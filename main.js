const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const { spawn, exec } = require("child_process");
const WebSocket = require("ws");
const qrcode = require("qrcode");
const bonjour = require("bonjour")();
const os = require("os");

// Config / constants
const REMOTE_PORT = process.env.SLAB_REMOTE_PORT ? parseInt(process.env.SLAB_REMOTE_PORT, 10) : 3000;
const DEV_URL = process.env.DEV_URL || "http://localhost:5173"; // change via env if needed
const CONFIG_PATH = path.join(app.getPath("userData") || __dirname, "slab-config.json");
const DEFAULT_DEMO_ICON = "/mnt/data/f8b34732-0d43-4dbd-b74c-8c12d532a9cd.png"; // uploaded file path

// Attempt to load native helpers (you must have nativeHelpers.js exporting the functions)
let nativeHelpers = {};
try {
  nativeHelpers = require(path.join(__dirname, "nativeHelpers"));
} catch (e) {
  console.warn("nativeHelpers not found — continuing with stubs. Provide nativeHelpers.js for better UX.");
  nativeHelpers.detectDisplays = async () => [{ name: "Primary", geometry: "1920x1080+0+0" }];
  nativeHelpers.moveWindowToDisplay = async () => {};
  nativeHelpers.launchApp = (cmd, args = []) => {
    try {
      spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    } catch (err) {
      console.error("launchApp stub failed:", err);
    }
  };
}

let mainWindow = null;
let wsServer = null;

// -------------------- Config helpers --------------------
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (err) {
    console.error("loadConfig err", err);
  }
  // sensible defaults
  return {
    securityMode: "open", // "open" | "pairing"
    pairedRemotes: [],
    neverShowHdmiPopup: false,
    defaultApp: { appId: "chrome", args: ["--new-window"], webUrl: "https://www.youtube.com/" },
    appsTiles: [
      { id: "youtube", title: "YouTube", type: "web", url: "https://www.youtube.com/", icon: DEFAULT_DEMO_ICON },
      { id: "stremio", title: "Stremio", type: "web", url: "https://www.stremio.com/", icon: DEFAULT_DEMO_ICON },
      { id: "vlc", title: "VLC", type: "native", appId: "vlc", icon: DEFAULT_DEMO_ICON }
    ]
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch (err) {
    console.error("saveConfig err", err);
  }
}

// -------------------- Window --------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false, // show when ready-to-show
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Helpful for dev debugging: open devtools if env var set
  if (process.env.SLAB_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "right" });
  }

  // Show window when renderer ready (avoids blank frame)
  mainWindow.once("ready-to-show", () => {
    try {
      mainWindow.show();
    } catch (err) {
      console.warn("Failed to show window:", err);
    }
  });

  // Helpful logs for troubleshooting
  mainWindow.webContents.once("did-finish-load", () => {
    console.log("Renderer finished loading:", mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error("did-fail-load:", { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  mainWindow.webContents.on("render-process-gone", (event, details) => {
    console.error("render-process-gone:", details);
    // attempt to reload the UI (fallback)
    const fallback = path.join(__dirname, "renderer", "index.html");
    try { mainWindow.loadFile(fallback); } catch (e) { console.error("fallback load failed:", e); }
  });
}

// -------------------- Dev server helpers --------------------
function waitForUrl(url, timeoutMs = 20000, intervalMs = 250) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function tryOnce() {
      const req = http.request(url, { method: "HEAD", timeout: 1500 }, (res) => {
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, intervalMs);
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, intervalMs);
      });
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
      console.log("Loaded dev url:", devUrl);
      return true;
    } catch (err) {
      console.warn("loadURL failed attempt", attempt, err && err.message ? err.message : err);
      await new Promise((r) => setTimeout(r, delayMs));
      if (attempt === maxAttempts) {
        try {
          console.log("Attempting final fallback to file:", fallbackFile);
          await mainWindow.loadFile(fallbackFile);
          return true;
        } catch (fileErr) {
          console.error("Fallback loadFile failed:", fileErr);
          return false;
        }
      }
    }
  }
  return false;
}

