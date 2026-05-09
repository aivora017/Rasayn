# auto-update-worker

Cloudflare Worker that serves PharmaCare Pro update manifests from R2.

Endpoint (production): `https://updates.pharmacare.in/manifest.json?channel=stable`

Channels: `stable` | `beta` | `pilot`. Default is `stable`.

## What it does

- GET `/manifest.json?channel=<ch>` -> returns R2 object `manifest-<ch>.json` as
  `application/json` with `Cache-Control: public, max-age=300`.
- Validates the channel against an allow-list. Unknown channels return 400.
- Missing manifest -> 404 (clients treat this as "no update available").
- Method other than GET/HEAD -> 405. Path other than `/manifest.json` -> 404.

The worker does NOT sign manifests. Signing is done founder-side by
`scripts/auto-update/promote-manifest.ts` using an ed25519 private key. The
desktop client verifies the signature against the public key embedded in
`apps/desktop/src-tauri/tauri.conf.json` (Tauri updater plugin).

## Manifest schema

See `packages/auto-update/src/index.ts` for the canonical TypeScript types
(`UpdateManifest`, `ReleaseEntry`, `ReleaseAsset`). The worker treats the
manifest as opaque JSON; the schema is enforced at write-time by the
promote script and at read-time by the client.

## First-time deploy

1. `npm install -g wrangler` (or use `npx wrangler`).
2. `wrangler login` — Cloudflare OAuth.
3. Create the R2 bucket once:
   ```
   wrangler r2 bucket create pharmacare-update-manifests
   wrangler r2 bucket create pharmacare-update-manifests-preview
   ```
4. Replace `account_id` placeholder in `wrangler.toml` with the founder's
   Cloudflare account id (Dashboard -> Workers & Pages -> right sidebar).
5. `wrangler deploy` from this directory.
6. In the Cloudflare dashboard, add a custom domain route:
   `updates.pharmacare.in/*` -> this worker.

## Secrets

R2 binding is declared in `wrangler.toml`; no API token needed at runtime
(the worker reads R2 via the binding, not HTTP). The founder-side
`promote-manifest.ts` script DOES need:

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN` (R2 read+write scope on `pharmacare-update-manifests`)
- `CF_R2_BUCKET=pharmacare-update-manifests`

Store these in the founder's password manager. NEVER commit them.

## Smoke test after deploy

```
curl -i 'https://updates.pharmacare.in/manifest.json?channel=stable'
curl -i 'https://updates.pharmacare.in/manifest.json?channel=bogus'   # -> 400
curl -i 'https://updates.pharmacare.in/manifest.json?channel=beta'    # -> 404 until first publish
```

## Rollback

To roll a channel back, run `promote-manifest.ts` pointing the channel at the
previous version. Clients pick up the change on next 5-minute cache cycle.
See `docs/runbooks/auto-update-release-flow.md` for the disaster path.
