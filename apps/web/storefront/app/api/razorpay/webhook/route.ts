import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
  if (!secret) return NextResponse.json({ error: "webhook secret not set" }, { status: 500 });

  const body = await req.text();
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  if (expected !== sig) return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });

  const event = JSON.parse(body) as { event: string; payload: { payment?: { entity: { id: string; order_id: string; amount: number; email: string } } } };

  switch (event.event) {
    case "payment.captured":
      // TODO: mark order as paid, trigger license issuance if not already done
      console.log("Payment captured:", event.payload.payment?.entity.id);
      break;
    case "payment.failed":
      console.warn("Payment failed:", event.payload.payment?.entity.id);
      break;
    case "subscription.charged":
      // TODO: extend pro-monthly licence by 30 days
      break;
    case "refund.created":
      // TODO: mark licence revoked
      break;
  }
  return NextResponse.json({ ok: true });
}
