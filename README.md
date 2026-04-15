# PharmaCare Pro

LAN-first, cloud-optional, desktop-first pharmacy POS for Indian independent pharmacies.

**Canonical source of truth:** `../PharmaCare_Pro_Build_Playbook_v2.0_Final.docx`

## Monorepo layout

```
apps/
  desktop/         Tauri (Rust + React + TS) \u2014 POS, LAN-first
  mobile/          React Native \u2014 customer / owner / rider
  web/             Next.js \u2014 storefront
  cloud-services/  Go microservices (ap-south-1)
packages/
  shared-types/    Cross-cutting domain types
  gst-engine/      GST / HSN / e-invoice math
  schedule-h/      Schedule H/H1/X register logic
  crypto/          Signing, KMS, local keystore
infra/             IaC (Terraform/Pulumi)
docs/adr/          Architecture Decision Records
```

## Commands

```
npm install            # bootstrap all workspaces
npm run typecheck      # all packages
npm run test           # all packages
npm run build          # all packages
```

## Hard rules (v2.0 \u00a72)

LAN-first \u00b7 Perpetual license \u00b7 Keyboard-first \u00b7 <2s billing on Win7 4GB \u00b7 Compliance automatic \u00b7 PII stays on LAN \u00b7 Windows 7+ / 2GB RAM / <200MB installer \u00b7 Multi-store first-class \u00b7 FEFO + 3-way PO/GRN \u00b7 No vendor lock-in.

## Day-1 baseline

2026-04-15 \u00b7 Founder: Sourav Shaw \u00b7 Pilot shop: Vaidyanath Pharmacy, Kalyan.
