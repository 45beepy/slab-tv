// renderer/src/App.jsx
import React, { useEffect, useState } from "react";

export default function App() {
  const [displays, setDisplays] = useState([]);
  const [showPopup, setShowPopup] = useState(false);
  const [popupShownFor, setPopupShownFor] = useState(null); // store stringified displays to avoid repeat

  useEffect(() => {
    // subscribe to display changes exposed by preload
    if (window.slab && window.slab.onDisplaysChanged) {
      window.slab.onDisplaysChanged((d) => {
        setDisplays(d || []);
        // show popup if there's more than one connected display
        try {
          const key = JSON.stringify(d || []);
          const hasExternal = (d || []).length > 1;
          if (hasExternal && key !== popupShownFor) {
            setPopupShownFor(key);
            setShowPopup(true);
          }
        } catch (e) { /* ignore */ }
      });
    }
  }, [popupShownFor]);

  async function onUseAsSlab() {
    setShowPopup(false);
    if (window.slab && window.slab.launchSlab) {
      const res = await window.slab.launchSlab();
      if (!res.ok) {
        alert("Failed to enter SlabTV mode: " + (res.error || "unknown"));
      } else {
        // optionally show a toast - for now we can console.log
        console.log("Entered SlabTV mode", res.display);
      }
    }
  }

  return (
    <div style={{ padding: 28, fontFamily: "Inter, sans-serif" }}>
      <h1>Slab TV — Kiosk</h1>

      <section style={{ marginTop: 12 }}>
        <strong>Connected displays:</strong>
        <ul>
          {displays.length === 0 && <li>Detecting...</li>}
          {displays.map((d) => (
            <li key={d.name}>
              {d.name} {d.geometry ? `— ${d.geometry}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 18 }}>
        <button
          onClick={() => {
            // toggle fullscreen manually (debug)
            const evt = new CustomEvent("debug-toggle-fullscreen");
            window.dispatchEvent(evt);
          }}
          style={{ padding: "8px 14px", marginRight: 8 }}
        >
          Debug: Toggle Fullscreen
        </button>
      </section>

      {showPopup && (
        <div style={{
          position: "fixed",
          left: 20,
          right: 20,
          bottom: 30,
          background: "#111827",
          color: "#fff",
          padding: 18,
          borderRadius: 10,
          boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          zIndex: 9999
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>External display detected</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>Use this screen as Slab TV?</div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowPopup(false)}
              style={{ padding: "8px 12px", borderRadius: 6, background: "#374151", color: "#fff", border: "none" }}
            >
              Dismiss
            </button>

            <button
              onClick={onUseAsSlab}
              style={{ padding: "8px 12px", borderRadius: 6, background: "#06b6d4", color: "#000", border: "none", fontWeight: 600 }}
            >
              Use as Slab TV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
