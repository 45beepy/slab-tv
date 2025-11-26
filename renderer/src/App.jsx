// renderer/src/App.jsx
import React, { useEffect, useState } from "react";

// Simple Kiosk + Tile manager UI
export default function App() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editorData, setEditorData] = useState({ id: "", title: "", type: "web", webUrl: "", icon: "" });

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const c = await window.slab.getConfig();
        if (mounted) setCfg(c);
      } catch (e) { console.error("getConfig failed", e); }
      setLoading(false);
    }
    init();

    // handle remote-input for embedded web UI
    if (window.slab && window.slab.onRemoteInput) {
      window.slab.onRemoteInput((data) => {
        // this broadcast is for pages embedded inside the BrowserWindow
        // If you want to handle remote navigation inside the renderer, implement here.
        console.log("remote-input", data);
      });
    }
    if (window.slab && window.slab.onRemotePointerDelta) {
      window.slab.onRemotePointerDelta(({dx,dy}) => {
        // optional: if embedding a page, you could forward to that iframe or element
        // left as a hook for further UI
      });
    }

    return () => { mounted = false; };
  }, []);

  if (loading || !cfg) return <div style={{ padding: 24, color: "#e6eef8", background: "#0f172a", minHeight: "100vh" }}>Loading…</div>;

  const apps = cfg.apps || {};

  async function launchTile(id) {
    const info = apps[id];
    if (!info) return;
    if (info.type === "web") {
      await window.slab.openUrlInView(info.webUrl);
    } else {
      await window.slab.launchApp(id);
    }
  }

  function openEditorForNew() {
    setEditorData({ id: "", title: "", type: "web", webUrl: "", icon: "" });
    setShowEditor(true);
  }

  function openEditorForEdit(id) {
    const info = apps[id] || {};
    setEditorData({ id, title: info.title || id, type: info.type || "web", webUrl: info.webUrl || "", icon: info.icon || "", appId: info.appId || null });
    setShowEditor(true);
  }

  function deleteApp(id) {
    if (!confirm(`Delete tile ${id}?`)) return;
    const newCfg = { ...cfg, apps: { ...cfg.apps } };
    delete newCfg.apps[id];
    setCfg(newCfg);
    window.slab.saveConfig(newCfg);
  }

  function handleEditorChange(k, v) {
    setEditorData(prev => ({ ...prev, [k]: v }));
  }

  async function saveEditor() {
    let { id, title, type, webUrl, icon, appId } = editorData;
    id = id && id.trim();
    if (!id) return alert("Id is required (a short unique key, e.g. 'netflix')");
    const newApps = { ...cfg.apps };
    newApps[id] = { type, title: title || id, icon: icon || "", webUrl: webUrl || "", appId: appId || id };
    const newCfg = { ...cfg, apps: newApps };
    setCfg(newCfg);
    await window.slab.saveConfig(newCfg);
    setShowEditor(false);
  }

  // Quick launch defaults area
  const defaultAppId = (cfg.defaultApp && cfg.defaultApp.appId) || "chrome";

  const pageStyle = { background: "#0f172a", minHeight: "100vh", color: "#e6eef8", padding: 20, fontFamily: "Inter, system-ui, sans-serif" };
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 16 };

  return (
    <div style={pageStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Slab TV — Home</div>
        <div>
          <button onClick={openEditorForNew} style={{ marginRight: 8, padding: "8px 12px", borderRadius: 8 }}>+ Add Tile</button>
          <button onClick={() => window.slab.saveConfig(cfg)} style={{ padding: "8px 12px", borderRadius: 8 }}>Save</button>
        </div>
      </header>

      <section style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Quick actions</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.slab.launchApp(defaultAppId)} style={{ padding: "10px 14px", borderRadius: 8 }}>Launch default</button>
          <button onClick={() => window.slab.launchApp("stremio")} style={{ padding: "10px 14px", borderRadius: 8 }}>Launch Stremio</button>
          <button onClick={() => window.slab.launchApp("vlc")} style={{ padding: "10px 14px", borderRadius: 8 }}>Launch VLC</button>
        </div>
      </section>

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 16 }}>App Tiles</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Click a tile to launch (web opens inside Slab window)</div>
        </div>

        <div style={grid}>
          {Object.keys(apps).length === 0 && <div style={{ color: "#cbd5e1" }}>No tiles configured — add one.</div>}
          {Object.entries(apps).map(([id, info]) => (
            <div key={id} style={{ background: "#142235", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 56, height: 56, borderRadius: 8, background: "#07101a" }}>
                  {info.icon ? <img src={info.icon} alt={info.title || id} style={{ width: "100%", height: "100%", borderRadius: 8 }} /> : null}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{info.title || id}</div>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>{info.type === "native" ? "Native" : "Web"}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => launchTile(id)} style={{ padding: "8px 10px", borderRadius: 8 }}>Open</button>
                <button onClick={() => openEditorForEdit(id)} style={{ padding: "8px 10px", borderRadius: 8 }}>Edit</button>
                <button onClick={() => deleteApp(id)} style={{ padding: "8px 10px", borderRadius: 8, background: "#7f1d1d", color: "white" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {showEditor ? (
        <div style={{ position: "fixed", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 640, background: "#071427", padding: 18, borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>Tile editor</div>
              <div><button onClick={() => setShowEditor(false)}>Close</button></div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>Id (short unique key)</label>
              <input value={editorData.id} onChange={e => handleEditorChange("id", e.target.value)} placeholder="e.g. mynetflix" />
              <label>Title</label>
              <input value={editorData.title} onChange={e => handleEditorChange("title", e.target.value)} placeholder="Display title" />
              <label>Type</label>
              <select value={editorData.type} onChange={e => handleEditorChange("type", e.target.value)}>
                <option value="web">Web (opens inside Slab)</option>
                <option value="native">Native (launches system app)</option>
              </select>
              <label>Web URL (for web tiles)</label>
              <input value={editorData.webUrl} onChange={e => handleEditorChange("webUrl", e.target.value)} placeholder="https://example.com" />
              <label>Icon URL (file:// or http)</label>
              <input value={editorData.icon} onChange={e => handleEditorChange("icon", e.target.value)} placeholder="file:///path/to/icon.png or https://..." />

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={saveEditor} style={{ padding: "8px 12px", borderRadius: 8 }}>Save</button>
                <button onClick={() => setShowEditor(false)} style={{ padding: "8px 12px", borderRadius: 8 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
