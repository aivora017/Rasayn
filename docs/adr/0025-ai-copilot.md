# ADR 0025 — AI Copilot (text-to-SQL via Cube.dev semantic layer)

> **STATUS: DRAFT** (2026-04-27)
>
> Scoping ADR for the third AI-stack tier per playbook §8.1: frontier-LLM
> Copilot for owners. Implementation deferred; this doc locks the safety
> boundary, the Cube.dev semantic layer choice, the prompt + tool surface,
> and the cost / latency budget.

**Status:** DRAFT
**Date:** 2026-04-27
**Supersedes:** —
**Superseded by:** —
**Relates to:**
- Playbook v2.0 §3 (X-features), §8.1 (locked tech: 3-tier AI = edge / cloud-small / frontier-LLM with Cube.dev semantic layer for text-to-SQL)
- ADR 0010 / 0011 / 0015 (the underlying schemas the Copilot reads)
- ADR 0024 (X3 photo-grn — same Anthropic API key + cost-cap accounting)
- DPDP Act 2023 (consent + cross-border transfer guardrails)

---

## Context

### What the Copilot is for

A natural-language Q&A panel inside the desktop app that lets the **owner**
(not the cashier) ask things like:

- "How many strips of Crocin did I sell last month?"
- "Which suppliers are due for payment this week?"
- "Show me the schedule-H sales count for Sunita."
- "Did anyone return Dolo this month?"
- "Top 10 fastest-moving SKUs for last 90 days."

The owner gets back a one-paragraph answer plus a small data table or chart.
Always with a "show me the SQL" link so the owner can see exactly what was
queried.

### Why not just slap an LLM on top of the SQLite file

Direct text-to-SQL on a raw schema fails three ways:

1. **Joins are wrong half the time** even on simple questions, because the
   LLM doesn't know the foreign-key directions or the soft-delete columns
   (e.g. it joins through `bills.is_voided` without filtering).
2. **No business definitions.** "MRR" is `SUM(grand_total_paise) WHERE
   billed_at IN this_month - voids - returns + reversals` — that calculation
   lives in the owner's head, not the schema. The LLM can't infer it.
3. **No safety rails.** Ungated text-to-SQL means a prompt-injection can
   ask the model to `DELETE FROM bills`. We must run the LLM-generated SQL
   only against a **read-only**, **schema-restricted** semantic layer, never
   the live DB.

### Why Cube.dev

Cube.dev is the semantic-layer-of-choice for this category. Specifically:

- **YAML-based metric / dimension definitions** (≈ "MRR is sum(...) where...")
  that the LLM consumes as context. This is the single biggest win.
- **Read-only by design** — Cube generates SELECT-only SQL against a
  view-layer, not the source DB. SQL injection or DROP is structurally
  impossible.
- **Caching** — Cube pre-aggregates common rollups. 80% of owner questions
  hit cache in <100ms.
- **Permission scoping** — per-shop row filters via Cube's security context.
  Multi-store owners can't accidentally query another shop.
- Open-source core + commercial Cloud option — fits our LAN-first /
  cloud-optional principle (we'd run Cube embedded on the owner laptop in
  Phase 1; cloud-Cube for multi-store in Phase 2).

### What "Copilot" means here, concretely

Same shape as Claude Code's tool-loop, but bounded:
1. Owner types a question.
2. Frontend POSTs to a `/copilot/ask` endpoint on the cloud-services
   microservice.
3. Microservice fetches the Cube YAML schema for this shop and the last 5
   chat messages, builds a prompt for Claude 3.5 Sonnet.
4. Claude responds with **a Cube query** (not raw SQL). E.g. `{measures:
   [bills.count], filters: [{member: bills.billed_at, operator: 'inDateRange',
   values: ['2026-03-01', '2026-03-31']}]}`.
