# ADR 0002 — Gmail OAuth: Installed-App (Desktop) Flow with OS-Keyring Token Storage

**Status:** Accepted
**Date:** 2026-04-15
**Owner:** Sourav Shaw
**Supersedes:** —
**Superseded-by:** —

## Context

X1 (moat feature): Gmail distributor-bill inbox. The desktop POS must authenticate as the **pharmacy owner's own Google account** and read messages from a label (e.g. `distributor-bills`) to extract attached CSV/XLSX/PDF invoices and convert them to editable PO/GRN drafts.

Constraints from the v2.0 Playbook:
1. LAN-first, cloud-optional — no mandatory backend for core POS.
2. PII/Rx never leaves shop LAN without explicit per-feature opt-in. Gmail is an explicit opt-in per shop.
3. No SaaS-only dependencies for core flows; owner must be able to revoke and re-grant from the shop itself.
4. Target hardware is Windows 7 → 11 with 2 GB RAM floor — we cannot embed a full headless browser.
5. DPDP Act 2023: secrets must be stored at rest with OS-level protection; log only non-PII metadata.

Google offers three OAuth2 flow choices for this workload:

| Flow | Redirect | Secret distribution | Suitability |
|---|---|---|---|
| Web-server flow | HTTPS redirect to our cloud | Client secret server-side | Requires mandatory cloud — violates rule #1 |
| Service account + DWD | — | JSON key per shop | Only available on Google Workspace; 80% of ICP uses personal `@gmail.com` — rules out DWD |
| **Installed-app (loopback) flow** | `http://127.0.0.1:<ephemeral>/` | Client ID public, no secret required (PKCE) | Fits: runs fully on desktop, owner's own consent, works on personal Gmail |

## Decision

Use the **OAuth 2.0 Installed Application flow with PKCE and a loopback redirect URI**, orchestrated by a small Rust sidecar module inside the Tauri process. Refresh tokens stored in the **OS keyring** (Windows Credential Manager / macOS Keychain / libsecret) via the `keyring` crate. No client secret shipped in the binary (PKCE replaces it).

### Components

```
apps/desktop/src-tauri/src/oauth/
  mod.rs          pub use {authorize_gmail, refresh_access_token, revoke_gmail, load_status}
  pkce.rs         S256 code verifier/challenge, base64url no-pad
  loopback.rs     ephemeral port :0 http server, single-shot `/callback?code=...`
  google.rs       POST https://oauth2.googleapis.com/token (exchange + refresh + revoke)
  keyring.rs      `keyring` crate wrappers, service="pharmacare-pro", user="gmail:<shop_id>"
```

Tauri commands exposed to the React UI:
- `gmail_connect(shop_id: String) -> Result<OAuthStatus>` — opens system browser, waits for loopback callback, stores refresh token in keyring.
- `gmail_status(shop_id: String) -> Result<OAuthStatus>` — returns `{connected: bool, scopes: Vec<String>, granted_at: Option<DateTime>, account_email: Option<String>}`.
- `gmail_disconnect(shop_id: String) -> Result<()>` — calls Google revoke endpoint, purges keyring entry, audit-logs event.

### Scopes (minimum)

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.metadata   (fallback if owner declines readonly)
```

We never request `gmail.modify` or `gmail.send`. Label-scoped reads are enforced in application code; Google does not offer label-scoped OAuth.

### Storage

| Data | Location | Rationale |
|---|---|---|
| Refresh token | OS keyring, per-shop entry | OS-level encryption, not on disk plaintext |
| Access token | Process memory, never persisted | 60 min lifetime, re-derivable from refresh token |
| Scopes granted, account email, granted_at | SQLite `oauth_accounts` table | Needed for UI without unlocking keyring on every render |
| `client_id` | Hard-coded in binary | Public per Google docs; PKCE means no secret |

### Auth flow sequence

1. UI calls `gmail_connect(shop_id)`.
2. Sidecar generates PKCE `code_verifier` (32 random bytes) + S256 challenge.
3. Sidecar binds loopback on `127.0.0.1:0`, records the chosen port.
4. Sidecar opens user's default browser to `https://accounts.google.com/o/oauth2/v2/auth?...&redirect_uri=http://127.0.0.1:<port>/callback&code_challenge=...&code_challenge_method=S256`.
5. User consents in browser → Google redirects to loopback with `code`.
6. Sidecar exchanges `code + code_verifier` at `oauth2.googleapis.com/token` → receives `{access_token, refresh_token, expires_in, scope, id_token}`.
7. Sidecar parses `id_token` for `email` claim, writes refresh token to keyring, writes metadata row to `oauth_accounts`.
8. Returns `OAuthStatus` to UI.

Refresh on demand: if access token expiry is ≤60s away, sidecar POSTs `grant_type=refresh_token` to token endpoint, caches new access token in memory.

Revoke: DELETE keyring entry → POST `oauth2.googleapis.com/revoke?token=<refresh>` → DELETE `oauth_accounts` row.

## Consequences

**Positive**
- Zero cloud infrastructure required for X1 connect.
- No client secret risk — PKCE replaces it per RFC 7636.
- OS keyring storage satisfies DPDP §8(1)(g) "reasonable security practices".
- Owner can revoke any time from https://myaccount.google.com/permissions — our UI also shows a disconnect button.
- Works with personal `@gmail.com` accounts (the ICP), not just Workspace.
- Loopback flow is Google's officially blessed desktop pattern (IETF RFC 8252).

**Negative**
- Loopback port conflicts are possible on hardened firewalls — fallback: allow user to paste the auth code manually (RFC 7636 §8.6 out-of-band).
- Refresh tokens can be invalidated by Google if user changes password → handled by `gmail_status` returning `connected: false` on 400 `invalid_grant`, UI prompts re-auth.
- `keyring` crate adds ~300 KB to binary size — acceptable against 200 MB installer cap.
- Gmail API quotas (1B quota units/day per project) are pooled across all shops — monitor usage in Observability ADR (TBD).

**Neutral**
- Second-vendor plan: if Google pulls Gmail API access, fall back to Microsoft Graph (Outlook) with the same Installed-App + PKCE pattern. Abstraction lives in `packages/gmail-inbox` — the mailbox source is pluggable.

## Alternatives considered

1. **Web-server OAuth with mandatory cloud relay** — rejected: violates LAN-first rule.
2. **Service account with Domain-Wide Delegation** — rejected: only works for Google Workspace, and ICP is 80% personal Gmail.
3. **IMAP with app passwords** — rejected: Google deprecated less-secure-app access in May 2022; app passwords require 2FA and degrade compliance posture.
4. **Bundled headless Chromium for OAuth** — rejected: 100+ MB binary bloat, breaks 200 MB installer cap.
5. **Device-code flow** — rejected: user experience is worse (type code in browser) and Google's installed-app PKCE flow is the recommended desktop pattern.

## Operational notes

- Client ID lives in `apps/desktop/src-tauri/resources/oauth_client.json`, committed to repo (public per Google).
- Dev builds use a separate OAuth project (`pharmacare-dev`) so production quotas aren't polluted.
- Audit log: every `gmail_connect`/`gmail_disconnect`/`invalid_grant` event is written to the `audit_log` table with `{actor_user, shop_id, event_type, timestamp}` — no tokens, no email body.
- CERT-In incident runbook: if a refresh token is suspected compromised, disconnect endpoint + `myaccount.google.com/permissions` revocation within the 6-hour CERT-In notification window.
