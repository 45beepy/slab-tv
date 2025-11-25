// main.js — patched for Flatpak Stremio, escape handling, robust remote WS parsing, dev URL retries
// Paste this into your project (replace existing main.js). Requires nativeHelpers.js or will use stubs.

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const { spawn, execSync, exec } = require("child_process");
const WebSocket = require("ws");
const qrcode = require("qrcode");
const bonjour = require("bonjour")();
const os = require("os");

// Config
const REMOTE_PORT = process.env.SLAB_REMOTE_PORT ? parseInt(process.env.SLAB_REMOTE_PORT, 10) : 3000;
const DEV_URL = process.env.DEV_URL || "http://localhost:5173";
const CONFIG_PATH = path.join(app.getPath("userData") || __dirname, "slab-config.json");
const DEFAULT_ICON = "/mnt/data/e964f202-19dc-4f76-8704-397525e1c456.png";

// load nativeHelpers if present
let nativeHelpers = {};
try {
  nativeHelpers = require(path.join(__dirname, "nativeHelpers"));
} catch (e) {
  console.warn("nativeHelpers not found — using stubs");
  nativeHelpers.detectDisplays = async () => [{ name: "Primary", geometry: "1920x1080+0+0" }];
  nativeHelpers.moveWindowToDisplay = async () => {};
  nativeHelpers.launchApp = (cmd, args = []) => {
    try {
      const c = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      c.unref();
    } catch (err) {
      console.error('launchApp stub failed', err);
    }
  };
}

let mainWindow = null;
let wsServer = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('loadConfig err', e);
  }
  return {
    securityMode: 'open',
    pairedRemotes: [],
    neverShowHdmiPopup: false,
    defaultApp: { appId: 'chrome', args: ['--new-window'], webUrl: 'https://www.youtube.com/' },
    apps: {
      chrome: { type: 'web', webUrl: 'https://www.youtube.com/', title: 'Chrome' },
      stremio: { type: 'native', appId: 'stremio', title: 'Stremio' },
      vlc: { type: 'native', appId: 'vlc', title: 'VLC' }
    }
  };
}

function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) { console.error('saveConfig err', e); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.SLAB_OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'right' });

  mainWindow.once('ready-to-show', () => { try { mainWindow.show(); } catch (e) { console.warn('show failed', e); } });

  mainWindow.webContents.once('did-finish-load', () => {
    console.log('Renderer finished loading:', mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error('did-fail-load', { code, desc, url });
  });

  mainWindow.webContents.on('render-process-gone', (e, details) => {
    console.error('render-process-gone', details);
  });

  // catch Escape before page consumes it
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      exitTileAction().catch(err => console.error('exitTileAction err', err));
    }
  });
}

function waitForUrl(url, timeoutMs = 20000, intervalMs = 250) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function tryOnce() {
      const req = http.request(url, { method: 'HEAD', timeout: 1500 }, (res) => resolve(true));
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, intervalMs);
      });
      req.on('timeout', () => { req.destroy(); if (Date.now() - start > timeoutMs) return resolve(false); setTimeout(tryOnce, intervalMs); });
      req.end();
    })();
  });
}

async function tryLoadDevUrlOrFallback(devUrl, fallbackFile, maxAttempts = 6, delayMs = 800) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      console.log(`attempt ${attempt} loading ${devUrl} ...`);
      await mainWindow.loadURL(devUrl);
      console.log('Loaded dev url:', devUrl);
      return true;
    } catch (err) {
      console.warn('loadURL failed', attempt, err && err.message ? err.message : err);
      await new Promise(r => setTimeout(r, delayMs));
      if (attempt === maxAttempts) {
        try { await mainWindow.loadFile(fallbackFile); return true; } catch (e) { console.error('fallback load failed', e); return false; }
      }
    }
  }
  return false;
}

async function doLaunchSlab() {
  try {
    const displays = await nativeHelpers.detectDisplays();
    if (displays && displays.length > 1 && displays[1] && displays[1].geometry) {
      const geo = displays[1].geometry;
      const match = geo.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (match) {
        const width = +match[1], height = +match[2], x = +match[3], y = +match[4];
        mainWindow.setBounds({ x, y, width, height });
        setTimeout(() => mainWindow.setFullScreen(true), 150);
        return { ok: true, display: displays[1] };
      }
    }
    mainWindow.setFullScreen(true);
    return { ok: true, display: null };
  } catch (err) { console.error('doLaunchSlab err', err); return { ok: false, error: err.message }; }
}

