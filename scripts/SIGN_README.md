# Windows code-signing — activation flow

Default builds (`npm run tauri:build`) are **unsigned** so own-shop and dev
installs work without external dependencies. SmartScreen will warn the
operator on first run; they click "More info → Run anyway".

When DigiCert EV Authenticode + KeyLocker are procured (see
`docs/install/Code_Signing_Setup.docx`), activate signing with:

```powershell
# 1. Set the SM_* env vars (per Code_Signing_Setup.docx §2.2)
$env:SIGNING_MODE = "keylocker"
$env:SM_HOST = "https://clientauth.one.digicert.com"
$env:SM_API_KEY = "<from KeyLocker>"
$env:SM_CLIENT_CERT_FILE = "<path>"
$env:SM_CLIENT_CERT_PASSWORD = "<from KeyLocker>"
$env:SM_CODE_SIGNING_CERT_SHA1_HASH = "<40-char hex>"

# 2. Build with the signing overlay merged in
cd apps/desktop
npm run tauri:build -- --config src-tauri/tauri.signed.conf.json
```

The `--config` flag tells Tauri 2 to merge `tauri.signed.conf.json` on
top of `tauri.conf.json`. The signed overlay only adds
`bundle.windows.signCommand`; everything else is identical.

For CI: store secrets in GitHub repo secrets (`SM_*`) and pass
`--config src-tauri/tauri.signed.conf.json` in the release workflow
(`.github/workflows/release-windows.yml`). When the secrets are absent
(forks, untrusted PRs), CI builds without `--config` and produces an
unsigned artifact instead.

## Token-based signing (USB/HSM, dev laptop)

```powershell
$env:SIGNING_MODE = "token"
$env:SIGNING_CERT_THUMBPRINT = "<40-char hex>"
cd apps/desktop
npm run tauri:build -- --config src-tauri/tauri.signed.conf.json
```

`scripts/sign-windows.ps1` handles both modes; `tauri.signed.conf.json`
points at it.
