// renderer/src/App.jsx
import React, { useEffect, useState } from "react";

export default function App() {
  const [displays, setDisplays] = useState([]);
  const [showPopup, setShowPopup] = useState(false);
  const [config, setConfig] = useState({ neverShowHdmiPopup: false, defaultApp: { appId: "chrome", args: ["--new-window"] } });
  const [popupKey, setPopupKey] = useState(null);

  useEffect(() => {
    // load saved config
    (async () => {
      try {
        if (window.slab && window.slab.getConfig) {
          const cfg = await window.slab.getConfig();
          setConfig(cfg || config);
        }
      } catch (e) {
        console.warn("getConfig failed", e);
      }
    })();

    // subscribe to display changes exposed by preload
    if (window.slab && window.slab.onDisplaysChanged) {
      window.slab.onDisplaysChanged((d) => {
        setDisplays(d || []);
        try {
          const key = JSON.stringify(d || []);
          const hasExternal = (d || []).length > 1;
          if (hasExternal && key !== popupKey && !(config && config.neverShowHdmiPopup)) {
            setPopupKey(key);
            setShowPopup(true);
          }
        } catch (e) {}
      });
    }
  }, [popupKey, config]);

  async function handleUseAsSlab() {
    setShowPopup(false);
    const res = await window.slab.launchSlab();
    if (!res.ok) alert("Failed to enter SlabTV mode: " + (res.error || "unknown"));
  }

  async function handleDismiss(neverAgain) {
    setShowPopup(false);
    if (neverAgain) {
      const newCfg = { ...config, neverShowHdmiPopup: true };
      setConfig(newCfg);
      await window.slab.saveConfig(newCfg);
    }
  }

  async function openAppTiles() {
    // use local config default app for 'open tiles' behaviour:
    const appId = config?.defaultApp?.appId || "chrome";
    const args = config?.defaultApp?.args || ["--new-window"];
    // call main process via preload
    const res = await window.slab.launchApp(appId, args);
    if (!res.ok) alert("Failed to launch app: " + (res.error || "unknown"));
  }

  async function apiLaunchSlab() {
    // demo: call remote API endpoint from the renderer (same host)
    fetch("/api/launch-slab", { method: "POST" })
      .then(r => r.json())
      .then(j => console.log("api launch-slab:", j))
      .catch(e => console.error(e));
  }

  async function apiLaunchApp() {
    fetch("/api/launch-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: "chrome", args: ["--new-window", "--kiosk", "https://youtube.com"] })
    }).then(r => r.json()).then(j => console.log("api launch-app:", j));
  }

  return (
    <div className="p-8 font-sans min-h-screen">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Slab TV — Kiosk</h1>
        <div className="text-sm text-gray-300">Status: {displays.length > 1 ? "External display connected" : "Single display"}</div>
      </header>

      <section className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-3">Connected displays</h2>
          <ul className="space-y-2 text-sm text-gray-200">
            {displays.length === 0 && <li>Detecting displays...</li>}
            {displays.map(d => (
              <li key={d.name} className="flex items-center justify-between">
                <span>{d.name}</span>
                <span className="text-xs text-gray-400">{d.geometry || "—"}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-3">Quick actions</h2>
          <div className="flex flex-wrap gap-3">
            <button onClick={handleUseAsSlab} className="px-4 py-2 rounded bg-cyan-400 text-black font-semibold">Use as Slab TV</button>
            <button onClick={openAppTiles} className="px-4 py-2 rounded bg-indigo-600 text-white">Open App Tiles</button>
            <button onClick={apiLaunchSlab} className="px-4 py-2 rounded bg-gray-700 border border-gray-600 text-white">API: Launch Slab</button>
            <button onClick={apiLaunchApp} className="px-4 py-2 rounded bg-gray-700 border border-gray-600 text-white">API: Launch Chrome Kiosk</button>
          </div>

          <div className="mt-4 text-sm text-gray-400">
            Default app: <span className="text-white">{config?.defaultApp?.appId}</span>
          </div>
        </div>
      </section>

      {/* Popup */}
      {showPopup && (
        <div className="fixed left-6 right-6 bottom-6 z-50">
          <div className="max-w-3xl mx-auto bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-5 shadow-lg flex items-center justify-between">
            <div>
              <div className="text-lg font-bold text-white">External display detected</div>
              <div className="text-sm text-gray-300">Use this screen as Slab TV? You can always change this later in settings.</div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => handleDismiss(false)} className="px-4 py-2 rounded bg-gray-700 text-white">Dismiss</button>
              <button onClick={() => handleDismiss(true)} className="px-4 py-2 rounded bg-red-600 text-white">Never show again</button>
              <button onClick={openAppTiles} className="px-4 py-2 rounded bg-indigo-500 text-white">Open App Tiles</button>
              <button onClick={handleUseAsSlab} className="px-4 py-2 rounded bg-cyan-400 text-black font-semibold">Use as Slab TV</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
