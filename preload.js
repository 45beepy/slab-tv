// preload
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("slab", {
  onDisplaysChanged: cb => ipcRenderer.on("displays-changed", (_, d) => cb(d))
});
