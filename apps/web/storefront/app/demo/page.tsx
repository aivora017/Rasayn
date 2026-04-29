const SCREENS = [
  { name: "Billing — sub-2-second bill creation", desc: "F-key keyboard nav · FEFO batch picker · DDI alerts at line-add", emoji: "🧾" },
  { name: "Cash Shift", desc: "Denomination wizard · Z-report · variance approval", emoji: "💰" },
  { name: "Khata (credit ledger)", desc: "Aging buckets · payment recording · risk score", emoji: "📒" },
  { name: "Migration Import", desc: "Marg / Tally / Vyapar / Medeil / Generic CSV adapters", emoji: "📥" },
  { name: "Data Export", desc: "Full DB dump · re-import packs · zero vendor lock-in", emoji: "📤" },
  { name: "AI Copilot", desc: "Natural language Q&A · 5 Indic languages · counseling drafts", emoji: "🤖" },
  { name: "Voice Billing", desc: "Web Speech API · Hindi/Marathi/Gujarati/Tamil intent extraction", emoji: "🎙️" },
  { name: "Inspector Mode", desc: "FDA-ready report in one tap · Schedule registers · IRN reconciliation", emoji: "👁️" },
  { name: "Digital Twin", desc: "3D shop view · health gauge · predictive maintenance", emoji: "🏠" },
];

export default function Demo() {
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 44, fontWeight: 800, color: "#0A4338", marginBottom: 12 }}>See Rasayn in action</h1>
        <p style={{ fontSize: 17, color: "#666" }}>Tour 9 key flows · or download the 30-day free trial</p>
        <div style={{ marginTop: 24 }}>
          <a href="/buy?tier=free" style={{ background: "#0A4338", color: "white", padding: "12px 24px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Download free trial →</a>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {SCREENS.map((s) => (
          <div key={s.name} style={{ background: "white", padding: 20, borderRadius: 12, border: "1px solid #E5E5E0" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{s.emoji}</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0A4338", margin: "0 0 8px" }}>{s.name}</h3>
            <p style={{ fontSize: 13, color: "#444", lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
            <div style={{ marginTop: 16, height: 160, background: "linear-gradient(135deg, #F0F4F2 0%, #E5EBEA 100%)", borderRadius: 8, display: "grid", placeItems: "center", color: "#999", fontSize: 12 }}>
              Screenshot placeholder
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 64, padding: 32, background: "white", borderRadius: 12, textAlign: "center", border: "1px solid #E5E5E0" }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Want a live walkthrough?</h3>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>30-minute video call · I'll show you exactly how it works on your shop's data.</p>
        <a href="mailto:hello@rasayn.in?subject=Rasayn%20demo%20request" style={{ background: "#0A4338", color: "white", padding: "10px 24px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Schedule a call →</a>
      </div>
    </div>
  );
}
