import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";
import { issueLicense, type SignedLicenseKey } from "@pharmacare/license";
import { getLicenseStore, type IssuedLicenseRecord } from "../../../../lib/license-store";

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

  // 3. Persist the issued record (idempotent on razorpay_payment_id).
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
    // Don't block the customer's purchase on persistence failure — log it
    // and let the admin reconcile from Razorpay later. The license has
    // already been signed and is valid offline.
    console.error("[license/issue] persistence failed:", e);
  }

  // 4. TODO: email the licence key to body.email (S22).

  return NextResponse.json({ licenseKey: license.raw, parts: license.parts });
}
