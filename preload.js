// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("slab", {
  onDisplaysChanged: (cb) => {
    ipcRenderer.on("displays-changed", (_, displays) => cb(displays));
  },
  launchSlab: async () => {
    // returns result {ok:true|false}
    return await ipcRenderer.invoke("launch-slab");
  }
});

