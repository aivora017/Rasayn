# @pharmacare/web-storefront

Public-facing site at rasayn.in. Built with Next.js 15.5 + React 19.

## Pages
- `/` — Hero + 3 moats + comparison vs Marg/Tally + anti-lock-in promise
- `/pricing` — 4 tiers (Free / Starter / Pro / Enterprise) with feature matrix
- `/demo` — 9 screen showcases + "schedule a call" CTA
- `/faq` — 11 common questions answered
- `/buy?tier=starter` — Razorpay checkout flow
- `/buy/success?key=PCPR-...` — post-purchase confirmation with licence key

## API routes
- `POST /api/razorpay/order` — creates Razorpay order
- `POST /api/license/issue` — verifies Razorpay sig + issues licence via @pharmacare/license
- `POST /api/razorpay/webhook` — handles payment.captured / failed / subscription.charged / refund

## Required env vars (when going live)
```
RAZORPAY_KEY_ID=rzp_live_XXXXXXXX
RAZORPAY_KEY_SECRET=YYYYYYYY
RAZORPAY_WEBHOOK_SECRET=ZZZZZZZZ
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_XXXXXXXX     # exposed to browser
```

## Deploy
- Cloudflare Pages or Workers (Next.js adapter) — free tier sufficient for first 1000 visitors/day
- Domain: point rasayn.in to Pages

## What's NOT here yet (for you to add)
- Real screenshot images for /demo (currently placeholders)
- Privacy / Terms / Refund policy pages (lawyer-drafted)
- Razorpay live credentials (test keys for now)
- Google Analytics / Plausible (we recommend Plausible for privacy-friendly analytics)
