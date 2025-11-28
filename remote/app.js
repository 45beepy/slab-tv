// remote/app.js
(() => {
  const hostInput = document.getElementById('hostInput');
  const connectBtn = document.getElementById('connectBtn');
  const statusEl = document.getElementById('status');
  const hostLabel = document.getElementById('hostLabel');
  const pairBtn = document.getElementById('pairBtn');
  const pairArea = document.getElementById('pairArea');
  const pairQr = document.getElementById('pairQr');
  const pairInfo = document.getElementById('pairInfo');
  const logArea = document.getElementById('logArea');

  const defaultHost = window.location.hostname || 'localhost';
  const defaultPort = window.location.port || '3000';
  hostLabel.textContent = `${defaultHost}:${defaultPort}`;
  hostInput.value = `${defaultHost}:${defaultPort}`;

  let ws = null;
  let wsUrl = null;
  function log(...args) {
    const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    logArea.textContent = logArea.textContent + '\n' + line;
    logArea.scrollTop = logArea.scrollHeight;
  }

  function connectToHost(hostAndPort) {
    if (!hostAndPort) hostAndPort = `${defaultHost}:${defaultPort}`;
    wsUrl = `ws://${hostAndPort}`;
    try {
      ws = new WebSocket(wsUrl.replace(/^http/, 'ws').replace(/^ws:\/\//,'ws://'));
    } catch (e) {
      statusEl.textContent = `Conn error: ${e.message}`;
      log('conn err', e);
      return;
    }

    statusEl.textContent = 'Connecting...';
    ws.onopen = () => { statusEl.textContent = 'Connected'; log('ws open', wsUrl); };
    ws.onclose = () => { statusEl.textContent = 'Disconnected'; log('ws close'); };
    ws.onerror = (e) => { statusEl.textContent = 'Error'; log('ws error', e); };
    ws.onmessage = (ev) => {
      let data = null;
      try { data = JSON.parse(ev.data); } catch (e) { log('invalid ws payload', ev.data); return; }
      if (data.type === 'pair') {
        pairArea.style.display = 'block';
        pairQr.src = data.qr;
        pairInfo.textContent = `Token: ${data.token} — Host: ${data.host}`;
      }
    };
  }

  connectBtn.onclick = () => { if (ws) { ws.close(); ws = null; } connectToHost(hostInput.value); };

  pairBtn.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { alert('Connect first.'); return; }
    ws.send(JSON.stringify({ type: 'pair_request' }));
  };

  function sendInput(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  // --- UI BUTTONS ---
  document.querySelectorAll('.dpad').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); // Stop double-firing
      const dir = btn.dataset.dir || (btn.id === 'okBtn' ? 'ok' : null);
      if (dir) sendInput({ type: 'input', sub: 'dpad', dir });
    });
  });

  document.getElementById('backBtn').addEventListener('click', () => sendInput({ type: 'input', sub: 'dpad', dir: 'back' }));
  
  // Media controls
  ['playPause', 'next', 'prev', 'volUp', 'volDown'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', () => {
      const cmdMap = { playPause:'play-pause', next:'next', prev:'prev', volUp:'volume-up', volDown:'volume-down' };
      sendInput({ type: 'command', name: 'media', cmd: cmdMap[id] });
    });
  });

  // App buttons
  document.querySelectorAll('.appBtn').forEach(b => b.addEventListener('click', () => {
    sendInput({ type: 'command', name: 'launch_app', appId: b.dataset.app });
  }));

  document.getElementById('openUrlBtn').addEventListener('click', () => {
    const url = document.getElementById('openUrlInput').value;
    if (url) sendInput({ type: 'command', name: 'open_url', url });
  });

  // --- TRACKPAD LOGIC (Tap to Click) ---
  (function setupTouchpad(){
    const pad = document.getElementById('pad');
    if (!pad) return;
    
    let lastX = null, lastY = null;
    let isDragging = false;
    let tapStartTime = 0;
    let startX = 0, startY = 0;
    const TAP_THRESHOLD_MS = 250; // Max time for a tap
    const MOVE_THRESHOLD = 5; // Pixels to move before counting as a drag
    const THROTTLE_MS = 16;
    let lastSend = 0;

    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      lastX = e.clientX; 
      lastY = e.clientY;
      startX = e.clientX; 
      startY = e.clientY;
      isDragging = false;
      tapStartTime = Date.now();
    });

    pad.addEventListener('pointermove', (e) => {
      const now = Date.now();
      
      // Calculate total distance moved since start to detect "Tap vs Drag"
      const totalDist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (totalDist > MOVE_THRESHOLD) {
        isDragging = true;
      }

      if (!isDragging) return; // Don't send moves if we are still deciding if it's a tap

      if (now - lastSend < THROTTLE_MS) return;
      
      const dx = e.clientX - lastX; 
      const dy = e.clientY - lastY;
      lastX = e.clientX; 
      lastY = e.clientY; 
      lastSend = now;
      
      sendInput({ type: 'input', sub: 'touch', dx: Math.round(dx), dy: Math.round(dy) });
    });

    pad.addEventListener('pointerup', (e) => {
      try { pad.releasePointerCapture(e.pointerId); } catch (err) {}
      
      const duration = Date.now() - tapStartTime;
      
      // If we didn't drag much and time was short -> It's a TAP (Left Click)
      if (!isDragging && duration < TAP_THRESHOLD_MS) {
        log('Tap detected -> Click');
        sendInput({ type: 'input', sub: 'mouse', action: 'left' });
      }
      
      isDragging = false;
      lastX = null; 
      lastY = null;
    });

    document.getElementById('padLeftClick').addEventListener('click', () => sendInput({ type: 'input', sub: 'mouse', action: 'left' }));
    document.getElementById('padRightClick').addEventListener('click', () => sendInput({ type: 'input', sub: 'mouse', action: 'right' }));
  })();

  connectToHost(hostInput.value);
})();
