# @pharmacare/cash-shift

Opening shift (denomination wizard) + day close (Z-report, cheque clearing, variance flag). Required for any pharmacy day to begin or end.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as cash_shift from "@pharmacare/cash-shift";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
