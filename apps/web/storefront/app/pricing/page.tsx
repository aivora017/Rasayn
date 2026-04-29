const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "₹0",
    cadence: "30-day trial",
    cta: "Start free",
    href: "/buy?tier=free",
    features: [
      "Core POS + GST billing",
      "Inventory + batch tracking",
      "GSTR-1 + 3B exports",
      "Migration IN/OUT",
      "1 user · 100 bills/mo",
    ],
    highlight: false,
  },
  {
    id: "starter",
    name: "Starter",
    price: "₹14,999",
    cadence: "perpetual + ₹4,999/yr AMC",
    cta: "Buy Starter",
    href: "/buy?tier=starter",
    features: [
      "Everything in Free",
      "Unlimited users + bills",
      "Cash shift / Z-report",
      "Khata credit ledger",
      "RBAC + MFA",
      "Tally / Zoho / QuickBooks export",
      "Schedule H register",
      "1 year of updates included",
    ],
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "₹999",
    cadence: "/month",
    cta: "Buy Pro",
    href: "/buy?tier=pro",
    features: [
      "Everything in Starter",
      "AI Copilot (natural-language reports)",
      "Voice billing (Hindi · Marathi · Gujarati · Tamil)",
      "OCR Rx scan",
      "WhatsApp invoice delivery",
      "Demand forecasting (Holt-Winters)",
      "DDI + allergy + dose alerts",
      "Auto-update channel access",
    ],
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Contact",
    cadence: "for chains > 5 stores",
    cta: "Contact sales",
    href: "mailto:hello@rasayn.in?subject=Rasayn%20Enterprise%20enquiry",
    features: [
      "Everything in Pro",
      "Multi-store parent/worker LAN sync",
      "Plugin marketplace + custom plugins",
      "Cold-chain BLE temp sensors",
      "AR shelf overlay (visionOS / Quest)",
      "Digital twin 3D dashboard",
      "Custom compliance modules",
      "Dedicated CS + SLA",
    ],
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 44, fontWeight: 800, color: "#0A4338", marginBottom: 12 }}>Simple, fair pricing</h1>
        <p style={{ fontSize: 17, color: "#666", maxWidth: 600, margin: "0 auto" }}>
          Pay perpetual once or month-to-month. Either way, your data is yours and you can leave anytime.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {TIERS.map((t) => (
          <div key={t.id}
               style={{
                 background: t.highlight ? "linear-gradient(135deg, #0A4338 0%, #0E5142 100%)" : "white",
                 color: t.highlight ? "white" : "#1A1A1A",
                 padding: 24,
                 borderRadius: 12,
                 border: t.highlight ? "none" : "1px solid #E5E5E0",
                 boxShadow: t.highlight ? "0 8px 24px rgba(10, 67, 56, 0.3)" : "none",
                 transform: t.highlight ? "scale(1.05)" : "scale(1)",
               }}>
            {t.highlight && (
              <div style={{ display: "inline-block", background: "#FF7A4A", color: "white", padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, marginBottom: 12, letterSpacing: 1 }}>
                MOST POPULAR
              </div>
            )}
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>{t.name}</h2>
            <div style={{ fontSize: 36, fontWeight: 800, marginBottom: 4 }}>{t.price}</div>
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 24 }}>{t.cadence}</div>
            <a href={t.href}
               style={{
                 display: "block",
                 textAlign: "center",
                 background: t.highlight ? "white" : "#0A4338",
                 color:      t.highlight ? "#0A4338" : "white",
                 padding: "10px 16px",
                 borderRadius: 6,
                 textDecoration: "none",
                 fontWeight: 600,
                 marginBottom: 24,
               }}>{t.cta} →</a>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, lineHeight: 1.7 }}>
              {t.features.map((f) => <li key={f}>✓ {f}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 64, padding: 32, background: "white", borderRadius: 12, border: "1px solid #E5E5E0" }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Frequently asked</h3>
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontWeight: 600, cursor: "pointer" }}>Can I switch from monthly to perpetual?</summary>
          <p style={{ fontSize: 14, color: "#444", marginTop: 8 }}>Yes. Email <a href="mailto:hello@rasayn.in">hello@rasayn.in</a> with your licence key — we'll credit your last 3 months toward the perpetual fee.</p>
        </details>
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontWeight: 600, cursor: "pointer" }}>What if I'm not happy?</summary>
          <p style={{ fontSize: 14, color: "#444", marginTop: 8 }}>30-day money-back guarantee on all paid tiers. Use the data-export feature to take everything with you. We'll refund within 7 days.</p>
        </details>
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontWeight: 600, cursor: "pointer" }}>Do you charge per shop or per user?</summary>
          <p style={{ fontSize: 14, color: "#444", marginTop: 8 }}>Per shop (one licence per location). Unlimited users at that shop. Multi-store add-on for chains.</p>
        </details>
      </div>
    </div>
  );
}
