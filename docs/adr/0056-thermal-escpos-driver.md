# ADR-0056: Thermal printer ESC/POS driver

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
HTML iframe print is unprofessional and slow vs ESC/POS. Marg has native.

## Decision
Tauri sidecar (Rust) speaking ESC/POS over USB/Serial/Ethernet/BT. Auto-detect TVS + Zebra + Epson. Cash-drawer pulse via printer.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- browser print
- CUPS
- ESC/POS via JS only

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