async function doLaunchApp(appId, args = []) {
  try {
    let cmd = null; let finalArgs = args || [];

    if (appId === 'chrome') { cmd = 'google-chrome'; if (!finalArgs.length) finalArgs = ['--new-window']; }
    else if (appId === 'vlc') { cmd = 'vlc'; }
    else if (appId === 'stremio') {
      // prefer flatpak if available
      try {
        execSync('flatpak info --show-sdk com.stremio.Stremio', { stdio: 'ignore' });
        cmd = 'flatpak'; finalArgs = ['run', 'com.stremio.Stremio', ...finalArgs];
      } catch (e) {
        // fallback
        cmd = 'stremio';
      }
    } else { cmd = appId; }

    const child = spawn(cmd, finalArgs, { detached: true, stdio: 'ignore' });
    try { child.unref(); } catch (e) {}

    try { if (mainWindow) { mainWindow.setFullScreen(false); mainWindow.blur(); } } catch (e) {}

    setTimeout(async () => {
      try {
        const displays = await nativeHelpers.detectDisplays();
        if (displays && displays.length > 1) {
          if (appId === 'stremio') await nativeHelpers.moveWindowToDisplay('Stremio', displays[1]);
          if (appId === 'chrome') await nativeHelpers.moveWindowToDisplay('Google Chrome', displays[1]);
        }
      } catch (err) { console.error('post-launch move err', err); }
    }, 1200);

    return { ok: true };
  } catch (err) { console.error('doLaunchApp err', err); return { ok: false, error: err.message }; }
}

async function doOpenUrlInView(url) {
  if (!mainWindow) return { ok: false, error: 'no window' };
  try { await mainWindow.loadURL(url); mainWindow.setFullScreen(true); return { ok: true }; } catch (err) { console.error('doOpenUrlInView err', err); return { ok: false, error: err.message }; }
}

