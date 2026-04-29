"use client";
export default function BuySuccess() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const key = params?.get("key") ?? "";
  return (
    <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
      <h1 style={{ fontSize: 36, fontWeight: 800, color: "#0A4338", marginBottom: 16 }}>Welcome to Rasayn</h1>
      <p style={{ fontSize: 15, color: "#444", marginBottom: 24 }}>
        Your licence key is ready. Save this somewhere safe — we've also emailed it to you.
      </p>
      <div style={{ background: "white", padding: 20, borderRadius: 12, border: "2px dashed #0A4338", marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: "#666", letterSpacing: 1, marginBottom: 8 }}>YOUR LICENCE KEY</div>
        <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 600, color: "#0A4338", wordBreak: "break-all" }}>{key}</div>
        <button onClick={() => navigator.clipboard?.writeText(key)}
                style={{ marginTop: 12, background: "#0A4338", color: "white", padding: "8px 16px", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
          Copy to clipboard
        </button>
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Next steps</h3>
      <ol style={{ textAlign: "left", maxWidth: 480, margin: "0 auto", fontSize: 14, lineHeight: 1.8 }}>
        <li>Download the Windows installer: <a href="/downloads/PharmaCare-Setup-latest.msi">PharmaCare-Setup-latest.msi</a></li>
        <li>Install on your shop computer</li>
        <li>Open Settings → Licence → paste your key above → activate</li>
        <li>Done. Run your first bill.</li>
      </ol>
      <p style={{ fontSize: 12, color: "#888", marginTop: 32 }}>
        Need help? <a href="mailto:hello@rasayn.in">hello@rasayn.in</a> — we usually reply within an hour.
      </p>
    </div>
  );
}
