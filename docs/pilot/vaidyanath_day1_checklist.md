# Vaidyanath Day-1 Checklist (Hotline Reference)

> Companion to `vaidyanath_day1_install_runbook.docx`. Print, laminate, tape to the rig.
> PharmaCare Pro v0.1.0 - Vaidyanath pilot - DRAFT 2026-05-08.
> Cutover: Wednesday 2026-05-13. Hotline: Sourav Shaw (number on the rig).

## Section 1 - Pre-arrival (founder, evening before)
- [ ] USB stick A + B with MSI + SHA256 + this checklist + power-failure runbook
- [ ] Marg CSV export on USB: master / customers / suppliers / khata
- [ ] Printer cable + 3 thermal rolls + RJ12 drawer cable + USB-Eth + Cat-6 5m
- [ ] Multimeter + UPS (Q-015 default APC Easy UPS BV 800VA)
- [ ] Hotline SIM activated; call test ok
- [ ] Owner + cashier confirmed available 3 hours

## Section 2 - Hardware (~30 min)
- [ ] Voltage 198-242V (HARD BLOCKER)
- [ ] Rig + monitor + printer wired; UPS holds 30s on battery
- [ ] Network cable green at both ends OR wireless documented
- [ ] Drawer wired to printer DK port (silent, no pop yet)

## Section 3 - Install (~20 min)
- [ ] SHA-256 of MSI matches sidecar file
- [ ] SmartScreen click-through narrated; UAC accepted
- [ ] App opens; "v0.1.0" visible in splash
- [ ] License activates; shop name + GSTIN + retail license read back
- [ ] Resident memory <= 300MB; app.db + log file present

## Section 4 - First-run wizard (~30 min)
- [ ] Step 1 Shop Identity: 9 fields; GSTIN green; license PDF uploaded
- [ ] Step 2 DPDP: DPO + Grievance Officer filled; green tick
- [ ] Step 3 Locale: Marathi (Q-007 default); Devanagari renders
- [ ] Step 4 IRN: toggle matches Q-004 turnover bracket
- [ ] Step 5 Users: owner + cashier accounts log in
- [ ] Step 6 Finish: Dashboard loads with Vaidyanath name + DPDP shield green

## Section 5 - Marg CSV import (~30 min)
- [ ] 4 CSVs staged at C:\ProgramData\PharmaCare\import-staging\
- [ ] Dry run: counts in expected ranges (Items 500-2000, Customers 200-500, Suppliers 20-50)
- [ ] Validation: 0 missing GST rate, 0 Schedule-H without license class
- [ ] Live import: counts match dry run; pre-import + post-import snapshots taken
- [ ] 5 SKU spot-checks pass (Crocin 500, Dolo 650, Allegra 120, Pantop 40, Telma 40)
- [ ] 3 khata spot-checks pass

## Section 6 - Printer config (~15 min)
- [ ] Driver selected per Q-002 (TVS-E or Epson TM-T82); status "Connected"
- [ ] Test print: shop header, GST split, Marathi date all render
- [ ] Drawer kick test: pop within 200ms (try alt pulse code 27,112,0,50,250 if silent)
- [ ] Default printer set for billing + receipts

## Section 7 - Backup (~5 min)
- [ ] External SSD (Q-014 default) plugged in; D:\PharmacareBackups\ configured
- [ ] Schedule 02:00 nightly, 30-day retention
- [ ] Test snapshot tarball >=200KB present

## Section 8 - OTC test bill (~10 min)
- [ ] F2 new bill; Crocin 500 added; Cash INR 50; Enter
- [ ] Bill number VP-2026-05-13-0001 saved
- [ ] Receipt prints; drawer pops; "IRN: skipped" footer correct

## Section 9 - Schedule-H test bill (~10 min)
- [ ] F2 new bill; Augmentin 625; H badge visible
- [ ] Counseling modal blocks; patient + doctor + counsel-checkbox filled
- [ ] Bill saved; Schedule-H register has new row matching

## Section 10 - Parallel-run mode (~10 min)
- [ ] Owner heard the rule; double-billing for 3 days starts now
- [ ] 30-bill gate explained (1 discrepancy = reset)
- [ ] Discrepancy escalation path memorized (yell, then WhatsApp)

## Section 11 - EOD Day-1 (~5 min)
- [ ] Snapshot tarball today's timestamp
- [ ] Dashboard screenshot saved
- [ ] WhatsApp summary posted to S28 thread

## Section 12 - P0 fallback understood
- [ ] Owner + cashier can recite trigger list
- [ ] "Switch back to Marg, call Sourav" rule memorized
- [ ] Tape note ready: "OFFLINE - call founder before resuming"

## Section 13 - Cutover (Wed May 13)
- [ ] 9 AM: Rasayn primary, Marg secondary
- [ ] First 9 AM bill prints from Rasayn
- [ ] Founder onsite through 1 PM minimum
- [ ] EOD WhatsApp: "CUTOVER COMPLETE - Day 1 live"

## Section 14 - Hotline
- [ ] Hotline SIM number taped on rig
- [ ] Cashier card has number in Marathi
- [ ] Q-006 secondary contact placeholder noted (drain at next session boundary)

## Section 15 - Founder departure check
- [ ] All 12 above ticked. If any unticked: do not leave.
