const ws = new WebSocket(`ws://${location.hostname}:3000`);

ws.onopen = () => console.log("Connected to Slab TV");
ws.onmessage = ev => {
  const data = JSON.parse(ev.data);
  if (data.type === "pair") {
    document.getElementById("qr").innerHTML = `<img src="${data.qr}" />`;
  }
};

document.getElementById("pair").onclick = () => {
  ws.send(JSON.stringify({ type: "pair_request" }));
};

["up", "down", "left", "right", "ok"].forEach(dir => {
  document.getElementById(dir).onclick = () =>
    ws.send(JSON.stringify({ type: "input", sub: "dpad", dir }));
});
