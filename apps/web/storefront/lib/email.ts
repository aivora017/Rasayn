// email.ts — license-key delivery via Resend (S22c.1).
//
// Wired into /api/license/issue. The send is best-effort: a transient
// SMTP/API failure should NOT block the customer's purchase. The license
// key is already cryptographically signed and offline-validatable, so a
// retry from /admin/licenses or a manual resend is always available.
//
// S23 — i18n: subject + body now switch on `lang` (en/hi/mr) per project §9.

type Lang = "en" | "hi" | "mr";

interface SendOptions {
  readonly to: string;
  readonly licenseKey: string;
  readonly tier: "starter" | "pro";
  readonly shopName: string;
  readonly validUntil: string;
  readonly lang?: Lang;
}

interface ResendResponse {
  readonly id?: string;
  readonly error?: { message: string };
}

interface LangStrings {
  readonly subject: (tier: string, shopName: string) => string;
  readonly heading: string;
  readonly thanks: (shopName: string) => string;
  readonly licenseBelow: (tier: string) => string;
  readonly validThrough: (date: string) => string;
  readonly help: string;
  readonly locale: string;
}

const STRINGS: Record<Lang, LangStrings> = {
  en: {
    subject: (tier, shopName) => `Your PharmaCare Pro ${tier} licence -- ${shopName}`,
    heading: "Welcome to PharmaCare Pro",
    thanks: (shopName) => `Thank you for your purchase, ${shopName}.`,
    licenseBelow: (tier) => `Your ${tier} licence is below. Open the desktop app, click Settings -> Licence, and paste it in.`,
    validThrough: (date) => `Valid through ${date}.`,
    help: "Need help? Reply to this email or call +91-XXXX-XXXX-XX (Mon-Sat 9am-9pm IST).",
    locale: "en-IN",
  },
  hi: {
    subject: (tier, shopName) => `आपका PharmaCare Pro ${tier} लाइसेंस -- ${shopName}`,
    heading: "PharmaCare Pro में आपका स्वागत है",
    thanks: (shopName) => `आपकी ख़रीद के लिए धन्यवाद, ${shopName}।`,
    licenseBelow: (tier) => `आपका ${tier} लाइसेंस नीचे दिया गया है। डेस्कटॉप ऐप खोलें, Settings -> Licence पर क्लिक करें, और पेस्ट करें।`,
    validThrough: (date) => `${date} तक वैध।`,
    help: "सहायता चाहिए? इस ईमेल का उत्तर दें या +91-XXXX-XXXX-XX पर कॉल करें (सोम-शनि सुबह 9 से रात 9 IST)।",
    locale: "hi-IN",
  },
  mr: {
    subject: (tier, shopName) => `आपला PharmaCare Pro ${tier} परवाना -- ${shopName}`,
    heading: "PharmaCare Pro मध्ये आपले स्वागत आहे",
    thanks: (shopName) => `आपल्या खरेदीसाठी धन्यवाद, ${shopName}.`,
    licenseBelow: (tier) => `आपला ${tier} परवाना खाली दिला आहे. डेस्कटॉप अॅप उघडा, Settings -> Licence वर क्लिक करा, आणि पेस्ट करा.`,
    validThrough: (date) => `${date} पर्यंत वैध.`,
    help: "मदत हवी? या ईमेलला उत्तर द्या किंवा +91-XXXX-XXXX-XX वर कॉल करा (सोम-शनि सकाळी 9 ते रात्री 9 IST).",
    locale: "mr-IN",
  },
};

const FROM_DEFAULT = "PharmaCare Pro <licenses@pharmacare-pro.in>";

export async function sendLicenseKeyEmail(opts: SendOptions): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not set -- skipping email send" };
  }
  const from = process.env["RESEND_FROM"] ?? FROM_DEFAULT;
  const lang: Lang = opts.lang ?? "en";
  const t = STRINGS[lang];
  const subject = t.subject(opts.tier, opts.shopName);

  const html = renderLicenseEmailHtml(opts, t);
  const text = renderLicenseEmailText(opts, t);

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

function renderLicenseEmailHtml(o: SendOptions, t: LangStrings): string {
  const validDate = new Date(o.validUntil).toLocaleDateString(t.locale, { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #222">
  <h1 style="font-size: 18px; color: #15803d">${t.heading}</h1>
  <p>${escapeHtml(t.thanks(o.shopName))}</p>
  <p>${escapeHtml(t.licenseBelow(o.tier))}</p>
  <pre style="background:#f4f4f5;padding:12px;border-radius:6px;font-size:13px;letter-spacing:0.5px;word-break:break-all;">${escapeHtml(o.licenseKey)}</pre>
  <p style="font-size:13px;color:#555">${escapeHtml(t.validThrough(validDate))}</p>
  <hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0">
  <p style="font-size:12px;color:#888">${escapeHtml(t.help)}</p>
</body></html>`;
}

function renderLicenseEmailText(o: SendOptions, t: LangStrings): string {
  const validDate = new Date(o.validUntil).toLocaleDateString(t.locale);
  return [
    t.heading,
    ``,
    t.thanks(o.shopName),
    ``,
    t.licenseBelow(o.tier),
    ``,
    o.licenseKey,
    ``,
    t.validThrough(validDate),
    ``,
    t.help,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
