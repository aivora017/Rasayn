// /admin/licenses — operator console showing recently-issued license keys.
// Gate: STOREFRONT_ADMIN_TOKEN cookie must equal env STOREFRONT_ADMIN_TOKEN.
// Server component — reads directly from the file-backed store.

import { cookies } from "next/headers";
import { getLicenseStore } from "../../../lib/license-store";

export const dynamic = "force-dynamic";

export default async function LicensesAdminPage(): Promise<React.ReactElement> {
  const cookieStore = await cookies();
  const token = cookieStore.get("STOREFRONT_ADMIN_TOKEN")?.value ?? "";
  const expected = process.env["STOREFRONT_ADMIN_TOKEN"];
  if (!expected) {
    return <main style={{ padding: 24 }}><h1>Admin disabled</h1><p>Set STOREFRONT_ADMIN_TOKEN in env to enable.</p></main>;
  }
  if (token !== expected) {
    return <main style={{ padding: 24 }}><h1>403</h1><p>Set the STOREFRONT_ADMIN_TOKEN cookie.</p></main>;
  }

  const records = await getLicenseStore().listRecent(100);
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Recent license keys</h1>
      <p style={{ color: "#666" }}>Most recent {records.length} keys, newest first.</p>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: 8 }}>Issued</th>
            <th style={{ padding: 8 }}>Tier</th>
            <th style={{ padding: 8 }}>Shop</th>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Key</th>
            <th style={{ padding: 8 }}>Valid until</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.razorpayPaymentId} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{new Date(r.issuedAt).toLocaleString("en-IN")}</td>
              <td style={{ padding: 8 }}>{r.tier}</td>
              <td style={{ padding: 8 }}>{r.shopName}</td>
              <td style={{ padding: 8 }}>{r.email}</td>
              <td style={{ padding: 8, fontFamily: "monospace" }}>{r.licenseKey}</td>
              <td style={{ padding: 8 }}>{new Date(r.validUntil).toLocaleDateString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
