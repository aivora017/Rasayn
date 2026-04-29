export const metadata = {
  title: "Rasayn — PharmaCare Pro · the pharmacy software that doesn't lock you in",
  description: "Indian pharmacy POS · GST + LLP-Form-8 ready · migration-in from Marg / Tally / Vyapar / Medeil · standalone, no SaaS · ₹14,999 perpetual or ₹999/mo",
};

const NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/",        label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/demo",    label: "Demo" },
  { href: "/faq",     label: "FAQ" },
  { href: "/buy",     label: "Buy now" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Inter, system-ui, -apple-system, sans-serif", background: "#FAFAF8", color: "#1A1A1A" }}>
        <header style={{ borderBottom: "1px solid #E5E5E0", padding: "16px 24px", background: "white" }}>
          <nav style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 24, justifyContent: "space-between" }}>
            <a href="/" style={{ fontSize: 20, fontWeight: 700, color: "#0A4338", textDecoration: "none" }}>
              ℞ Rasayn
            </a>
            <div style={{ display: "flex", gap: 24, fontSize: 14 }}>
              {NAV.slice(0, -1).map((n) => (
                <a key={n.href} href={n.href} style={{ color: "#1A1A1A", textDecoration: "none" }}>{n.label}</a>
              ))}
              <a href="/buy" style={{ color: "white", background: "#0A4338", padding: "8px 16px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>Buy now →</a>
            </div>
          </nav>
        </header>
        <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>
          {children}
        </main>
        <footer style={{ borderTop: "1px solid #E5E5E0", padding: "32px 24px", marginTop: 64, background: "white", color: "#666", fontSize: 13 }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              © 2026 Rasayn Software (Jagannath Pharmacy LLP) · Kalyan, Maharashtra
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <a href="/privacy" style={{ color: "#666" }}>Privacy</a>
              <a href="/terms"   style={{ color: "#666" }}>Terms</a>
              <a href="/refund"  style={{ color: "#666" }}>Refund policy</a>
              <a href="mailto:hello@rasayn.in" style={{ color: "#666" }}>hello@rasayn.in</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
