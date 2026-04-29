# ADR-0059: AR shelf overlay (WebXR + WebGPU)

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
Phone-camera-at-shelf reveals stock/expiry/MRP/tamper. Uses X2 library as moat.

## Decision
WebXR session in WebView. Camera frames → MobileNetV3 + WebGPU pose → annotation overlays.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- native ARCore/ARKit
- barcode-scan only
- skip

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
