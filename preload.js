// preload.js — Exposes safe IPC bridge APIs to renderer
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("slab", {
  // Launch Slab TV fullscreen on HDMI
  launchSlab: () => ipcRenderer.invoke("launch-slab"),

  // Launch native app (chrome, vlc, etc.)
  launchApp: (appId, args) => ipcRenderer.invoke("launch-app", appId, args),

  // Open URL inside Electron BrowserView/kiosk
  openUrlInView: (url) => ipcRenderer.invoke("open-url-in-view", url),

  // Config access
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),

  // Pairing approval
  approveRemote: (token) => ipcRenderer.invoke("approve-remote", token),

  // Renderer listens to pairing requests
  onPairRequest: (cb) => {
    ipcRenderer.on("pair-request", (_, data) => cb(data));
  },

  // Renderer listens for display changes (HDMI hotplug)
  onDisplaysChanged: (cb) => {
    ipcRenderer.on("displays-changed", (_, displays) => cb(displays));
  }
});