async function exitTileAction() {
  try {
    try { exec('pkill -f stremio'); } catch (e) {}
    try { exec('pkill -f vlc'); } catch (e) {}
    try { exec('pkill -f chrome'); } catch (e) {}

    if (!mainWindow) return { ok: false, error: 'no window' };
    const up = await waitForUrl(DEV_URL, 2000, 200);
    try { mainWindow.focus(); } catch (e) {}
    mainWindow.setFullScreen(false);
    if (up) { await mainWindow.loadURL(DEV_URL); } else { await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')); }
    return { ok: true };
  } catch (err) { console.error('exitTileAction err', err); return { ok: false, error: err.message }; }
}

function startRemoteServer() {
  const appServer = express();
  appServer.use(bodyParser.json());
  appServer.use(express.static(path.join(__dirname, 'remote')));

  appServer.post('/api/launch-slab', async (req, res) => res.json(await doLaunchSlab()));
  appServer.post('/api/launch-app', async (req, res) => {
    const body = req.body || {}; const cfg = loadConfig();
    const appId = body.appId || (cfg.defaultApp || {}).appId || 'chrome';
    const args = body.args || (cfg.defaultApp || {}).args || [];
    res.json(await doLaunchApp(appId, args));
  });
  appServer.get('/api/status', (req, res) => res.json({ ok: true, host: os.hostname() }));

  const server = http.createServer(appServer);
  const wss = new WebSocket.Server({ server });
  wsServer = wss;

  wss.on('connection', (socket) => {
    console.log('Remote WS connected');
    const cfg = loadConfig(); const mode = cfg.securityMode || 'open';
    socket.isPaired = (mode === 'open');

    socket.on('message', async (msg) => {
      let data;
      try { const txt = (typeof msg === 'string') ? msg : msg.toString(); data = JSON.parse(txt); } catch (err) { console.warn('WS: failed parse', err); return; }
      try {
        if (mode === 'pairing' && !socket.isPaired) {
          if (data.type === 'pair_request') {
            const token = Math.random().toString(36).slice(2,8);
            const hostString = `${os.hostname()}:${REMOTE_PORT}`;
            const uri = `slabtv://pair?token=${token}&host=${hostString}`;
            const qr = await qrcode.toDataURL(uri);
            socket.pairToken = token;
            socket.send(JSON.stringify({ type: 'pair', token, host: hostString, uri, qr }));
            if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('pair-request', { token, host: hostString });
          }
          return;
        }

        if (data.type === 'input' && data.sub === 'dpad') {
          const keyMap = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', ok: 'Return', back: 'Escape' };
          if (keyMap[data.dir]) spawn('xdotool', ['key', keyMap[data.dir]]);
        } else if (data.type === 'input' && data.sub === 'mouse') {
          spawn('xdotool', ['click', '1']);
        } else if (data.type === 'input' && data.sub === 'text') {
          spawn('xdotool', ['type', data.text || '']);
        } else if (data.type === 'command' && data.name === 'open_url') {
          if (data.url) await doOpenUrlInView(data.url);
        } else if (data.type === 'command' && data.name === 'launch_app') {
          await doLaunchApp(data.appId, data.args || []);
        } else if (data.type === 'command' && data.name === 'exit_tile') {
          await exitTileAction();
        } else {
          console.log('WS: unknown message', data);
        }
      } catch (handlerErr) { console.error('WS handler err', handlerErr); }
    });

    socket.on('close', () => console.log('Remote WS disconnected'));
    socket.on('error', (err) => console.error('Remote WS error', err));
  });

  server.listen(REMOTE_PORT, () => console.log(`Remote server listening at http://localhost:${REMOTE_PORT}`));
  try { bonjour.publish({ name: `SlabTV-${os.hostname()}`, type: 'slabtv', port: REMOTE_PORT }); } catch (e) { console.warn('bonjour publish failed', e); }
}

function startDisplayPolling(intervalMs = 1500) {
  (async () => { try { const displays = await nativeHelpers.detectDisplays(); if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('displays-changed', displays); } catch (e) { console.error('initial display poll err', e); } })();
  setInterval(async () => { try { const displays = await nativeHelpers.detectDisplays(); if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('displays-changed', displays); } catch (e) { console.error('display poll err', e); } }, intervalMs);
}

ipcMain.handle('launch-slab', () => doLaunchSlab());
ipcMain.handle('launch-app', (evt, appId, args) => doLaunchApp(appId, args));
ipcMain.handle('open-url-in-view', (evt, url) => doOpenUrlInView(url));
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (evt, cfg) => { saveConfig(cfg); return { ok: true }; });
ipcMain.handle('approve-remote', async (evt, token) => {
  const cfg = loadConfig(); cfg.pairedRemotes = cfg.pairedRemotes || []; if (!cfg.pairedRemotes.includes(token)) { cfg.pairedRemotes.push(token); saveConfig(cfg); }
  if (wsServer) wsServer.clients.forEach(c => { if (c.pairToken === token) c.isPaired = true; });
  return { ok: true };
});
ipcMain.handle('exit-tile', async () => exitTileAction());

process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

app.whenReady().then(async () => {
  createWindow();
  console.log('Preload path:', path.join(__dirname, 'preload.js'));
  console.log('Renderer index path:', path.join(__dirname, 'renderer', 'index.html'));
  console.log('Dev URL:', DEV_URL);

  const fallback = path.join(__dirname, 'renderer', 'index.html');
  try {
    if (process.env.NODE_ENV !== 'production') {
      const up = await waitForUrl(DEV_URL, 20000, 250);
      if (up) await tryLoadDevUrlOrFallback(DEV_URL, fallback, 6, 800);
      else { console.warn('Dev server not available — loading local index.html'); await mainWindow.loadFile(fallback); }
    } else { await mainWindow.loadFile(fallback); }
  } catch (err) { console.error('Error during initial load', err); try { await mainWindow.loadFile(fallback); } catch (e) { console.error('Final fallback failure', e); } }

  startRemoteServer();
  startDisplayPolling();
});

app.on('window-all-closed', () => app.quit());
