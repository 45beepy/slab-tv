// preload.js (patched)
// Path: /home/sonicknucklesss/slab-tv/preload.js
// Exposes a safe API to renderer. Use window.slab.<fn> from your React app.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slab', {
  // Launch a native app (appId from config, e.g. 'stremio', 'vlc', 'chrome')
  launchApp: async (appId, args = []) => {
    try {
      const res = await ipcRenderer.invoke('launch-app', appId, args);
      return res;
    } catch (e) {
      console.error('preload.launchApp err', e);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },

  // Open a URL inside the main BrowserWindow (useful for web tiles)
  openUrlInView: async (url) => {
    try {
      const res = await ipcRenderer.invoke('open-url-in-view', url);
      return res;
    } catch (e) {
      console.error('preload.openUrlInView err', e);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },

  // Exit a tile (return to home UI)
  exitTile: async () => {
    try {
      const res = await ipcRenderer.invoke('exit-tile');
      return res;
    } catch (e) {
      console.error('preload.exitTile err', e);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },

  // Config read/write
  getConfig: async () => {
    try {
      return await ipcRenderer.invoke('get-config');
    } catch (e) {
      console.error('preload.getConfig err', e);
      return null;
    }
  },
  saveConfig: async (cfg) => {
    try {
      return await ipcRenderer.invoke('save-config', cfg);
    } catch (e) {
      console.error('preload.saveConfig err', e);
      return { ok: false };
    }
  },

  // Approve a remote pairing token (called from renderer UI when user accepts pairing)
  approveRemote: async (token) => {
    try {
      return await ipcRenderer.invoke('approve-remote', token);
    } catch (e) {
      console.error('preload.approveRemote err', e);
      return { ok: false };
    }
  },

  // Listen for display changes and pairing events from main
  onDisplaysChanged: (cb) => {
    ipcRenderer.on('displays-changed', (evt, displays) => cb(displays));
  },
  onPairRequest: (cb) => {
    ipcRenderer.on('pair-request', (evt, info) => cb(info));
  }
});
