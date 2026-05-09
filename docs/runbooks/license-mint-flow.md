# License-Mint Flow — Founder Runbook

## When to mint

Mint a license file **per pilot Day-1**, the moment the shop owner
signs the Sales Agreement (₹14,999 perpetual + ₹4,999 AMC, Playbook §2).
Until the agreement is signed, do not mint — the license file embeds
the shop's GSTIN and retail-license number and is binding evidence
of an executed sale. The license file is then placed on USB stick A
and copied to `C:\PharmaCare\license\` during the on-site install.
Cross-reference: `docs/runbooks/pilot-day-1-install.md` step 5
("License activation"), and the pre-arrival checklist item
"License file generated for the shop's GSTIN + retail-license number".

## Founder command (run on the founder laptop, not the shop rig)

```powershell
cd C:\Users\Jagannath Pharmacy\ClaudeWorkspace\pharmacy-sw\Rasayn\pharmacare-pro\packages\license
npm run build   # produces dist/cli.js — required, the bin entry points there

$env:PHARMACARE_LICENSE_HMAC_SECRET = "<paste-from-1Password>"
node ./dist/cli.js `
  --gstin <SHOP_GSTIN_15CHAR> `
  --retail-license <RETAIL_LICENSE_NUMBER> `
  --shop-name "<Legal Shop Name>" `
  --valid-days 365 `
  --edition standard `
  --fingerprint <64-HEX-SHA256> `
  --out C:\Users\Jagannath` Pharmacy\Desktop\<shop-slug>-license.json
```

Edition map: `trial` (free tier — 30-day demo only), `standard`
(starter — what every Day-1 pilot gets), `pro` (AI copilot + WhatsApp
+ OCR-Rx; reserved for owners who explicitly upgrade post-pilot).

## HMAC secret

Stored in the founder's password manager under
**1Password → "PharmaCare / license-HMAC-prod"**. Never check this
secret into git, never paste it into Slack, never type it into a
machine that is not the founder's laptop. Rotate quarterly; rotation
runbook lives at `docs/runbooks/secret-rotation.md` (S29 deliverable).

## Capturing the shop's hardware fingerprint

Two paths:

1. **Preferred — pre-visit capture.** When the Lenovo arrives at
   the founder's office for image prep, run:
   `pharmacare-cli system-info --json` (S27 deliverable, see
   `apps/desktop/src-tauri/src/system_info.rs`). Copy the
   64-char SHA-256 hex out of the `fingerprint` field. Mint the
   license against that fingerprint before leaving for the shop.
2. **Fallback — rebind on first launch.** If the founder cannot
   image the rig in advance (e.g. owner sources their own PC),
   mint with `--fingerprint <64-zeros-hex placeholder>` and the
   app rebinds at first launch within the 60-day grace window
   (per `validateLicense` `graceDays` default).

## Verification (post-mint, before walking out the door)

Open the resulting JSON and eyeball: `gstin`, `shopName`,
`expiryDate`, `licenseKey` (`PCPR-YYYY-...` format), and
`fingerprintShort` matches the first 6 hex chars of the rig's
fingerprint. The single-line stderr summary the CLI prints
(`minted license: <id> for <shop> (<gstin>) valid until <date>`)
goes into the pilot-tracker note for the shop.

Cross-reference: `_research_brain/99_forward_plan/FORWARD_PLAN_v4_2026-05-07.md`
§4 sprint S29 ("license-mint CLI ... tested on a real Vaidyanath
sample") and §6 procurement table.
