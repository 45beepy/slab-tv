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
function initCursor() {
  // If cursor already exists, don't create another
  if (document.getElementById('slab-cursor')) {
    cursorState.el = document.getElementById('slab-cursor');
    return;
  }

  const el = document.createElement('div');
  el.id = 'slab-cursor';
  
  // Style the cursor (Cyan Circle)
  Object.assign(el.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: '24px',
    height: '24px',
    backgroundColor: 'rgba(6, 182, 212, 0.9)', // Cyan
    borderRadius: '50%',
    border: '2px solid white',
    pointerEvents: 'none', // CRITICAL: Allows clicks to pass through to the element below
    zIndex: '2147483647', // Max valid Z-Index to stay on top of everything
    transform: `translate(${cursorState.x}px, ${cursorState.y}px)`,
    opacity: '0', // Hidden by default
    transition: 'opacity 0.2s ease', // Smooth fade
    boxShadow: '0 0 10px rgba(0,0,0,0.5)',
    willChange: 'transform' // Hardware acceleration hint
  });
  
  document.body.appendChild(el);
  cursorState.el = el;
}

// Inject cursor immediately when any page loads
window.addEventListener('DOMContentLoaded', initCursor);

// --- 3. INPUT HANDLERS ---

// HANDLE TRACKPAD MOVEMENT
ipcRenderer.on('remote-pointer-delta', (evt, { dx, dy }) => {
  if (!cursorState.el) initCursor();
  
  // Update X/Y with Screen Clamping
  cursorState.x = Math.max(0, Math.min(window.innerWidth, cursorState.x + dx));
  cursorState.y = Math.max(0, Math.min(window.innerHeight, cursorState.y + dy));

  // Apply movement using hardware accelerated transform
  cursorState.el.style.transform = `translate(${cursorState.x}px, ${cursorState.y}px)`;
  cursorState.el.style.opacity = '1';
  cursorState.visible = true;

  // Auto-hide cursor after 3 seconds of no movement
  if (cursorState.timer) clearTimeout(cursorState.timer);
  cursorState.timer = setTimeout(() => {
    if (cursorState.el) cursorState.el.style.opacity = '0';
  }, 3000);
});

// HANDLE MOUSE CLICKS
ipcRenderer.on('remote-mouse-click', (evt, { which }) => {
  if (!cursorState.el) initCursor();

  // Identify the element under the cursor
  const target = document.elementFromPoint(cursorState.x, cursorState.y);
  
  if (target) {
    // Simulate a full mouse click sequence (Down -> Up -> Click)
    // This is required for React apps and Video players to register the click
    const opts = { bubbles: true, cancelable: true, view: window };
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();

    // Focus inputs if clicked
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)) {
      target.focus();
    }

    // Visual Feedback (Ripple effect)
    const originalTransform = cursorState.el.style.transform;
    cursorState.el.style.transform += ' scale(0.8)'; // Shrink
    cursorState.el.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'; // Flash white
    
    setTimeout(() => {
      cursorState.el.style.transform = originalTransform;
      cursorState.el.style.backgroundColor = 'rgba(6, 182, 212, 0.9)'; // Back to Cyan
    }, 150);
  }
});

// HANDLE KEYBOARD (D-PAD)
ipcRenderer.on('remote-input', (evt, { key }) => {
  // Map Main process keys (strings) to JS KeyboardEvent keys
  const keyMap = {
    'Up': { code: 'ArrowUp', keyCode: 38 },
    'Down': { code: 'ArrowDown', keyCode: 40 },
    'Left': { code: 'ArrowLeft', keyCode: 37 },
    'Right': { code: 'ArrowRight', keyCode: 39 },
    'Return': { code: 'Enter', keyCode: 13 },
    'Escape': { code: 'Escape', keyCode: 27 },
    'Back': { code: 'Backspace', keyCode: 8 }
  };

  const keyInfo = keyMap[key];

  if (keyInfo) {
    const activeElement = document.activeElement || document.body;
    
    // Create detailed event
    const eventOptions = {
      key: keyInfo.code,
      code: keyInfo.code,
      keyCode: keyInfo.keyCode,
      bubbles: true,
      cancelable: true,
      view: window
    };

    // Dispatch KeyDown
    activeElement.dispatchEvent(new KeyboardEvent('keydown', eventOptions));

    // Dispatch KeyUp (Small delay to simulate realistic press)
    setTimeout(() => {
      activeElement.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
    }, 50);
  }
});

// --- 4. EXPOSE API (Safe Bridge) ---
contextBridge.exposeInMainWorld('slab', {
  launchApp: async (appId, args = []) => ipcRenderer.invoke('launch-app', appId, args),
  openUrlInView: async (url) => ipcRenderer.invoke('open-url-in-view', url),
  exitTile: async () => ipcRenderer.invoke('exit-tile'),
  getConfig: async () => ipcRenderer.invoke('get-config'),
  saveConfig: async (cfg) => ipcRenderer.invoke('save-config', cfg),
  approveRemote: async (token) => ipcRenderer.invoke('approve-remote', token),

  onDisplaysChanged: (cb) => ipcRenderer.on('displays-changed', (evt, val) => cb(val)),
  onPairRequest: (cb) => ipcRenderer.on('pair-request', (evt, val) => cb(val)),
  
  // We still expose this listener just in case the UI needs it, 
  // but the global handler above now does the heavy lifting.
  onRemoteInput: (cb) => ipcRenderer.on('remote-input', (evt, val) => cb(val)),
});
