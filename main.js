// main.js — embed-web + MPRIS + X11 fallback + pointer/mouse handling + remote server
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

const REMOTE_PORT = process.env.SLAB_REMOTE_PORT ? parseInt(process.env.SLAB_REMOTE_PORT, 10) : 3000;
const DEV_URL = process.env.DEV_URL || "http://localhost:5173";
const CONFIG_PATH = path.join(app.getPath("userData") || __dirname, "slab-config.json");

// try to load nativeHelpers if present
let nativeHelpers = {};
try { nativeHelpers = require(path.join(__dirname, "nativeHelpers")); } catch (e) {
  console.warn("nativeHelpers not found — using stubs");
  nativeHelpers.detectDisplays = async () => [{ name: "Primary", geometry: "1920x1080+0+0" }];
  nativeHelpers.moveWindowToDisplay = async () => {};
  nativeHelpers.launchApp = (cmd, args = []) => {
    try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore' }); c.unref(); } catch (err) { console.error('launchApp stub failed', err); }
  };
}

let mainWindow = null;
let wsServer = null;

const ALLOW_X11_FALLBACK = process.env.ALLOW_X11_FALLBACK === "1";
const PLAYERCTL_AVAILABLE = (() => { try { execSync("playerctl -v", { stdio: "ignore" }); return true; } catch (e) { return false; } })();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error("loadConfig err", e);
  }
  // sensible default config
  return {
    securityMode: "open",
    pairedRemotes: [],
    neverShowHdmiPopup: false,
    defaultApp: { appId: "chrome", args: ["--new-window"], webUrl: "https://www.youtube.com/" },
    apps: {
      chrome: { type: "web", webUrl: "https://www.youtube.com/", title: "YouTube (Chrome)", icon: "" },
      stremio: { type: "native", appId: "stremio", title: "Stremio", icon: "" },
      vlc: { type: "native", appId: "vlc", title: "VLC", icon: "" }
    }
  };
}

