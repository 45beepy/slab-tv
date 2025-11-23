// main.js — SlabTV (Full Hybrid Security Mode Version)
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
const CONFIG_PATH = path.join(app.getPath('userData'), "slab-config.json");

let mainWindow;
let wsServer;

// ======================
//      CONFIG HELPERS
// ======================
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (e) {
    console.error("loadConfig err", e);
  }
  return {
    securityMode: "open",        // open | pairing
    pairedRemotes: [],
    neverShowHdmiPopup: false,
    defaultApp: { appId: "chrome", args: ["--new-window"], webUrl: "https://www.youtube.com/" },
    appsTiles: []
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch (e) {
    console.error("saveConfig err", e);
  }
}

// ======================
//   ELECTRON WINDOW
// ======================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile("./renderer/index.html");
}

// ======================
//   SLAB TV ACTIONS
// ======================
async function doLaunchSlab() {
  try {
    const displays = await detectDisplays();
    if (displays.length > 1 && displays[1].geometry) {
      const geo = displays[1].geometry;
      const match = geo.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (match) {
        const width = +match[1], height = +match[2], x = +match[3], y = +match[4];
        mainWindow.setBounds({ x, y, width, height });
        setTimeout(() => mainWindow.setFullScreen(true), 150);
        return { ok: true };
      }
    }
    mainWindow.setFullScreen(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function doLaunchApp(appId, args = []) {
  try {
    let cmd = null;
    if (appId === "chrome") {
      cmd = "google-chrome";
    } else if (appId === "vlc") {
      cmd = "vlc";
    } else {
      cmd = appId;
    }

    launchApp(cmd, args);

    setTimeout(async () => {
      try {
        const displays = await detectDisplays();
        if (displays.length > 1) {
          if (appId === "chrome") await moveWindowToDisplay("Google Chrome", displays[1]);
          if (appId === "vlc") await moveWindowToDisplay("VLC media player", displays[1]);
        }
      } catch (e) {}
    }, 1000);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function doOpenUrlInView(url) {
  if (!mainWindow) return { ok: false, error: "No window" };
  try {
    mainWindow.setFullScreen(true);
    mainWindow.loadURL(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ======================
//  REMOTE MSG HANDLER
// ======================
function handleRemoteMessage(data) {
  if (!data) return;

  // D-pad controls
  if (data.type === "input" && data.sub === "dpad") {
    const keyMap = { up: "Up", down: "Down", left: "Left", right: "Right", ok: "Return", back: "Escape" };
    if (keyMap[data.dir]) spawn("xdotool", ["key", keyMap[data.dir]]);
  }

  // Mouse click
  else if (data.type === "input" && data.sub === "mouse") {
    spawn("xdotool", ["click", "1"]);
  }

  // Keyboard text
  else if (data.type === "input" && data.sub === "text") {
    spawn("xdotool", ["type", data.text]);
  }

  // Open web URL inside browser view
  else if (data.type === "command" && data.name === "open_url") {
    doOpenUrlInView(data.url);
  }

  // Launch native app
  else if (data.type === "command" && data.name === "launch_app") {
    doLaunchApp(data.appId, data.args || []);
  }
}

// ======================
// EXPRESS + WS REMOTE SERVER
// ======================
function startRemoteServer() {
  const appServer = express();
  appServer.use(bodyParser.json());
  appServer.use(express.static("remote"));

  // Simple HTTP APIs
  appServer.post("/api/open-url", (req, res) => {
    const { url } = req.body;
    doOpenUrlInView(url);
    res.json({ ok: true });
  });

  const server = http.createServer(appServer);
  const wss = new WebSocket.Server({ server });
  wsServer = wss;

  wss.on("connection", (socket) => {
    console.log("Remote connected");

    const cfg = loadConfig();
    const mode = cfg.securityMode || "open";

    // In OPEN mode, socket is automatically trusted
    socket.isPaired = (mode === "open");

    socket.on("message", async (msg) => {
      let data;
      try { data = JSON.parse(msg); } catch { return; }

      // Open mode → allow everything
      if (mode === "open") {
        handleRemoteMessage(data);
        return;
      }

      // Pairing mode
      if (!socket.isPaired) {
        if (data.type === "pair_request") {
          const token = Math.random().toString(36).substring(2, 8);
          const hostString = `${os.hostname()}:${REMOTE_PORT}`;
          const pairingUri = `slabtv://pair?token=${token}&host=${hostString}`;
          const qr = await qrcode.toDataURL(pairingUri);

          socket.pairToken = token;

          socket.send(JSON.stringify({
            type: "pair",
            token,
            host: hostString,
            uri: pairingUri,
            qr
          }));

          mainWindow.webContents.send("pair-request", { token, host: hostString });

          return;
        }
        return; // ignore other commands
      }

      // Already paired → accept commands
      handleRemoteMessage(data);
    });
  });

  server.listen(REMOTE_PORT, () => {
    console.log(`Remote server running at http://localhost:${REMOTE_PORT}`);
  });

  bonjour.publish({ name: `SlabTV-${os.hostname()}`, type: "slabtv", port: REMOTE_PORT });
}

// ======================
//   DISPLAY POLLING
// ======================
async function startDisplayPolling() {
  async function poll() {
    try {
      const displays = await detectDisplays();
      mainWindow.webContents.send("displays-changed", displays);
    } catch (e) {}
  }
  poll();
  setInterval(poll, 1500);
}

// ======================
//     IPC HANDLERS
// ======================
ipcMain.handle("launch-slab", () => doLaunchSlab());
ipcMain.handle("launch-app", (e, appId, args) => doLaunchApp(appId, args));
ipcMain.handle("open-url-in-view", (e, url) => doOpenUrlInView(url));
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (e, cfg) => { saveConfig(cfg); return { ok: true }; });

// Approve pairing
ipcMain.handle("approve-remote", async (evt, token) => {
  const cfg = loadConfig();
  cfg.pairedRemotes = cfg.pairedRemotes || [];

  if (!cfg.pairedRemotes.includes(token)) {
    cfg.pairedRemotes.push(token);
    saveConfig(cfg);
  }

  // Activate any socket waiting for this token
  wsServer.clients.forEach(client => {
    if (client.pairToken === token) client.isPaired = true;
  });

  return { ok: true };
});

// ======================
// APP LIFECYCLE
// ======================

// helper: wait for an HTTP URL to respond (simple poll)
function waitForUrl(url, timeoutMs = 20000, intervalMs = 200) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function tryOnce() {
      const req = http.request(url, { method: 'HEAD', timeout: 1500 }, (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, intervalMs);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, intervalMs);
      });
      req.end();
    })();
  });
}


// robust app.whenReady() — try dev server, fallback to local file, and log failures
async function waitForUrl(url, timeoutMs = 20000, intervalMs = 250) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function tryOnce() {
      const req = http.request(url, { method: 'HEAD', timeout: 1500 }, (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, intervalMs);
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, intervalMs);
      });
      req.end();
    })();
  });
}

