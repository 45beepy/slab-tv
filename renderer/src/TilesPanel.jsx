// renderer/src/TilesPanel.jsx
import React, { useEffect, useState } from "react";
import { nanoid } from "nanoid";

/*
 Expects window.slab.getConfig() and window.slab.saveConfig() and window.slab.openUrlInView()
*/

export default function TilesPanel({ onTileLaunched }) {
  const [tiles, setTiles] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", type: "web", url: "", appId: "", icon: "" });

  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.slab.getConfig();
        const saved = (cfg && cfg.appsTiles) || [];
        setTiles(saved);
      } catch (e) {
        console.warn("TilesPanel: getConfig failed", e);
      }
    })();
  }, []);

  async function saveTiles(newTiles) {
    setTiles(newTiles);
    try {
      const cfg = await window.slab.getConfig();
      const merged = { ...(cfg || {}), appsTiles: newTiles };
      await window.slab.saveConfig(merged);
    } catch (e) {
      console.error("saveTiles err", e);
    }
  }

  async function handleLaunch(tile) {
    if (tile.type === "web" && tile.url) {
      const res = await window.slab.openUrlInView(tile.url);
      if (!res || !res.ok) {
        alert("Failed to open: " + (res && res.error));
        return;
      }
      if (onTileLaunched) onTileLaunched(tile);
    } else if (tile.type === "native" && tile.appId) {
      await window.slab.launchApp(tile.appId, tile.args || []);
      if (onTileLaunched) onTileLaunched(tile);
    }
  }

  function openCreate() {
    setForm({ title: "", type: "web", url: "", appId: "", icon: "" });
    setShowCreate(true);
  }

  function handleCreateSubmit(e) {
    e.preventDefault();
    const id = nanoid(6);
    const newTile = { id, title: form.title || id, type: form.type, url: form.url, appId: form.appId, icon: form.icon };
    const next = [...tiles, newTile];
    saveTiles(next);
    setShowCreate(false);
  }

  function handleRemove(id) {
    const next = tiles.filter(t => t.id !== id);
    saveTiles(next);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">App Tiles</h3>
        <div>
          <button onClick={openCreate} className="px-3 py-1 rounded bg-emerald-500 text-white">Add Tile</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {tiles.length === 0 && <div className="text-gray-400 col-span-4">No tiles yet — add one.</div>}
        {tiles.map(tile => (
          <div key={tile.id} className="bg-gray-800 p-3 rounded hover:shadow cursor-pointer flex flex-col items-center">
            <div onClick={() => handleLaunch(tile)} className="w-full flex-1 flex flex-col items-center justify-center">
              <img src={tile.icon || ""} alt={tile.title} className="w-20 h-20 object-contain mb-2" onError={(e)=>{ e.target.src=''; }} />
              <div className="text-sm text-center">{tile.title}</div>
            </div>
            <div className="mt-2 w-full flex justify-between">
              <button onClick={() => handleLaunch(tile)} className="px-2 py-1 bg-sky-500 rounded text-white text-xs">Open</button>
              <button onClick={() => handleRemove(tile.id)} className="px-2 py-1 bg-red-600 rounded text-white text-xs">Remove</button>
            </div>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <form onSubmit={handleCreateSubmit} className="bg-gray-800 p-6 rounded w-96 text-white">
            <h4 className="mb-3 text-lg">Create Tile</h4>

            <label className="block text-sm text-gray-300">Title</label>
            <input value={form.title} onChange={e=>setForm({...form, title:e.target.value})} className="w-full p-2 rounded bg-gray-900 border border-gray-700 mb-2" />

            <label className="block text-sm text-gray-300">Type</label>
            <select value={form.type} onChange={e=>setForm({...form, type:e.target.value})} className="w-full p-2 rounded bg-gray-900 border border-gray-700 mb-2">
              <option value="web">Web URL (embedded)</option>
              <option value="native">Native app</option>
            </select>

            {form.type === "web" && <>
              <label className="block text-sm text-gray-300">URL</label>
              <input value={form.url} onChange={e=>setForm({...form, url:e.target.value})} placeholder="https://example.com" className="w-full p-2 rounded bg-gray-900 border border-gray-700 mb-2" />
            </>}

            {form.type === "native" && <>
              <label className="block text-sm text-gray-300">App command (appId)</label>
              <input value={form.appId} onChange={e=>setForm({...form, appId:e.target.value})} placeholder="vlc" className="w-full p-2 rounded bg-gray-900 border border-gray-700 mb-2" />
            </>}

            <label className="block text-sm text-gray-300">Icon (file path or URL)</label>
            <input value={form.icon} onChange={e=>setForm({...form, icon:e.target.value})} placeholder="/path/to/icon.png or https://..." className="w-full p-2 rounded bg-gray-900 border border-gray-700 mb-3" />

            <div className="flex justify-end gap-2">
              <button type="button" onClick={()=>setShowCreate(false)} className="px-3 py-1 border rounded">Cancel</button>
              <button type="submit" className="px-3 py-1 bg-emerald-500 rounded text-white">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
