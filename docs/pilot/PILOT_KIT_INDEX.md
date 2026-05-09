# PharmaCare Pro - Pilot Kit Index v0.9 (Cohort-1)

> **Owner:** Sourav Shaw (founder).
> **Status:** v0.9, cohort-1 ready.
> **Last touched:** 2026-05-08 (S28 wave-2B agent C5 - initial consolidation).
> **Pilot date:** 2026-05-13 (Wednesday) at Vaidyanath Pharmacy, Kalyan, MH.
> **Workspace bundle:** `computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/.../outputs/PILOT_KIT_v0.9/`

This file is the single index for everything cohort-1 ships with. The workspace folder `PILOT_KIT_v0.9/` is the printable bundle; this index is the read-me + fill-checklist + ownership map + cross-link hub. Anything not listed here is not in the pilot kit.

---

## 1. Overview - what cohort-1 ships with

| Artefact class | Count | What's it for |
|---|---|---|
| Installation + training docs | 3 (.docx) | Walks the founder + cashier through Day-1 install and shop-floor cutover. |
| DR + reliability docs | 1 (.docx) | Restore-from-snapshot procedure, taped on the rig. |
| Hotline + escalation | 1 (.docx) | 48h hotline number, severity gates, hardware-failure scripts. |
| Legal docs (signable) | 4 (.docx) | Sales agreement, DPDP privacy notice, customer consent, lawyer cover memo. |
| Live tick-list | 1 (.md) | Day-1 procedural checklist. |
| Dry-run dataset | 1 (.csv) | Synthetic 500+ row product master for dress-rehearsal only. |

10 deliverables total. Plus README.txt (v0.9 framing + fill-list pointer).

The kit is shippable for cohort-1 as-is. v1.0 lifts after lawyer red-line (Q-009) and Hindi/Marathi translator review (Q-010) return - both expected week 2 post-cutover. See section 5.

---

## 2. Deliverable table

Every row links the source author (S28 wave letter), the canonical repo path, the printable workspace path, and the fill-needed placeholders.

