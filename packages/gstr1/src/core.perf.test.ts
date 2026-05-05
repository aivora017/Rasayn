// A8 step 4 + A10 perf gate — generateGstr1 throughput on a 100-bill period.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PERF_GATE_GSTR1_GENERATE } from "@pharmacare/shared-types";
import { generateGstr1 } from "./index.js";
import { makeBill, makeCustomer, makeLine, makeReturn, makeReturnLine, makeShop } from "./fixtures.js";

const N_ITER = 30;
const BILLS_PER_PERIOD = 100;
const RETURNS_PER_PERIOD = 10;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (1 - (pos - lo)) + sorted[hi]! * (pos - lo);
}

describe("gstr1 · A8/A10 perf — generate", () => {
  it(`100-bill generate p95 < ${PERF_GATE_GSTR1_GENERATE.p95Ms}ms over ${N_ITER} iterations`, () => {
    const shop = makeShop();
    const bills = Array.from({ length: BILLS_PER_PERIOD }, (_, i) => {
      const lines = Array.from({ length: 5 }, (_, j) =>
        makeLine({ id: `b-${i}-l-${j}`, gstRate: 12 }),
      );
      return makeBill({
        id: `b-${i}`, billNo: `INV-${(i + 1).toString().padStart(4, "0")}`,
        billedAt: `2026-03-${((i % 28) + 1).toString().padStart(2, "0")}T10:00:00.000Z`,
        customer: i % 5 === 0 ? makeCustomer({ gstin: `27AABCC${i.toString().padStart(4, "0")}B1Z3` }) : makeCustomer(),
        gstTreatment: "intra_state", lines,
      });
    });
    const returns = Array.from({ length: RETURNS_PER_PERIOD }, (_, i) =>
      makeReturn({
        id: `r-${i}`, returnNo: `CN/2025-26/${(i + 1).toString().padStart(4, "0")}`,
        createdAt: `2026-03-${((i % 28) + 1).toString().padStart(2, "0")}T11:00:00.000Z`,
        lines: [makeReturnLine({ refundTaxablePaise: 5000, refundAmountPaise: 5600 })],
      }),
    );

    const samples: number[] = [];
    for (let it = 0; it < N_ITER; it++) {
      const t0 = performance.now();
      generateGstr1({ period: { mm: "03", yyyy: "2026" }, shop, bills, returns });
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
    expect(stats.p95).toBeLessThan(PERF_GATE_GSTR1_GENERATE.p95Ms);

    const outDir = path.resolve(__dirname, "../../../docs/evidence/a10");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "perf.json"),
      JSON.stringify({
        adr: "0015",
        gate: PERF_GATE_GSTR1_GENERATE.slo,
        source: PERF_GATE_GSTR1_GENERATE.source,
        timestamp: new Date().toISOString(),
        runner: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus()?.[0]?.model ?? "unknown" },
        params: { iterations: N_ITER, billsPerPeriod: BILLS_PER_PERIOD, returnsPerPeriod: RETURNS_PER_PERIOD },
        gateMs: PERF_GATE_GSTR1_GENERATE.p95Ms,
        statsMs: stats,
      }, null, 2),
    );
  });
});
