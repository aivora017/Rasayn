# ADR-0077 — DSR Auto-Respond (DPDP §11 Personal Data Export)

- Status: Accepted
- Date: 2026-05-08
- Sprint: S28 (wave 2B, agent C1)
- Author: Claude (lead engineering copilot) under Sourav Shaw
- Pairs with: migration `0053_dsr_audit.sql`,
  `apps/desktop/src-tauri/src/dsr_export.rs`, `DSRPanel.tsx`,
  `request_personal_data_export` / `dsr_get_export_status` /
  `dsr_list_exports` Tauri commands.
- Supersedes: none (extends migration `0033_dpdp_consents.sql` /
  `dpdp.rs` queue infrastructure).
- Superseded by: none.

## Context

The Digital Personal Data Protection Act 2023 (DPDP) §11 grants every
Data Principal four rights against the Data Fiduciary (the pharmacy):

1. access to a summary of personal data being processed,
2. correction / completion / erasure (subject to retention limits),
3. nomination of a representative,
4. grievance redressal.

§13(2) sets a hard 30-day SLA for the Fiduciary to respond. The Data
Protection Board can fine the Fiduciary up to ₹250 crore per violation
under §33(1).

The pre-S28-C1 state of PharmaCare Pro:

- `dpdp_dsr_requests` (migration 0033) — request-lifecycle queue,
  shipped S19. Captures id / customer_id / kind / received_at / status
  / fulfilled_at / response_payload_path. Owner can flip status manually.
- `DPDPConsentScreen` — DSR queue UI. Owner can OPEN a DSR (record that
  a customer asked) and ADVANCE the status manually.
- **No automation.** The owner — Sourav Shaw, founder, the only
  registered Data Fiduciary at pilot — would have to hand-pull every
  customer's data from sqlite himself, format it, and email/print it.
  Vaidyanath Pharmacy goes live 2026-05-13 (Wed); a single DSR with no
  tooling is a 4-6 hour task that misses the §13(2) clock easily.

The owner needs a one-click "fulfil" flow that produces a deterministic
bundle of the customer's personal data — JSON for machines, CSV for
Excel, README explaining the principal's rights — that the owner can
hand the customer in the shop or email under the §13(2) SLA.

## Decision

Add a narrow, append-only audit log table `dsr_audit_log` (migration
0053) and three Tauri commands in a new module `dsr_export.rs`:

- `request_personal_data_export(customer_id, requester_phone, reason)
  -> { request_id, files }` — collects every row of personal data this
  shop holds for the customer, writes a JSON + CSV + README bundle
  under `<backup_dir>/dsr_exports/<YYYY-MM-DD>_<request_id>/`, and
  appends an audit row with `status='done'`. Writes an `in-progress`
  audit row at start so a crash is recoverable.
- `dsr_get_export_status(request_id) -> DsrStatus` — looks up the most
  recent audit row for `request_id`. Returns done / in-progress /
  failed.
- `dsr_list_exports(limit) -> Vec<DsrExport>` — for the owner's UI.
  Returns the most recent N audit rows (id, request_id, customer_id,
  status, files_path, created_at).

The bundle contents are scoped to the customer's personally-identifying
rows:

- their `customers` row (name, phone, GSTIN, address, consents);
- every `bills` row for that customer (bill_no, billed_at, totals,
  payment mode);
- every `prescriptions` row;
- every `return_headers` row joined via the customer's bills;
- every `dpdp_consents` row for that customer.

The folder name encodes both the date and the request_id so a single
customer can request multiple bundles at different times without
collisions.

The UI surface is a new `DSRPanel.tsx` component (separate from the
existing `DPDPConsentScreen` so the consent matrix and the auto-respond
flow have distinct mental models). It shows:

- a "New DSR" form (customer_id, requester_phone, reason) with a
  one-click `Fulfil access request` button;
- a "Recent DSR exports" table with a `Re-fulfil` action per row;
- the latest bundle path surfaced inline so the owner can copy the
  filesystem path and open the folder in Explorer.

## Consequences

Positive

- §13(2) 30-day SLA is now mechanically achievable. A walk-in DSR
  becomes a sub-30-second click instead of a 4-hour hand-pull.
- §11(b) "summary of personal data being processed" is satisfied by a
  single bundle that's auditable on disk.
- §10 grievance contact is restated in the README, so every fulfilled
  DSR self-documents the principal's onward-escalation path.
- The audit log captures one row per state transition; an `in-progress`
  row precedes the `done` row, so a crashed export leaves a recoverable
  trace.

Negative / costs

- **PII bundle on disk.** The export folder lives under the same
  backup root as the SQLite snapshots (per ADR-0071 + S28-A6 DR setup).
  That path is on the shop's external SSD, owner-controlled, but
  unencrypted today. Mitigation: in the next iteration we will
  encrypt-at-rest using the shop's primary DEK (ADR-0071) before the
  bundle hits disk. Pilot gate (May 13): owner is the only person with
  filesystem access to the shop machine; documenting this trade-off in
  the Day-1 runbook + the README in the bundle itself ("retain in a
  locked drawer, hand to customer or shred").
- **No identity proofing.** The owner records the requester_phone but
  the Tauri command does not (yet) verify it via OTP. The pre-pilot
  threat model treats this as acceptable — the owner is physically
  present at the shop and uses out-of-band verification. Post-pilot we
  will add an OTP gate before `request_personal_data_export` runs.
- **Bundle is a snapshot, not a subscription.** A later update to the
  customer's data does not push to a previously-emitted bundle. The
  owner re-runs `Re-fulfil` if the customer asks 90 days later. The
  README explicitly states the bundle is a point-in-time snapshot.

## Alternatives considered

1. **Real-time PDF generator via `printpdf`.** Rejected for v1. PDF is
   a frozen format the principal cannot machine-read or re-import.
   JSON + CSV cover both audiences; the README is human-text. The PDF
   path stays on the post-pilot backlog.
2. **Mail the bundle directly via Gmail SMTP.** Rejected for v1. The
   pilot machine has Gmail OAuth scoped for inbox reads (X1 PO
   ingestion); email-out requires `gmail.send` consent + a separate
   threat model for misdelivery. The owner manually emails the bundle
   for now; auto-mail goes to S30+.
3. **Inline fulfilment from `DPDPConsentScreen` (extend not replace).**
   Rejected. The consent matrix is a different mental model (per-purpose
   toggles), and conflating it with a one-click PII export creates a
   crowded screen. Two distinct screens, with cross-links via a sidebar
   menu, is clearer for owner training.
4. **Encrypted-at-rest on first write.** Wanted, but the DEK lifecycle
   (ADR-0071) is not yet wired into per-file write paths outside the
   SQLite layer. We accept the unencrypted disk artefact for the pilot
   and queue the encrypted-bundle work as USER_INPUT_QUEUE Q-018.

## References

- DPDP Act 2023 §10, §11, §12, §13, §14, §33.
- `_research_brain/08_rules/PROJECT_INSTRUCTIONS.md` §8.
- ADR-0053 (DPDP consent + DSR queue) — sister table & UI.
- ADR-0071 (crypto-at-rest) — encryption that will eventually wrap
  these bundles.
- ADR-0073 (counsel_log) — same pattern of "one append-only audit
  table per regulatory mandate".
- Migration `0033_dpdp_consents.sql`, `0053_dsr_audit.sql`.
