// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slab', {
  // Commands (Renderer -> Main)
  launchApp: async (appId, args = []) => ipcRenderer.invoke('launch-app', appId, args),
  openUrlInView: async (url) => ipcRenderer.invoke('open-url-in-view', url),
  exitTile: async () => ipcRenderer.invoke('exit-tile'),
  getConfig: async () => ipcRenderer.invoke('get-config'),
  saveConfig: async (cfg) => ipcRenderer.invoke('save-config', cfg),
  approveRemote: async (token) => ipcRenderer.invoke('approve-remote', token),

  // Listeners (Main -> Renderer)
  onDisplaysChanged: (cb) => ipcRenderer.on('displays-changed', (evt, val) => cb(val)),
  onPairRequest: (cb) => ipcRenderer.on('pair-request', (evt, val) => cb(val)),

  // --- CRITICAL: This bridges the remote signals to the UI ---
  onRemoteInput: (cb) => ipcRenderer.on('remote-input', (evt, val) => cb(val)),
  onRemotePointerDelta: (cb) => ipcRenderer.on('remote-pointer-delta', (evt, val) => cb(val)),
  onRemoteMouseClick: (cb) => ipcRenderer.on('remote-mouse-click', (evt, val) => cb(val)),
});
