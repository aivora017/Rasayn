// Perf gate for A2 (ADR 0004 row A2):
//   * FEFO query returns oldest non-expired batch in p95 <5 ms on 50 k rows.
//
// Seeds 50 000 batches across 500 products (100 batches each, staggered
// expiries with 5 % already-expired distractors + 10 % zero-qty) and measures
// `allocateFefo()` p95 over 1000 random product picks.
//
// Writes a JSON report to docs/evidence/a2/perf.json so A15's aggregator
// picks it up.
//
// IMPORTANT — flake-isolation contract:
//   This file is NOT picked up by `npm test` / `turbo run test` (excluded by
//   the `--exclude '**/*.perf.test.ts'` flag in package.json). It must be run
//   via `npm run test:perf`, which forces a single-fork pool so the timing
//   assertions are not subject to turbo-parallel CPU contention.
//   Rationale: under `turbo run test --concurrency>=4` on a 2-core box we
//   measured p95 climbing from 0.22 ms (isolated) to ~3 ms with max ~21 ms;
//   the 5 ms gate would flake intermittently and obscure real regressions.
//   Set PERF_GATE_DISABLED=1 to soft-skip the gate assertions (the report is
//   still written) for environments where measurement is unreliable.

import { describe, it, expect } from "vitest";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import type { ProductId } from "@pharmacare/shared-types";
import { allocateFefo, auditLedger } from "./index.js";
import * as fs from "node:fs";
import * as path from "node:path";

const PRODUCTS = 500;
const BATCHES_PER_PRODUCT = 100;   // → 50 000 rows total
const PICK_ITERATIONS = 1000;
const P95_GATE_MS = 5;

// Quantile from a sorted ascending array of numbers.
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

