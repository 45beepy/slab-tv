// remote/app.js
// lightweight remote PWA client (vanilla JS) — uses WebSocket to the same host:port serving this file.

(function () {
  const statusEl = document.getElementById("status");
  const qrWrap = document.getElementById("qrWrap");
  const reqPairBtn = document.getElementById("reqPair");
  const dpad = document.getElementById("dpad");
  const touchpad = document.getElementById("touchpad");
  const textIn = document.getElementById("textIn");
  const sendText = document.getElementById("sendText");
  const tilesEl = document.getElementById("tiles");
  const sendRaw = document.getElementById("sendRaw");
  const rawCmd = document.getElementById("rawCmd");

  // demo tiles (replace with dynamic fetch later)
  const demoTiles = [
    { id: "youtube", title: "YouTube", type: "web", url: "https://www.youtube.com/", icon: "/mnt/data/561eae9f-a058-4fc0-bc93-6c1f9c5ff7ba.png" },
    { id: "stremio", title: "Stremio", type: "web", url: "https://www.stremio.com/", icon: "/mnt/data/561eae9f-a058-4fc0-bc93-6c1f9c5ff7ba.png" },
    { id: "vlc", title: "VLC", type: "native", appId: "vlc", icon: "/mnt/data/561eae9f-a058-4fc0-bc93-6c1f9c5ff7ba.png" }
  ];

  // connect to same host:port serving the remote app (express serves remote at REMOTE_PORT)
  const host = location.hostname;
  const port = location.port || 3000; // remote server port
  const wsUrl = `ws://${host}:${port}`;

  let ws = null;
  let connected = false;
  let lastPair = null;

  function setStatus(s) {
    statusEl.textContent = s;
  }

  function renderTiles() {
    tilesEl.innerHTML = "";
    demoTiles.forEach(t => {
      const wrap = document.createElement("div");
      wrap.className = "tile";
      const img = document.createElement("img");
      img.src = t.icon;
      img.alt = t.title;
      const title = document.createElement("div");
      title.textContent = t.title;
      title.style.marginTop = "6px";
      title.style.fontSize = "13px";
      wrap.appendChild(img);
      wrap.appendChild(title);

      wrap.addEventListener("click", async () => {
        if (t.type === "web") {
          ws.send(JSON.stringify({ type: "command", name: "open_url", url: t.url }));
        } else if (t.type === "native") {
          ws.send(JSON.stringify({ type: "command", name: "launch_app", appId: t.appId, args: [] }));
        }
      });

      tilesEl.appendChild(wrap);
    });
  }

  function connect() {
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      setStatus("ws connect failed");
      console.error(e);
      return;
    }

    ws.addEventListener("open", () => {
      connected = true;
      setStatus("connected");
      // request pair QR proactively
      // not necessary, user can press "Request Pair"
    });

    ws.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "pair") {
          // server sends { type:"pair", token, qr }
          lastPair = data.token;
          qrWrap.innerHTML = `<img class="pair-qr" src="${data.qr}" alt="pair qr" />`;
          setStatus("pair token ready");
        } else {
          console.log("ws message", data);
        }
      } catch (e) {
        console.warn("invalid ws message", e);
      }
    });

    ws.addEventListener("close", () => {
      connected = false;
      setStatus("disconnected — retrying in 2s");
      qrWrap.innerHTML = "";
      setTimeout(connect, 2000);
    });

    ws.addEventListener("error", (e) => {
      console.error("ws err", e);
      setStatus("ws error");
    });
  }

  // controls
  dpad.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const dir = btn.dataset.dir;
    if (!dir || !connected) return;
    ws.send(JSON.stringify({ type: "input", sub: "dpad", dir }));
  });

  // touchpad (basic tap => click)
  touchpad.addEventListener("click", (ev) => {
    if (!connected) return;
    // send mouse click
    ws.send(JSON.stringify({ type: "input", sub: "mouse", action: "click" }));
  });

  // keyboard input
  sendText.addEventListener("click", () => {
    const t = textIn.value.trim();
    if (!t || !connected) return;
    ws.send(JSON.stringify({ type: "input", sub: "text", text: t }));
    textIn.value = "";
  });

  // raw command sender
  sendRaw.addEventListener("click", () => {
    const txt = rawCmd.value.trim();
    if (!txt) return alert("enter JSON");
    try {
      const obj = JSON.parse(txt);
      ws.send(JSON.stringify(obj));
    } catch (e) {
      alert("invalid JSON");
    }
  });

  // request pair
  reqPairBtn.addEventListener("click", () => {
    if (!connected) return alert("not connected");
    ws.send(JSON.stringify({ type: "pair_request" }));
    setStatus("requested pair — waiting for QR");
  });

  // initial
  renderTiles();
  connect();
})();

