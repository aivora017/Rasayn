# Pilot 48 h Hotline

**Owner:** Sourav Shaw
**Frequency:** runs continuously from cutover (Day-1) onward; intensive
window is the first 48 hours
**References:** Playbook v2.0 §9 (GTM + pilot rules - "48 h hotline"
obligation); §10 (GA gate); sibling runbooks: `pilot-day-1-install.md`,
`pilot-leave-behind-kit.md`.

## Purpose

Playbook §9 commits the founder to a **48 h hotline** for every pilot
shop. This runbook defines the hotline number, coverage window,
severity gates, escalation tree, call-log format, top-3 hardware-failure
recovery scripts, and the "before you call" self-service script that
sits on the laminated cashier card.

A hotline that nobody answers is worse than no hotline; a hotline with
no severity gates burns the founder out by Day-7. This runbook protects
both sides.

## Hotline number

Placeholder: **`+91-XXXXX-XXXXX`** - founder fills in either a personal
SIM dedicated to pilots, or a BSP-routed number (see S25.4.4 follow-up
for the SIP / cloud-routing decision). The number on the leave-behind
magnet must match the number on the laminated cashier card and the
number printed in the owner one-pager - all three are restocked
together when the number changes.

## Coverage window

| Window          | Hours                          | Mode                                    |
|-----------------|--------------------------------|-----------------------------------------|
| First 48 h      | 24 / 7 from cutover            | Founder cell answers live               |
| Day 3 - Day 30  | 09:00 - 21:00 IST, 7 days      | Founder cell answers live               |
| Day 3 - Day 30  | 21:00 - 09:00 IST              | Voicemail; auto-callback next morning   |
| Day 31+         | per AMC SLA                    | Ticketed via email + weekly call window |

The first-48 h window is the strictest - the cutover risk is highest
when the cashier is muscle-memory-rebuilding and the rig has not yet
seen a full peak-hour shift.

## Severity gates

| Sev | Symptom                                                                              | Founder response                                              | Onsite SLA          |
|-----|--------------------------------------------------------------------------------------|---------------------------------------------------------------|---------------------|
| P0  | Cannot bill; data-loss suspected; receipt printer dead during peak hours             | Pick up within 5 min; remote diagnose; if no fix in 30 min, drive | 4 h                 |
| P1  | Wrong GST calc; wrong total; Schedule-H block firing wrongly; CFD blank during sale  | Pick up within 30 min; remote fix or hotpatch ship             | Next business day   |
| P2  | UI nit; missing convenience feature; slow but works; cosmetic CFD glitch             | Acknowledge within 4 h; ticket; weekly batch                   | Best-effort         |

Severity is set by the founder on pickup, not by the caller. A caller
saying "URGENT" does not auto-promote to P0 - the symptom does.

## Escalation tree

1. Cashier or owner dials the hotline number.
2. **Founder picks up within the per-severity window above.**
3. If founder is unreachable for >15 min on a P0 (rare; flight,
   hospital, lost phone): the laminated card instructs the shop to
   **fall back to legacy paper-bill mode** for the rest of the shift.
   This is explicitly endorsed - Day-1 is not "all or nothing".
4. Founder returns the call within 4 h of becoming reachable, even
   if the original P0 has self-resolved, and back-fills the hotline
   log (next section).
5. If the same P0 symptom recurs at the same shop within 7 days, the
   founder schedules an in-person visit before the next weekend.

## Logging

Every call - inbound or outbound, answered or missed - is logged in
`docs/pilot-tracker/hotline-log.csv` with the columns:

```
timestamp_iso, shop_id, severity, symptom, action_taken, resolution_minutes, notes
```

This CSV is the §9 success-gate evidence. CI lints it for shape on
every PR that touches `docs/pilot-tracker/**`.

A typical week of pilot rows looks like:

```
2026-05-06T10:14:00+05:30,jagannath-kalyan,P2,"CFD shows extra space",advised-cashier-rebuild-card,8,
2026-05-06T18:42:00+05:30,jagannath-kalyan,P0,"Receipt printer dead",remote-replug-cycle-driver,22,resolved-without-onsite
```

## Hardware-failure runbook (top 3)

These are the most-likely failure modes seen in pre-pilot testing,
each with a 5-step remote-resolve script the founder reads off
during the call. Document the actual resolution path in the
hotline-log row.

### Printer dies (P0 if peak hours, else P1)

1. Confirm the printer LED state (off / red / blinking).
2. Power-cycle the printer (5 s off, 10 s on).
3. Replug the USB into a different port on the rig.
4. Reinstall the ESC/POS driver from `C:\PharmaCare\drivers\`.
5. If still dead, switch the till to "print to PDF" fallback mode
   (Settings -> Printers -> Fallback) and ship a replacement
   printer same-day.

### NIC dies / LAN unreachable (P1 unless multi-till)

1. Confirm the cable is seated at both ends and the link LED is on.
2. Try the secondary RJ-45 port on the router.
3. Plug in the spare USB-Ethernet adapter from the leave-behind kit
   (some shops may not have one; ship overnight if missing).
4. Confirm DHCP lease via `ipconfig /renew` in elevated cmd.
5. If multi-till, switch the second till to single-till mode in
   Settings -> Multi-till -> Standalone, until LAN is restored.

### Disk full (P1)

1. Check free space: `Get-PSDrive C` in PowerShell.
2. Run `pharmacare-cli backup --rotate-keep 7` to prune old SQLite
   backup files in `C:\PharmaCare\backups\`.
3. Clear Windows Update cache:
   `Stop-Service wuauserv; Remove-Item C:\Windows\SoftwareDistribution\Download\* -Recurse -Force; Start-Service wuauserv`.
4. Empty the Recycle Bin and the temp folder.
5. If still under 10 GB free, schedule a same-week visit to install
   a larger SSD or add an external drive for the backups directory.

## Owner self-service script (laminated card, "before you call")

The leave-behind cashier card prints these 5 steps in the shop's
primary language. They resolve roughly 40 % of P2 / P3 calls without
founder time, based on pre-pilot dry-runs.

1. Reboot the till PC (full restart, not just sleep).
2. Replug the receipt printer USB cable.
3. Check the printer paper roll is loaded the right way.
4. Check that the rig has not run out of disk (Settings -> Storage
   shows "free space" - call if under 5 GB).
5. If still stuck, dial the hotline number and read out the
   on-screen error message word-for-word.

## Acceptance gate

| Gate                                            | Y / N |
|-------------------------------------------------|-------|
| Hotline number live and ringing the founder     |       |
| `hotline-log.csv` exists and CI-lints clean     |       |
| Magnet + cashier card carry the same number     |       |
| Owner has dialled the number once as a test     |       |
| Founder has the hotline SIM in a charged phone  |       |

All Y by end of Day-1 cutover, no exceptions. The "owner test-dial"
row catches the embarrassing failure mode where the magnet has a
typo in the number.

## Operator notes

- Do not silence the hotline phone during the first 48 h, ever.
- If the founder is in a meeting that cannot be interrupted, route
  the hotline forward to a trusted second; never let it hit
  voicemail during the 48 h window.
- The §9 obligation ends at 48 h, but goodwill and word-of-mouth do
  not. Most pilots that succeed in word-of-mouth referrals do so
  because the founder kept picking up at Day 30 the same way they
  picked up at Day 2.
