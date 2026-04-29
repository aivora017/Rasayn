# @pharmacare/khata

Customer credit ledger: limit, aging buckets (0-30/30-60/60-90/90+), dunning schedule, payment recording, default-risk score.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as khata from "@pharmacare/khata";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
