# @pharmacare/formulary

Drug interaction (DDI) + allergy + dose-appropriateness checks against local FDA Orange + CIMS-India formulary. Edge inference with Sarvam-30B for plain-language explanations.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as formulary from "@pharmacare/formulary";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
