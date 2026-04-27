# PharmaCare Pro — perf-gate summary

Generated 2026-04-27T08:52:21.506Z.

Aggregates docs/evidence/<area>/perf.json files from the most recent vitest run.

| Area | ADR | Gate | p50 (ms) | p95 (ms) | Budget (ms) | Status |
|---|---|---|---:|---:|---:|---|
| a10 | 0015 | 100-bill GSTR-1 generate p95 <2000ms | 0.51 | 2.13 | 2000 | OK |
| a2 | — | (no gate label) | — | — | — | info |
| a3 | A3 | lookupCustomerByPhone | — | — | — | info |
| a4 | A4 | 100-bill golden suite compute (computeLine + computeInvoice) | — | — | — | info |
| a5 | 0009 | (no gate label) | — | — | — | info |
| a6 | 0010 | A6 — 10-line bill save, p95 < 400ms (ADR 0004 row A6) | 0.69 | 1.18 | 400 | OK |
| a8 | 0021 | 5-line partial refund: compute + save p95 <300ms | 0.01 | 0.01 | 300 | OK |
| a9 | 0014 | Invoice/credit-note HTML render p95 <50ms | 0.05 | 0.13 | 200 | OK |

## Runner

- node v22.22.0 on linux/x64
- cpu: 12th Gen Intel(R) Core(TM) i3-12100 (? cores)

*Reference-hardware floor (i3-8100/4GB/HDD) is the playbook §10 target. CI runs typically clear gates by ~10×; this report is for regression detection.*
