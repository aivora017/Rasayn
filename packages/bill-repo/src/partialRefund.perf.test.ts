// A8 step 3 perf gate — pro-rata math throughput.
//
// Single-iteration micro-benchmark: 5-line return, 200 iterations, p95
// must clear PERF_GATE_PARTIAL_REFUND.p95Ms (300ms reference floor).
// On CI/SSD the actual p95 is typically <2ms — gate fires only when an
// O(n^2) regression slips into the math.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { paise, PERF_GATE_PARTIAL_REFUND, type Paise } from "@pharmacare/shared-types";
import { computeLineProRata, computeTenderReversal } from "./partialRefund.js";

const N_ITER = 200;
const LINES_PER_RETURN = 5;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (1 - (pos - lo)) + sorted[hi]! * (pos - lo);
}

describe("bill-repo · A8 perf — partial-refund math", () => {
  it(`5-line refund p95 < ${PERF_GATE_PARTIAL_REFUND.p95Ms}ms over ${N_ITER} iterations`, () => {
    const samples: number[] = [];
    for (let it = 0; it < N_ITER; it++) {
      const t0 = performance.now();
      // Simulate a 5-line refund: pro-rata each, then tender-reverse the sum.
      const lineRefunds = Array.from({ length: LINES_PER_RETURN }, (_, i) =>
        computeLineProRata(
          {
            qty: 10,
            taxableValuePaise: paise(1000 + i * 100) as Paise,
            discountPaise: paise(50) as Paise,
            cgstPaise: paise(60) as Paise,
            sgstPaise: paise(60) as Paise,
            igstPaise: paise(0) as Paise,
            cessPaise: paise(0) as Paise,
            lineTotalPaise: paise(1170 + i * 100) as Paise,
          },
          1,
        ),
      );
      const refundTotal = lineRefunds.reduce((s, l) => s + l.refundAmountPaise, 0);
      computeTenderReversal(
        [
          { mode: "cash", amountPaise: paise(10_000) as Paise },
          { mode: "upi", amountPaise: paise(5_000) as Paise },
        ],
        paise(refundTotal) as Paise,
      );
      samples.push(performance.now() - t0);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const stats = {
      count: samples.length,
      mean: samples.reduce((a, b) => a + b, 0) / samples.length,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      max: sorted[sorted.length - 1]!,
    };
    expect(stats.p95).toBeLessThan(PERF_GATE_PARTIAL_REFUND.p95Ms);

    const outDir = path.resolve(__dirname, "../../../docs/evidence/a8");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "perf.json"),
      JSON.stringify(
        {
          adr: "0021",
          gate: PERF_GATE_PARTIAL_REFUND.slo,
          source: PERF_GATE_PARTIAL_REFUND.source,
          timestamp: new Date().toISOString(),
          runner: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpus: os.cpus()?.[0]?.model ?? "unknown",
            cpuCount: os.cpus()?.length ?? 0,
          },
          params: { iterations: N_ITER, linesPerReturn: LINES_PER_RETURN },
          gateMs: PERF_GATE_PARTIAL_REFUND.p95Ms,
          statsMs: stats,
        },
        null,
        2,
      ),
    );
  });
});
