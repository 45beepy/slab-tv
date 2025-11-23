// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bonjour = require("bonjour")();
const qrcode = require("qrcode");
const { spawn } = require("child_process");
const { detectDisplays, moveWindowToDisplay, launchApp } = require("./nativeHelpers");

let mainWindow;
let wsServer;
const REMOTE_PORT = 3000;
let lastDisplaysJson = "[]";

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

function startRemoteServer() {
  const appServer = express();
  appServer.use(express.static("remote"));

  const server = http.createServer(appServer);
  const wss = new WebSocket.Server({ server });

  wss.on("connection", socket => {
    console.log("Remote connected");

    socket.on("message", async msg => {
      try {
        const data = JSON.parse(msg);

        if (data.type === "input" && data.sub === "dpad") {
          const keyMap = {
            up: "Up",
            down: "Down",
            left: "Left",
            right: "Right",
            ok: "Return"
          };
          if (keyMap[data.dir]) spawn("xdotool", ["key", keyMap[data.dir]]);
        }

        if (data.type === "command" && data.name === "launch_app") {
          const proc = launchApp("google-chrome", ["--new-window"]);
          setTimeout(async () => {
            const displays = await detectDisplays();
            if (displays.length > 1) {
              moveWindowToDisplay("Google Chrome", displays[1]);
            }
          }, 1000);
        }

        if (data.type === "pair_request") {
          const token = Math.random().toString(36).substring(2, 8);
          const uri = `slabtv://pair?token=${token}`;
          const qr = await qrcode.toDataURL(uri);
          socket.send(JSON.stringify({ type: "pair", token, qr }));
        }

      } catch (err) {
        console.log("WS error:", err);
      }
    });
  });

  server.listen(REMOTE_PORT, () => {
    console.log("Remote server running on http://localhost:" + REMOTE_PORT);
  });

  wsServer = wss;

  // mDNS advertise
  bonjour.publish({ name: "SlabTV", type: "slabtv", port: REMOTE_PORT });
}

// Periodic polling of displays (xrandr)
async function startDisplayPolling(intervalMs = 1500) {
  try {
    const displays = await detectDisplays();
    lastDisplaysJson = JSON.stringify(displays);
    // send initial state when window exists
    if (mainWindow) mainWindow.webContents.send("displays-changed", displays);
  } catch (e) {
    console.error("initial display poll err", e);
  }

  setInterval(async () => {
    try {
      const displays = await detectDisplays();
      const json = JSON.stringify(displays);
      if (json !== lastDisplaysJson) {
        lastDisplaysJson = json;
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("displays-changed", displays);
        }
      }
    } catch (e) {
      console.error("display poll err", e);
    }
  }, intervalMs);
}

// IPC handler: renderer requests we enter "Slab TV" mode
ipcMain.handle("launch-slab", async () => {
  try {
    const displays = await detectDisplays();
    if (displays.length > 1 && displays[1] && displays[1].geometry) {
      // geometry format: WIDTHxHEIGHT+X+Y (e.g. 1920x1080+1920+0)
      const geo = displays[1].geometry;
      const match = geo.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (match) {
        const width = parseInt(match[1], 10);
        const height = parseInt(match[2], 10);
        const x = parseInt(match[3], 10);
        const y = parseInt(match[4], 10);
        // move window to external display and set fullscreen
        mainWindow.setBounds({ x, y, width, height });
        // allow a moment for bounds to apply
        setTimeout(() => {
          mainWindow.setFullScreen(true);
          mainWindow.focus();
        }, 200);
        return { ok: true, display: displays[1] };
      }
    } else {
      // single display fallback: just fullscreen current window
      mainWindow.setFullScreen(true);
      mainWindow.focus();
      return { ok: true, display: null };
    }
  } catch (e) {
    console.error("launch-slab err", e);
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  startRemoteServer();
  startDisplayPolling(1500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
