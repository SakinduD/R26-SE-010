// Loading state shaped like the actual new layout (metric strip, chart,
// snapshot grid) instead of four generic cards — so the page doesn't jump
// once real content lands.
export default function JourneySkeleton() {
  return (
    <div className="jsk-wrap">
      <div className="jsk-metrics">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="jsk-metric">
            <div className="skel" style={{ height: 30, width: 52, marginBottom: 6 }} />
            <div className="skel" style={{ height: 10, width: 60 }} />
          </div>
        ))}
      </div>

      <div className="skel" style={{ height: 220, width: '100%', borderRadius: 16, marginTop: 8 }} />

      <div className="jsk-grid">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="skel-card">
            <div className="skel" style={{ height: 16, width: '60%', marginBottom: 10 }} />
            <div className="skel" style={{ height: 12, width: '40%', marginBottom: 16 }} />
            <div className="skel" style={{ height: 40, width: '100%' }} />
          </div>
        ))}
      </div>

      <style>{`
        .jsk-wrap{ display:flex; flex-direction:column; gap:24px; }
        .jsk-metrics{ display:flex; gap:40px; padding:22px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border); flex-wrap:wrap; }
        .jsk-grid{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        @media (max-width:680px){ .jsk-grid{ grid-template-columns:1fr; } }
      `}</style>
    </div>
  )
}
