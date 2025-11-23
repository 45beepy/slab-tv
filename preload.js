
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slab', {
  // displays
  onDisplaysChanged: (cb) => {
    ipcRenderer.on('displays-changed', (evt, displays) => cb(displays));
  },

  // slab actions
  launchSlab: async () => ipcRenderer.invoke('launch-slab'),
  launchSlabChoice: async (choice) => ipcRenderer.invoke('launch-slab-choice', choice),
  exitSlab: async () => ipcRenderer.invoke('exit-slab'),
  openUrlInView: async (url) => ipcRenderer.invoke('open-url-in-view', url),

  // config
  getConfig: async () => ipcRenderer.invoke('get-config'),
  saveConfig: async (cfg) => ipcRenderer.invoke('save-config', cfg),

  // native apps
  launchApp: async (appId, args) => ipcRenderer.invoke('launch-app', appId, args)
});

