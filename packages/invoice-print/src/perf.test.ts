// A9 perf gate — invoice + credit-note HTML render throughput.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PERF_GATE_INVOICE_RENDER } from "@pharmacare/shared-types";
import { renderInvoiceHtml, renderCreditNoteHtml } from "./index.js";
import { makeBill, makeCreditNote } from "./fixtures.js";

const N_ITER = 200;

function quantile(s: readonly number[], q: number): number {
  if (s.length === 0) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (1 - (pos - lo)) + s[hi]! * (pos - lo);
}

describe("invoice-print · A9 perf — HTML render", () => {
  it(`thermal+a5 invoice + credit note render p95 < ${PERF_GATE_INVOICE_RENDER.p95Ms}ms`, () => {
    const bill = makeBill();
    const cn = makeCreditNote();
    const samples: number[] = [];
    for (let it = 0; it < N_ITER; it++) {
      const t0 = performance.now();
      renderInvoiceHtml({ bill });
      renderInvoiceHtml({ bill, layout: "a5_gst" });
      renderCreditNoteHtml({ creditNote: cn });
      renderCreditNoteHtml({ creditNote: cn, layout: "a5_gst" });
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
    // Multiplied by 4 because we do 4 renders per iteration.
    expect(stats.p95).toBeLessThan(PERF_GATE_INVOICE_RENDER.p95Ms * 4);

    const outDir = path.resolve(__dirname, "../../../docs/evidence/a9");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "perf.json"),
      JSON.stringify({
        adr: "0014",
        gate: PERF_GATE_INVOICE_RENDER.slo,
        source: PERF_GATE_INVOICE_RENDER.source,
        timestamp: new Date().toISOString(),
        runner: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus()?.[0]?.model ?? "unknown" },
        params: { iterations: N_ITER, rendersPerIter: 4 },
        gateMs: PERF_GATE_INVOICE_RENDER.p95Ms * 4,
        statsMs: stats,
      }, null, 2),
    );
  });
});
