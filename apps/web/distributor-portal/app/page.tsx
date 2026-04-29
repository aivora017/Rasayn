// SCAFFOLD — apps/web/distributor-portal (Distributor Portal)
// Pharmarack-class B2B portal for distributors. Catalog, orders, schemes, settlements.

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0A4338", color: "#FFFFFF", padding: 24 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Distributor Portal</h1>
      <span style={{ color: "#FF7A4A", fontSize: 12, fontWeight: 600, letterSpacing: 2, marginBottom: 16 }}>SCAFFOLD</span>
      <p style={{ color: "#E5F4F0", maxWidth: 480, textAlign: "center", lineHeight: 1.5 }}>Pharmarack-class B2B portal for distributors. Catalog, orders, schemes, settlements.</p>
    </main>
  );
}
