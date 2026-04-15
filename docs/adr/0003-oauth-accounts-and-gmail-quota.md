# ADR 0003 — oauth_accounts schema, audit policy, and Gmail API quota handling

- Status: Accepted
- Date: 2026-04-15
- Supersedes: none
- Related: ADR 0001 (X1 Gmail→GRN), ADR 0002 (Gmail OAuth installed-app + PKCE)

## Context

ADR 0002 decided the OAuth client shape (installed-app + PKCE + loopback) and
that the refresh token lives in the OS keyring — never on disk. But we still
needed a durable record of *which Gmail account is linked to which shop*, a
compliance-grade audit trail of every OAuth side-effect, and a plan for what
happens when Gmail rate-limits us or revokes consent mid-day during a rush.

Constraints:

- LAN-first, desktop-first, SQLite local. No network dependency on a cloud DB
  for X1 to function.
- DPDP Act 2023 + CERT-In: every access of user mail data must be auditable
  with a 180-day retention floor.
- Gmail API per-user quota = 250 quota units/second, 1 000 000 000/day project
  cap. Typical ops: `messages.list` = 5 units, `messages.get` = 5 units,
  `attachments.get` = 5 units. A pharmacy pulling a 30-day inbox with 40
  distributor bills per day = ~6 000 units per refresh — well under the
  per-user second budget but easy to burst past on a first-time sync.
- Owner devices are on consumer broadband. Transient network failure is the
  common case; treat it as non-fatal.

## Decision

### 1. `oauth_accounts` table (migration 0005)

```sql
CREATE TABLE oauth_accounts (
  shop_id        TEXT    NOT NULL,
  provider       TEXT    NOT NULL,          -- 'gmail'
  account_email  TEXT,                       -- best-effort, from /userinfo
  scopes         TEXT    NOT NULL,           -- space-separated, as granted
  connected_at   INTEGER NOT NULL,           -- unix ms, first successful link
  last_used_at   INTEGER,                    -- unix ms, last successful API call
  last_error     TEXT,                       -- truncated error; NULL on success
  PRIMARY KEY (shop_id, provider)
);
```

Secrets are NOT in this table. Refresh token lives in OS keyring under
`service = "pharmacare-pro.oauth"`, `username = "{shop_id}:{provider}"`.
Access tokens are in-memory only, re-minted per call via refresh.

Rationale: one provider per shop is the v0.1 contract — a shop that
insists on multiple Gmail inboxes is an edge case we'll revisit post-pilot.
PK captures that constraint without a surrogate id.

### 2. Audit log — reuse the canonical `audit_log` from migration 0001

`audit_log` already exists from migration 0001 with columns
`(id, at, actor_id, entity, entity_id, action, payload)`. OAuth side-effects
write to the same table so the compliance stream stays unified:

- `actor_id` = `'system'` (until we wire a real user session)
- `entity` = `'oauth:gmail'`
- `entity_id` = the `shop_id`
- `action` = one of the event names below
- `payload` = JSON detail blob, ≤ 2 KB

Recorded `action` values for X1 (written by `oauth::audit`):

| action                            | emitted by                    |
|-----------------------------------|-------------------------------|
| `gmail_connect`                   | `oauth::gmail_connect`        |
| `gmail_disconnect`                | `oauth::gmail_disconnect`     |
| `gmail_list_messages`             | `oauth::gmail_list_messages`  |
| `gmail_list_messages_error`       | `oauth::gmail_list_messages`  |
| `gmail_fetch_attachment`          | `oauth::gmail_fetch_attachment` |
| `gmail_fetch_attachment_error`    | `oauth::gmail_fetch_attachment` |

Retention: 180 days minimum (CERT-In). A nightly job prunes rows older than
365 days. Audit writes are best-effort — a write failure MUST NOT block the
user-facing operation (we log to the Tauri log and continue).

### 3. Gmail quota & failure handling

