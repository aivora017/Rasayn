# @pharmacare/cold-chain

BLE temp-sensor integration for vaccines/insulin fridges. Auto-link to batches. Anomaly alert + auto-prep AEFI report.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as cold_chain from "@pharmacare/cold-chain";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
