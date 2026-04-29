// SCAFFOLD — apps/web/customer-kiosk (Customer Kiosk)
// Voice-first kiosk in-store. Elderly-friendly. 'Is my Crocin ready?' in Hindi.

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0A4338", color: "#FFFFFF", padding: 24 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Customer Kiosk</h1>
      <span style={{ color: "#FF7A4A", fontSize: 12, fontWeight: 600, letterSpacing: 2, marginBottom: 16 }}>SCAFFOLD</span>
      <p style={{ color: "#E5F4F0", maxWidth: 480, textAlign: "center", lineHeight: 1.5 }}>Voice-first kiosk in-store. Elderly-friendly. 'Is my Crocin ready?' in Hindi.</p>
    </main>
  );
}
