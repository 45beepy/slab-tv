// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("slab", {
  onDisplaysChanged: (cb) => {
    ipcRenderer.on("displays-changed", (_, displays) => cb(displays));
  },
  launchSlab: async () => {
    return await ipcRenderer.invoke("launch-slab");
  },
  getConfig: async () => {
    return await ipcRenderer.invoke("get-config");
  },
  saveConfig: async (cfg) => {
    return await ipcRenderer.invoke("save-config", cfg);
  },
  launchApp: async (appId, args) => {
    return await ipcRenderer.invoke("launch-app", appId, args);
  }
});
