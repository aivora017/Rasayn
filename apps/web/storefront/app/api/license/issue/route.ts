import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { issueLicense, type SignedLicenseKey } from "@pharmacare/license";
import { getLicenseStore, type IssuedLicenseRecord } from "../../../../lib/license-store";
import { sendLicenseKeyEmail } from "../../../../lib/email";

interface IssueRequest {
  readonly razorpay_payment_id: string;
  readonly razorpay_order_id: string;
  readonly razorpay_signature: string;
  readonly tier: "starter" | "pro";
  readonly shopName: string;
  readonly email: string;
  readonly shopFingerprintShort?: string;
  readonly lang?: "en" | "hi" | "mr";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as IssueRequest;

  // 1. Verify Razorpay signature
  const secret = process.env["RAZORPAY_KEY_SECRET"];
  if (!secret) return NextResponse.json({ error: "secret not set" }, { status: 500 });

  const expected = crypto.createHmac("sha256", secret)
    .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
    .digest("hex");
  if (expected !== body.razorpay_signature) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  // 2. Issue licence key
  const validForDays = body.tier === "starter" ? 365 : body.tier === "pro" ? 30 : 30;
  const fp = body.shopFingerprintShort ?? "000000";
  const license: SignedLicenseKey = issueLicense({
    preset: body.tier,
    shopFingerprintShort: fp,
    validForDays,
  });

  // 3. Persist (idempotent on razorpay_payment_id)
  const issuedAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + validForDays * 86400_000).toISOString();
  const record: IssuedLicenseRecord = {
    licenseKey: license.raw,
    tier: body.tier,
    email: body.email,
    shopName: body.shopName,
    shopFingerprintShort: fp,
    issuedAt,
    validUntil,
    razorpayOrderId: body.razorpay_order_id,
    razorpayPaymentId: body.razorpay_payment_id,
  };
  try {
    await getLicenseStore().append(record);
  } catch (e) {
    console.error("[license/issue] persistence failed:", e);
  }

  // 4. Email the licence key (best-effort, non-blocking).
  void (async () => {
    try {
      const r = await sendLicenseKeyEmail({
        to: body.email,
        licenseKey: license.raw,
        tier: body.tier,
        shopName: body.shopName,
        validUntil,
        ...(body.lang ? { lang: body.lang } : {}),
      });
      if (!r.ok) console.error("[license/issue] email failed:", r.error);
    } catch (e) {
      console.error("[license/issue] email throw:", e);
    }
  })();

  return NextResponse.json({ licenseKey: license.raw, parts: license.parts });
}
