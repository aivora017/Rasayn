// A4 perf probe — 100-bill golden suite throughput.
// Gate: full suite (100 bills × N lines) computed in <200 ms wall time.
// Equivalent real-world: a GSTR-1 monthly reconciliation scanning 1–2k
// bills on Win7/4GB/HDD, where we want sub-second interactive feedback.

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeLine, computeInvoice, type LineInput, type LineTax, type InvoiceTotals } from "./index.js";

interface GoldenBill {
  id: string;
  treatment: "intra_state" | "inter_state" | "exempt" | "nil_rated";
  lines: LineInput[];
  expectedLines: LineTax[];
  expectedInvoice: InvoiceTotals;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "golden-bills.json");
const doc = JSON.parse(readFileSync(fixturePath, "utf8")) as { bills: GoldenBill[] };

// Gate: compute the full 100-bill suite 100 times in <200ms per run.
// p95 across 100 runs must hold.
const RUNS = 100;
const GATE_MS = 200;

describe("gst-engine perf", () => {
  it(`100-bill suite compute p95 <${GATE_MS}ms on ${RUNS} runs`, () => {
    const timings: number[] = [];
    // Warm-up
    for (let w = 0; w < 5; w++) {
      for (const b of doc.bills) {
        const lines = b.lines.map((l) => computeLine(l, b.treatment));
        computeInvoice(lines);
      }
    }
    // Timed runs
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      for (const b of doc.bills) {
        const lines = b.lines.map((l) => computeLine(l, b.treatment));
        computeInvoice(lines);
      }
      timings.push(performance.now() - t0);
    }
    timings.sort((a, b) => a - b);
    const p50 = timings[Math.floor(RUNS * 0.50)]!;
    const p95 = timings[Math.floor(RUNS * 0.95)]!;
    const p99 = timings[Math.floor(RUNS * 0.99)]!;
    const total = timings.reduce((a, b) => a + b, 0);

    // Count total line computations for context
    const totalLines = doc.bills.reduce((acc, b) => acc + b.lines.length, 0);

    const report = {
      branch: "A4",
      package: "@pharmacare/gst-engine",
      probe: "100-bill golden suite compute (computeLine + computeInvoice)",
      bills: doc.bills.length,
      total_lines_per_run: totalLines,
      runs: RUNS,
      p50_ms: +p50.toFixed(3),
      p95_ms: +p95.toFixed(3),
      p99_ms: +p99.toFixed(3),
      mean_ms: +(total / RUNS).toFixed(3),
      gate_ms: GATE_MS,
      timestamp: new Date().toISOString(),
    };
    const repoRoot = join(here, "..", "..", "..");
    const evDir = join(repoRoot, "docs", "evidence", "a4");
    if (!existsSync(evDir)) mkdirSync(evDir, { recursive: true });
    writeFileSync(join(evDir, "perf.json"), JSON.stringify(report, null, 2) + "\n");
    // eslint-disable-next-line no-console
    console.log(
      `A4 perf: p50=${report.p50_ms}ms p95=${report.p95_ms}ms p99=${report.p99_ms}ms ` +
      `(${doc.bills.length} bills, ${totalLines} lines, gate ${GATE_MS}ms)`,
    );
    expect(p95).toBeLessThan(GATE_MS);
  }, 30_000);
});
