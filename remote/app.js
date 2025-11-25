// remote/app.js
// Lightweight remote controller UI that connects to ws://<host>:3000
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

  // default host = same host served this page
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
      log('ws msg', data);
      if (data.type === 'pair') {
        pairArea.style.display = 'block';
        pairQr.src = data.qr;
        pairInfo.textContent = `Token: ${data.token} — Host: ${data.host}`;
      }
    };
  }

  connectBtn.onclick = () => {
    if (ws) { ws.close(); ws = null; }
    connectToHost(hostInput.value);
  };

  // pairing
  pairBtn.onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('Connect first to request pairing.');
      return;
    }
    const req = { type: 'pair_request' };
    ws.send(JSON.stringify(req));
    log('pair_request sent');
  };

  // helpers to send dpad/input
  function sendInput(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { alert('Not connected'); return; }
    ws.send(JSON.stringify(obj));
    log('sent', obj);
  }

  // D-Pad
  document.querySelectorAll('.dpad').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.dir || (btn.id === 'okBtn' ? 'ok' : null);
      if (!dir) return;
      sendInput({ type: 'input', sub: 'dpad', dir });
    });
  });

  document.getElementById('backBtn').addEventListener('click', () => sendInput({ type: 'input', sub: 'dpad', dir: 'back' }));
  document.getElementById('okBtn').addEventListener('click', () => sendInput({ type: 'input', sub: 'dpad', dir: 'ok' }));

  // media
  document.getElementById('playPause').addEventListener('click', () => {
    // prefer MPRIS command route via WS
    sendInput({ type: 'command', name: 'media', cmd: 'play-pause' });
  });
  document.getElementById('next').addEventListener('click', () => sendInput({ type: 'command', name: 'media', cmd: 'next' }));
  document.getElementById('prev').addEventListener('click', () => sendInput({ type: 'command', name: 'media', cmd: 'prev' }));
  document.getElementById('volUp').addEventListener('click', () => sendInput({ type: 'command', name: 'media', cmd: 'volume-up' }));
  document.getElementById('volDown').addEventListener('click', () => sendInput({ type: 'command', name: 'media', cmd: 'volume-down' }));

  // app launches
  document.querySelectorAll('.appBtn').forEach(b => {
    b.addEventListener('click', () => {
      const appId = b.dataset.app;
      sendInput({ type: 'command', name: 'launch_app', appId });
    });
  });

  // open URL
  document.getElementById('openUrlBtn').addEventListener('click', () => {
    const url = document.getElementById('openUrlInput').value;
    if (!url) return alert('Enter a URL');
    sendInput({ type: 'command', name: 'open_url', url });
  });

  // auto connect by default
  connectToHost(hostInput.value);
  log('remote UI ready — ws target:', hostInput.value);
})();
