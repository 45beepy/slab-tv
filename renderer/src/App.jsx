// renderer/src/App.jsx
import React, { useEffect, useState } from "react";
import TilesPanel from "./TilesPanel";

export default function App() {
  const [displays, setDisplays] = useState([]);
  const [statusText, setStatusText] = useState("Detecting displays...");
  const [config, setConfig] = useState(null);

  useEffect(() => {
    async function loadCfg() {
      try {
        const cfg = await window.slab.getConfig();
        setConfig(cfg);
      } catch (e) {
        console.error("Failed to load config", e);
      }
    }
    loadCfg();

    // listen for display updates
    window.slab.onDisplaysChanged((list) => {
      setDisplays(list || []);
      if (!list || list.length === 0) {
        setStatusText("No displays found");
      } else if (list.length === 1) {
        setStatusText("Single display");
      } else {
        setStatusText("External display detected");
      }
    });
  }, []);

  async function handleUseAsSlab() {
    const result = await window.slab.launchSlab();
    console.log("launch slab:", result);
    if (!result || !result.ok) alert("Failed to launch Slab TV");
  }

  async function handleOpenAppTiles() {
    const defaultUrl = (config?.defaultApp?.webUrl) || "https://www.youtube.com/";
    const result = await window.slab.openUrlInView(defaultUrl);
    if (!result || !result.ok) alert("Failed to open app tile view");
  }

  async function launchChromeKiosk() {
    const result = await window.slab.launchApp("chrome", ["--kiosk", "https://www.youtube.com"]);
    if (!result.ok) alert("Chrome launch failed: " + result.error);
  }

  async function apiLaunchSlab() {
    try {
      await fetch("http://localhost:3000/api/launch-slab", { method: "POST" });
    } catch (e) {
      alert("API Launch Slab failed");
    }
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-6">
      <h1 className="text-2xl font-bold mb-6">Slab TV — Kiosk</h1>

      {/* TOP SECTION */}
      <div className="grid grid-cols-2 gap-6">

        {/* CONNECTED DISPLAYS CARD */}
        <div className="bg-[#1e293b] p-6 rounded-2xl shadow">
          <h2 className="text-lg font-semibold mb-3">Connected displays</h2>
          <p className="text-gray-300">{statusText}</p>

          <div className="mt-4 space-y-2">
            {displays.map((d, idx) => (
              <div key={idx} className="p-2 rounded bg-[#334155] text-sm">
                Display {idx + 1}: {d?.geometry || "Unknown geometry"}
              </div>
            ))}
          </div>
        </div>

        {/* QUICK ACTIONS CARD */}
        <div className="bg-[#1e293b] p-6 rounded-2xl shadow">
          <h2 className="text-lg font-semibold mb-3">Quick actions</h2>

          <div className="flex gap-3">
            <button
              onClick={handleUseAsSlab}
              className="px-4 py-2 rounded bg-sky-500 hover:bg-sky-600 text-white"
            >
              Use as Slab TV
            </button>

            <button
              onClick={handleOpenAppTiles}
              className="px-4 py-2 rounded bg-indigo-500 hover:bg-indigo-600 text-white"
            >
              Open App Tiles
            </button>

            <button
              onClick={apiLaunchSlab}
              className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-700 text-sm"
            >
              API: Launch Slab
            </button>

            <button
              onClick={launchChromeKiosk}
              className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-700 text-sm"
            >
              API: Launch Chrome Kiosk
            </button>
          </div>

          <p className="mt-4 text-sm text-gray-400">
            Default app: {config?.defaultApp?.appId || "chrome"}
          </p>
          <p className="text-sm text-gray-400">Status: {statusText}</p>
        </div>
      </div>

      {/* TILES PANEL BELOW */}
      <TilesPanel
        onTileLaunched={(tile) => {
          console.log("Tile launched:", tile);
        }}
      />
    </div>
  );
}
