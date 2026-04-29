# @pharmacare/fraud-detection

Staff-theft anomaly detection — Isolation Forest on bills + voids + discounts + after-hours. LLM-narrative explanation of flagged patterns.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as fraud_detection from "@pharmacare/fraud-detection";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
