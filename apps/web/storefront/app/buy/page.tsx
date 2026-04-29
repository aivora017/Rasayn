"use client";
import { useState } from "react";

const TIER_INFO: Record<string, { name: string; pricePaise: number; cadence: string }> = {
  free:       { name: "Free 30-day trial",  pricePaise:       0, cadence: "trial" },
  starter:    { name: "Starter (perpetual)", pricePaise: 14999_00, cadence: "perpetual" },
  pro:        { name: "Pro (monthly)",       pricePaise:   999_00, cadence: "monthly" },
  enterprise: { name: "Enterprise",          pricePaise:       0, cadence: "contact" },
};

declare global { interface Window { Razorpay?: new (opts: object) => { open(): void } } }

export default function Buy() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const tier = params?.get("tier") ?? "starter";
  const info = TIER_INFO[tier] ?? TIER_INFO.starter;

  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const launchPayment = async () => {
    setBusy(true);
    try {
      // 1. Create order on backend
      const r = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, shopName, email, phone, amountPaise: info!.pricePaise }),
      });
      const order = await r.json();

      // 2. Open Razorpay modal
      if (!window.Razorpay) {
        alert("Razorpay SDK not loaded. (For local dev, your real key goes in apps/web/storefront/.env)");
        return;
      }
      const rzp = new window.Razorpay({
        key: process.env["NEXT_PUBLIC_RAZORPAY_KEY_ID"] ?? "rzp_test_PLACEHOLDER",
        amount: info!.pricePaise,
        currency: "INR",
        name: "Rasayn (PharmaCare Pro)",
        description: info!.name,
        order_id: order.id,
        prefill: { name: shopName, email, contact: phone },
        theme: { color: "#0A4338" },
        handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          // 3. Server verifies + issues licence key
          const verify = await fetch("/api/license/issue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...resp, tier, shopName, email }),
          });
          const { licenseKey } = await verify.json();
          window.location.href = `/buy/success?key=${encodeURIComponent(licenseKey)}`;
        },
      });
      rzp.open();
    } finally { setBusy(false); }
  };

  if (info?.cadence === "contact") {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: "#0A4338", marginBottom: 16 }}>Enterprise enquiry</h1>
        <p style={{ fontSize: 15, color: "#444", marginBottom: 24 }}>
          Email hello@rasayn.in with your shop count, GMV per store, and required custom modules. We'll reply within 24h.
        </p>
        <a href="mailto:hello@rasayn.in?subject=Rasayn%20Enterprise"
           style={{ background: "#0A4338", color: "white", padding: "12px 28px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>
          Email sales →
        </a>
      </div>
    );
  }

  if (info?.cadence === "trial") {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: "#0A4338", marginBottom: 16 }}>Free 30-day trial</h1>
        <p style={{ fontSize: 15, color: "#444", marginBottom: 24 }}>
          Download the Rasayn Windows installer · install · register your shop · click "Start 30-day trial" in Settings → Licence. No credit card.
        </p>
        <a href="/downloads/PharmaCare-Setup-latest.msi"
           style={{ background: "#0A4338", color: "white", padding: "12px 28px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>
          Download Windows installer (.msi) →
        </a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 500, margin: "0 auto" }}>
      <h1 style={{ fontSize: 36, fontWeight: 800, color: "#0A4338", marginBottom: 8 }}>Buy {info?.name}</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>
        ₹{((info?.pricePaise ?? 0) / 100).toLocaleString("en-IN")} {info?.cadence === "monthly" ? "per month" : "one-time"}
      </p>

      <form onSubmit={(e) => { e.preventDefault(); void launchPayment(); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Shop name (as on GST certificate)
          <input value={shopName} onChange={(e) => setShopName(e.target.value)} required
                 style={{ display: "block", width: "100%", padding: 10, border: "1px solid #E5E5E0", borderRadius: 6, marginTop: 4, fontSize: 14 }} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                 style={{ display: "block", width: "100%", padding: 10, border: "1px solid #E5E5E0", borderRadius: 6, marginTop: 4, fontSize: 14 }} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Phone (10-digit)
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required pattern="[0-9]{10}"
                 style={{ display: "block", width: "100%", padding: 10, border: "1px solid #E5E5E0", borderRadius: 6, marginTop: 4, fontSize: 14 }} />
        </label>
        <button type="submit" disabled={busy}
                style={{ background: "#0A4338", color: "white", padding: 14, borderRadius: 6, border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 12 }}>
          {busy ? "Processing…" : `Pay ₹${((info?.pricePaise ?? 0) / 100).toLocaleString("en-IN")} via Razorpay →`}
        </button>
        <p style={{ fontSize: 12, color: "#888", textAlign: "center" }}>
          Secured by Razorpay. UPI · Cards · Netbanking. 30-day money-back guarantee.
        </p>
      </form>
    </div>
  );
}
