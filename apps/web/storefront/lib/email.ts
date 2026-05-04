// email.ts — license-key delivery via Resend (S22c.1).
//
// Wired into /api/license/issue. The send is best-effort: a transient
// SMTP/API failure should NOT block the customer's purchase. The license
// key is already cryptographically signed and offline-validatable, so a
// retry from /admin/licenses or a manual resend is always available.

interface SendOptions {
  readonly to: string;
  readonly licenseKey: string;
  readonly tier: "starter" | "pro";
  readonly shopName: string;
  readonly validUntil: string;
}

interface ResendResponse {
  readonly id?: string;
  readonly error?: { message: string };
}

const FROM_DEFAULT = "PharmaCare Pro <licenses@pharmacare-pro.in>";

export async function sendLicenseKeyEmail(opts: SendOptions): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not set -- skipping email send" };
  }
  const from = process.env["RESEND_FROM"] ?? FROM_DEFAULT;
  const subject = `Your PharmaCare Pro ${opts.tier} licence -- ${opts.shopName}`;

  const html = renderLicenseEmailHtml(opts);
  const text = renderLicenseEmailText(opts);

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from, to: [opts.to], subject, html, text,
      }),
    });
    const body = (await r.json()) as ResendResponse;
    if (!r.ok || !body.id) {
      return { ok: false, error: body.error?.message ?? `HTTP ${r.status}` };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function renderLicenseEmailHtml(o: SendOptions): string {
  const validDate = new Date(o.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #222">
  <h1 style="font-size: 18px; color: #15803d">Welcome to PharmaCare Pro</h1>
  <p>Thank you for your purchase, ${escapeHtml(o.shopName)}.</p>
  <p>Your <strong>${o.tier}</strong> licence is below. Open the desktop app, click <em>Settings -&gt; Licence</em>, and paste it in.</p>
  <pre style="background:#f4f4f5;padding:12px;border-radius:6px;font-size:13px;letter-spacing:0.5px;word-break:break-all;">${escapeHtml(o.licenseKey)}</pre>
  <p style="font-size:13px;color:#555">Valid through <strong>${validDate}</strong>.</p>
  <hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0">
  <p style="font-size:12px;color:#888">Need help? Reply to this email or call +91-XXXX-XXXX-XX (Mon-Sat 9am-9pm IST).</p>
</body></html>`;
}

function renderLicenseEmailText(o: SendOptions): string {
  const validDate = new Date(o.validUntil).toLocaleDateString("en-IN");
  return [
    `Welcome to PharmaCare Pro`,
    ``,
    `Thank you for your purchase, ${o.shopName}.`,
    ``,
    `Your ${o.tier} licence:`,
    ``,
    o.licenseKey,
    ``,
    `Valid through ${validDate}.`,
    ``,
    `In the desktop app: Settings -> Licence, paste the key.`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
