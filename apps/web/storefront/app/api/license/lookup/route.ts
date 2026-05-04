// GET /api/license/lookup?key=PCPR-...&email=...
// Returns the issued license record if (key, email) match. Used by Sourav's
// support UI when a customer can't find their key in email.
//
// Note: this is read-only; activation/binding lives in the desktop app.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getLicenseStore } from "../../../../lib/license-store";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key")?.trim() ?? "";
  const email = searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!key || !email) {
    return NextResponse.json({ error: "key and email are required" }, { status: 400 });
  }
  const record = await getLicenseStore().findByKey(key);
  if (!record || record.email.toLowerCase() !== email) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // Don't leak razorpay IDs to the public lookup endpoint.
  return NextResponse.json({
    licenseKey: record.licenseKey,
    tier: record.tier,
    shopName: record.shopName,
    issuedAt: record.issuedAt,
    validUntil: record.validUntil,
  });
}
