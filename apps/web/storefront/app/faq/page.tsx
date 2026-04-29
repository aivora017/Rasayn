const QA: ReadonlyArray<{ q: string; a: string }> = [
  { q: "What's different about Rasayn vs Marg / Tally / Vyapar?",
    a: "Three things: (1) we ship migration both IN and OUT — you can leave us anytime with all your data. (2) AI is woven in (DDI alerts, voice billing, copilot, OCR), not a roadmap promise. (3) GST + LLP/Pvt-Ltd compliance auto-generates as a CA-ready file bundle so your CA doesn't ask you 8 times for the sales register." },
  { q: "Does it work without internet?",
    a: "Yes. 100% local-first SQLite database. Internet is only used for (a) optional cloud backup to your own AWS S3 / Cloudflare R2, (b) AI Copilot if you've enabled it, (c) Gmail bill import (X1), (d) auto-updates. You can use Rasayn for months offline and it just works." },
  { q: "Will it work on my old Windows 7 PC?",
    a: "Yes. Tested on i3-8100 / 4GB RAM / 256GB HDD running Windows 7. Sub-2-second bill creation. We deliberately target this hardware — most modern pharmacy software needs Windows 10+ + 8GB RAM, which excludes the long tail of small shops." },
  { q: "What about migration from Marg ERP?",
    a: "Built-in. Export your Marg item-master CSV + customer-master CSV → Rasayn → Migration Import → Marg ERP. Done in 5 minutes. We support Marg / Tally Prime XML / Vyapar / Medeil / Generic CSV." },
  { q: "How do GST returns work?",
    a: "End of month: click 'Export for CA' → ZIP file with GSTR-1 JSON, GSTR-3B summary, GSTR-2B reconciliation worksheet, sales/purchase registers, HSN summary, and Tally Prime XML. Hand it to your CA. They upload to GSTN portal as usual. Works for sole proprietor / partnership / LLP / OPC / Pvt Ltd / Public Ltd / Section 8 / HUF — entity-aware." },
  { q: "What if I'm an LLP and need Form 8 every year?",
    a: "Same Export-for-CA bundle includes LLP Form 8 input JSON, P&L, Balance Sheet, Trial Balance — all the data your CA needs for the MCA portal. Pvt Ltd gets AOC-4 + MGT-7 inputs. OPC gets MGT-7A. Sole proprietor doesn't need ROC at all." },
  { q: "Do you support Schedule H/H1/X compliance?",
    a: "Yes. Mandatory image-on-file enforcement (counter staff can't sell a Schedule H drug without a doctor + Rx + image). Schedule H/H1 register auto-generated. Schedule X biometric witness flow available in Enterprise tier." },
  { q: "What about DDI / drug-interaction alerts?",
    a: "Curated 42-ingredient + 25-pair seed bundled (FDA Orange + WHO Essential Medicines + BNF). Shows at line-add: warn for moderate, block for life-threatening. CIMS-India full subscription is an Enterprise add-on." },
  { q: "Can I use it for multiple shops / chain?",
    a: "Yes — Enterprise tier. LAN-first parent/worker sync via rqlite. Each store works fully independently when offline; HQ aggregates when reconnected." },
  { q: "What payment options for licence?",
    a: "Razorpay: UPI / cards / netbanking / EMI. Perpetual licences: one-time. Monthly: auto-debit. 30-day money-back guarantee on all tiers." },
  { q: "Who's behind Rasayn?",
    a: "Built by Sourav Shaw at Jagannath Pharmacy LLP in Kalyan, Maharashtra. Ground-up rebuild in 2026 by a single founder-engineer. Supported by his pharmacy as the proving ground." },
];

export default function FAQ() {
  return (
    <div>
      <h1 style={{ fontSize: 44, fontWeight: 800, color: "#0A4338", marginBottom: 32, textAlign: "center" }}>FAQ</h1>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {QA.map((qa, i) => (
          <details key={i} style={{ background: "white", padding: 16, borderRadius: 8, border: "1px solid #E5E5E0", marginBottom: 8 }}>
            <summary style={{ fontWeight: 600, cursor: "pointer", fontSize: 16 }}>{qa.q}</summary>
            <p style={{ fontSize: 14, color: "#444", lineHeight: 1.7, marginTop: 8 }}>{qa.a}</p>
          </details>
        ))}
      </div>
      <div style={{ textAlign: "center", marginTop: 48 }}>
        <p style={{ fontSize: 15, color: "#666" }}>Still have questions?</p>
        <a href="mailto:hello@rasayn.in" style={{ background: "#0A4338", color: "white", padding: "10px 24px", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>hello@rasayn.in</a>
      </div>
    </div>
  );
}