5. Microservice executes the Cube query → JSON rows.
6. Microservice sends rows back to Claude for narration ("In March you sold
   485 bills totalling ₹4,82,310...").
7. Frontend renders the narration + an inline data table.

Two LLM calls per question (planner + narrator). Total budget: 4-8s, ~₹3
per question.

---

## Decision

### 1. Locked stack
- **Frontier model:** Anthropic Claude 3.5 Sonnet (haiku for narration to
  cut cost). Same API key as ADR 0024 X3 Tier-C; shared cost cap.
- **Semantic layer:** Cube.dev OSS (`cubejs-server-core`), embedded in the
  PharmaCare cloud-services Go microservice via gRPC. Phase 1 hosted; Phase
  2 considers self-hosted-on-shop-laptop for multi-store franchises that
  prefer LAN-only.
- **DB connection:** Cube reads from a per-shop **read-only PostgreSQL
  replica** of the SQLite shop DB, refreshed every 5 minutes by a
  PharmaCare-cloud sync job. We never give Cube live DB access — too many
  ways for hot-path queries to interfere with billing.
- **Frontend:** A new `CopilotPanel.tsx` component with a chat textarea
  + ChatGPT-style streaming response + collapsible "Show SQL / Show Cube
  query" debug pane.

### 2. The bounded tool surface

The planner LLM gets exactly one tool: `execute_cube_query(query: CubeQuery)`.
The Cube query type is a fixed JSON schema. No raw SQL. No file system. No
network. No `eval`. The tool returns rows or a typed error.

If the LLM tries anything else (proposes raw SQL, asks to read a file,
asks for personal info, attempts an off-topic conversation), the wrapper
intercepts and returns the same canned response: "I can answer questions
about your shop's data. What would you like to know?"

### 3. Cube YAML scope (Phase 1)

Initial Cube schema covers the high-frequency owner questions only. Adding
new measures requires an ADR amendment.

```yaml
cubes:
  - name: bills
    sql_table: bills
    measures:
      count: { type: count }
      revenuePaise: { sql: "grand_total_paise", type: sum, filters: [{ sql: "is_voided = 0" }] }
      avgBasketPaise: { sql: "grand_total_paise", type: avg, filters: [{ sql: "is_voided = 0" }] }
    dimensions:
      billedAt: { sql: "billed_at", type: time }
      isVoided: { sql: "is_voided", type: number }
      shopId: { sql: "shop_id", type: string }
  - name: bill_lines
    sql_table: bill_lines
    measures:
      strips_sold: { sql: "qty", type: sum }
      taxableValuePaise: { type: sum, sql: "taxable_value_paise" }
    dimensions:
      productName: { sql: "product_name", type: string }
      hsn: { sql: "hsn", type: string }
      schedule: { sql: "schedule", type: string }
  - name: returns
    sql_table: return_headers
    measures:
      count: { type: count }
      refundPaise: { sql: "refund_total_paise", type: sum }
    dimensions:
      createdAt: { sql: "created_at", type: time }
      returnType: { sql: "return_type", type: string }
  - name: gstr1_periods
    sql: "SELECT period, gstin, status, filed_at FROM gst_returns"
    measures:
      filedCount: { type: count, filters: [{ sql: "status = 'filed'" }] }
    dimensions:
      period: { type: string }
      status: { type: string }
```

Excluded from Phase 1 scope: customers (DPDP — needs separate consent),
prescriptions (Schedule H/H1/X data is sensitive — cashier role MUST NOT
have copilot access to Rx), supplier payments (deferred to A14).

### 4. Safety boundary

| Concern | Guardrail |
|---|---|
| Prompt injection asks for raw SQL / file read | LLM only has `execute_cube_query` tool. Wrapper rejects anything else. |
| LLM hallucinates a measure that doesn't exist | Cube validates the query against the YAML schema, returns 400 → LLM gets the error and retries with valid measures. |
| Owner asks about another shop's data | Cube security context filters `shop_id` to caller's session. Multi-store owners scope on UI side. |
| Owner asks for PII (e.g. "give me Sunita Sharma's prescription history") | Customers + prescriptions cubes are excluded from Phase 1 schema. LLM responds: "Customer-specific queries aren't supported in v1." |
| Cost runaway | Same Anthropic cost cap as X3 (per-shop monthly ceiling, default ₹50k). Copilot calls deduct from the same pool. |
| Latency runaway | Hard 12s timeout end-to-end. Above 12s the user sees "I'm taking too long, please refine your question." |

### 5. UX

Single CopilotPanel component, accessible via Ctrl+K from anywhere in the
app (matches the F-key shortcut convention but uses Ctrl since F is taken
across all screens already). Modal overlay; chat textarea at the bottom,
streaming response above, "Show SQL / Show Cube query / Show timing" debug
chevron at the bottom.

Owner-only role gating: if `currentUser.role !== "owner"`, Ctrl+K shows a
banner "Copilot is owner-only" and closes. The cashier role explicitly
cannot trigger any Cube query.

### 6. Cost + budget

- Planner call: ~700 input tokens (Cube schema + 5 chat history) + ~150
  output tokens (Cube query JSON) = ~₹1.50 per question on Sonnet.
- Narrator call: ~1500 input tokens (Cube rows + chat history) + ~200
  output tokens = ~₹0.80 on Haiku.
- Total: ~₹2.30 per question. Owner asking 50/day = ₹3,500/month.
- Cost cap shared with ADR 0024 X3 (default ₹50k/month per shop).

### 7. LAN-first / DPDP

- Cube + LLM both require network connectivity. Per playbook §6
  (PII/Rx never leaves shop LAN without explicit per-feature opt-in),
  Copilot is opt-in at install: a separate consent toggle from X1 / X3.
- When opt-out: Ctrl+K shows "Copilot disabled — opt in via Settings".
- DPDP DPO (Sourav) signs off on prompt + response logging to Grafana
  Cloud (queries are not PII per Phase-1 cube scope — bills, lines,
  returns are aggregate; no customer/Rx).

---

## Migration / data model

No SQLite schema migration. The Postgres replica DDL lives in the Go
microservice's migration tree (out-of-scope for this monorepo).

A new `copilot_chats` table on the Postgres side captures every
`(shop_id, user_id, question, cube_query, rows_returned, narration,
latency_ms, cost_paise, timestamp)` for cost / latency / drift monitoring.

---

## Alternatives considered

1. **Direct text-to-SQL on SQLite.** Rejected — joins/business-definition
   accuracy too low; safety boundary impossible (read-only PRAGMA can be
   bypassed by an injection that prefixes `PRAGMA query_only=OFF`).
2. **Embed a smaller open model on-shop (Llama-3.1-8B).** Rejected for
   Phase 1 — accuracy gap on text-to-Cube too wide for owner trust.
   Reconsider for Phase 3 when cost or LAN-only mandate matters more.
3. **Pre-built dashboards instead of NL Copilot.** Considered — we DO ship
   ReportsScreen with day-book / GSTR-1 / top-movers. Copilot complements
   for "questions we didn't think to dashboard."
4. **Frontier model owned by us (no Anthropic dep).** Rejected for cost +
   maintenance reasons; revisit if Anthropic pricing changes materially.

---

## Consequences

### Positive
- Sub-pilot owners get an answer-by-asking surface, not just a
  fixed-dashboard menu.
- Marg / BUSY can't replicate without 6-12 months of work — Cube semantic
  layer + per-shop fine-tune is sticky moat.
- Cost predictable: hard-capped per shop, per month.

### Negative
- Network-dependent. Owners on slow links get >12s timeouts.
- Adds an external Anthropic dependency to the X-feature set (already
  there for X3).
- Cube schema authoring is the long pole — every new measure needs
  testing + ADR amendment.

---

## Test strategy

1. **Cube schema validation** — JSON-schema check that every measure /
   dimension reference in the YAML resolves against the live Postgres
   replica DDL.
2. **Planner LLM eval set** — 50 owner questions, hand-labelled with the
   expected Cube query. Hit ≥85% exact match for v1 ship.
3. **Narrator LLM eval set** — 50 row-set→narration pairs. Score on
   factual accuracy (does the narration cite the right number).
4. **Safety eval** — 30 prompt-injection attempts. 100% must be rejected
   by the wrapper, never reach the planner LLM.
5. **Cost cap test** — assert that Copilot calls fail closed when the
   per-shop monthly Anthropic budget is exceeded.
6. **DPDP consent test** — a copilot call from a shop without consent
   returns the canned opt-in banner without invoking the LLM.

---

## Build phases

| Phase | Scope | Effort |
|---|---|---|
| **Phase 1** (this ADR) | ADR draft only. THIS COMMIT. | ~1 session |
| **Phase 2** | Postgres replica sync job + initial Cube YAML | ~2 sessions |
| **Phase 3** | Cloud-services /copilot/ask endpoint + tool wrapper | ~2 sessions |
| **Phase 4** | CopilotPanel.tsx + Ctrl+K wiring + role gate | ~1 session |
| **Phase 5** | Eval harness + 50-question gold set | ~2 sessions |

Phases 2-5 require X1 cloud bridge online + Anthropic billing set up.
Total: ~8 sessions. Land post-pilot Day-1 + post-X3.

---

## Open questions (resolve before Phase 2)

1. **Cube hosting** — embedded Go (cubejs-go binding) or separate Node
   sidecar? Embedded is simpler ops, Node is cleaner ecosystem fit.
2. **Cost-cap scope** — separate Copilot vs X3 caps, or shared? Shared is
   simpler accounting; separate is fairer if one feature dominates.
3. **Streaming response** — Server-Sent Events vs websocket? SSE simpler
   for Tauri webview.
4. **Multi-shop owner UX** — shop-picker in Copilot panel, or inferred
   from the active shop in BillingScreen? Latter cleaner.
