# PharmaCare Pro - Pilot Kit Index v1.0 (Cohort-1)

> **Owner:** Sourav Shaw (founder).
> **Status:** v1.0, cohort-1 ready — wave-F gaps closed.
> **Last updated:** 2026-05-09 (S28 wave-G agent G1 — v1.0 refresh).
> **Pilot date:** 2026-05-13 (Wednesday) at Vaidyanath Pharmacy, Kalyan, MH.
> **Main SHA:** `780fdf1` (origin/main, BOTH CI workflows GREEN — 5 consecutive).
> **Workspace bundle:** `computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/.../outputs/PILOT_KIT_v1.0/`

This file is the single index for everything cohort-1 ships with. The workspace folder `PILOT_KIT_v1.0/` is the printable bundle; this index is the read-me + fill-checklist + ownership map + cross-link hub. Anything not listed here is not in the pilot kit.

v1.0 SUPERSEDES v0.9 (2026-05-08 S28-C5). v0.9 framing is preserved in §7 changelog. The two operational artefacts that v0.9 left implicit are now explicit: hotfix deployment (F1) and the Sun-night dress-rehearsal SOP (F3). Two code-only changes (F2 + F4) are referenced for traceability but ship no doc.

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
| **Hotfix protocol (NEW v1.0)** | **1 (.docx)** | **Day-1+ rapid hotfix flow with P0/P1 SLAs + 10-row Day-1 risk inventory.** |
| **Dress-rehearsal SOP (NEW v1.0)** | **1 (.docx)** | **Sun May 10 evening 91-120 min full clean pass on a clone Win 11 VM. Hard-fail gate at §10 (DR restore).** |
| **Dress-rehearsal results template (NEW v1.0)** | **1 (.md)** | **The artefact Sourav fills Sunday evening with pass/fail per section.** |

13 deliverables total. Plus README.txt (v1.0 framing + fill-list pointer).

The kit is shippable for cohort-1 as-is. Three deferrals carry forward unchanged from v0.9 — see §5.

---

## 2. Deliverable table

Every row links the source author (S28 wave letter), the canonical repo path, the printable workspace path, and the fill-needed placeholders.

