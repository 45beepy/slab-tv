// renderer/src/App.jsx
import React, { useEffect, useState } from "react";
import TilesPanel from "./TilesPanel";

/*
  App.jsx for Slab TV renderer
  - Shows connected displays
  - Quick actions (Use as Slab TV, Open App Tiles, API buttons)
  - TilesPanel below (imported)
  - Listens for pairing requests from main process via preload (window.slab.onPairRequest)
  - Uses APIs exposed in preload.js:
      window.slab.launchSlab()
      window.slab.launchApp(appId, args)
      window.slab.openUrlInView(url)
      window.slab.getConfig()
      window.slab.saveConfig(cfg)
      window.slab.onPairRequest(cb)
      window.slab.onDisplaysChanged(cb)
      window.slab.approveRemote(token)
*/

export default function App() {
  const [displays, setDisplays] = useState([]);
  const [statusText, setStatusText] = useState("Detecting displays...");
  const [config, setConfig] = useState(null);
  const [pairRequest, setPairRequest] = useState(null); // { token, host }
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadCfg() {
      try {
        const cfg = await window.slab.getConfig();
        if (!mounted) return;
        setConfig(cfg);
      } catch (e) {
        console.warn("Failed to load config", e);
      } finally {
        setLoadingConfig(false);
      }
    }
    loadCfg();

    // displays hotplug
    if (window.slab && window.slab.onDisplaysChanged) {
      window.slab.onDisplaysChanged((list) => {
        setDisplays(list || []);
        if (!list || list.length === 0) setStatusText("No displays found");
        else if (list.length === 1) setStatusText("Single display");
        else setStatusText("External display detected");
      });
    }

    // pairing requests from main process
    if (window.slab && window.slab.onPairRequest) {
      window.slab.onPairRequest((data) => {
        // data: { token, host }
        setPairRequest(data);
      });
    }

    return () => { mounted = false; };
  }, []);

  async function refreshConfig() {
    try {
      const cfg = await window.slab.getConfig();
      setConfig(cfg);
    } catch (e) {
      console.warn("refreshConfig err", e);
    }
  }

  async function handleUseAsSlab() {
    // Show the chooser modal inside TilesPanel instead? keep simple: launch default slab
    const res = await window.slab.launchSlab();
    if (!res || !res.ok) {
      alert("Failed to launch Slab TV: " + (res && res.error));
    }
  }

  async function handleOpenAppTiles() {
    const defaultUrl = (config?.defaultApp?.webUrl) || "https://www.youtube.com/";
    const res = await window.slab.openUrlInView(defaultUrl);
    if (!res || !res.ok) {
      alert("Failed to open app tiles view");
    }
  }

  async function handleChromeKiosk() {
    const res = await window.slab.launchApp("chrome", ["--kiosk", "https://www.youtube.com/"]);
    if (!res || !res.ok) alert("Chrome launch failed: " + (res && res.error));
  }

  async function approvePair(token) {
    try {
      await window.slab.approveRemote(token);
      setPairRequest(null);
      // optionally show a small toast or refresh paired list
      await refreshConfig();
    } catch (e) {
      console.error("approveRemote err", e);
      alert("Failed to approve remote");
    }
  }

  async function rejectPair() {
    setPairRequest(null);
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-6">
      <h1 className="text-2xl font-bold mb-6">Slab TV — Kiosk</h1>

      <div className="grid grid-cols-2 gap-6">

        {/* Connected displays */}
        <div className="bg-[#1e293b] p-6 rounded-2xl shadow">
          <h2 className="text-lg font-semibold mb-3">Connected displays</h2>
          <p className="text-gray-300 mb-3">{statusText}</p>

          <div className="mt-4 space-y-2">
            {displays.length === 0 && <div className="p-2 rounded bg-[#0b1220] text-sm text-gray-400">Detecting displays...</div>}
            {displays.map((d, idx) => (
              <div key={idx} className="p-2 rounded bg-[#334155] text-sm">
                <div className="flex justify-between">
                  <div>Display {idx + 1}: {d?.name || "Unnamed"}</div>
                  <div className="text-xs text-gray-400">{d?.geometry || "Unknown geometry"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-[#1e293b] p-6 rounded-2xl shadow">
          <h2 className="text-lg font-semibold mb-3">Quick actions</h2>

          <div className="flex gap-3 flex-wrap">
            <button onClick={handleUseAsSlab} className="px-4 py-2 rounded bg-sky-500 hover:bg-sky-600 text-white">Use as Slab TV</button>
            <button onClick={handleOpenAppTiles} className="px-4 py-2 rounded bg-indigo-500 hover:bg-indigo-600 text-white">Open App Tiles</button>
            <button onClick={() => { fetch("/api/launch-slab", { method: "POST" }); }} className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-700 text-sm">API: Launch Slab</button>
            <button onClick={handleChromeKiosk} className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-700 text-sm">API: Launch Chrome Kiosk</button>
          </div>

          <p className="mt-4 text-sm text-gray-400">
            Default app: <span className="text-white">{config?.defaultApp?.appId || "chrome"}</span>
          </p>

          <div className="mt-3 text-sm text-gray-400">Security Mode: <span className="text-white">{config?.securityMode || "open"}</span></div>

          <div className="mt-4">
            <button onClick={refreshConfig} className="px-3 py-2 rounded bg-gray-700">Refresh Config</button>
          </div>
        </div>
      </div>

      {/* Tiles panel */}
      <div className="mt-6">
        <TilesPanel onTileLaunched={() => { /* optional callback */ }} />
      </div>

      {/* Pairing request modal (shows when a remote requests pairing in pairing mode) */}
      {pairRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#0b1220] p-6 rounded-xl w-full max-w-md border border-gray-700">
            <h3 className="text-lg font-bold mb-2">Remote wants to pair</h3>
            <p className="text-sm text-gray-300 mb-4">Token: <span className="text-white">{pairRequest.token}</span></p>
            <p className="text-sm text-gray-400 mb-4">Host: <span className="text-gray-200">{pairRequest.host}</span></p>

            <div className="text-sm text-gray-400 mb-4">Approve this remote to allow it to control Slab TV. You can revoke paired remotes from settings later.</div>

            <div className="flex justify-end gap-3">
              <button onClick={rejectPair} className="px-3 py-2 rounded bg-gray-700">Reject</button>
              <button onClick={() => approvePair(pairRequest.token)} className="px-3 py-2 rounded bg-emerald-500 text-black font-semibold">Approve</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
