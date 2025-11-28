import React, { useEffect, useState, useRef } from "react";

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editorData, setEditorData] = useState({ id: "", title: "", type: "web", webUrl: "", icon: "" });
  
  // Ref to store tile buttons for auto-focus
  const tilesRef = useRef([]);

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const c = await window.slab.getConfig();
        if (mounted) {
          setCfg(c);
          // Auto-focus the first tile after a short delay to ensure rendering
          setTimeout(() => {
            const firstTile = document.querySelector('.tile-btn');
            if (firstTile) firstTile.focus();
          }, 100);
        }
      } catch (e) { console.error("getConfig failed", e); }
      setLoading(false);
    }
    init();
    return () => { mounted = false; };
  }, []);

  if (loading || !cfg) return <div style={{ padding: 40, color: "white", background: "#0f172a", minHeight: "100vh" }}>Loading Config...</div>;

  const apps = cfg.apps || {};
  const defaultAppId = (cfg.defaultApp && cfg.defaultApp.appId) || "chrome";

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

  function openEditorForEdit(id, e) {
    e.stopPropagation(); // Prevent launching when clicking edit
    const info = apps[id] || {};
    setEditorData({ id, title: info.title || id, type: info.type || "web", webUrl: info.webUrl || "", icon: info.icon || "", appId: info.appId || null });
    setShowEditor(true);
  }

  function deleteApp(id, e) {
    e.stopPropagation();
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
    if (!id) return alert("Id is required");
    const newApps = { ...cfg.apps };
    newApps[id] = { type, title: title || id, icon: icon || "", webUrl: webUrl || "", appId: appId || id };
    const newCfg = { ...cfg, apps: newApps };
    setCfg(newCfg);
    await window.slab.saveConfig(newCfg);
    setShowEditor(false);
  }

  const pageStyle = { background: "#0f172a", minHeight: "100vh", color: "#e6eef8", padding: 20, fontFamily: "Inter, system-ui, sans-serif", cursor: "none" };
  
  // Grid layout
  const gridStyle = { 
    display: "grid", 
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", 
    gap: 20,
    marginTop: 20
  };

  return (
    <div style={pageStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Slab TV — Home</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={openEditorForNew} className="tile-btn" style={{ padding: "8px 12px", borderRadius: 8, background: "#334155", border: "2px solid transparent", color: "white", cursor: "pointer" }}>+ Add Tile</button>
          <button onClick={() => window.slab.saveConfig(cfg)} className="tile-btn" style={{ padding: "8px 12px", borderRadius: 8, background: "#334155", border: "2px solid transparent", color: "white", cursor: "pointer" }}>Save</button>
        </div>
      </header>

      <section style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 16, marginBottom: 8, opacity: 0.7 }}>Quick actions</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.slab.launchApp(defaultAppId)} className="tile-btn" style={{ padding: "12px 20px", borderRadius: 8, background: "#1e293b", border: "2px solid transparent", color: "white", cursor: "pointer", fontWeight: 600 }}>Launch Default</button>
        </div>
      </section>

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16 }}>Apps</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>Use D-Pad to navigate</div>
        </div>

        <div style={gridStyle}>
          {Object.keys(apps).length === 0 && <div style={{ color: "#cbd5e1" }}>No tiles configured — add one.</div>}
          
          {Object.entries(apps).map(([id, info], index) => (
            <button
              key={id}
              className="tile-btn"
              onClick={() => launchTile(id)}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: "#1e293b",
                borderRadius: 16,
                padding: 20,
                border: "2px solid rgba(255,255,255,0.05)",
                color: "white",
                cursor: "pointer",
                transition: "transform 0.1s, border-color 0.1s, background 0.1s",
                outline: "none",
                textAlign: "center",
                height: 160
              }}
              onKeyDown={(e) => {
                // Add Focus ring style via JS for stricter control if needed, 
                // but CSS :focus is usually enough.
                if (e.key === 'Enter') launchTile(id);
              }}
            >
              <div style={{ width: 64, height: 64, marginBottom: 12, borderRadius: 12, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {info.icon ? 
                  <img src={info.icon} alt={info.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : 
                  <span style={{ fontSize: 32 }}>📺</span>
                }
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{info.title || id}</div>
              <div style={{ fontSize: 11, opacity: 0.5, textTransform: "uppercase", letterSpacing: 0.5 }}>{info.type}</div>

              {/* Hover/Focus Actions */}
              <div className="actions" style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                <div onClick={(e) => openEditorForEdit(id, e)} style={{ width: 24, height: 24, background: "rgba(0,0,0,0.3)", borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>✎</div>
                <div onClick={(e) => deleteApp(id, e)} style={{ width: 24, height: 24, background: "rgba(200,0,0,0.3)", borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>×</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Add global styles for focus state */}
      <style>{`
        .tile-btn:focus {
          border-color: #06b6d4 !important;
          background: #253346 !important;
          transform: scale(1.05);
          box-shadow: 0 0 20px rgba(6, 182, 212, 0.4);
          z-index: 10;
        }
      `}</style>

      {showEditor && (
        <div style={{ position: "fixed", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
          <div style={{ width: 500, background: "#1e293b", padding: 24, borderRadius: 12, border: "1px solid #334155" }}>
            <h2 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>Edit Tile</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <input style={{width:"100%", padding:10, background:"#0f172a", border:"1px solid #334155", color:"white", borderRadius:6}} value={editorData.id} onChange={e => handleEditorChange("id", e.target.value)} placeholder="ID (e.g. netflix)" />
              <input style={{width:"100%", padding:10, background:"#0f172a", border:"1px solid #334155", color:"white", borderRadius:6}} value={editorData.title} onChange={e => handleEditorChange("title", e.target.value)} placeholder="Title" />
              <select style={{width:"100%", padding:10, background:"#0f172a", border:"1px solid #334155", color:"white", borderRadius:6}} value={editorData.type} onChange={e => handleEditorChange("type", e.target.value)}>
                <option value="web">Web Tile</option>
                <option value="native">Native App</option>
              </select>
              {editorData.type === 'web' ? 
                <input style={{width:"100%", padding:10, background:"#0f172a", border:"1px solid #334155", color:"white", borderRadius:6}} value={editorData.webUrl} onChange={e => handleEditorChange("webUrl", e.target.value)} placeholder="https://..." /> :
                <input style={{width:"100%", padding:10, background:"#0f172a", border:"1px solid #334155", color:"white", borderRadius:6}} value={editorData.appId} onChange={e => handleEditorChange("appId", e.target.value)} placeholder="Command (e.g. vlc)" />
              }
              <input style={{width:"100%", padding:10, background:"#0f172a", border:"1px solid #334155", color:"white", borderRadius:6}} value={editorData.icon} onChange={e => handleEditorChange("icon", e.target.value)} placeholder="Icon URL" />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10 }}>
                <button onClick={() => setShowEditor(false)} style={{ padding: "10px 20px", borderRadius: 6, background: "transparent", border: "1px solid #475569", color: "white", cursor:"pointer" }}>Cancel</button>
                <button onClick={saveEditor} style={{ padding: "10px 20px", borderRadius: 6, background: "#0ea5e9", color: "black", fontWeight: "bold", border: "none", cursor:"pointer" }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
