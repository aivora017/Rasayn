import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { issueLicense, type SignedLicenseKey } from "@pharmacare/license";

interface IssueRequest {
  readonly razorpay_payment_id: string;
  readonly razorpay_order_id: string;
  readonly razorpay_signature: string;
  readonly tier: "starter" | "pro";
  readonly shopName: string;
  readonly email: string;
  /** Optional — caller passes in shop hardware fingerprint at activation
   *  time. If absent, licence is "unbound" and validates against any FP for
   *  first 60 days (grace period). */
  readonly shopFingerprintShort?: string;
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
  const fp = body.shopFingerprintShort ?? "000000";   // unbound until first activation
  const license: SignedLicenseKey = issueLicense({
    preset: body.tier,
    shopFingerprintShort: fp,
    validForDays,
  });

  // 3. TODO: persist (license_key, email, shopName, payment_id) to your DB
  // 4. TODO: email the licence key to body.email

  return NextResponse.json({ licenseKey: license.raw, parts: license.parts });
}