| ID | File | Owner | Version | Last-updated | Pages | Source agent | Repo path | Workspace copy | Fill-needed placeholders | Dependencies |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 | `01_day1_install_runbook.docx` | Sourav | v0.9 | 2026-05-08 | ~14 | S28-A3 | `pharmacare-pro/docs/pilot/vaidyanath_day1_install_runbook.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/01_day1_install_runbook.docx) | `<<SHOP_NAME>>`, `<<PRINTER_MODEL>>` (Q-002), `<<DRAWER_MODEL>>` (Q-003), `<<INSTALL_DATE>>`, `<<HOTLINE_NUMBER>>` (Q-006) | None |
| 02 | `02_training_hi_mr_one_pager.docx` | Sourav | v0.9 | 2026-05-08 | 2 (A4 colour, laminate) | S28-A4 | `pharmacare-pro/docs/pilot/vaidyanath_training_hi_mr.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/02_training_hi_mr_one_pager.docx) | `<<HOTLINE_NUMBER>>` (Q-006), `<<LOCALE_HI_OR_MR>>` (Q-007) | Translator review (Q-010, deferred) |
| 03 | `03_dr_runbook.docx` | Sourav | v0.9 | 2026-05-08 | ~6 | S28-A6 | `pharmacare-pro/docs/dr/runbook.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/03_dr_runbook.docx) | `<<BACKUP_TARGET_PATH>>` (Q-014), `<<UPS_MODEL>>` (Q-015) | `restore_smoke_test.md` |
| 04 | `04_hotline_escalation_matrix.docx` | Sourav | v0.9 | 2026-05-08 | ~5 | S28-C3 | `pharmacare-pro/docs/runbooks/pilot-48h-hotline.md` (source) + this docx (canonical printable) | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/04_hotline_escalation_matrix.docx) | `<<HOTLINE_NUMBER>>` (Q-006), `<<BACKUP_NUMBER>>` (Q-006), `<<LOCALE_HI_OR_MR>>` (Q-007) | None |
| 05 | `05_sales_agreement_pilot_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~8 | S28-B5 | `pharmacare-pro/docs/legal/sales_agreement_pilot_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/05_sales_agreement_pilot_v0.9.docx) | `<<SHOP_NAME>>`, `<<SHOP_GSTIN>>`, `<<OWNER_FULL_NAME>>`, `<<OWNER_AADHAAR_LAST_4>>`, `<<EFFECTIVE_DATE>>`, `<<PILOT_TERM_MONTHS>>` | Lawyer red-line (Q-009, week 2) |
| 06 | `06_dpdp_privacy_notice_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~4 | S28-B5 | `pharmacare-pro/docs/legal/dpdp_privacy_notice_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/06_dpdp_privacy_notice_v0.9.docx) | `<<SHOP_NAME>>`, `<<SHOP_GSTIN>>`, `<<DPO_NAME>>`, `<<DPO_EMAIL>>`, `<<GRIEVANCE_OFFICER>>`, `<<GRIEVANCE_EMAIL>>`, `<<EFFECTIVE_DATE>>` | Lawyer red-line (Q-009) |
| 07 | `07_customer_consent_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~2 | S28-B5 | `pharmacare-pro/docs/legal/customer_consent_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/07_customer_consent_v0.9.docx) | `<<SHOP_NAME>>`, `<<EFFECTIVE_DATE>>`, blank customer fields filled at till | Lawyer red-line (Q-009) |
| 08 | `08_lawyer_review_memo_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~3 | S28-B5 | `pharmacare-pro/docs/legal/lawyer_review_memo_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/08_lawyer_review_memo_v0.9.docx) | `<<LAWYER_NAME>>`, `<<DATE_FORWARDED>>` | Forward Sun May 10 |
| 09 | `09_day1_checklist.md` | Sourav | v0.9 | 2026-05-08 | 1 (printable) | S28-A3 | `pharmacare-pro/docs/pilot/vaidyanath_day1_checklist.md` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/09_day1_checklist.md) | None - tick-list, fill at-time | None |
| 10 | `10_synthetic_vaidyanath_master.csv` | Sourav | v0.9 | 2026-05-08 | n/a (567 rows) | S28-A5 | `pharmacare-pro/tools/synthetic-vaidyanath-master.csv` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v0.9/10_synthetic_vaidyanath_master.csv) | None - DRY-RUN ONLY, do not import to real shop | Q-001 (real Vaidyanath master) supersedes for production install |

10 rows.

---

## 3. Pre-print checklist (drain USER_INPUT_QUEUE first)

Drain these from `_research_brain/00_session_state/USER_INPUT_QUEUE.md` answers before printing docs 01..08. Items are listed in fill-order for a single sit-down session.

| # | Placeholder | Source | Replaces in | Default if blank |
|---|---|---|---|---|
| 1 | `<<SHOP_NAME>>` | Static: "Vaidyanath Pharmacy" | 01, 05, 06, 07 | Hard-fail - do NOT print |
| 2 | `<<SHOP_GSTIN>>` | Q-001 (Marg export header row) | 05, 06 | Leave blank, fill on Day-1 |
| 3 | `<<OWNER_FULL_NAME>>` | B5 input from owner | 05, 07 | Hard-fail - do NOT sign |
| 4 | `<<OWNER_AADHAAR_LAST_4>>` | B5 input from owner | 05, 07 | Hard-fail - do NOT sign |
| 5 | `<<EFFECTIVE_DATE>>` | Day-1 cutover date | 05, 06, 07 | 2026-05-13 |
| 6 | `<<PILOT_TERM_MONTHS>>` | Founder decision | 05 | 6 months |
| 7 | `<<DPO_NAME>>` | B5 input - founder is DPO until owner appoints alt | 06 | Sourav Shaw |
| 8 | `<<DPO_EMAIL>>` | B5 | 06 | dpo@rasayn.in |
| 9 | `<<GRIEVANCE_OFFICER>>` | B5 | 06 | Owner full name |
| 10 | `<<GRIEVANCE_EMAIL>>` | B5 | 06 | Owner WhatsApp-linked email |
| 11 | `<<HOTLINE_NUMBER>>` | Q-006 | 02, 04 | Founder primary cell |
| 12 | `<<BACKUP_NUMBER>>` | Q-006 | 04 | Owner cell |
| 13 | `<<LOCALE_HI_OR_MR>>` | Q-007 | 02, 04 | Marathi (Kalyan default) |
| 14 | `<<PRINTER_MODEL>>` | Q-002 | 01 | Epson TM-T82 |
| 15 | `<<DRAWER_MODEL>>` | Q-003 | 01 | RJ12 from printer |
| 16 | `<<INSTALL_DATE>>` | Q-005 | 01 | Mon May 11 morning |
| 17 | `<<BACKUP_TARGET_PATH>>` | Q-014 | 03 | C:\PharmaCare\backups\ |
| 18 | `<<UPS_MODEL>>` | Q-015 | 03 | None (mark "no UPS - power-failure runbook only") |
| 19 | `<<LAWYER_NAME>>` | B5 | 08 | Skip if not yet engaged |
| 20 | `<<DATE_FORWARDED>>` | Day-of forward | 08 | Day-of |

20 placeholder items. Items #1, #3, #4 are HARD-FAIL - do not print or sign without them. Everything else has a working default.

---

## 4. Onsite-day responsibilities (FORWARD_PLAN v5 §3 Day 3-5 mapping)

Maps every kit artefact to who carries it and who runs it. Cross-reference: `_research_brain/99_forward_plan/FORWARD_PLAN_v5_2026-05-08.md` §3.

### Day 3 - Mon May 11 (Onsite install)

| Time | Owner | Action | Artefact |
|---|---|---|---|
| 09:00 | Sourav | Arrive Vaidyanath; greet owner | 01 (read in transit) |
| 09:15 | Sourav + owner | Sign sales agreement | 05 (countersign 2 copies) |
| 09:20 | Sourav + owner | Review DPDP notice; display at till | 06 (1 copy at till, 1 in file) |
| 09:30 | Sourav | Install Tauri build, configure printer + drawer | 01 (live tick) |
| 11:00 | Sourav | Marg CSV import (real Q-001 master, NOT 10) | 01 step 7 |
| 12:30 | Sourav | Configure DPO + grievance officer fields | 06 |
| 14:00 | Cashier + owner | Walk-throughs of training one-pager | 02 (laminated, taped near till) |
| 16:00 | Sourav | Tape hotline matrix on rig + back wall | 04 |
| 16:30 | Sourav + owner | Tape DR runbook on rig | 03 |
| 17:00 | Sourav + cashier | Start parallel-run (every bill through both) | 09 (live tick) |

### Day 4 - Tue May 12 (Pharmacist training + 30-bill gate)

| Time | Owner | Action | Artefact |
|---|---|---|---|
| 10:00 | Sourav | 2-hour training session | 02 (walked through) |
| 12:00 | Owner | First customer-consent forms | 07 (printed pad of 50) |
| 14:00 | Sourav | 30-bill zero-discrepancy gate | 09 |
| 17:00 | Sourav | Hotfix dispatch if any P0 surfaces | 04 escalation tree |

### Day 5 - Wed May 13 (CUTOVER - Vaidyanath pilot live)

| Time | Owner | Action | Artefact |
|---|---|---|---|
| 09:00 | Sourav onsite | Cutover; Marg becomes secondary | 09 |
| All day | Sourav onsite | Standby + 48h hotline open | 04 |
| 21:00 | Sourav | EOD snapshot + first metrics export | 03 (verify backup) |

---

## 5. Post-cutover iteration - how the kit evolves week 2 onwards

The kit is v0.9 because three specific deferrals are tracked. v1.0 is gated on:

1. **Lawyer red-line returns (Q-009).** Founder forwards docs 05/06/07 + cover memo 08 on Sun May 10. Expected return 2-5 BD - likely week 2 post-cutover. v1.0 docs 05/06/07 incorporate red-line; reissue + countersign.
2. **Hindi/Marathi pharma-translator review (Q-010).** Founder forwards doc 02 plus the 6 markdown source files in `pharmacare-pro/docs/training/` to translator. Re-render doc 02 with returns; relaminate.
3. **DigiCert EV cert arrives (Q-008).** Re-ship signed Tauri MSI; v1.0 install runbook drops the SmartScreen warning step. Doc 01 step 4 collapses from 3 actions to 1.

Defect-driven iteration is captured in `_research_brain/06_pilot/post_pilot_backlog.md` (S28-C4 deliverable). Every WhatsApp defect from the founder rolls into that backlog; weekly triage.

Cohort-2 (pilots 2-10, June 1 onwards) begins from v1.0 - never v0.9. Cohort-1's defect log is the input gate for v1.0.

References:
- Cohort tracker: `_research_brain/06_pilot/cohort_tracker.md`
- Post-pilot backlog: `_research_brain/06_pilot/post_pilot_backlog.md` (S28-C4)
- Defect log scaffold: `pharmacare-pro/docs/pilot-tracker/defect-log.csv` (S28-C4)

---

## 6. Sign-off

This index is the consolidated handoff from S28 wave-2B C5 to the founder. It supersedes any prior in-flight pilot kit drafts.

| Sign-off | Name | Signature | Date |
|---|---|---|---|
| Founder (PharmaCare Pro) | Sourav Shaw | __________________ | __________ |
| Pilot owner | Vaidyanath Pharmacy proprietor | __________________ | __________ |

Once both lines are signed, this kit is locked at v0.9 for cohort-1. Mutations rebuild as v0.9.1 (patch) or v1.0 (lawyer/translator merge).

---

## 7. Cross-links

- Source mirror in brain: `_research_brain/06_pilot/PILOT_KIT_INDEX_source.md`
- Workspace bundle: `outputs/PILOT_KIT_v0.9/` (README.txt at root)
- Sprint plan: `_research_brain/99_forward_plan/FORWARD_PLAN_v5_2026-05-08.md`
- Operating rules: `_research_brain/08_rules/OPERATING_MODE.md`
- User-input queue (drain pre-print): `_research_brain/00_session_state/USER_INPUT_QUEUE.md`
