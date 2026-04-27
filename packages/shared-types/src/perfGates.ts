/**
 * Centralised perf gates — Playbook v2.0 §10 GA SLO targets.
 *
 * Every `*.perf.test.ts` should import its threshold from here so a single
 * source of truth tracks reference-hardware budgets. Numbers come from the
 * playbook's perf budget on i3-8100 / 4GB / HDD (the pilot floor), then
 * margin-adjusted for the CI runner (~10× faster) so wall-clock regressions
 * surface long before hardware does.
 */

export interface PerfGate {
  readonly slo: string;
  readonly p95Ms: number;
  /** Doc reference for traceability — ADR or playbook section. */
  readonly source: string;
}

/** Bill compute + save (A6 / ADR 0010). 10-line bill on reference hw. */
export const PERF_GATE_BILL_SAVE: PerfGate = {
  slo: "10-line bill: compute + save p95 <400ms (i3-8100/4GB/HDD)",
  p95Ms: 400,
  source: "playbook v2.0 §10 + ADR 0004 row A6",
};

/** Partial-refund pro-rata math (A8 step 3 / ADR 0021). */
export const PERF_GATE_PARTIAL_REFUND: PerfGate = {
  slo: "5-line partial refund: compute + save p95 <300ms",
  p95Ms: 300,
  source: "ADR 0021 §3 (extrapolated from A6 budget; partial < full)",
};

/** GSTR-1 monthly generate (A10 / ADR 0015) — pure-TS, runs on owner laptop. */
export const PERF_GATE_GSTR1_GENERATE: PerfGate = {
  slo: "100-bill GSTR-1 generate p95 <2000ms",
  p95Ms: 2000,
  source: "playbook v2.0 §10",
};

/** Credit-note + invoice HTML render (A9 / ADR 0014). */
export const PERF_GATE_INVOICE_RENDER: PerfGate = {
  slo: "Invoice/credit-note HTML render p95 <50ms",
  p95Ms: 50,
  source: "playbook v2.0 §0 (sub-2s keyboard path budget)",
};

/** Product FTS search (A1 / ADR 0006). */
export const PERF_GATE_PRODUCT_SEARCH: PerfGate = {
  slo: "FTS5 search across 5k SKUs p95 <100ms",
  p95Ms: 100,
  source: "playbook v2.0 §10",
};

/** Directory search (A3 / ADR 0011). */
export const PERF_GATE_DIRECTORY_SEARCH: PerfGate = {
  slo: "Customer/doctor LIKE search across 50k rows p95 <150ms",
  p95Ms: 150,
  source: "playbook v2.0 §10",
};

/** GST engine math (line-level computation). */
export const PERF_GATE_GST_ENGINE: PerfGate = {
  slo: "10-line GST compute p95 <5ms",
  p95Ms: 5,
  source: "ADR 0004 row A6",
};

/** Batch FEFO query (A2 / ADR 0007). */
export const PERF_GATE_BATCH_FEFO: PerfGate = {
  slo: "FEFO pick across 200 batches p95 <50ms",
  p95Ms: 50,
  source: "playbook v2.0 §10",
};