// -------------------- Core actions --------------------
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
  } catch (err) {
    console.error("doLaunchSlab err", err);
    return { ok: false, error: err.message };
  }
}

async function doLaunchApp(appId, args = []) {
  try {
    let cmd = null;
    let finalArgs = args || [];

    if (appId === "chrome") {
      cmd = "google-chrome";
      if (!finalArgs.length) finalArgs = ["--new-window"];
    } else if (appId === "vlc") {
      cmd = "vlc";
    } else if (appId === "stremio") {
      cmd = "stremio";
    } else {
      cmd = appId;
    }

    nativeHelpers.launchApp(cmd, finalArgs);

    // try to move launched app to external display (best-effort)
    setTimeout(async () => {
      try {
        const displays = await nativeHelpers.detectDisplays();
        if (displays && displays.length > 1) {
          if (appId === "chrome") await nativeHelpers.moveWindowToDisplay("Google Chrome", displays[1]);
          if (appId === "vlc") await nativeHelpers.moveWindowToDisplay("VLC media player", displays[1]);
        }
      } catch (err) {
        console.error("post-launch move err", err);
      }
    }, 1000);

    return { ok: true };
  } catch (err) {
    console.error("doLaunchApp err", err);
    return { ok: false, error: err.message };
  }
}

async function doOpenUrlInView(url) {
  if (!mainWindow) return { ok: false, error: "no window" };
  try {
    await mainWindow.loadURL(url);
    mainWindow.setFullScreen(true);
    return { ok: true };
  } catch (err) {
    console.error("doOpenUrlInView err", err);
    return { ok: false, error: err.message };
  }
}

// -------------------- Remote server (express + ws) --------------------
function startRemoteServer() {
  const appServer = express();
  appServer.use(bodyParser.json());
  appServer.use(express.static(path.join(__dirname, "remote")));

  // API endpoints
  appServer.post("/api/launch-slab", async (req, res) => {
    res.json(await doLaunchSlab());
  });

  appServer.post("/api/launch-app", async (req, res) => {
    const body = req.body || {};
    const cfg = loadConfig();
    const appId = body.appId || (cfg.defaultApp || {}).appId || "chrome";
    const args = body.args || (cfg.defaultApp || {}).args || [];
    res.json(await doLaunchApp(appId, args));
  });

  appServer.get("/api/status", (req, res) => {
    res.json({ ok: true, host: os.hostname() });
  });

  const server = http.createServer(appServer);
  const wss = new WebSocket.Server({ server });
  wsServer = wss;

  wss.on("connection", (socket) => {
    console.log("Remote connected via WS");

    const cfg = loadConfig();
    const mode = cfg.securityMode || "open";
    socket.isPaired = mode === "open";

    socket.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);

        // pairing mode handling
        if (!socket.isPaired && mode === "pairing") {
          if (data.type === "pair_request") {
            const token = Math.random().toString(36).slice(2, 8);
            const hostString = `${os.hostname()}:${REMOTE_PORT}`;
            const uri = `slabtv://pair?token=${token}&host=${hostString}`;
            const qr = await qrcode.toDataURL(uri);

            socket.pairToken = token;
            socket.send(JSON.stringify({ type: "pair", token, host: hostString, uri, qr }));

            // notify renderer UI
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send("pair-request", { token, host: hostString });
            }
          }
          return;
        }

        // open mode or paired: process commands
        if (data.type === "input" && data.sub === "dpad") {
          const keyMap = { up: "Up", down: "Down", left: "Left", right: "Right", ok: "Return", back: "Escape" };
          if (keyMap[data.dir]) spawn("xdotool", ["key", keyMap[data.dir]]);
        } else if (data.type === "input" && data.sub === "mouse") {
          spawn("xdotool", ["click", "1"]);
        } else if (data.type === "input" && data.sub === "text") {
          spawn("xdotool", ["type", data.text]);
        } else if (data.type === "command" && data.name === "open_url") {
          doOpenUrlInView(data.url);
        } else if (data.type === "command" && data.name === "launch_app") {
          doLaunchApp(data.appId, data.args || []);
        }
      } catch (err) {
        console.error("ws message parse/handle err", err);
      }
    });

    socket.on("close", () => {
      console.log("Remote WS closed");
    });
  });

  server.listen(REMOTE_PORT, () => {
    console.log(`Remote server listening at http://localhost:${REMOTE_PORT}`);
  });

  bonjour.publish({ name: `SlabTV-${os.hostname()}`, type: "slabtv", port: REMOTE_PORT });
}

