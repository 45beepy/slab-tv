// renderer/src/App.jsx
import React, { useEffect, useState } from "react";

/*
  Restored kiosk/home UI.
  - Hardcoded apps: chrome (web), stremio (native - flatpak), vlc (native)
  - Buttons: Use as Slab TV, Open App Tiles, API quick buttons
  - Uses window.slab APIs patched in preload.js
*/

export default function App() {
  const [displays, setDisplays] = useState([]);
  const [status, setStatus] = useState("Detecting displays...");
  const [loading, setLoading] = useState(true);
  const [defaultApp, setDefaultApp] = useState("chrome");

  // Hardcoded app list (native or web)
  const APPS = {
    chrome: { type: "web", title: "Chrome (Web)", webUrl: "https://www.youtube.com/", icon: "" },
    stremio: { type: "native", title: "Stremio (Native)", appId: "stremio", icon: "" },
    vlc: { type: "native", title: "VLC (Native)", appId: "vlc", icon: "" }
  };

  useEffect(() => {
    let mounted = true;
    async function getConfigDisplays() {
      try {
        const cfg = await window.slab.getConfig();
        if (mounted) {
          if (cfg && cfg.defaultApp && cfg.defaultApp.appId) setDefaultApp(cfg.defaultApp.appId);
        }
      } catch (e) {
        // ignore - we'll continue with hardcoded defaults
        console.warn("getConfig failed", e);
      } finally {
        setLoading(false);
      }
    }

    getConfigDisplays();

    // listen for display changes sent from main
    if (window.slab && window.slab.onDisplaysChanged) {
      window.slab.onDisplaysChanged((d) => {
        setDisplays(d || []);
        setStatus(d && d.length > 1 ? "Multiple displays" : "Single display");
      });
    }

    // also listen for pair requests to show QR (optional)
    if (window.slab && window.slab.onPairRequest) {
      window.slab.onPairRequest((info) => {
        console.log("pair-request", info);
        // you can show a dialog here if needed
      });
    }

    return () => { mounted = false; };
  }, []);

  async function handleUseAsSlab() {
    const res = await window.slab.launchApp("chrome", ["--kiosk"]); // default behavior: make slab fullscreen or launch default
    // we also invoke launch-slab if you want special action
    try {
      const slabRes = await window.slab.launchSlab?.() || null; // optional
      console.log("slabRes", slabRes);
    } catch (e) {}
    // If the ipc handler for launch-slab exists in main, you can call it; otherwise we call doLaunchSlab from main when UI asks.
    // For now let's call the ipc if exists:
    try {
      const result = await window.slab.launchApp(defaultApp);
      if (!result || !result.ok) {
        alert("Failed to launch default app: " + (result && result.error));
      }
    } catch (err) {
      console.error("Use as Slab error", err);
      alert("Error launching slab: " + (err?.message || err));
    }
  }

  async function openAppTiles() {
    // Show app tiles view inside this renderer - for now open a simple view: load the chrome web tile or open local 'tiles' UI
    // We'll open the web view of the default app inside the main BrowserWindow (so remote can control it)
    const app = APPS[defaultApp];
    if (!app) return;
    if (app.type === "web") {
      await window.slab.openUrlInView(app.webUrl);
    } else {
      await window.slab.launchApp(defaultApp);
    }
  }

  async function apiLaunchSlab() {
    // call the remote server API if you want (we also have IPC)
    try {
      const res = await fetch("/api/launch-slab", { method: "POST" }).then(r => r.json()).catch(()=>null);
      console.log("apiLaunchSlab", res);
    } catch (e) {
      console.warn("api launch error", e);
    }
  }

  async function apiLaunchChromeKiosk() {
    try {
      const res = await fetch("/api/launch-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: "chrome", args: ["--kiosk", "https://www.youtube.com/"] })
      }).then(r => r.json()).catch(()=>null);
      console.log("api chrome kiosk", res);
    } catch (e) { console.warn(e); }
  }

  // Launch specific tile (native or web)
  async function launchTile(appId) {
    const info = APPS[appId];
    if (!info) return;
    if (info.type === "web") {
      await window.slab.openUrlInView(info.webUrl);
    } else {
      await window.slab.launchApp(appId);
    }
  }

  // UI styles inline to avoid external CSS
  const pageStyle = { background: "#0f172a", minHeight: "100vh", color: "#e6eef8", padding: 28, fontFamily: "Inter, system-ui, sans-serif" };
  const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 };
  const titleStyle = { fontSize: 28, fontWeight: 700 };
  const panelRow = { display: "grid", gridTemplateColumns: "1fr 420px", gap: 20 };
  const card = { background: "#142235", borderRadius: 10, padding: 18, minHeight: 120 };
  const button = (bg="#06b6d4") => ({ background: bg, color: "#062022", border: "none", padding: "10px 14px", borderRadius: 8, cursor: "pointer", marginRight: 8 });

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>Slab TV — Kiosk</div>
        <div style={{ fontSize: 14, color: "#94a3b8" }}>{displays && displays.length > 1 ? "Status: Multiple displays" : "Status: Single display"}</div>
      </div>

      <div style={panelRow}>
        <div style={card}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Connected displays</div>
          <div style={{ color: "#94a3b8", marginTop: 8 }}>
            {displays && displays.length > 0 ? (
              <ul>
                {displays.map((d, idx) => (
                  <li key={idx}>{d.name || `Display ${idx}`} {idx===1 ? "(external)" : ""}</li>
                ))}
              </ul>
            ) : (
              <div>Detecting displays...</div>
            )}
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>Quick actions</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 8 }}>
            <button style={button("#06b6d4")} onClick={handleUseAsSlab}>Use as Slab TV</button>
            <button style={button("#7c3aed")} onClick={openAppTiles}>Open App Tiles</button>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button style={button("#94a3b8")} onClick={apiLaunchSlab}>API: Launch Slab</button>
            <button style={button("#94a3b8")} onClick={apiLaunchChromeKiosk}>API: Launch Chrome Kiosk</button>
          </div>

          <div style={{ marginTop: 12, color: "#9fb0c8" }}>
            Default app: <strong style={{ color: "#e6eef8" }}>{defaultApp}</strong>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 36 }}>
        <div style={{ fontSize: 18, marginBottom: 12 }}>App Tiles</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {Object.entries(APPS).map(([id, info]) => (
            <div key={id} style={{ width: 180, borderRadius: 12, padding: 14, background: "#0b1220", cursor: "pointer" }}
                 onClick={() => launchTile(id)}>
              <div style={{ height: 72, marginBottom: 12, background: "#07101a", borderRadius: 8 }} />
              <div style={{ fontWeight: 600 }}>{info.title}</div>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>{info.type === "native" ? "Native" : "Web"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
