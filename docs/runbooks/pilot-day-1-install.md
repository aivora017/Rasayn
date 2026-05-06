# Pilot Day-1 Install - Vaidyanath / Jagannath Pharmacy and successors

**Owner:** Sourav Shaw
**Frequency:** once per pilot shop, on the day of cutover
**Target rig:** Lenovo i3-8100 / 4 GB RAM / 256 GB SSD or HDD / Win 11 Pro / wired 100 Mbit LAN
**Time budget:** 90 minutes on-site (door-to-receipt-printed)
**References:** Playbook v2.0 §3 (locked tech), §8 (operational playbook),
§9 (GTM + pilot rules), §10 (GA gate); ADR-0017 (update manager);
sibling runbooks: `pilot-leave-behind-kit.md`, `pilot-48h-hotline.md`,
`perf-drill-jagannath.md`, `dr-drill.md`.

## Purpose

Turn a 1-3 location independent pharmacy off Marg / Tally / paper and
onto **PharmaCare Pro v0.1.0** in a single founder-led visit, capturing
the §9 success-gate evidence on the way out. The first execution of
this runbook is at Vaidyanath Pharmacy (also referred to as Jagannath
Pharmacy in earlier docs - same shop) in Kalyan; subsequent pilots reuse
this exact sequence with shop-specific substitutions.

The runbook converts Day-1 from a freestyle visit into a 90-minute
push-button procedure. Anything that drifts off the script gets logged
in the post-visit notes file for the next iteration.

## Reference rig

- Lenovo ThinkCentre / IdeaCentre i3-8100, 4 GB RAM, 256 GB SSD or HDD.
- Windows 11 Pro fully patched; can degrade gracefully to Win 10 / Win 8 / Win 7
  per Playbook §3 hardware floor.
- Wired 100 Mbit LAN backbone preferred; wireless tolerated.
- Resident memory budget 300 MB; signed installer .exe under 200 MB.
- DigiCert EV Authenticode signature on the installer (Playbook §3 locked).

## Pre-arrival checklist (founder-side, T-24 h before visit)

- [ ] **USB stick A** with `PharmaCare-Pro-Setup-v0.1.0.exe` (signed).
- [ ] **USB stick B** with backup copy of the same installer (redundancy
      against a corrupt USB).
- [ ] **License file** generated for the shop's GSTIN + retail-license
      number. Perpetual ₹14,999 + AMC ₹4,999 per Playbook §2 hard rules.
- [ ] **Sample data SQL** with 5 product fixtures + 1 shop row + 1 owner
      user + 1 cashier user (PIN preset, owner can rotate Day-2).
- [ ] **USB-Ethernet adapter** - some Lenovo onboard NICs are flaky;
      adapter is the cheapest 5-minute fix on-site.
- [ ] **Cat-6 patch cable, 5 m**, gigabit-rated.
- [ ] **USB hub, 4-port**, powered if possible.
- [ ] **Multimeter** - verify shop mains is 220 V ±10 %. Voltage spikes
      are the #1 hardware-killer in IST and MUST be checked before
      anything else gets plugged in.
- [ ] **Thermal 80 mm receipt printer** (Epson TM-T82 or equivalent),
      ESC/POS over USB. Pair the printer driver on a test machine
      before leaving the office so the ESC/POS .inf is known-good.
- [ ] **CFD (customer-facing display)** cable + termination resistor
      if the model needs one.
- [ ] **Phone with hotline SIM** - separate SIM from founder's personal
      cell, dedicated to the §9 "48 h hotline" obligation.
- [ ] **4 laminated cards** printed and laminated:
      `cashier-card-hi.pdf` / `cashier-card-mr.pdf` / `cashier-card-gu.pdf`
      (S25.4.2 deliverable). Generic English fallback if S25.4.2 has
      not yet shipped.
- [ ] **Shop-side confirmation** by phone the day before: GSTIN active,
      retail license certificate scanned and emailed back, owner
      available for the full 90-minute visit (not just first 15 min).

## On-site sequence (10 steps, 90-minute target)

1. **Power check** (5 min). Multimeter on the shop mains outlet that
   will feed the rig. Reading must sit 198-242 V (220 V ±10 %).
   Visually inspect the surge protector for melt marks or popped LEDs.
   **Block install if voltage is outside range** - reschedule until
   the shop fixes the supply or sources a UPS. Do not improvise.
2. **Network check** (5 min). Wired LAN preferred. Plug into the
   shop router; confirm DHCP lease, ping the gateway, ping `1.1.1.1`.
   If the shop is wireless-only, document and proceed - the LAN-first
   design accepts no-internet operation; license activation happens
   off the founder's hotspot.
3. **Hardware uncrate + power-on** (5 min). If the Lenovo arrived in
   retail packaging, uncrate now and check for transit damage. Plug,
   power on, BIOS-skip past the OEM splash, into the Win 11 first-run
   experience. Skip every "set up Microsoft account" prompt - go local.
