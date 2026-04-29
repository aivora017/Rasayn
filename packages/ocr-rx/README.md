# @pharmacare/ocr-rx

Prescription OCR — TrOCR for printed/typed Rx + Gemini 2.5 Pro Vision (Claude Sonnet 4.6 fallback) for handwritten. Constrained-JSON entity extraction (drug, dose, qty, doctor).

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as ocr_rx from "@pharmacare/ocr-rx";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
