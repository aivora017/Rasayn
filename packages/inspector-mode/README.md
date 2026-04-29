# @pharmacare/inspector-mode

FDA / Drug Inspector single-tap report. Pulls Schedule H/H1/X register + IRN reconciliation + expired-stock disposal + NPPA-cap compliance into a printable bundle.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as inspector_mode from "@pharmacare/inspector-mode";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