function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8"); } catch (e) { console.error("saveConfig err", e); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 720, show: false, backgroundColor: "#0f172a",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });

  mainWindow.once("ready-to-show", () => { try { mainWindow.show(); } catch (e) { console.warn("show failed", e); } });

  mainWindow.webContents.once("did-finish-load", () => console.log("Renderer finished loading:", mainWindow.webContents.getURL()));

  mainWindow.webContents.on("before-input-event",(event,input)=>{
    if (input && input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      exitTileAction().catch(err => console.error("exitTileAction err", err));
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// helper: is X11 session?
function isX11Session() {
  return String(process.env.XDG_SESSION_TYPE || "").toLowerCase() === "x11";
}

// X11 helpers (best-effort)
function focusWindowByName(name) {
  return new Promise(resolve => {
    if (!ALLOW_X11_FALLBACK || !isX11Session()) return resolve(false);
    exec(`xdotool search --name "${name}" | head -n1`, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      const win = stdout.trim();
      exec(`xdotool windowactivate ${win}`, (e2) => {
        if (e2) return resolve(false);
        setTimeout(() => resolve(true), 120);
      });
    });
  });
}
function sendKeyWithXdotool(key) {
  if (!ALLOW_X11_FALLBACK || !isX11Session()) return false;
  try { spawn("xdotool", ["key", key]); return true; } catch (e) { console.warn("xdotool key failed", e); return false; }
}
function xdotoolMouseRelative(dx, dy) {
  if (!ALLOW_X11_FALLBACK || !isX11Session()) return false;
  try { spawn("xdotool", ["mousemove_relative", "--", String(dx), String(dy)]); return true; } catch (e) { return false; }
}
function xdotoolClick(which = "1") {
  if (!ALLOW_X11_FALLBACK || !isX11Session()) return false;
  try { spawn("xdotool", ["click", which]); return true; } catch (e) { return false; }
}

// Wayland-ish fallback: try ydotool if installed
function tryYdotool(argsArray) {
  try { spawn("ydotool", argsArray, { stdio: "ignore" }); return true; } catch (e) { return false; }
}

// MPRIS helpers (playerctl)
async function mediaPlayPause(player = null) {
  if (!PLAYERCTL_AVAILABLE) return { ok: false, error: "playerctl not available" };
  const args = player ? ["--player", player, "play-pause"] : ["play-pause"];
  try { execSync(["playerctl", ...args].join(" "), { stdio: "ignore" }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
async function mediaNext(player = null) {
  if (!PLAYERCTL_AVAILABLE) return { ok: false, error: "playerctl not available" };
  const args = player ? ["--player", player, "next"] : ["next"];
  try { execSync(["playerctl", ...args].join(" "), { stdio: "ignore" }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
async function mediaPrev(player = null) {
  if (!PLAYERCTL_AVAILABLE) return { ok: false, error: "playerctl not available" };
  const args = player ? ["--player", player, "previous"] : ["previous"];
  try { execSync(["playerctl", ...args].join(" "), { stdio: "ignore" }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
async function mediaVolume(delta = 0, player = null) {
  if (!PLAYERCTL_AVAILABLE) return { ok: false, error: "playerctl not available" };
  try {
    let cur = execSync(["playerctl", ...(player ? ["--player", player] : []), "volume"].join(" "), { encoding: "utf8" }).trim();
    cur = parseFloat(cur || "1.0");
    let next = Math.min(1.0, Math.max(0.0, cur + delta));
    execSync(["playerctl", ...(player ? ["--player", player] : []), "volume", String(next)].join(" "), { stdio: "ignore" });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// open url inside main BrowserWindow (embed)
async function doOpenUrlInView(url) {
  if (!mainWindow) return { ok: false, error: "no window" };
  try { await mainWindow.loadURL(url); try { mainWindow.setFullScreen(true); } catch(e){}; return { ok: true }; } catch (err) { console.error("doOpenUrlInView err", err); return { ok: false, error: err.message }; }
}

// launch native app (flatpak-aware for stremio); record lastLaunchedApp
async function doLaunchApp(appId, args = []) {
  try {
    let cmd = null; let finalArgs = args || [];
    if (appId === "chrome") { cmd = "google-chrome"; if (!finalArgs.length) finalArgs = ["--new-window"]; }
    else if (appId === "vlc") { cmd = "vlc"; }
    else if (appId === "stremio") {
      try { execSync("flatpak run --version", { stdio: "ignore" }); cmd = "flatpak"; finalArgs = ["run", "com.stremio.Stremio", ...finalArgs]; } catch (e) { cmd = "stremio"; }
    } else { cmd = appId; }
    const child = spawn(cmd, finalArgs, { detached: true, stdio: "ignore" }); try { child.unref(); } catch(e){}
    global.lastLaunchedApp = appId;
    setTimeout(async () => {
      try {
        if (appId === "stremio") await focusWindowByName("Stremio");
        if (appId === "vlc") await focusWindowByName("VLC");
        if (appId === "chrome") await focusWindowByName("Google Chrome");
      } catch (err) { console.warn("post-launch focus err", err); }
    }, 900);
    try { if (mainWindow) { mainWindow.setFullScreen(false); mainWindow.blur(); } } catch(e){}
    return { ok: true };
  } catch (e) { console.error("doLaunchApp err", e); return { ok: false, error: e.message }; }
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
  } catch (err) { console.error("doLaunchSlab err", err); return { ok: false, error: err.message }; }
}

async function exitTileAction() {
  try {
    global.lastLaunchedApp = null;
    if (!mainWindow) return { ok: false, error: "no window" };
    const up = await (async (url, tm=2000, it=200) => {
      const start = Date.now();
      return new Promise(res => {
        (function t(){ const req = http.request(url, { method: "HEAD", timeout: 1500 }, () => res(true)); req.on("error", ()=>{ if (Date.now()-start>tm) return res(false); setTimeout(t,it); }); req.on("timeout", ()=>{ req.destroy(); if (Date.now()-start>tm) return res(false); setTimeout(t,it); }); req.end(); })();
      });
    })(DEV_URL,2000,200);
    try { mainWindow.focus(); } catch(e){}
    mainWindow.setFullScreen(false);
    if (up) await mainWindow.loadURL(DEV_URL); else await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    return { ok: true };
  } catch (err) { console.error("exitTileAction err", err); return { ok: false, error: err.message }; }
}

// Remote/WS server
function startRemoteServer() {
  const appServer = express();
  appServer.use(bodyParser.json());
  appServer.use(express.static(path.join(__dirname, "remote")));

  appServer.post("/api/launch-slab", async (req, res) => res.json(await doLaunchSlab()));
  appServer.post("/api/launch-app", async (req, res) => {
    const body = req.body || {}; const appId = body.appId || (loadConfig().defaultApp || {}).appId || "chrome"; const args = body.args || (loadConfig().defaultApp || {}).args || [];
    res.json(await doLaunchApp(appId, args));
  });
  appServer.get("/api/status", (req, res) => res.json({ ok: true, host: os.hostname() }));
  appServer.post("/api/media/play-pause", async (req, res) => { const player = req.body?.player || null; res.json(await mediaPlayPause(player)); });
  appServer.post("/api/media/next", async (req, res) => { const player = req.body?.player || null; res.json(await mediaNext(player)); });
  appServer.post("/api/media/prev", async (req, res) => { const player = req.body?.player || null; res.json(await mediaPrev(player)); });

  const server = http.createServer(appServer);
  const wss = new WebSocket.Server({ server });
  wsServer = wss;

  wss.on("connection", socket => {
    console.log("Remote WS connected");
    socket.isPaired = true;
    socket.on("message", async raw => {
      let data; try { data = JSON.parse(typeof raw === "string" ? raw : raw.toString()); } catch (err) { console.warn("WS parse failed", err); return; }
      try {
        // pointer/touch events
        if (data.type === "input" && data.sub === "touch") {
          const dx = data.dx || 0, dy = data.dy || 0;
          // forward to embedded web UI
          if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("remote-pointer-delta", { dx, dy });
          // fallback to native input
          const last = global.lastLaunchedApp;
          if (ALLOW_X11_FALLBACK && isX11Session()) { xdotoolMouseRelative(dx, dy); return; }
          if (tryYdotool(["mousemove_relative", String(dx), String(dy)])) return;
        } else if (data.type === "input" && data.sub === "mouse") {
          if (data.action === "left") { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("remote-mouse-click", { which: "left" }); if (ALLOW_X11_FALLBACK && isX11Session()) xdotoolClick("1"); else tryYdotool(["click", "1"]); }
          if (data.action === "right") { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("remote-mouse-click", { which: "right" }); if (ALLOW_X11_FALLBACK && isX11Session()) xdotoolClick("3"); else tryYdotool(["click", "3"]); }
        } else if (data.type === "input" && data.sub === "dpad") {
          const keyMap = { up: "Up", down: "Down", left: "Left", right: "Right", ok: "Return", back: "Escape" };
          const key = keyMap[data.dir];
          if (!key) return;
          // media shortcuts via MPRIS for vlc
          const last = global.lastLaunchedApp;
          if (last === "vlc" && data.dir === "ok") { await mediaPlayPause("vlc"); return; }
          // try focusing native app then send key via xdotool
          if (ALLOW_X11_FALLBACK && isX11Session() && last) {
            if (last === "stremio") await focusWindowByName("Stremio");
            if (last === "vlc") await focusWindowByName("VLC");
            if (last === "chrome") await focusWindowByName("Google Chrome");
            const sent = sendKeyWithXdotool(key);
            if (sent) return;
          }
          // otherwise forward as remote-input to renderer (for embedded web UI)
          if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("remote-input", { key, raw: data });
        } else if (data.type === "command" && data.name === "launch_app") {
          await doLaunchApp(data.appId, data.args || []);
        } else if (data.type === "command" && data.name === "open_url") {
          await doOpenUrlInView(data.url);
        } else if (data.type === "command" && data.name === "media") {
          const cmd = data.cmd;
          if (cmd === "play-pause") await mediaPlayPause(data.player || null);
          if (cmd === "next") await mediaNext(data.player || null);
          if (cmd === "prev") await mediaPrev(data.player || null);
        } else if (data.type === "pair_request") {
          const token = Math.random().toString(36).slice(2,8);
          const hostString = `${os.hostname()}:${REMOTE_PORT}`;
          const uri = `slabtv://pair?token=${token}&host=${hostString}`;
          const qr = await qrcode.toDataURL(uri);
          socket.pairToken = token;
          socket.send(JSON.stringify({ type: "pair", token, host: hostString, uri, qr }));
          if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("pair-request", { token, host: hostString });
        } else {
          console.log("WS: unknown message", data);
        }
      } catch (handlerErr) { console.error("WS handler err", handlerErr); }
    });

    socket.on("close", () => console.log("Remote WS disconnected"));
    socket.on("error", (err) => console.error("Remote WS error", err));
  });

  server.listen(REMOTE_PORT, () => console.log(`Remote server listening at http://localhost:${REMOTE_PORT}`));
  try { bonjour.publish({ name: `SlabTV-${os.hostname()}`, type: "slabtv", port: REMOTE_PORT }); } catch (e) { console.warn("bonjour publish failed", e); }
}

function startDisplayPolling(intervalMs = 1500) {
  (async () => { try { const displays = await nativeHelpers.detectDisplays(); if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("displays-changed", displays); } catch (e) { console.error("initial display poll err", e); } })();
  setInterval(async () => { try { const displays = await nativeHelpers.detectDisplays(); if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("displays-changed", displays); } catch (e) { console.error("display poll err", e); } }, intervalMs);
}

// IPC
ipcMain.handle("launch-slab", () => doLaunchSlab());
ipcMain.handle("launch-app", (evt, appId, args) => doLaunchApp(appId, args));
ipcMain.handle("open-url-in-view", (evt, url) => doOpenUrlInView(url));
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (evt, cfg) => { saveConfig(cfg); return { ok: true }; });
ipcMain.handle("exit-tile", async () => exitTileAction());
ipcMain.handle("media-play-pause", async (evt, player) => mediaPlayPause(player));
ipcMain.handle("media-next", async (evt, player) => mediaNext(player));
ipcMain.handle("media-prev", async (evt, player) => mediaPrev(player));

process.on("unhandledRejection", (err) => console.error("unhandledRejection", err));

app.whenReady().then(async () => {
  createWindow();
  const fallback = path.join(__dirname, "renderer", "index.html");
  try {
    if (process.env.NODE_ENV !== "production") {
      const up = await (async (url, tm=20000, it=250) => {
        const start = Date.now();
        return new Promise(res => {
          (function t(){ const req = http.request(url, { method: "HEAD", timeout: 1500 }, ()=>res(true)); req.on("error", ()=>{ if (Date.now()-start>tm) return res(false); setTimeout(t,it); }); req.on("timeout", ()=>{ req.destroy(); if (Date.now()-start>tm) return res(false); setTimeout(t,it); }); req.end(); })();
        });
      })(DEV_URL,20000,250);
      if (up) await (async function(){ let attempt=0; while(attempt<6){ attempt++; try{ console.log(`attempt ${attempt} loading ${DEV_URL} ...`); await mainWindow.loadURL(DEV_URL); console.log("Loaded dev url:", DEV_URL); return; } catch(e){ console.warn("loadURL failed", attempt, e && e.message ? e.message : e); await new Promise(r=>setTimeout(r,800)); if(attempt===6){ await mainWindow.loadFile(fallback); return; } } } })();
      else { console.warn("Dev server not available — loading local index.html"); await mainWindow.loadFile(fallback); }
    } else { await mainWindow.loadFile(fallback); }
  } catch (err) { console.error("Error during initial load", err); try { await mainWindow.loadFile(fallback); } catch (e) { console.error("Final fallback failure", e); } }

  startRemoteServer();
  startDisplayPolling();
});

app.on("window-all-closed", () => app.quit());