- **Client-side rate limit**: at most 5 `messages.get` in flight per shop.
  List fetches 20 IDs, then hydrates serially with a 50 ms pacing gap —
  keeps per-user-second under 120 quota units, far below the 250 ceiling.
- **Backoff**: 429 and 5xx → exponential with full jitter, base 500 ms, cap
  8 s, max 4 retries. Surfacing: after retries exhausted, return the error
  to the UI as "Gmail is busy, try again in a moment" and write
  `result='err'` to the audit log with the HTTP status in `detail`.
- **401 handling**: a 401 during `messages.*` invalidates the cached access
  token and forces a refresh round. If refresh itself 400s
  (`invalid_grant`), the link is dead — delete the keyring entry, set
  `oauth_accounts.last_error='revoked'`, and surface a banner prompting
  the owner to re-connect. Do NOT auto-retry a revoked link.
- **Attachment size cap**: 10 MB per attachment. Anything larger is
  rejected at the Rust layer (`Err("attachment too large")`) — distributor
  bills are ~100 KB max; a 10 MB file is either a scanning accident or a
  malicious payload.
- **Daily project budget**: at 500 shops × 6 000 units/day = 3 M/day, we
  are 0.3% of the 1 B project cap. No cloud-side throttling needed at
  pilot scale. Revisit at 10 000 shops.

### 4. Scope hygiene

We request `https://www.googleapis.com/auth/gmail.readonly` only. Never
`gmail.modify`, never `gmail.send`. Recorded in `oauth_accounts.scopes` at
connect time so an audit can detect scope creep if Google changes the
consent UX.

### 5. Data-subject-rights (DPDP) hooks

- **Erasure**: `oauth::gmail_disconnect` revokes the refresh token at
  Google, clears the keyring, and leaves only a tombstone row in
  `oauth_accounts` (last_error='disconnected_by_user'). Full row deletion
  happens only on explicit "erase all Gmail traces" owner action (post-v1).
- **Export**: audit_log rows for a given shop are dumpable as JSON via the
  existing `reports_export` IPC — no new surface needed.

## Consequences

Positive:
- One canonical place to ask "is this shop linked to Gmail, and when did we
  last touch it?" without hitting Google.
- Audit trail is queryable offline — owners can show CERT-In/DPDP auditors
  a local SQLite file, no cloud dependency.
- Quota plan is conservative enough to survive pilot scale without a
  server-side rate-limiter.

Negative:
- 180-day audit retention grows the SQLite file. Rough budget: 40 bills/day
  × 3 actions × 200 bytes = 24 KB/day, 4.3 MB/180d — trivial, but worth
  watching if we start logging request bodies.
- One-provider-per-shop means we can't support an owner who splits
  distributor mail across two inboxes. Acceptable for v0.1; revisit with
  a second `account_label` column in v0.2 if a pilot demands it.
- Audit writes during a burst of `messages.get` calls add SQLite write
  pressure. Mitigation: batch in a single transaction per list-refresh.

## Alternatives considered

1. **Audit log in a JSON file, not SQLite.** Rejected — SQL queries for
   compliance ("show me every gmail.attachments.get in the last 30 days
   for shop X") are the point of having an audit log. Grep over JSON lines
   doesn't scale to 500 shops in a franchise.
2. **Store refresh token encrypted in SQLite.** Rejected in ADR 0002;
   reaffirmed here — keyring is the only place the OS will protect the
   secret from another user on the same machine.
3. **No per-user rate limiter, rely on Google's 429s.** Rejected — a
   first-time sync on a 5-year-old inbox will blow past the per-user
   second and return a stream of 429s that look like broken software to
   the owner. Client-side pacing is cheaper than a support call.
4. **Request `gmail.modify` for "archive after import".** Rejected —
   read-only scope is a trust differentiator at the pilot pitch; adding
   write scope later is a one-line change.

## Supersedes / Superseded-by

- Supersedes: none
- Superseded-by: pending
