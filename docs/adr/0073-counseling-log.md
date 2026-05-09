# ADR-0073 — Schedule-H counsel-log + save_bill counseling gate

- Status: Accepted
- Date: 2026-05-08
- Sprint: S28 (wave 1, agent A1)
- Author: Claude (lead engineering copilot) under Sourav Shaw
- Pairs with: migration `0050_counseling_log.sql`,
  `apps/desktop/src-tauri/src/counseling.rs`, `CounselingScreen.tsx`,
  `BillingClinicalGuard.tsx`.
- Supersedes: none (extends; does not replace migration `0035_counseling_records`).
- Superseded by: none.

## Context

Drugs & Cosmetics Act 1940 sections 22 and 27, and Rules 1945 rule 65,
oblige the registered pharmacist (RPh) to counsel the patient at the
point of dispense for every Schedule H, H1, and X line. Pre-pilot, this
was a UX-only nudge: `CounselingScreen.tsx` was a 31-LOC scaffold
(rendered "coming online" placeholder) and `save_bill` had no read-side
guard for counseling. The `SILENT_KILLERS.md` table flagged this as
mandate-shaped risk: an FDA inspector visit to the pilot site (Vaidyanath
Pharmacy, Kalyan, scheduled 2026-05-13) on Day-1 would surface the gap
in the Schedule register and trigger D&C s.27 enforcement.

A sister table `counseling_records` already exists (migration 0035) for
the long-form AI-drafted counseling SCRIPT (one row per multi-product
bill, linked to `customers`, `bills`, `users`). It stores the cashier-
spoken script — useful evidence in court — but it is NOT what
`save_bill` should consult to decide pass/fail because:

- It mixes purposes (script storage + acknowledgement flag) and was
  designed around AI-copilot-generated text, not per-line proof.
- Its `customer_id NOT NULL` shape excludes walk-in bills, which
  Schedule-H regulation still mandates counseling for.
- The pre-pilot UI never wrote it.

## Decision

Introduce a separate, narrow per-line evidence table `counsel_log`
(migration 0050) and three Tauri commands:

- `log_counseling(bill_id, drug_id, drug_name, schedule_class, notes,
  patient_consented, counselor_user_id) -> i64` — append one row.
- `list_counseling_for_bill(bill_id) -> Vec<CounselLogRow>` — read for
  cashier UI.
- `check_counseling_complete(bill_id) -> Vec<MissingCounsel>` — gate
  helper. Empty Vec = pass.

Wire `save_bill` (commands.rs `save_bill`) so that, AFTER the existing
DPDP §6 consent gate, NPPA cap check, Rx-required check, and expiry
guard but BEFORE the SQLite transaction opens, we call
`counseling::check_counseling_complete_for_basket(&c, &bill_id,
&product_ids)`. Non-empty result aborts with the colon-delimited error
`COUNSELING_INCOMPLETE:<json missing list>`. Pre-existing DPDP gate
behaviour is preserved by ordering: DPDP fails first, counseling fails
second.

The cashier UI flow:

1. BillingScreen adds a Schedule-H/H1/X line.
2. `BillingClinicalGuard` detects `scheduleClass in {H,H1,X}` from the
   `basket` prop and renders the **Counseling required** banner with
   "Open Counseling" CTA.
3. CTA navigates to `CounselingScreen` with the active `bill_id`.
4. CounselingScreen calls `check_counseling_complete`, renders one card
   per missing drug, RPh ticks "Patient acknowledged", optionally enters
   notes, clicks "Log counseling" → `log_counseling`.
5. Once the missing-list is empty, "Continue to bill close" enables.
6. BillingScreen retries `save_bill`; gate clears; bill persists.

The error format `COUNSELING_INCOMPLETE:<json>` matches the existing
colon-delimited convention used by `RX_REQUIRED:`,
`NEAR_EXPIRY_NO_OVERRIDE:`, `NPPA_CAP_EXCEEDED:` so the TS side does
not need a typed-error refactor. JSON suffix carries
`[{drugId,drugName,scheduleClass}, ...]`.

## Consequences

Positive
- D&C s.22 / s.27 mandate hard-blocked at the data layer, not the UI.
  An adversarial test (modified TS bypassing CounselingScreen) cannot
  bypass save_bill.
- Per-line evidence trail satisfies r.65 retention; counsel_log carries
  `created_at`, `counselor_user_id`, `notes`.
- ON DELETE CASCADE on `bill_id` keeps the database internally
  consistent if a bill is voided.
- Walk-in bills (customer_id NULL) are still gated — counsel_log is
  bill-scoped, not customer-scoped.

Negative / costs
- Cashier flow on H/H1/X bills gains one screen step (open Counseling →
  log → close). Mitigation: BillingClinicalGuard banner is one click;
  for repeat patients of the same drug we DEDUPE by `drug_id` so
  multiple bill_lines of the same INN need only one counsel_log row.
- save_bill fails fast on COUNSELING_INCOMPLETE — TS retry logic must
  parse the colon-delimited error and route to CounselingScreen rather
  than display a raw string. Wired in BillingScreen.tsx (TODO outside
  this ADR's scope; see USER_INPUT_QUEUE Q-001 + S28 lead integration).

## Alternatives considered

1. **Soft warning only (no save_bill block).** Rejected. The whole
   point is to prevent the founder being prosecuted under D&C s.27 if
   the pilot RPh misses a line. Soft warning + culture is what Marg
   ships; we promised hard enforcement in Playbook v2.0 §1 rule 5.
2. **Reuse migration 0035 `counseling_records`.** Rejected for the
   shape reasons above (NOT NULL customer_id; mixed-purpose row). We
   keep 0035 for the AI-drafted script and add 0050 for the per-line
   evidence; the two co-exist.
3. **Block at the trigger layer (SQLite trigger on bills INSERT).**
   Rejected. The trigger fires too late (transaction half-open) and
   loses the rich missing-drugs payload. save_bill is the right gate
   because it owns the basket payload pre-transaction.
4. **Store schedule_class on bill_lines, denormalised.** Rejected for
   v1; products.schedule is the source of truth. Counsel_log carries
   schedule_class so the audit row is self-contained even if a product
   is later re-classified.

## References

- Drugs & Cosmetics Act 1940 §22, §27.
- Drugs & Cosmetics Rules 1945, rule 65.
- `_research_brain/00_session_state/SILENT_KILLERS.md` — task #19.
- `_research_brain/99_forward_plan/FORWARD_PLAN_v5_2026-05-08.md` §3
  Day-0 A1.
- ADR-0011 (Rx-required save_bill gate) — same gate-pattern lineage.
- ADR-0030 (idempotency) — interaction note: counsel_log gate runs
  AFTER the idempotency replay check; a replayed save_bill response
  still surfaces the original COUNSELING_INCOMPLETE if applicable.
