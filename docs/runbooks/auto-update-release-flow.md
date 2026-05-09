# Auto-update release flow

Runbook for shipping a PharmaCare Pro patch (v0.1.0 -> v0.1.1).

## 1. One-time setup (founder)

Generate ed25519 keypair:

```
openssl genpkey -algorithm Ed25519 -out updater_priv.pem
openssl pkey -in updater_priv.pem -pubout -out updater_pub.pem
openssl pkey -in updater_pub.pem -pubin -outform DER | base64 -w0 > updater_pub.b64
```

- Store `updater_priv.pem` in founder's password manager (1Password / KeePassXC). NEVER commit.
- Paste `updater_pub.b64` into `apps/desktop/src-tauri/tauri.conf.json` -> `plugins.updater.pubkey`.
- Backup `updater_priv.pem` to YubiKey 5 (FORWARD_PLAN_v4 §6).

R2 + Worker (one-time):

```
cd apps/cloud-services/auto-update-worker
wrangler login
wrangler r2 bucket create pharmacare-update-manifests
wrangler r2 bucket create pharmacare-update-manifests-preview
# Replace account_id in wrangler.toml, then:
wrangler deploy
```

In Cloudflare dashboard: bind `updates.pharmacare.in/*` -> this worker.

## 2. Per-release flow

Build + sign the MSI:

```
cd apps/desktop && npm run build && cd src-tauri
cargo tauri build --target x86_64-pc-windows-msvc
pwsh ../../../scripts/sign-windows.ps1 -Path target/release/bundle/msi/<msi>
$sha = (Get-FileHash <msi> -Algorithm SHA256).Hash.ToLower()
$sig = openssl pkeyutl -sign -inkey updater_priv.pem -rawin -in <msi> | base64 -w0
gh release create v0.1.1 <msi> --notes "Bug fixes"
```

Promote (pilot -> beta -> stable):

```
$env:CF_ACCOUNT_ID="<id>"; $env:CF_API_TOKEN="<token>"; $env:CF_R2_BUCKET="pharmacare-update-manifests"
npx tsx scripts/auto-update/promote-manifest.ts \
  --version 0.1.1 --channel pilot \
  --url https://github.com/aivora017/Rasayn/releases/download/v0.1.1/<msi> \
  --sha256 $sha --signature $sig --notes "S27 patch" --key-file updater_priv.pem
```

Wait 24h on `pilot`. If green, repeat with `--channel beta` (48h), then `--channel stable`.

## 3. Verification

1. `curl 'https://updates.pharmacare.in/manifest.json?channel=stable'` — confirm v0.1.1 in `latest.stable`.
2. Clean Win 11 VM with v0.1.0: Settings -> "Check for updates" should fetch, verify sig, prompt, patch on relaunch.
3. Confirm v0.1.1 in About dialog.

## 4. Rollback / disaster

If v0.1.2 breaks pilot rigs, re-promote v0.1.1 to `stable`:

```
npx tsx scripts/auto-update/promote-manifest.ts --version 0.1.1 \
  --channel stable --url <github-url> --sha256 <sha> \
  --signature <sig> --notes "Rollback from 0.1.2" --key-file updater_priv.pem
```

Tauri does NOT auto-downgrade rigs already on v0.1.2 — push v0.1.3 hotfix. Log incident in `_research_brain/05_drills/`.

## 5. Channel ladder

`pilot` (24h, founder + 1 dev) -> `beta` (48h, friendly pharmacies) -> `stable` (Vaidyanath + future pilots). Never skip once ≥3 pilot rigs are live.
