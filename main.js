// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const bonjour = require("bonjour")();
const qrcode = require("qrcode");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { detectDisplays, moveWindowToDisplay, launchApp } = require("./nativeHelpers");

const REMOTE_PORT = 3000;
const CONFIG_PATH = path.join(app ? app.getPath('userData') : __dirname, "slab-config.json"); // persists per user

let mainWindow;
let wsServer;
let lastDisplaysJson = "[]";

// --- Config helpers ---
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (e) {
    console.error("loadConfig err", e);
  }
  return { neverShowHdmiPopup: false, defaultApp: { appId: "chrome", args: ["--new-window"] } };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch (e) {
    console.error("saveConfig err", e);
  }
}

// --- Core window / actions ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });

  mainWindow.loadFile("./renderer/index.html");
}

async function doLaunchSlab() {
  // Attempt to move main window to the external display and make fullscreen
  try {
    const displays = await detectDisplays();
    if (displays.length > 1 && displays[1] && displays[1].geometry) {
      const geo = displays[1].geometry;
      const match = geo.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (match) {
        const width = parseInt(match[1], 10);
        const height = parseInt(match[2], 10);
        const x = parseInt(match[3], 10);
        const y = parseInt(match[4], 10);
        mainWindow.setBounds({ x, y, width, height });
        // small delay then fullscreen
        setTimeout(() => {
          mainWindow.setFullScreen(true);
          mainWindow.focus();
        }, 200);
        return { ok: true, display: displays[1] };
      }
    } else {
      mainWindow.setFullScreen(true);
      mainWindow.focus();
      return { ok: true, display: null };
    }
  } catch (e) {
    console.error("doLaunchSlab err", e);
    return { ok: false, error: e.message };
  }
}

async function doLaunchApp(appId, args = []) {
  // map appId to actual command; expand later with config
  try {
    let cmd = null;
    let finalArgs = args || [];
    if (appId === "chrome") {
      cmd = "google-chrome";
      if (finalArgs.length === 0) finalArgs = ["--new-window"];
    } else if (appId === "vlc") {
      cmd = "vlc";
    } else if (appId === "stremio") {
      cmd = "stremio";
    } else {
      // fallback: try to run appId as command
      cmd = appId;
    }

    launchApp(cmd, finalArgs);

    // attempt to move newly launched app to second display
    setTimeout(async () => {
      try {
        const displays = await detectDisplays();
        if (displays.length > 1) {
          // best-effort move, title heuristics
          if (appId === "chrome") await moveWindowToDisplay("Google Chrome", displays[1]);
          if (appId === "vlc") await moveWindowToDisplay("VLC media player", displays[1]);
        }
      } catch (err) {
        console.error("post-launch move err", err);
      }
    }, 1000);

    return { ok: true };
  } catch (e) {
    console.error("doLaunchApp err", e);
    return { ok: false, error: e.message };
  }
}

// --- Express / WebSocket server ---
function startRemoteServer() {
  const appServer = express();
  appServer.use(bodyParser.json());
  appServer.use(express.static("remote"));

  // API: remotes can POST to trigger actions
  appServer.post("/api/launch-slab", async (req, res) => {
    const result = await doLaunchSlab();
    res.json(result);
  });

  appServer.post("/api/launch-app", async (req, res) => {
    const body = req.body || {};
    const appId = body.appId || (loadConfig().defaultApp || {}).appId || "chrome";
    const args = body.args || (loadConfig().defaultApp || {}).args || [];
    const result = await doLaunchApp(appId, args);
    res.json(result);
  });

  // minimal status endpoint
  appServer.get("/api/status", (req, res) => {
    res.json({ ok: true, host: os.hostname() });
  });

  const server = http.createServer(appServer);
  const wss = new WebSocket.Server({ server });

  wss.on("connection", socket => {
    console.log("Remote connected via websocket");

    socket.on("message", async msg => {
      try {
        const data = JSON.parse(msg);
        if (data.type === "input" && data.sub === "dpad") {
          const keyMap = { up: "Up", down: "Down", left: "Left", right: "Right", ok: "Return", back: "Escape" };
          if (keyMap[data.dir]) spawn("xdotool", ["key", keyMap[data.dir]]);
        } else if (data.type === "command" && data.name === "launch_app") {
          const { appId, args } = data;
          await doLaunchApp(appId, args);
        } else if (data.type === "pair_request") {
          const token = Math.random().toString(36).substring(2, 8);
          const uri = `slabtv://pair?token=${token}&host=${os.hostname()}:${REMOTE_PORT}`;
          const qr = await qrcode.toDataURL(uri);
          socket.send(JSON.stringify({ type: "pair", token, qr }));
        }
      } catch (err) {
        console.error("ws message err", err);
      }
    });
  });

  server.listen(REMOTE_PORT, () => {
    console.log(`Remote server running on http://localhost:${REMOTE_PORT}`);
  });

  wsServer = wss;

  bonjour.publish({ name: `SlabTV-${os.hostname()}`, type: "slabtv", port: REMOTE_PORT });
}

// --- display polling ---
async function startDisplayPolling(intervalMs = 1500) {
  try {
    const displays = await detectDisplays();
    lastDisplaysJson = JSON.stringify(displays);
    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("displays-changed", displays);
  } catch (e) {
    console.error("initial display poll err", e);
  }

  setInterval(async () => {
    try {
      const displays = await detectDisplays();
      const json = JSON.stringify(displays);
      if (json !== lastDisplaysJson) {
        lastDisplaysJson = json;
        if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("displays-changed", displays);
      }
    } catch (e) {
      console.error("display poll err", e);
    }
  }, intervalMs);
}

// IPC handlers
ipcMain.handle("launch-slab", async () => {
  return await doLaunchSlab();
});

ipcMain.handle("get-config", async () => {
  return loadConfig();
});

ipcMain.handle("save-config", async (evt, cfg) => {
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle("launch-app", async (evt, appId, args) => {
  return await doLaunchApp(appId, args);
});

// app lifecycle
app.whenReady().then(() => {
  createWindow();
  startRemoteServer();
  startDisplayPolling(1500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
