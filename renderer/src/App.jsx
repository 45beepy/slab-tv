import React, { useEffect, useState } from "react";

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
    if (!id) return alert("Id is required");
    const newApps = { ...cfg.apps };
    newApps[id] = { type, title: title || id, icon: icon || "", webUrl: webUrl || "", appId: appId || id };
    const newCfg = { ...cfg, apps: newApps };
    setCfg(newCfg);
    await window.slab.saveConfig(newCfg);
    setShowEditor(false);
  }

  const pageStyle = { background: "#0f172a", minHeight: "100vh", color: "#e6eef8", padding: 20, fontFamily: "Inter, system-ui, sans-serif", cursor: "none" };
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 16 };

  return (
    <div style={pageStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Slab TV — Home</div>
        <div>
          <button onClick={openEditorForNew} style={{ marginRight: 8, padding: "8px 12px", borderRadius: 8, background: "#334155" }}>+ Add Tile</button>
          <button onClick={() => window.slab.saveConfig(cfg)} style={{ padding: "8px 12px", borderRadius: 8, background: "#334155" }}>Save</button>
        </div>
      </header>

      <section style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Quick actions</div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.slab.launchApp(defaultAppId)} style={{ padding: "10px 14px", borderRadius: 8, background: "#1e293b" }}>Launch default</button>
          <button onClick={() => window.slab.launchApp("stremio")} style={{ padding: "10px 14px", borderRadius: 8, background: "#1e293b" }}>Launch Stremio</button>
          <button onClick={() => window.slab.launchApp("vlc")} style={{ padding: "10px 14px", borderRadius: 8, background: "#1e293b" }}>Launch VLC</button>
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
                <div style={{ width: 56, height: 56, borderRadius: 8, background: "#07101a", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {info.icon ? <img src={info.icon} alt={info.title || id} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 24 }}>📺</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{info.title || id}</div>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>{info.type === "native" ? "Native" : "Web"}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => launchTile(id)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: "#0ea5e9", color: "#000", fontWeight: "bold" }}>Open</button>
                <button onClick={() => openEditorForEdit(id)} style={{ padding: "8px 10px", borderRadius: 8, background: "#334155" }}>Edit</button>
                <button onClick={() => deleteApp(id)} style={{ padding: "8px 10px", borderRadius: 8, background: "#7f1d1d", color: "white" }}>Del</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {showEditor ? (
        <div style={{ position: "fixed", left: 0, right: 0, top: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
          <div style={{ width: 500, background: "#1e293b", padding: 24, borderRadius: 12, border: "1px solid #334155" }}>
            <h2 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16 }}>Edit Tile</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>ID</label>
                <input style={{ width: "100%", padding: 8, borderRadius: 6, background: "#0f172a", border: "1px solid #334155", color: "white" }} value={editorData.id} onChange={e => handleEditorChange("id", e.target.value)} placeholder="e.g. netflix" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Title</label>
                <input style={{ width: "100%", padding: 8, borderRadius: 6, background: "#0f172a", border: "1px solid #334155", color: "white" }} value={editorData.title} onChange={e => handleEditorChange("title", e.target.value)} placeholder="Display title" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Type</label>
                <select style={{ width: "100%", padding: 8, borderRadius: 6, background: "#0f172a", border: "1px solid #334155", color: "white" }} value={editorData.type} onChange={e => handleEditorChange("type", e.target.value)}>
                  <option value="web">Web (opens inside Slab)</option>
                  <option value="native">Native (launches system app)</option>
                </select>
              </div>
              {editorData.type === 'web' ? (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Web URL</label>
                  <input style={{ width: "100%", padding: 8, borderRadius: 6, background: "#0f172a", border: "1px solid #334155", color: "white" }} value={editorData.webUrl} onChange={e => handleEditorChange("webUrl", e.target.value)} placeholder="https://..." />
                </div>
              ) : (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>App Command</label>
                  <input style={{ width: "100%", padding: 8, borderRadius: 6, background: "#0f172a", border: "1px solid #334155", color: "white" }} value={editorData.appId} onChange={e => handleEditorChange("appId", e.target.value)} placeholder="vlc" />
                </div>
              )}
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Icon URL</label>
                <input style={{ width: "100%", padding: 8, borderRadius: 6, background: "#0f172a", border: "1px solid #334155", color: "white" }} value={editorData.icon} onChange={e => handleEditorChange("icon", e.target.value)} placeholder="http://... or file://..." />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setShowEditor(false)} style={{ padding: "8px 16px", borderRadius: 8, background: "transparent", border: "1px solid #475569" }}>Cancel</button>
                <button onClick={saveEditor} style={{ padding: "8px 16px", borderRadius: 8, background: "#0ea5e9", color: "black", fontWeight: "bold" }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
