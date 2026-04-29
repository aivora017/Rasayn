# @pharmacare/counterfeit-shield

Counterfeit detection at scan time. (a) GS1 DataMatrix authenticity verify against national registry. (b) Visual CNN match against X2 image library. (c) TamperShield score combining both.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as counterfeit_shield from "@pharmacare/counterfeit-shield";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
