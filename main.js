const { app, BrowserWindow } = require("electron");
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

app.whenReady().then(() => {
  createWindow();
  startRemoteServer();
});

app.on("window-all-closed", () => app.quit());