| ID | File | Owner | Version | Last-updated | Pages | Source agent | Repo path | Workspace copy | Fill-needed placeholders | Dependencies |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 | `01_day1_install_runbook.docx` | Sourav | v0.9 | 2026-05-08 | ~14 | S28-A3 | `pharmacare-pro/docs/pilot/vaidyanath_day1_install_runbook.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/01_day1_install_runbook.docx) | `<<SHOP_NAME>>`, `<<PRINTER_MODEL>>` (Q-002), `<<DRAWER_MODEL>>` (Q-003), `<<INSTALL_DATE>>`, `<<HOTLINE_NUMBER>>` (Q-006) | None |
| 02 | `02_training_hi_mr_one_pager.docx` | Sourav | v0.9 | 2026-05-08 | 2 (A4 colour, laminate) | S28-A4 | `pharmacare-pro/docs/pilot/vaidyanath_training_hi_mr.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/02_training_hi_mr_one_pager.docx) | `<<HOTLINE_NUMBER>>` (Q-006), `<<LOCALE_HI_OR_MR>>` (Q-007) | Translator review (Q-010, deferred) |
| 03 | `03_dr_runbook.docx` | Sourav | v0.9 | 2026-05-08 | ~6 | S28-A6 | `pharmacare-pro/docs/dr/runbook.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/03_dr_runbook.docx) | `<<BACKUP_TARGET_PATH>>` (Q-014), `<<UPS_MODEL>>` (Q-015) | `restore_smoke_test.md` |
| 04 | `04_hotline_escalation_matrix.docx` | Sourav | v0.9 | 2026-05-08 | ~5 | S28-D3 | `pharmacare-pro/docs/runbooks/pilot-48h-hotline.md` (source) + this docx (canonical printable) | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/04_hotline_escalation_matrix.docx) | `<<HOTLINE_NUMBER>>` (Q-006), `<<BACKUP_NUMBER>>` (Q-006), `<<LOCALE_HI_OR_MR>>` (Q-007) | None |
| 05 | `05_sales_agreement_pilot_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~8 | S28-B5 | `pharmacare-pro/docs/legal/sales_agreement_pilot_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/05_sales_agreement_pilot_v0.9.docx) | `<<SHOP_NAME>>`, `<<SHOP_GSTIN>>`, `<<OWNER_FULL_NAME>>`, `<<OWNER_AADHAAR_LAST_4>>`, `<<EFFECTIVE_DATE>>`, `<<PILOT_TERM_MONTHS>>` | Lawyer red-line (Q-009, week 2) |
| 06 | `06_dpdp_privacy_notice_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~4 | S28-B5 | `pharmacare-pro/docs/legal/dpdp_privacy_notice_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/06_dpdp_privacy_notice_v0.9.docx) | `<<SHOP_NAME>>`, `<<SHOP_GSTIN>>`, `<<DPO_NAME>>`, `<<DPO_EMAIL>>`, `<<GRIEVANCE_OFFICER>>`, `<<GRIEVANCE_EMAIL>>`, `<<EFFECTIVE_DATE>>` | Lawyer red-line (Q-009) |
| 07 | `07_customer_consent_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~2 | S28-B5 | `pharmacare-pro/docs/legal/customer_consent_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/07_customer_consent_v0.9.docx) | `<<SHOP_NAME>>`, `<<EFFECTIVE_DATE>>`, blank customer fields filled at till | Lawyer red-line (Q-009) |
| 08 | `08_lawyer_review_memo_v0.9.docx` | Sourav | v0.9 | 2026-05-08 | ~3 | S28-B5 | `pharmacare-pro/docs/legal/lawyer_review_memo_v0.9.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/08_lawyer_review_memo_v0.9.docx) | `<<LAWYER_NAME>>`, `<<DATE_FORWARDED>>` | Forward Sun May 10 |
| 09 | `09_day1_checklist.md` | Sourav | v0.9 | 2026-05-08 | 1 (printable) | S28-A3 | `pharmacare-pro/docs/pilot/vaidyanath_day1_checklist.md` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/09_day1_checklist.md) | None - tick-list, fill at-time | None |
| 10 | `10_synthetic_vaidyanath_master.csv` | Sourav | v0.9 | 2026-05-08 | n/a (567 rows) | S28-A5 | `pharmacare-pro/tools/synthetic-vaidyanath-master.csv` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/10_synthetic_vaidyanath_master.csv) | None - DRY-RUN ONLY, do not import to real shop | Q-001 (real Vaidyanath master) supersedes for production install |
| 11 | `11_hotfix_deployment_protocol.docx` **NEW v1.0** | Sourav | v1.0 | 2026-05-09 | ~12 | S28-F1 | `pharmacare-pro/docs/runbooks/hotfix_deployment_protocol.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/11_hotfix_deployment_protocol.docx) | `<<HOTLINE_NUMBER>>` (Q-006), `<<BACKUP_NUMBER>>` (Q-006), `<<PREVIOUS_MSI_PATH>>` (founder USB), `<<DEFENDER_USB_SCAN_DATE>>` (founder, day-of) | `defect_log.md` (C4), `auto-update-release-flow.md` (S27) — code-only |
| 12 | `12_dress_rehearsal_sop.docx` **NEW v1.0** | Sourav | v1.0 | 2026-05-09 | ~10 | S28-F3 | `pharmacare-pro/docs/pilot/dress_rehearsal_sop.docx` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/12_dress_rehearsal_sop.docx) | `<<CLONE_VM_HOSTNAME>>` (founder local) | A3 + A6 (validates them); F2 ADR-0078 (motivates §4 Marg import) |
| 13 | `13_dress_rehearsal_results_TEMPLATE.md` **NEW v1.0** | Sourav | v1.0 | 2026-05-09 | n/a (fill-in) | S28-F3 | `_research_brain/06_pilot/dress_rehearsal_results_TEMPLATE.md` | [computer link](computer://C:/Users/Jagannath%20Pharmacy/AppData/Roaming/Claude/local-agent-mode-sessions/PILOT_KIT_v1.0/13_dress_rehearsal_results_TEMPLATE.md) | Filled Sunday evening — copy to `dress_rehearsal_results_2026-05-10.md` then fill | Doc 12 (the SOP that drives the rows) |

**13 rows.** Verify: every File column in column 2 maps 1:1 to a file in `outputs/PILOT_KIT_v1.0/`.

---

## 3. Pre-print checklist (drain USER_INPUT_QUEUE first)

Drain these from `_research_brain/00_session_state/USER_INPUT_QUEUE.md` answers before printing docs 01..08 + 11..12. Items are listed in fill-order for a single sit-down session. Rows marked **NEW v1.0** are added by F1 + F3.

| # | Placeholder | Source | Replaces in | Default if blank |
|---|---|---|---|---|
| 1 | `<<SHOP_NAME>>` | Static: "Vaidyanath Pharmacy" | 01, 05, 06, 07 | Hard-fail - do NOT print |
| 2 | `<<SHOP_GSTIN>>` | Q-001 (Marg export header row) | 05, 06 | Leave blank, fill on Day-1 |
| 3 | `<<OWNER_FULL_NAME>>` | B5 input from owner | 05, 07 | Hard-fail - do NOT sign |
| 4 | `<<OWNER_AADHAAR_LAST_4>>` | B5 input from owner | 05, 07 | Hard-fail - do NOT sign |
| 5 | `<<EFFECTIVE_DATE>>` | Day-1 cutover date | 05, 06, 07 | 2026-05-13 |
| 6 | `<<PILOT_TERM_MONTHS>>` | Founder decision | 05 | 6 months |
| 7 | `<<DPO_NAME>>` | B5 - founder is DPO until owner appoints alt | 06 | Sourav Shaw |
| 8 | `<<DPO_EMAIL>>` | B5 | 06 | dpo@rasayn.in |
| 9 | `<<GRIEVANCE_OFFICER>>` | B5 | 06 | Owner full name |
| 10 | `<<GRIEVANCE_EMAIL>>` | B5 | 06 | Owner WhatsApp-linked email |
| 11 | `<<HOTLINE_NUMBER>>` | Q-006 | 02, 04, **11** | Founder primary cell |
| 12 | `<<BACKUP_NUMBER>>` | Q-006 | 04, **11** | Owner cell |
| 13 | `<<LOCALE_HI_OR_MR>>` | Q-007 | 02, 04 | Marathi (Kalyan default) |
| 14 | `<<PRINTER_MODEL>>` | Q-002 | 01 | Epson TM-T82 |
| 15 | `<<DRAWER_MODEL>>` | Q-003 | 01 | RJ12 from printer |
| 16 | `<<INSTALL_DATE>>` | Q-005 | 01 | Mon May 11 morning |
| 17 | `<<BACKUP_TARGET_PATH>>` | Q-014 | 03 | C:\PharmaCare\backups\ |
| 18 | `<<UPS_MODEL>>` | Q-015 | 03 | None (mark "no UPS - power-failure runbook only") |
| 19 | `<<LAWYER_NAME>>` | B5 | 08 | Skip if not yet engaged |
| 20 | `<<DATE_FORWARDED>>` | Day-of forward | 08 | Day-of |
| 21 | `<<CLONE_VM_HOSTNAME>>` **NEW v1.0** | Founder local (e.g. `WIN11-VAIDYAREHEARSAL`) | 12 | `WIN11-CLONE-01` |
| 22 | `<<PREVIOUS_MSI_PATH>>` **NEW v1.0** | Founder USB (path on stick to `previous.msi`) | 11 §4.b | `E:\PharmaCarePro\previous.msi` |
| 23 | `<<DEFENDER_USB_SCAN_DATE>>` **NEW v1.0** | Founder, day-of (ISO 8601) | 11 §3.k | Hard-fail — must be SAME-DAY scan |

**23 placeholder items** (was 20 in v0.9). Items #1, #3, #4 remain HARD-FAIL. New item #23 (Defender USB scan timestamp) is HARD-FAIL onsite — never carry an unscanned USB to the shop. Everything else has a working default.

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
| 17:00 | Sourav | **If any P0/P1 surfaces, invoke doc 11 hotfix protocol** (sandbox branch, pcall gate, PR, MSI rebuild, onsite re-install). Severity-to-SLA: P0 = 24h ship+install, P1 = 48h. | **11** + 04 escalation tree |

### Day 5 - Wed May 13 (CUTOVER - Vaidyanath pilot live)

| Time | Owner | Action | Artefact |
|---|---|---|---|
| 09:00 | Sourav onsite | Cutover; Marg becomes secondary | 09 |
| All day | Sourav onsite | Standby + 48h hotline open. **Any defect → doc 11 §1 invoke check, then §3 step-by-step.** | **11** + 04 |
| 21:00 | Sourav | EOD snapshot + first metrics export | 03 (verify backup) |

### Day 6+ (Thu May 14 onwards — remote)

| Day | Owner | Action | Artefact |
|---|---|---|---|
| Day 6-7 | Sourav (remote) | Watch defect log, ack within hotline §2 SLA, drive to shop only on P0 reproducible. **Hotfix path:** doc 11 §3 (sandbox → MSI → smoke VM → onsite re-install). Onsite rollback: doc 11 §4. | **11** + 04 + `defect_log.md` |
| Day 14 | Sourav | First post-cutover lawyer red-line forward (Q-009 follow-up) | 08 |
| Day 14 | Sourav | First quarterly drill prep (doc 11 §8 cadence; first scheduled S30) | **11** §8 |

---

## 5. Post-cutover iteration - how the kit evolves week 2 onwards

The kit is v1.0. v1.1+ is gated on:

1. **Lawyer red-line returns (Q-009).** Founder forwards docs 05/06/07 + cover memo 08 on Sun May 10. Expected return 2-5 BD - likely week 2 post-cutover. v1.1 docs 05/06/07 incorporate red-line; reissue + countersign.
2. **Hindi/Marathi pharma-translator review (Q-010).** Founder forwards doc 02 plus the 6 markdown source files in `pharmacare-pro/docs/training/` to translator. Re-render doc 02 with returns; relaminate.
3. **DigiCert EV cert arrives (Q-008).** Re-ship signed Tauri MSI; v1.1 install runbook drops the SmartScreen warning step. Doc 01 step 4 collapses from 3 actions to 1. Doc 11 §7 (auto-update path) becomes the default flow once the channel ladder is exercised.

Defect-driven iteration is captured in `_research_brain/06_pilot/post_pilot_backlog.md` (S28-C4 deliverable). Every WhatsApp defect from the founder rolls into that backlog; weekly triage. v1.0 doc 11 §1 — §3 is the binding flow for any P0/P1 in the live shop.

Cohort-2 (pilots 2-10, June 1 onwards) begins from v1.0 — never v0.9. Cohort-1's defect log is the input gate for v1.1.

References:
- Cohort tracker: `_research_brain/06_pilot/cohort_tracker.md`
- Post-pilot backlog: `_research_brain/06_pilot/post_pilot_backlog.md` (S28-C4)
- Defect log scaffold: `pharmacare-pro/docs/pilot-tracker/defect-log.csv` (S28-C4)
- Hotfix protocol source: `_research_brain/06_pilot/hotfix_deployment_source.md` (S28-F1)
- Dress-rehearsal SOP source: `_research_brain/06_pilot/dress_rehearsal_source.md` (S28-F3)
- ADR-0078 (F2 motivator): `pharmacare-pro/docs/adr/0078-shared-db-runmigrations-pragma-extraction.md`

---

## 6. Sun May 10 dress-rehearsal section (NEW v1.0)

**Hard gate before driving to Kalyan Mon morning.** Founder MUST run doc 12 SOP on a clone Win 11 VM Sunday May 10 evening. Do NOT skip. Doc 13 results template gets filled live and committed before bed.

| Item | Value |
|---|---|
| Window | Sun 2026-05-10 evening (latest start 18:00 IST) |
| Driver | Sourav Shaw |
| VM floor | 4 GB RAM / 2 vCPU / HDD-equivalent (matches Lenovo ThinkCentre i3-8100 from Playbook hardware floor) |
| Total budget | 91 min floor / 120 min ceiling |
| Sections | 13 (prep / install / wizard / CSV import / OTC bill / Schedule-H bill / return / GSTR-3B export / snapshot / **DR restore (HARD-FAIL gate)** / locale switch / perf smoke / tear-down) |
| Hard-fail gate | §10 DR restore — `integrity_check = "ok"` AND 500/500 products restored; failure aborts pilot, push 48h, call owner |
| Abort policy | P0 in §2/§3/§6/§9/§10 → STOP, fix, restart from §1; P1 → log + continue; P2 → log + S29 backlog |
| Output | `dress_rehearsal_results_2026-05-10.md` (copy of doc 13 template), filled and committed before bed |
| Inputs | Cloned Win 11 VM clean baseline; USB with `PharmaCare-Pro-Setup-v0.1.0.msi` + `.sha256`; doc 10 synthetic master CSV; printer (TVS-E or Epson TM-T82); doc 12 printed; doc 13 open in editor |

Verify before driving Mon AM:
- Doc 13 results file is committed to repo with overall verdict = `PASS` or `PASS-WITH-P1`.
- §10 row is `PASS` (no exceptions).
- All P0 findings are either `FIXED + rehearsal restarted` or pilot is `PUSHED`.
- Off-site backup of Sunday's snapshot folder is present.
- Drill log row appended to `_research_brain/06_pilot/dr_drills.md`.

If any of those five verify-bullets fails: **do not drive to Kalyan.** Call owner, push pilot 48h, retest.

---

## 7. Changelog

| Version | Date | Wave / agent | Summary |
|---|---|---|---|
| v0.9 | 2026-05-08 | S28 wave-2B agent C5 | Original 10-deliverable kit. Day-1 install + training + DR + hotline + 4 legal docs + day-1 checklist + synthetic master CSV. Single-pass consolidation. |
| **v1.0** | **2026-05-09** | **S28 wave-G agent G1** | **Added F1 hotfix protocol (doc 11) + F3 dress-rehearsal SOP (doc 12) + F3 results template (doc 13). F2 (shared-db runMigrations PRAGMA extraction, ADR-0078) and F4 (OnboardingWizard 85-key i18n × en/hi/mr) referenced for traceability but ship code-only. Pre-print checklist grew from 20 to 23 placeholders (+CLONE_VM_HOSTNAME, +PREVIOUS_MSI_PATH, +DEFENDER_USB_SCAN_DATE). Onsite Day 3-5 table cites doc 11 hotfix protocol on every defect path. New §6 Sun May 10 dress-rehearsal gate.** |

---

## 8. Sign-off

This index is the consolidated handoff from S28 wave-G G1 to the founder. It supersedes the v0.9 kit (S28 wave-2B C5 handoff). v0.9 framing is preserved in §7 changelog.

| Sign-off | Name | Signature | Date |
|---|---|---|---|
| Founder (PharmaCare Pro) | Sourav Shaw | __________________ | __________ |
| Pilot owner | Vaidyanath Pharmacy proprietor | __________________ | __________ |

Once both lines are signed, this kit is locked at v1.0 for cohort-1. Mutations rebuild as v1.0.1 (patch) or v1.1 (lawyer/translator/DigiCert merge).

---

## 9. Cross-links

- Source mirror in brain: `_research_brain/06_pilot/PILOT_KIT_INDEX_source.md`
- Workspace bundle: `outputs/PILOT_KIT_v1.0/` (README.txt at root)
- Sprint plan: `_research_brain/99_forward_plan/FORWARD_PLAN_v5_2026-05-08.md`
- Operating rules: `_research_brain/08_rules/OPERATING_MODE.md`
- User-input queue (drain pre-print): `_research_brain/00_session_state/USER_INPUT_QUEUE.md`
- Hotfix protocol source: `_research_brain/06_pilot/hotfix_deployment_source.md`
- Dress-rehearsal SOP source: `_research_brain/06_pilot/dress_rehearsal_source.md`
- Dress-rehearsal results template (canonical): `_research_brain/06_pilot/dress_rehearsal_results_TEMPLATE.md`
- ADR-0078 (F2 motivator): `pharmacare-pro/docs/adr/0078-shared-db-runmigrations-pragma-extraction.md`
