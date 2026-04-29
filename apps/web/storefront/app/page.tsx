const MOATS = [
  {
    title: "X1 — Gmail bill import",
    body: "Distributor invoices land in your Gmail. We OAuth in, parse the attachments, draft a GRN. Saves 6-10 hours/week of manual entry.",
    icon: "📧",
  },
  {
    title: "X2 — Mandatory product images",
    body: "Every Schedule H/H1/X SKU must have a real product photo before sale. Counter staff who can't read English can dispense correctly.",
    icon: "📸",
  },
  {
    title: "X3 — Photo-of-paper-bill OCR",
    body: "30-40% of distributors still hand you paper. Snap a phone photo, get a draft GRN with confidence-coded lines.",
    icon: "🤖",
  },
];

const VS_TABLE = [
  { feat: "Migration IN (from Marg/Tally/Vyapar)", us: "✓ 5 adapters", them: "✗ rare" },
  { feat: "Migration OUT (full DB dump)",          us: "✓ ZIP with re-import packs", them: "✗ never" },
  { feat: "Voice billing in Hindi/Marathi",        us: "✓ Web Speech API", them: "✗" },
  { feat: "AI Copilot ('why are sales down?')",    us: "✓ local LLM-ready", them: "✗" },
  { feat: "DDI + allergy + dose alerts",           us: "✓ FDA + WHO + BNF curated", them: "✗" },
  { feat: "GSTR-1 / 3B / 9 + LLP Form 8 export",  us: "✓ entity-aware", them: "△ partial" },
  { feat: "Standalone install (no SaaS)",          us: "✓ local-first", them: "✗ many cloud-only" },
  { feat: "Perpetual licence option",              us: "✓ ₹14,999",  them: "₹? variable" },
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section style={{ textAlign: "center", padding: "64px 0 48px" }}>
        <div style={{ fontSize: 13, color: "#0A4338", letterSpacing: 1.5, fontWeight: 600, textTransform: "uppercase" }}>
          Pharmacy software · India · 2026
        </div>
        <h1 style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1, margin: "16px 0 24px", color: "#0A4338" }}>
          The pharmacy software that<br />doesn't lock you in.
        </h1>
        <p style={{ fontSize: 19, color: "#444", maxWidth: 720, margin: "0 auto 32px", lineHeight: 1.5 }}>
          GST + LLP Form 8 ready. Voice billing in 5 Indic languages. AI Copilot.
          Migrate IN from Marg / Tally / Vyapar in minutes — and OUT just as easily.
          ₹14,999 perpetual licence, no monthly trap.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/buy"  style={{ background: "#0A4338", color: "white", padding: "14px 28px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Buy now ₹14,999 →</a>
          <a href="/demo" style={{ border: "2px solid #0A4338", color: "#0A4338", padding: "12px 28px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Try free for 30 days</a>
        </div>
        <p style={{ fontSize: 12, color: "#888", marginTop: 16 }}>
          Tauri 2 · React 19 · SQLite · works offline · Windows 7+ supported
        </p>
      </section>

      {/* The 3 moats */}
      <section style={{ padding: "64px 0" }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, textAlign: "center", marginBottom: 8 }}>Three things no other Indian pharmacy software does</h2>
        <p style={{ fontSize: 14, color: "#666", textAlign: "center", marginBottom: 48 }}>(and none of them can copy in 24 months)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {MOATS.map((m) => (
            <div key={m.title} style={{ background: "white", padding: 24, borderRadius: 12, border: "1px solid #E5E5E0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{m.icon}</div>
              <h3 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 8px", color: "#0A4338" }}>{m.title}</h3>
              <p style={{ fontSize: 14, color: "#444", lineHeight: 1.5 }}>{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section style={{ padding: "64px 0" }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, textAlign: "center", marginBottom: 32 }}>Rasayn vs the field</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "white", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <thead>
            <tr style={{ background: "#0A4338", color: "white" }}>
              <th style={{ textAlign: "left", padding: 16, fontWeight: 600 }}>Feature</th>
              <th style={{ textAlign: "left", padding: 16, fontWeight: 600 }}>Rasayn</th>
              <th style={{ textAlign: "left", padding: 16, fontWeight: 600 }}>Marg / Tally / Vyapar / Medeil</th>
            </tr>
          </thead>
          <tbody>
            {VS_TABLE.map((row, i) => (
              <tr key={i} style={{ borderTop: "1px solid #E5E5E0" }}>
                <td style={{ padding: 14, fontSize: 14 }}>{row.feat}</td>
                <td style={{ padding: 14, fontSize: 14, color: "#0A4338", fontWeight: 600 }}>{row.us}</td>
                <td style={{ padding: 14, fontSize: 14, color: "#999" }}>{row.them}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Anti-lock-in promise */}
      <section style={{ padding: "64px 0", background: "linear-gradient(135deg, #0A4338 0%, #0E5142 100%)", color: "white", borderRadius: 16, margin: "64px 0", textAlign: "center" }}>
        <div style={{ padding: "48px 24px" }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 16px" }}>Your data. Always.</h2>
          <p style={{ fontSize: 17, opacity: 0.9, maxWidth: 640, margin: "0 auto", lineHeight: 1.5 }}>
            One click and you walk away with everything: customers, products, every bill, every stock movement.
            CSV + JSON + ready-to-import packs for Marg / Vyapar / Tally.
            We even <em>tell you how</em> to import into them.
          </p>
          <p style={{ fontSize: 14, opacity: 0.7, marginTop: 24 }}>
            No DRM. No vendor lock-in. No fees to leave.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{ textAlign: "center", padding: "48px 0" }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Stop fighting your software. Start running your pharmacy.</h2>
        <a href="/pricing" style={{ background: "#0A4338", color: "white", padding: "14px 28px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>See pricing →</a>
      </section>
    </div>
  );
}