4. **Install** (10 min). Insert USB stick A; run
   `PharmaCare-Pro-Setup-v0.1.0.exe`. Accept EULA. Accept the default
   install path `C:\PharmaCare\`. Verify the Authenticode signature
   block in the UAC dialog says **DigiCert EV** before clicking Yes.
   Reboot if the installer prompts (some Win 11 builds do).
5. **License activation** (5 min). Copy the license file from the
   founder laptop or USB stick A into `C:\PharmaCare\license\`.
   Launch the app. The license screen accepts; first launch creates
   `app.db` (SQLite) at `%APPDATA%\PharmaCare\app.db`. Confirm the
   shop name, GSTIN and retail-license number all read back correctly.
6. **Fixture-data seed** (10 min). From an elevated PowerShell at
   `C:\PharmaCare\`:
   `pharmacare-cli seed --shop-id <shop_id> --gstin <shop_gstin> --license <retail_license> --sample-products 5`.
   This verifies the write-path end-to-end and populates the owner
   and cashier users with default PINs (rotate on Day-2 follow-up).
7. **Printer + CFD pair** (10 min). Settings -> Printers -> Add Device;
   install the ESC/POS driver from the bundled `.inf` on USB stick A.
   Print a test receipt. Pair the CFD on the assigned COM port; test
   that "PharmaCare Pro - Ready" displays. If either device fails,
   swap to the spare USB cable before debugging the driver.
8. **First-bill smoke test** (5 min). Log in as cashier; F2 -> search
   `Paracetamol 500mg` (sample fixture); F3 -> quantity 1; F10 -> save.
   Receipt prints. CFD shows the total. Record the wall-clock time
   for this bill in the smoke-test log.
9. **Owner walkthrough** (10 min). F-key tour, daily open-shift and
   close-shift, end-of-day report (point to the line that shows GST
   collected; show where to find the GSTR-1 export). Hand over the
   laminated cashier card so the owner has a physical reference for
   the floor.
10. **Cashier walkthrough** (15 min). Cashier sits at the till and
    runs **5 practice bills** against fake customers (founder
    role-plays the customer and varies the script: cash, partial
    return, Schedule-H drug, GST-exempt item, multi-line). Founder
    watches for friction points and writes them straight into
    `docs/pilot-tracker/pilot-<shop>-day-1-notes.md`.

## Smoke-test gate

The first real customer bill must be **saved + receipt printed + CFD
displayed within 30 minutes of install start**. If the gate is missed,
do **not** mark Day-1 successful - reschedule the cutover for the next
day, leave the shop on legacy software, and debug from the founder
laptop overnight.

## Leave-behind handoff (10 min, end of visit)

- Laminated cashier card stays at the till, taped to the wall behind
  the monitor or stuck to the side of the rig.
- Owner gets the language-matched one-pager (S25.4.2 deliverable).
- Hotline magnet stuck on the front face of the till, visible to both
  cashier and customer.
- Founder takes a photo of the till with cards + magnet placed and
  files it in the pilot-tracker spreadsheet under that shop's row.
- Founder signs and counter-signs the install acceptance form with
  the shop owner; one copy stays with the owner, one goes back into
  the founder's pilot binder.

Full leave-behind inventory is in `pilot-leave-behind-kit.md`.

## Acceptance gate

| Gate                       | Y / N | Notes                          |
|----------------------------|-------|--------------------------------|
| Install completed          |       | Authenticode verified          |
| License active             |       | GSTIN + retail license read    |
| Printer paired             |       | Test receipt printed           |
| CFD paired                 |       | Total displays on save         |
| Smoke-bill saved           |       | Within 30 min of install start |
| Owner walkthrough done     |       | F-keys + EOD + GST line shown  |
| Cashier walkthrough done   |       | 5 practice bills run           |
| Leave-behind kit placed    |       | Per `pilot-leave-behind-kit`   |
| Hotline magnet stuck       |       | Visible from both sides        |
| Acceptance form signed     |       | Both copies                    |

**ALL rows must be Y** to mark Day-1 green in the pilot tracker.
A single N keeps the shop in "Day-1 amber" until the gap is closed.

## Rollback

If any step fails irrecoverably (voltage out of range, installer
refuses to verify, license rejection, printer cannot be paired after
two driver swaps, smoke-bill gate missed), bring the shop back to its
legacy stack (Marg / Tally / paper) **before** leaving the premises.
The shop must not end the day mid-cutover.

1. Stop the PharmaCare Pro service if it was started.
2. Restore whatever legacy workflow the shop was on that morning.
3. Document the blocker in
   `docs/pilot-tracker/pilot-<shop>-day-1-notes.md` with severity, the
   exact step that failed, the error text, and a hypothesis.
4. Founder follows up within 24 h with a fix plan; reschedule Day-1
   only when the blocker has a tested workaround.

## Cross-references

- `docs/runbooks/perf-drill-jagannath.md` - perf evidence; can be
  captured at Day-1 if the rig is fresh and the shop is post-21:00 IST,
  otherwise defer to the Day-7 follow-up visit.
- `docs/runbooks/dr-drill.md` - DR rehearsal; defer to Day-7 follow-up,
  reuse `scripts/dr/restore-from-backup.ps1`.
- `docs/runbooks/pilot-leave-behind-kit.md` - sibling deliverable,
  inventory of what physically stays at the shop.
- `docs/runbooks/pilot-48h-hotline.md` - sibling deliverable, call
  routing and severity gates for the §9 hotline obligation.

## Operator notes

- Keep this runbook printed and laminated in the founder bag. If
  Sourav is unreachable mid-visit (rare), the operator on the rig
  should be able to follow steps 1-7 from paper.
- The 90-minute target is door-to-receipt-printed. Owner and cashier
  walkthroughs (steps 9-10) extend the visit but do not gate "Day-1
  green" - the smoke-test gate does.
- Do not leave the shop without all 10 acceptance-gate rows answered.
  An unanswered row counts as N.
