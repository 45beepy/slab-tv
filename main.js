// main.js
// Complete main process for Slab TV (development-friendly)
// - Dev: waits for Vite and loads dev URL
// - Remote: Express + WebSocket server with pairing QR
// - Display polling (xrandr wrapper in nativeHelpers)
// - BrowserView-based Slab mode (embed web apps inside Electron window)
// - IPC handlers for renderer <-> main (launch-slab, exit-slab, open-url-in-view, launch-app, config)

const { app, BrowserWindow, ipcMain, BrowserView } = require("electron");
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
const CONFIG_PATH = path.join(app ? app.getPath("userData") : __dirname, "slab-config.json");

let mainWindow = null;
let wsServer = null;
let lastDisplaysJson = "[]";

// BrowserView / Slab-mode state
let activeView = null;
let previousBounds = null;
let isInSlabMode = false;

// --------------------- Config helpers ---------------------
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

// --------------------- Window creation ---------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // We'll load renderer content later (dev: loadURL; prod: loadFile).
}

// --------------------- BrowserView helpers ---------------------
async function openUrlInBrowserView(url) {
  try {
    // remove existing view
    if (activeView) {
      try {
        mainWindow.removeBrowserView(activeView);
        activeView.webContents.destroy();
      } catch (e) { /* ignore */ }
      activeView = null;
    }

    previousBounds = mainWindow.getBounds();

    activeView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    mainWindow.setBrowserView(activeView);

    // fill the whole window (change if you want a top bar)
    const [w, h] = mainWindow.getSize();
    activeView.setBounds({ x: 0, y: 0, width: w, height: h });
    activeView.setAutoResize({ width: true, height: true });

    // load URL
    await activeView.webContents.loadURL(url);

    // focus so it can receive input
    activeView.webContents.focus();

    isInSlabMode = true;
    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("slab-state", { slab: true });

    return { ok: true };
  } catch (e) {
    console.error("openUrlInBrowserView error", e);
    return { ok: false, error: e.message };
  }
}

async function exitSlab() {
  try {
    if (activeView) {
      try {
        mainWindow.removeBrowserView(activeView);
        activeView.webContents.destroy();
      } catch (e) { /* ignore */ }
      activeView = null;
    }

    try { mainWindow.setFullScreen(false); } catch (e) {}
    if (previousBounds) {
      try { mainWindow.setBounds(previousBounds); } catch (e) {}
      previousBounds = null;
    }

    isInSlabMode = false;
    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("slab-state", { slab: false });
    return { ok: true };
  } catch (e) {
    console.error("exitSlab error", e);
    return { ok: false, error: e.message };
  }
}

// --------------------- App launching / embedded logic ---------------------
async function doLaunchSlab() {
  try {
    const cfg = loadConfig();
    const defaultApp = cfg.defaultApp || { appId: "chrome", args: ["--new-window"] };

    // try to find a URL in args (simple heuristic)
    const urlArg = (defaultApp.args || []).find(a => /^https?:\/\//i.test(a));
    const urlToOpen = urlArg || "https://www.youtube.com/";

    // Make the window fullscreen (so BrowserView will fill it)
    try { mainWindow.setFullScreen(true); } catch (e) {}

    return await openUrlInBrowserView(urlToOpen);
  } catch (e) {
    console.error("doLaunchSlab err", e);
    return { ok: false, error: e.message };
  }
}

async function doLaunchApp(appId, args = []) {
  try {
    // Fallback: for native apps, keep launching externally
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
      cmd = appId;
    }

    launchApp(cmd, finalArgs);

    // attempt best-effort move to external display (if any)
    setTimeout(async () => {
      try {
        const displays = await detectDisplays();
        if (displays.length > 1) {
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

// --------------------- Remote server (Express + WebSocket) ---------------------
function startRemoteServer() {
  const appServer = express();
  appServer.use(bodyParser.json());
  appServer.use(express.static("remote"));

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

        // D-pad / navigation input forwarding
        if (data.type === "input" && data.sub === "dpad") {
          const keyMap = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", ok: "Enter", back: "Escape" };
          const key = keyMap[data.dir];

          if (activeView && activeView.webContents) {
            try {
              activeView.webContents.focus();
              // send a down+up to emulate a press
              activeView.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
              activeView.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
            } catch (e) {
              console.error("sendInputEvent error", e);
            }
          } else {
            // fallback to xdotool (system-level)
            if (key) {
              const fallback = key.replace("Arrow", ""); // ArrowUp -> Up
              spawn("xdotool", ["key", fallback]);
            }
          }

        } else if (data.type === "input" && data.sub === "text") {
          // For text, send keystrokes to the view or fallback to xdotool
          const text = data.text || "";
          if (activeView && activeView.webContents) {
            try {
              // send each char (basic)
              for (const ch of text) {
                activeView.webContents.sendInputEvent({ type: "char", keyCode: ch });
              }
            } catch (e) { console.error("text input error", e); }
          } else {
            spawn("xdotool", ["type", text]);
          }

        } else if (data.type === "command" && data.name === "launch_app") {
          const { appId, args } = data;
          await doLaunchApp(appId, args);

        } else if (data.type === "command" && data.name === "open_url") {
          const { url } = data;
          if (url && activeView) {
            try {
              await activeView.webContents.loadURL(url);
            } catch (e) { console.error("open_url error", e); }
          } else if (url) {
            // if not in view, launch slab mode using the URL
            await openUrlInBrowserView(url);
          }

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

  try {
    bonjour.publish({ name: `SlabTV-${os.hostname()}`, type: "slabtv", port: REMOTE_PORT });
  } catch (e) {
    console.warn("mDNS advertise failed (bonjour)", e);
  }
}

// --------------------- Display polling ---------------------
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

// --------------------- IPC handlers ---------------------
ipcMain.handle("launch-slab", async () => {
  return await doLaunchSlab();
});
ipcMain.handle("exit-slab", async () => {
  return await exitSlab();
});
ipcMain.handle("open-url-in-view", async (evt, url) => {
  return await openUrlInBrowserView(url);
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

// --------------------- Helper: wait for URL ---------------------
async function waitForUrl(url, timeout = 20000, interval = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, res => { res.destroy(); resolve(); });
        req.on("error", reject);
      });
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, interval));
    }
  }
  return false;
}

// --------------------- App lifecycle ---------------------
app.whenReady().then(async () => {
  createWindow();

  // start remote API early
  try { startRemoteServer(); } catch (e) { console.error("startRemoteServer error", e); }

  // load renderer (dev: loadURL once vite is ready; prod: load built files)
  const devUrl = process.env.VITE_DEV_URL || "http://localhost:5174";
  if (process.env.NODE_ENV !== "production") {
    try {
      const up = await waitForUrl(devUrl, 20000, 200);
      if (up) {
        mainWindow.loadURL(devUrl);
      } else {
        console.warn("Dev server not responding, falling back to local file");
        mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
      }
    } catch (e) {
      console.error("URL wait error", e);
      mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  }

  try { startDisplayPolling(1500); } catch (e) { console.error("startDisplayPolling err", e); }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  try {
    if (process.platform !== "darwin") {
      if (wsServer && wsServer.close) {
        try { wsServer.close(); } catch (e) { /* ignore */ }
      }
      app.quit();
    }
  } catch (e) {
    console.error("window-all-closed handler err", e);
    app.quit();
  }
});
