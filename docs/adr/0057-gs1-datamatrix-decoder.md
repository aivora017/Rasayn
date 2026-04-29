# ADR-0057: GS1 DataMatrix decoder

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
1D barcodes lose batch+expiry+serial data. DSCSA-India is coming.

## Decision
zxing-cpp via WASM. Decodes batch + GTIN + expiry + serial in one scan. Feeds counterfeit-shield + cold-chain.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- 1D only
- cloud OCR
- skip

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
