# @pharmacare/printer-escpos

Thermal printer ESC/POS driver. TVS RP-3230, Zebra GX420Rx, Epson TM-T81 auto-detect. Cash-drawer pulse via DK pulse. GS1 DataMatrix decoder. Dot-matrix Schedule-X register.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as printer_escpos from "@pharmacare/printer-escpos";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