// -------------------- Display polling --------------------
function startDisplayPolling(intervalMs = 1500) {
  (async () => {
    try {
      const displays = await nativeHelpers.detectDisplays();
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("displays-changed", displays);
    } catch (err) {
      console.error("initial display poll err", err);
    }
  })();

  setInterval(async () => {
    try {
      const displays = await nativeHelpers.detectDisplays();
      if (mainWindow && mainWindow.webContents) mainWindow.webContents.send("displays-changed", displays);
    } catch (err) {
      console.error("display poll err", err);
    }
  }, intervalMs);
}

// -------------------- IPC --------------------
ipcMain.handle("launch-slab", () => doLaunchSlab());
ipcMain.handle("launch-app", (evt, appId, args) => doLaunchApp(appId, args));
ipcMain.handle("open-url-in-view", (evt, url) => doOpenUrlInView(url));
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (evt, cfg) => { saveConfig(cfg); return { ok: true }; });

ipcMain.handle("approve-remote", async (evt, token) => {
  const cfg = loadConfig();
  cfg.pairedRemotes = cfg.pairedRemotes || [];
  if (!cfg.pairedRemotes.includes(token)) {
    cfg.pairedRemotes.push(token);
    saveConfig(cfg);
  }

  // mark matching sockets as paired
  if (wsServer) {
    wsServer.clients.forEach((c) => {
      if (c.pairToken === token) c.isPaired = true;
    });
  }
  return { ok: true };
});

ipcMain.handle("exit-tile", async () => {
  try {
    // optional: attempt to kill commonly launched native apps when exiting tile
    try { exec("pkill -f stremio"); } catch (e) {}
    try { exec("pkill -f vlc"); } catch (e) {}
    try { exec("pkill -f chrome"); } catch (e) {}

    const up = await waitForUrl(DEV_URL, 2000, 200);
    mainWindow.setFullScreen(false);
    if (up) {
      await mainWindow.loadURL(DEV_URL);
    } else {
      await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
    return { ok: true };
  } catch (err) {
    console.error("exit-tile err", err);
    return { ok: false, error: err.message };
  }
});

// -------------------- App lifecycle --------------------
app.whenReady().then(async () => {
  createWindow();

  console.log("Preload path:", path.join(__dirname, "preload.js"));
  console.log("Renderer index path:", path.join(__dirname, "renderer", "index.html"));
  console.log("Dev URL:", DEV_URL);

  // dev: wait for dev server (if in non-production) then load it; otherwise load local index.html
  const fallbackHtml = path.join(__dirname, "renderer", "index.html");
  try {
    if (process.env.NODE_ENV !== "production") {
      const up = await waitForUrl(DEV_URL, 20000, 250);
      if (up) {
        await tryLoadDevUrlOrFallback(DEV_URL, fallbackHtml, 6, 800);
      } else {
        console.warn("Dev server not available — loading local index.html");
        await mainWindow.loadFile(fallbackHtml);
      }
    } else {
      await mainWindow.loadFile(fallbackHtml);
    }
  } catch (err) {
    console.error("Error during initial load:", err);
    try { await mainWindow.loadFile(fallbackHtml); } catch (e) { console.error("Final fallback failure:", e); }
  }

  startRemoteServer();
  startDisplayPolling();
});

// ensure app quits when windows are closed
app.on("window-all-closed", () => app.quit());

// -------------------- End of file --------------------