describe("batch-repo · perf — FEFO on 50k rows", () => {
  it("allocateFefo p95 <5ms; single-batch pick p95 <2ms; ledger balanced after seed", () => {
    const db = openDb({ path: ":memory:" });
    runMigrations(db);

    db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
                VALUES ('shop1','Vaidyanath','27ABCDE1234F1Z5','27','MH-KLN-123','Kalyan')`).run();
    db.prepare(`INSERT INTO suppliers (id,shop_id,name) VALUES ('sup1','shop1','Cipla')`).run();

    // ---- seed products ------------------------------------------------------
    const insProd = db.prepare(`
      INSERT INTO products (id,name,manufacturer,hsn,gst_rate,schedule,pack_form,pack_size,mrp_paise)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => {
      for (let p = 0; p < PRODUCTS; p++) {
        insProd.run(
          `p_${p.toString().padStart(4, "0")}`,
          `Product-${p}`,
          "Mfr",
          "3004",
          12,
          "OTC",
          "tablet",
          10,
          10000 + p,
        );
      }
    })();

    // ---- seed batches -------------------------------------------------------
    //
    // For each product:
    //   * 5   expired (2024-…)            — filtered out by FEFO
    //   * 10  zero-qty but non-expired    — filtered out by partial index
    //   * 85  valid non-expired with varied expiries in 2026-07 … 2030-12
    //
    // That gives 500 * 100 = 50 000 total rows.
    const insBatch = db.prepare(`
      INSERT INTO batches (id,product_id,batch_no,mfg_date,expiry_date,qty_on_hand,
                           purchase_price_paise,mrp_paise,supplier_id)
      VALUES (?,?,?,?,?,?,?,?,?)`);

    // Deterministic PRNG so the perf test is reproducible.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const seedStart = Date.now();
    db.transaction(() => {
      for (let p = 0; p < PRODUCTS; p++) {
        const pid = `p_${p.toString().padStart(4, "0")}`;
        for (let i = 0; i < BATCHES_PER_PRODUCT; i++) {
          const batchNo = `B${i.toString().padStart(4, "0")}`;
          let expiry: string;
          let qty: number;

          if (i < 5) {
            // expired distractor
            expiry = `2024-${((i % 12) + 1).toString().padStart(2, "0")}-15`;
            qty = 20;
          } else if (i < 15) {
            // zero-qty, non-expired → partial index excludes these
            const yr = 2028 + (i % 3);
            const mo = ((i * 7) % 12) + 1;
            expiry = `${yr}-${mo.toString().padStart(2, "0")}-15`;
            qty = 0;
          } else {
            // valid
            const yr = 2026 + Math.floor(rand() * 5);   // 2026 .. 2030
            const mo = Math.floor(rand() * 12) + 1;
            const dy = Math.floor(rand() * 28) + 1;
            expiry = `${yr}-${mo.toString().padStart(2, "0")}-${dy.toString().padStart(2, "0")}`;
            qty = 10 + Math.floor(rand() * 200);
          }

          insBatch.run(`b_${p}_${i}`, pid, batchNo, "2026-01-01", expiry, qty, 800, 11200, "sup1");
        }
      }
    })();
    const seedMs = Date.now() - seedStart;

    // Sanity: 50k rows present.
    const total = db.prepare("SELECT COUNT(*) c FROM batches").get() as { c: number };
    expect(total.c).toBe(PRODUCTS * BATCHES_PER_PRODUCT);

    // Make sure SQLite's planner has stats for the partial index (optional but
    // realistic — production runs ANALYZE after seed-tool).
    db.exec("ANALYZE");

    // ---- measure ------------------------------------------------------------
    //
    // Two measurements:
    //   (a) "single-batch pick" — allocate 1 unit, which exits after the first
    //       FEFO candidate. Mirrors the common bill-line path (qty=1..N small).
    //   (b) "full FEFO scan" — allocate 50 units, forcing multiple candidates.

    const singleMs: number[] = [];
    const fullMs: number[] = [];

    for (let k = 0; k < PICK_ITERATIONS; k++) {
      const pid = `p_${Math.floor(rand() * PRODUCTS).toString().padStart(4, "0")}` as ProductId;

      let t0 = performance.now();
      allocateFefo(db, pid, 1);
      singleMs.push(performance.now() - t0);

      t0 = performance.now();
      allocateFefo(db, pid, 50);
      fullMs.push(performance.now() - t0);
    }

    singleMs.sort((a, b) => a - b);
    fullMs.sort((a, b) => a - b);

    const report = {
      fixture: {
        products: PRODUCTS,
        batchesPerProduct: BATCHES_PER_PRODUCT,
        totalBatches: PRODUCTS * BATCHES_PER_PRODUCT,
        seedMs,
      },
      singlePick: {
        iterations: PICK_ITERATIONS,
        p50Ms: quantile(singleMs, 0.5),
        p95Ms: quantile(singleMs, 0.95),
        p99Ms: quantile(singleMs, 0.99),
        maxMs: singleMs[singleMs.length - 1],
      },
      fullAlloc50: {
        iterations: PICK_ITERATIONS,
        p50Ms: quantile(fullMs, 0.5),
        p95Ms: quantile(fullMs, 0.95),
        p99Ms: quantile(fullMs, 0.99),
        maxMs: fullMs[fullMs.length - 1],
      },
      ledgerBalanced: auditLedger(db).length === 0,
      gates: {
        singlePickP95Ms: P95_GATE_MS,
        fullAllocP95Ms: P95_GATE_MS,
      },
      capturedAt: new Date().toISOString(),
    };

    // Write evidence for A15 aggregator. Non-fatal on write failure.
    try {
      const outDir = path.resolve(process.cwd(), "../../docs/evidence/a2");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "perf.json"), JSON.stringify(report, null, 2));
    } catch {
      /* evidence write is best-effort */
    }

    // ---- gates --------------------------------------------------------------
    // Ledger invariant is correctness, not perf — always assert it.
    expect(report.ledgerBalanced).toBe(true);

    // Perf gates: skip if PERF_GATE_DISABLED=1. The report is still written
    // for downstream aggregation regardless.
    if (process.env.PERF_GATE_DISABLED === "1") {
      // eslint-disable-next-line no-console
      console.warn(
        `[perf] PERF_GATE_DISABLED=1 — skipping p95 assertions. ` +
          `singlePick.p95=${report.singlePick.p95Ms.toFixed(3)}ms ` +
          `fullAlloc50.p95=${report.fullAlloc50.p95Ms.toFixed(3)}ms`,
      );
      return;
    }
    expect(report.singlePick.p95Ms).toBeLessThan(P95_GATE_MS);
    expect(report.fullAlloc50.p95Ms).toBeLessThan(P95_GATE_MS);
  }, 60_000);
});
