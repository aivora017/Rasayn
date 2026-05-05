// Perf gate for A6 (ADR 0004 row A6):
//   "10-line bill computed and saved in p95 <400 ms on reference hardware
//    (i3-8100/4 GB/HDD)."
//
// Seeds 10 products × 10 batches (100 batches, plenty of headroom for FEFO
// auto-pick) and measures the end-to-end saveBill() call for a 10-line bill
// across N iterations. Records mean/p50/p95/p99/max + runner metadata into
// docs/evidence/a6/perf.json so A15's perf aggregator picks it up.
//
// CI (Linux / SSD) will clear the 400 ms gate by 10×+; the gate fires only in
// the reference-hardware regression VM (A15). The purpose of running it on
// every CI is to detect wall-clock regressions (e.g. an accidental O(n²)
// compute, a missing index, a sync fs call) long before pilot hardware sees
// them.

import { describe, it, expect } from "vitest";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { rupeesToPaise, type Paise } from "@pharmacare/shared-types";
import { saveBill } from "./index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const N_ITER = 100;
const LINES_PER_BILL = 10;
const P95_GATE_MS = 400;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

describe("bill-repo · perf — 10-line bill save", () => {
  it(`saveBill p95 < ${P95_GATE_MS}ms over ${N_ITER} iterations`, () => {
    const db = openDb({ path: ":memory:" });
    runMigrations(db);

    db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
                VALUES ('shop1','Vaidyanath','27ABCDE1234F1Z5','27','MH-KLN-123','Kalyan')`).run();
    db.prepare(`INSERT INTO users (id,shop_id,name,role,pin_hash)
                VALUES ('u1','shop1','Sourav','owner','x')`).run();
    db.prepare(`INSERT INTO suppliers (id,shop_id,name) VALUES ('sup1','shop1','Cipla')`).run();

    // 10 products × 10 batches. Products rotate through GST rates and an
    // NPPA cap on half so the validate-line path hits both branches.
    const insProd = db.prepare(`INSERT INTO products
      (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise,nppa_max_mrp_paise)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const insBatch = db.prepare(`INSERT INTO batches
      (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,purchase_price_paise,mrp_paise,supplier_id)
      VALUES (?,?,?,?,?,?,?,?,?)`);

    db.transaction(() => {
      const gstRates = [0, 5, 12, 18, 28];
      for (let p = 0; p < 10; p++) {
        const rate = gstRates[p % gstRates.length]!;
        const hasCap = p % 2 === 0;
        insProd.run(
          `p_${p.toString().padStart(2, "0")}`,
          `Product ${p}`, "GSK", "3004", rate,
          "OTC", "tablet", 10, 10000,
          hasCap ? 12000 : null,
        );
        for (let b = 0; b < 10; b++) {
          insBatch.run(
            `b_${p}_${b}`,
            `p_${p.toString().padStart(2, "0")}`,
            `BN${p}${b}`,
            "2026-01-01",
            "2028-12-31",
            1000,         // deep stock so N_ITER × 10 lines × 1 qty never depletes
            7000, 10000, "sup1",
          );
        }
      }
    })();

    // Warm-up — JIT + statement prep. Not counted.
    for (let w = 0; w < 5; w++) {
      saveBill(db, `warm_${w}`, {
        shopId: "shop1", billNo: `W-${w}`, cashierId: "u1",
        customerId: null, doctorId: null, rxId: null,
        paymentMode: "cash", customerStateCode: null,
        lines: Array.from({ length: LINES_PER_BILL }, (_, i) => ({
          productId: `p_${(i % 10).toString().padStart(2, "0")}`,
          batchId: null,
          mrpPaise: rupeesToPaise(100) as Paise,
          qty: 1,
          gstRate: [0, 5, 12, 18, 28][(i % 10) % 5]!,
        })),
      });
    }

    const samples: number[] = [];
    for (let it = 0; it < N_ITER; it++) {
      const t0 = performance.now();
      saveBill(db, `bill_${it}`, {
        shopId: "shop1", billNo: `INV-${it.toString().padStart(4, "0")}`, cashierId: "u1",
        customerId: null, doctorId: null, rxId: null,
        paymentMode: "cash", customerStateCode: null,
        lines: Array.from({ length: LINES_PER_BILL }, (_, i) => ({
          productId: `p_${(i % 10).toString().padStart(2, "0")}`,
          batchId: null,
          mrpPaise: rupeesToPaise(100) as Paise,
          qty: 1,
          gstRate: [0, 5, 12, 18, 28][(i % 10) % 5]!,
        })),
      });
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

    // Gate.
    expect(stats.p95).toBeLessThan(P95_GATE_MS);

    // Write evidence.
    const outDir = path.resolve(__dirname, "../../../docs/evidence/a6");
    fs.mkdirSync(outDir, { recursive: true });
    const report = {
      adr: "0010",
      gate: "A6 — 10-line bill save, p95 < 400ms (ADR 0004 row A6)",
      timestamp: new Date().toISOString(),
      runner: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus()?.[0]?.model ?? "unknown",
        cpuCount: os.cpus()?.length ?? 0,
        totalMemGB: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
      },
      params: { iterations: N_ITER, linesPerBill: LINES_PER_BILL, warmup: 5 },
      gateMs: P95_GATE_MS,
      statsMs: stats,
      notes: [
        "Gate is authoritative on i3-8100 / 4 GB / HDD / Windows 7 (A15 regression VM).",
        "CI (Linux / SSD / modern CPU) typically clears by 10×+. Watch the trend, not the absolute.",
        "FEFO auto-pick enabled on every line (batchId: null).",
        "In-memory SQLite ⇒ no HDD fsync cost. A15 re-captures on HDD VM.",
      ],
    };
    fs.writeFileSync(path.join(outDir, "perf.json"), JSON.stringify(report, null, 2) + "\n");
  }, 60_000);
});