app.whenReady().then(async () => {
  createWindow();

  // log some helpful paths to terminal for debugging:
  console.log("Preload path:", path.join(__dirname, "preload.js"));
  console.log("Renderer index path:", path.join(__dirname, "renderer", "index.html"));

  const devUrl = "http://localhost:5175"; // <- set this to exact port Vite printed

  // clean handlers to catch failed loads / crashes
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('Renderer finished loading:', mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('did-fail-load:', { errorCode, errorDescription, validatedURL, isMainFrame });
    if (validatedURL && validatedURL.startsWith('http') && errorCode !== -3) {
      // if http load failed for a reason other than fallback -3, try fallback
      try {
        mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
      } catch (err) {
        console.error("loadFile fallback error:", err);
      }
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
    // try to reload a local file to recover
    try {
      mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    } catch (err) {
      console.error("reload fallback failed:", err);
    }
  });

  try {
    if (process.env.NODE_ENV !== "production") {
      const up = await waitForUrl(devUrl, 20000, 250);
      if (up) {
        console.log("Dev server available, loading:", devUrl);
        try {
          await mainWindow.loadURL(devUrl);
          console.log("Loaded dev server into Electron:", devUrl);
        } catch (loadErr) {
          console.error("Error loading dev URL:", loadErr);
          // fallback to local file
          try {
            mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
          } catch (err) {
            console.error("Fallback loadFile error:", err);
          }
        }
      } else {
        console.warn("Dev server not available — loading local index.html");
        mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
      }
    } else {
      mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
  } catch (e) {
    console.error("Error while waiting for dev server:", e);
    try {
      mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    } catch (err) {
      console.error("Final fallback error loading file:", err);
    }
  }

  // start the rest of your services
  startRemoteServer();
  startDisplayPolling();
});

app.on("window-all-closed", () => app.quit());
