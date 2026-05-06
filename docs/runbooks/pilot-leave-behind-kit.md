# Pilot Leave-Behind Kit

**Owner:** Sourav Shaw
**Frequency:** assembled once per pilot shop, restocked per the
thresholds below
**References:** Playbook v2.0 §9 (GTM + pilot rules); ADR-0017 (update
manager); sibling runbooks: `pilot-day-1-install.md`,
`pilot-48h-hotline.md`.

## Purpose

Define exactly what physically stays at the shop after the Day-1
install visit ends, and what the founder carries back. The kit is
the "self-service surface" that lets a cashier or owner unstick a
P2/P3 issue without calling the hotline, and the audit trail that
lets the founder prove §9 success-gate evidence on demand.

If the leave-behind kit is incomplete when the founder walks out,
Day-1 is amber, not green - even if the install gate in
`pilot-day-1-install.md` was met.

## Inventory (per till, stays at the shop)

- **1× laminated cashier card**, language-matched to the till's
  primary cashier:
  - `cashier-card-hi.pdf` (Hindi),
  - `cashier-card-mr.pdf` (Marathi),
  - `cashier-card-gu.pdf` (Gujarati),
  - English fallback if the shop language file is not yet shipped.
  Card is taped behind the monitor or stuck to the side of the rig
  where the cashier sees it without obstructing the till.
- **1× hotline magnet**, stuck on the front face of the till, visible
  to both cashier and customer. Carries the §9 hotline number and
  the 5-step "before you call" self-service script.
- **1× USB key (USB stick C)**, separate from the founder's two
  install sticks (A + B). Contents:
  - `license/<gstin>.lic` - license file backup,
  - `backup/app.db.last-known-good` - SQLite backup taken at end of
    Day-1 visit,
  - `installer/PharmaCare-Pro-Setup-v0.1.0.exe` - re-install fallback,
  - `README-IF-FOUND.txt` - 4-line note in shop's language with
    hotline number and "do not throw away" instructions.
- **1× owner one-pager**, in the shop owner's language, covering
  daily open / close, end-of-day report and where the GST line lives.

## Inventory (founder-side, after the visit ends)

- **Photo of the till** with cards + hotline magnet placed,
  date-stamped on the founder's phone, filed under the shop's row in
  the pilot tracker.
- **Signed install acceptance form** (1 page), signed by the shop
  owner, confirming all 10 Day-1 acceptance-gate rows are Y. One
  copy stays with the owner; the original returns with the founder.
- **Pilot tracker row updated** with: `shop_id`, install date,
  installer build sha, perf baseline (deferred to Day-7 if not
  captured at Day-1), DR drill date (Day-7 target), kit cost line.
- **Post-visit notes file** committed at
  `docs/pilot-tracker/pilot-<shop>-day-1-notes.md`, listing every
  friction point seen during the cashier walkthrough.

## Restock thresholds

| Item                | Restock trigger                                 |
|---------------------|-------------------------------------------------|
| Laminated cards     | annually, or on visible damage / staining       |
| Hotline magnet      | annually, or if hotline number changes          |
| USB stick C content | on installer minor-version bump, or quarterly   |
| License file backup | at AMC anniversary (₹4,999 renewal)             |
| Owner one-pager     | on every UI string-freeze release              |

The PharmaCare Update Manager (per ADR-0017) handles installer
updates automatically when the shop has internet; the manual
fallback - re-flash USB stick C from the founder laptop and walk it
to the shop - is documented here so the kit-bound copy never goes
stale by more than one release.

## Cost ledger (per shop)

| Item                       | Quantity | Cost (₹) |
|----------------------------|----------|----------|
| Laminated A5 cards         | 3        | 150      |
| USB key (16 GB, branded)   | 1        | 250      |
| Hotline magnet             | 1        | 50       |
| Acceptance form printout   | 2        | 10       |
| Owner one-pager printout   | 1        | 10       |
| Misc (zip-bag, stickers)   | -        | 30       |
| **Total per-shop kit**     |          | **~500** |

This ₹500 capitalises as the **"pilot-kit cost"** line in the
unit-economics tracker (`docs/pilot-tracker/unit-econ.md`), separate
from per-shop hardware cost and per-shop founder time. Kit cost is
fixed; founder time and travel dominate the all-in pilot cost.

## Operator notes

- Always assemble the kit the day before the visit, not the morning
  of - laminating in a hurry produces bubbles.
- Do not pre-print the laminated cards more than a year ahead of
  use; phone numbers and the F-key map can drift.
- The acceptance form is the only paper that returns to the founder
  unsigned at the start of the visit. Everything else is pre-cut
  and ready to leave at the till.
