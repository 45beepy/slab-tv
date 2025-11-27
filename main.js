// main.js — embed-web + MPRIS + X11 fallback + pointer/mouse handling + remote server
const { app, BrowserWindow, ipcMain } = require("electron");
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

// Helper: Safely spawn processes without crashing if binary is missing
function safeSpawn(command, args = []) {
  try {
    const child = spawn(command, args, { stdio: "ignore" });
    // CRITICAL FIX: Catch 'error' event (like ENOENT) to prevent app crash
    child.on("error", (err) => {
      // console.warn(`Native command '${command}' failed:`, err.message);
    });
    return true;
  } catch (e) {
    return false;
  }
}

// try to load nativeHelpers if present
let nativeHelpers = {};
try { nativeHelpers = require(path.join(__dirname, "nativeHelpers")); } catch (e) {
  console.warn("nativeHelpers not found — using stubs");
  nativeHelpers.detectDisplays = async () => [{ name: "Primary", geometry: "1920x1080+0+0" }];
  nativeHelpers.moveWindowToDisplay = async () => {};
  nativeHelpers.launchApp = (cmd, args = []) => safeSpawn(cmd, args);
}

let mainWindow = null;
const ALLOW_X11_FALLBACK = process.env.ALLOW_X11_FALLBACK === "1";
const PLAYERCTL_AVAILABLE = (() => { try { execSync("playerctl -v", { stdio: "ignore" }); return true; } catch (e) { return false; } })();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) { console.error("loadConfig err", e); }
  return {
    securityMode: "open",
    pairedRemotes: [],
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
  mainWindow.once("ready-to-show", () => { try { mainWindow.show(); } catch (e) {} });
  mainWindow.webContents.on("before-input-event",(event,input)=>{
    if (input && input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      exitTileAction();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function isX11Session() {
  return String(process.env.XDG_SESSION_TYPE || "").toLowerCase() === "x11";
}

function focusWindowByName(name) {
  return new Promise(resolve => {
    if (!ALLOW_X11_FALLBACK || !isX11Session()) return resolve(false);
    exec(`xdotool search --name "${name}" | head -n1`, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      const win = stdout.trim();
      exec(`xdotool windowactivate ${win}`, (e2) => {
        setTimeout(() => resolve(true), 120);
      });
    });
  });
}

// System Input Fallbacks (using safeSpawn)
function xdotoolMouseRelative(dx, dy) {
  if (!ALLOW_X11_FALLBACK || !isX11Session()) return false;
  return safeSpawn("xdotool", ["mousemove_relative", "--", String(dx), String(dy)]);
}
function xdotoolClick(which = "1") {
  if (!ALLOW_X11_FALLBACK || !isX11Session()) return false;
  return safeSpawn("xdotool", ["click", which]);
}
function tryYdotool(argsArray) {
  // Safe spawn prevents ENOENT crash
  return safeSpawn("ydotool", argsArray);
}

// PlayerCtl Helpers
async function mediaCmd(args) {
  if (!PLAYERCTL_AVAILABLE) return { ok: false };
  try { execSync(["playerctl", ...args].join(" "), { stdio: "ignore" }); return { ok: true }; } catch (e) { return { ok: false }; }
}

async function doOpenUrlInView(url) {
  if (!mainWindow) return { ok: false };
  try { await mainWindow.loadURL(url); try { mainWindow.setFullScreen(true); } catch(e){}; return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
}

async function doLaunchApp(appId, args = []) {
  try {
    let cmd = appId; let finalArgs = args || [];
    if (appId === "chrome") { cmd = "google-chrome"; if (!finalArgs.length) finalArgs = ["--new-window"]; }
    else if (appId === "stremio") { try { execSync("flatpak run --version"); cmd = "flatpak"; finalArgs = ["run", "com.stremio.Stremio", ...finalArgs]; } catch (e) { cmd = "stremio"; } }
    
    safeSpawn(cmd, finalArgs);
    global.lastLaunchedApp = appId;
    
    setTimeout(async () => {
      if (appId === "stremio") await focusWindowByName("Stremio");
      if (appId === "vlc") await focusWindowByName("VLC");
      if (appId === "chrome") await focusWindowByName("Google Chrome");
    }, 1000);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function doLaunchSlab() {
  try {
    const displays = await nativeHelpers.detectDisplays();
    if (displays && displays[1] && displays[1].geometry) {
      const m = displays[1].geometry.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (m) mainWindow.setBounds({ x: +m[3], y: +m[4], width: +m[1], height: +m[2] });
    }
    mainWindow.setFullScreen(true);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

async function exitTileAction() {
  global.lastLaunchedApp = null;
  if (!mainWindow) return { ok: false };
  try {
    // try to load local dev server or index.html
    const fallback = path.join(__dirname, "renderer", "index.html");
    if (process.env.NODE_ENV !== "production") {
        try { await mainWindow.loadURL(DEV_URL); } catch(e) { await mainWindow.loadFile(fallback); }
    } else {
        await mainWindow.loadFile(fallback);
    }
    mainWindow.setFullScreen(false);
    mainWindow.focus();
    return { ok: true };
  } catch (e) { return { ok: false }; }
}

// --- SERVER ---
function startRemoteServer() {
  const appServer = express();
  appServer.use(bodyParser.json());
  appServer.use(express.static(path.join(__dirname, "remote")));

  appServer.post("/api/launch-app", async (req, res) => res.json(await doLaunchApp(req.body.appId, req.body.args)));
  
  const server = http.createServer(appServer);
  const wss = new WebSocket.Server({ server });

  wss.on("connection", socket => {
    socket.on("message", async raw => {
      let data; try { data = JSON.parse(raw); } catch (e) { return; }
      
      // Helper to send to renderer safely
      const sendToRenderer = (ch, pl) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          try { mainWindow.webContents.send(ch, pl); } catch(e){}
        }
      };

      try {
        if (data.type === "input" && data.sub === "touch") {
          const { dx, dy } = data;
          // 1. Send to Visual Cursor (Preload)
          sendToRenderer("remote-pointer-delta", { dx, dy });
          // 2. Try Native (Safe)
          if (!xdotoolMouseRelative(dx, dy)) tryYdotool(["mousemove_relative", String(dx), String(dy)]);

        } else if (data.type === "input" && data.sub === "mouse") {
          const btn = data.action === "left" ? "1" : "3";
          // 1. Send to Visual Cursor
          sendToRenderer("remote-mouse-click", { which: data.action });
          // 2. Try Native (Safe)
          if (!xdotoolClick(btn)) tryYdotool(["click", btn]);

        } else if (data.type === "input" && data.sub === "dpad") {
          // Send key to Renderer
          sendToRenderer("remote-input", { key: data.dir });
          
          // Also try Native Key press if outside app
          const keyMap = { up: "Up", down: "Down", left: "Left", right: "Right", ok: "Return", back: "Escape" };
          const k = keyMap[data.dir];
          if (k && global.lastLaunchedApp) {
             safeSpawn("xdotool", ["key", k]);
          }
        } 
        // ... (Launch commands, etc)
        else if (data.type === "command" && data.name === "launch_app") {
            await doLaunchApp(data.appId);
        } else if (data.type === "command" && data.name === "open_url") {
            await doOpenUrlInView(data.url);
        }
      } catch (e) { console.error("WS Handler Err", e); }
    });
  });

  server.listen(REMOTE_PORT, () => console.log(`Remote running on port ${REMOTE_PORT}`));
  try { bonjour.publish({ name: `SlabTV-${os.hostname()}`, type: "slabtv", port: REMOTE_PORT }); } catch (e) {}
}

// IPC
ipcMain.handle("launch-app", (e, id, args) => doLaunchApp(id, args));
ipcMain.handle("open-url-in-view", (e, url) => doOpenUrlInView(url));
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (e, cfg) => { saveConfig(cfg); return { ok: true }; });
ipcMain.handle("exit-tile", () => exitTileAction());

app.whenReady().then(() => {
  createWindow();
  if (process.env.NODE_ENV !== "production") mainWindow.loadURL(DEV_URL).catch(() => mainWindow.loadFile(path.join(__dirname, "renderer", "index.html")));
  else mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  startRemoteServer();
});
app.on("window-all-closed", () => app.quit());
