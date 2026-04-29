# @pharmacare/demand-forecast

Per-SKU demand forecasting via Prophet + LSTM hybrid. Retrained nightly per shop. Outputs reorder-point + safety-stock + auto-PO draft.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as demand_forecast from "@pharmacare/demand-forecast";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
