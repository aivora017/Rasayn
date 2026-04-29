# @pharmacare/ai-copilot

AI Copilot — natural-language reports + counseling drafts + HSN classifier + Inspector Mode + DPDP DSR responder. Uses LiteLLM gateway with Opus 4.7 primary, Sonnet 4.6 fallback, Cube.dev semantic layer for text-to-SQL.

## Status
**SCAFFOLD** — types + signatures locked, implementations all `throw new Error("TODO(...)")`. See `_research_brain/99_forward_plan/MASTER_PLAN_v3_2026-04-28.docx` and the relevant ADR for build sequence.

## Quick start
```ts
import * as ai_copilot from "@pharmacare/ai-copilot";
```

## Interface
See `src/index.ts` — all exported types and function signatures are stable; bodies will land per sprint.
