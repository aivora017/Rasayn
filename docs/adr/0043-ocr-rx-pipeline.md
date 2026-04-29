# ADR-0043: OCR Rx pipeline

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Rx attach is a blob today. Manual transcription is the largest data-entry pain.

## Decision
(a) Deskew via OpenCV. (b) Printed/handwritten classifier (MobileNetV3). (c) Printed → TrOCR; handwritten → Gemini 2.5 Pro Vision (Claude Sonnet 4.6 fallback). (d) JSON-mode entity extract.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- Tesseract only
- Cloud Vision API
- manual entry forever

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
