# @pharmacare/plugin-sdk

Open Pharmacy Plugin SDK. Third-party developers ship plugins (clinic, lab, insurance, regional compliance). Sandbox via WASM modules with capability-based permissions.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as plugin_sdk from "@pharmacare/plugin-sdk";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
