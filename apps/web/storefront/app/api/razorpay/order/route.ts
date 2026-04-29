import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

interface OrderRequest {
  readonly tier: "starter" | "pro";
  readonly shopName: string;
  readonly email: string;
  readonly phone: string;
  readonly amountPaise: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as OrderRequest;
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "Razorpay credentials not configured" }, { status: 500 });
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const r = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: body.amountPaise, currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: { tier: body.tier, shopName: body.shopName, email: body.email, phone: body.phone },
    }),
  });
  return NextResponse.json(await r.json());
}
