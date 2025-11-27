const { contextBridge, ipcRenderer } = require('electron');

// --- GLOBAL CURSOR STATE ---
const cursorState = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  el: null,
  timer: null
};

// --- CURSOR RENDERER ---
function getCursor() {
  let el = document.getElementById('slab-cursor');
  if (!el) {
    el = document.createElement('div');
    el.id = 'slab-cursor';
    Object.assign(el.style, {
      position: 'fixed',
      top: '0px',
      left: '0px',
      width: '24px',
      height: '24px',
      backgroundColor: 'rgba(6, 182, 212, 0.9)', // Cyan
      borderRadius: '50%',
      border: '2px solid white',
      pointerEvents: 'none', // Critical!
      zIndex: '2147483647',
      transform: `translate(${cursorState.x}px, ${cursorState.y}px)`,
      opacity: '0',
      transition: 'opacity 0.2s ease',
      boxShadow: '0 0 10px rgba(0,0,0,0.5)'
    });
    document.body.appendChild(el);
  }
  return el;
}

// --- INPUT LISTENERS ---

// 1. Mouse Move
ipcRenderer.on('remote-pointer-delta', (evt, { dx, dy }) => {
  try {
    const el = getCursor();
    cursorState.x = Math.max(0, Math.min(window.innerWidth, cursorState.x + (dx || 0)));
    cursorState.y = Math.max(0, Math.min(window.innerHeight, cursorState.y + (dy || 0)));

    el.style.transform = `translate(${cursorState.x}px, ${cursorState.y}px)`;
    el.style.opacity = '1';

    if (cursorState.timer) clearTimeout(cursorState.timer);
    cursorState.timer = setTimeout(() => {
      const c = document.getElementById('slab-cursor');
      if (c) c.style.opacity = '0';
    }, 3000);
  } catch (e) { console.error(e); }
});

// 2. Mouse Click
ipcRenderer.on('remote-mouse-click', (evt, { which }) => {
  try {
    const el = getCursor();
    
    // Animation
    el.style.transform = `translate(${cursorState.x}px, ${cursorState.y}px) scale(0.8)`;
    setTimeout(() => {
      el.style.transform = `translate(${cursorState.x}px, ${cursorState.y}px) scale(1)`;
    }, 150);

    // Perform Click
    const target = document.elementFromPoint(cursorState.x, cursorState.y);
    if (target) {
      target.focus();
      target.click();
      
      // Force extra events for React apps
      const opts = { bubbles: true, cancelable: true, view: window };
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
    }
  } catch (e) { console.error(e); }
});

// 3. Keyboard (D-Pad)
ipcRenderer.on('remote-input', (evt, { key }) => {
  try {
    const keyMap = {
      'Up': { code: 'ArrowUp', keyCode: 38 },
      'Down': { code: 'ArrowDown', keyCode: 40 },
      'Left': { code: 'ArrowLeft', keyCode: 37 },
      'Right': { code: 'ArrowRight', keyCode: 39 },
      'Return': { code: 'Enter', keyCode: 13 },
      'Escape': { code: 'Escape', keyCode: 27 },
      'Back': { code: 'Backspace', keyCode: 8 }
    };

    const k = keyMap[key];
    if (k) {
      const active = document.activeElement || document.body;
      const opts = { key: k.code, code: k.code, keyCode: k.keyCode, bubbles: true, cancelable: true, view: window };
      active.dispatchEvent(new KeyboardEvent('keydown', opts));
      setTimeout(() => active.dispatchEvent(new KeyboardEvent('keyup', opts)), 50);
    }
  } catch (e) { console.error(e); }
});

// --- EXPOSE API ---
contextBridge.exposeInMainWorld('slab', {
  launchApp: (id, args) => ipcRenderer.invoke('launch-app', id, args),
  openUrlInView: (url) => ipcRenderer.invoke('open-url-in-view', url),
  exitTile: () => ipcRenderer.invoke('exit-tile'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  approveRemote: (t) => ipcRenderer.invoke('approve-remote', t),
  
  onDisplaysChanged: (cb) => ipcRenderer.on('displays-changed', (evt, val) => cb(val)),
  onPairRequest: (cb) => ipcRenderer.on('pair-request', (evt, val) => cb(val)),
  onRemoteInput: (cb) => ipcRenderer.on('remote-input', (evt, val) => cb(val)),
});
