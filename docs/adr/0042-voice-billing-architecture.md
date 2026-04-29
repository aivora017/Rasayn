# ADR-0042: Voice billing architecture (Whisper-Indic + Sarvam-Indus)

**Status**: Draft (scaffold)  ·  **Date**: 2026-04-28  ·  **Deciders**: Sourav (founder), tech-lead

## Context
No competitor has Indic voice billing. Massive UX moat.

## Decision
Edge ASR: Whisper-Indic-v3-turbo via ONNX Runtime Web on WebGPU. Intent extract: Sarvam-Indus 105B in cloud (Sarvam-30B fallback edge). TTS for read-aloud: Sarvam-Indus TTS.

## Consequences

### Positive
- TBD per implementation sprint.

### Negative / Risks
- TBD per implementation sprint.

### Operational impact
- TBD per implementation sprint.

## Alternatives considered
- Google STT
- Azure speech
- local Vosk

## References
- Master plan: `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx`
- Research: `_research_brain/01_market_research/Pharmacy_Software_Deep_Research_Report_2026.docx`
- Scaffold index: `pharmacare-pro/SCAFFOLD_INDEX.md`

## Supersedes / Superseded-by
- None at scaffold time.
