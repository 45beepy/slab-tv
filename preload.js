const { contextBridge, ipcRenderer } = require('electron');

// --- 1. GLOBAL CURSOR STATE ---
const cursorState = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  el: null,
  timer: null,
  visible: false
};

// --- 2. CURSOR RENDERER ---
function getOrCreateCursor() {
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
      pointerEvents: 'none', // Critical: clicks pass through
      zIndex: '2147483647',
      transform: `translate(${cursorState.x}px, ${cursorState.y}px)`,
      opacity: '0',
      transition: 'opacity 0.2s ease',
      boxShadow: '0 0 10px rgba(0,0,0,0.5)',
      willChange: 'transform'
    });
    document.body.appendChild(el);
  }
  return el;
}

// Helper to update cursor position
function updateCursor(x, y, visible = true) {
  try {
    const el = getOrCreateCursor();
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.opacity = visible ? '1' : '0';
    
    if (visible) {
      if (cursorState.timer) clearTimeout(cursorState.timer);
      cursorState.timer = setTimeout(() => {
        const c = document.getElementById('slab-cursor');
        if (c) c.style.opacity = '0';
      }, 3000);
    }
  } catch (err) {
    console.error("Cursor update failed:", err);
  }
}

// --- 3. INPUT HANDLERS ---

// HANDLE TRACKPAD MOVEMENT
ipcRenderer.on('remote-pointer-delta', (evt, { dx, dy }) => {
  try {
    const el = getOrCreateCursor();
    // Update X/Y with Screen Clamping
    cursorState.x = Math.max(0, Math.min(window.innerWidth, cursorState.x + dx));
    cursorState.y = Math.max(0, Math.min(window.innerHeight, cursorState.y + dy));

    updateCursor(cursorState.x, cursorState.y, true);
  } catch (e) {
    console.error("remote-pointer-delta error:", e);
  }
});

// HANDLE MOUSE CLICKS
ipcRenderer.on('remote-mouse-click', (evt, { which }) => {
  try {
    const el = getOrCreateCursor();
    
    // Animate click
    const originalTransform = el.style.transform;
    el.style.transform += ' scale(0.8)';
    el.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
    
    setTimeout(() => {
      el.style.transform = originalTransform;
      el.style.backgroundColor = 'rgba(6, 182, 212, 0.9)';
    }, 150);

    // Perform Click
    const target = document.elementFromPoint(cursorState.x, cursorState.y);
    if (target) {
      target.focus();
      target.click();
      
      const opts = { bubbles: true, cancelable: true, view: window };
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
    }
  } catch (e) {
    console.error("remote-mouse-click error:", e);
  }
});

// HANDLE KEYBOARD (D-PAD) - FIXED KEY MAPPING
ipcRenderer.on('remote-input', (evt, { key }) => {
  try {
    // Normalize key to lower case to match remote input
    const normalizedKey = key ? key.toLowerCase() : '';

    const keyMap = {
      // D-Pad Directionals
      'up': { code: 'ArrowUp', keyCode: 38 },
      'down': { code: 'ArrowDown', keyCode: 40 },
      'left': { code: 'ArrowLeft', keyCode: 37 },
      'right': { code: 'ArrowRight', keyCode: 39 },
      
      // Actions
      'ok': { code: 'Enter', keyCode: 13 },
      'enter': { code: 'Enter', keyCode: 13 },
      'return': { code: 'Enter', keyCode: 13 },
      
      // Navigation
      'back': { code: 'Backspace', keyCode: 8 },
      'escape': { code: 'Escape', keyCode: 27 }
    };

    const k = keyMap[normalizedKey];
    
    if (k) {
      console.log(`[Preload] Simulating ${k.code} from remote key: ${key}`);
      const active = document.activeElement || document.body;
      const opts = { 
        key: k.code, 
        code: k.code, 
        keyCode: k.keyCode, 
        bubbles: true, 
        cancelable: true, 
        view: window 
      };
      
      // Dispatch KeyDown then KeyUp
      active.dispatchEvent(new KeyboardEvent('keydown', opts));
      setTimeout(() => active.dispatchEvent(new KeyboardEvent('keyup', opts)), 50);
    } else {
      console.warn(`[Preload] Unknown remote key: ${key}`);
    }
  } catch (e) {
    console.error("remote-input error:", e);
  }
});

// --- 4. EXPOSE API ---
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
