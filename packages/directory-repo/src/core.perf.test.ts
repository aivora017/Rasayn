// Perf gate for A3 (ADR 0004 row A3):
//   * lookupCustomerByPhone p95 <10 ms on 10 000 customer rows.
//
// Seeds 10 000 synthetic customers across 2 shops (random Indian mobile
// numbers, 100 of them deterministic "known hits" for the query set) and
// measures `lookupCustomerByPhone()` p95 over 1000 iterations — 500 hits +
// 500 misses so we stress both index branches.
//
// Writes a JSON report to docs/evidence/a3/perf.json (picked up later by
// A15's aggregator).

import { describe, it, expect } from "vitest";
import { openDb, runMigrations } from "@pharmacare/shared-db";
import { ensureWalkInCustomer, lookupCustomerByPhone, upsertCustomer, normalizePhone } from "./index.js";
import * as fs from "node:fs";
import * as path from "node:path";

const N_CUSTOMERS = 10_000;
const ITER = 1000;
const P95_GATE_MS = 10;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

// Deterministic PRNG for reproducible seeding.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPhone(rng: () => number): string {
  // India mobile: leading digit 6–9, 10 digits total.
  const first = 6 + Math.floor(rng() * 4);
  let rest = "";
  for (let i = 0; i < 9; i++) rest += Math.floor(rng() * 10).toString();
  return `${first}${rest}`;
}

describe("directory-repo · perf — lookupCustomerByPhone on 10k rows", () => {
  it("p95 <10ms across 500 hits + 500 misses", () => {
    const db = openDb({ path: ":memory:" });
    runMigrations(db);
    db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
                VALUES ('shop1','Vaidyanath','27ABCDE1234F1Z5','27','MH-KLN-123','Kalyan')`).run();
    db.prepare(`INSERT INTO shops (id,name,gstin,state_code,retail_license,address)
                VALUES ('shop2','Other','27ABCDE1234F2Z4','27','L2','Thane')`).run();
    ensureWalkInCustomer(db, "shop1");
    ensureWalkInCustomer(db, "shop2");

    // ---- seed 10 000 customers ------------------------------------------------
    const rng = mulberry32(0xA3C007);
    const knownPhones: string[] = [];
    const seen = new Set<string>();
    const stmt = db.prepare(`
      INSERT INTO customers (id, shop_id, name, phone)
      VALUES (?, ?, ?, ?)
    `);
    const t0 = performance.now();
    db.transaction(() => {
      for (let i = 0; i < N_CUSTOMERS; i++) {
        let p = randomPhone(rng);
        while (seen.has(p)) p = randomPhone(rng);
        seen.add(p);
        // 80% shop1, 20% shop2 — realistic single-location skew
        const shop = rng() < 0.8 ? "shop1" : "shop2";
        const id = `cus_seed_${i.toString().padStart(5, "0")}`;
        const name = `Cust${i}`;
        stmt.run(id, shop, name, p);
        if (knownPhones.length < 500 && shop === "shop1") knownPhones.push(p);
      }
    })();
    const seedMs = performance.now() - t0;

    // sanity: index should be used and populated
    const cntIndexed = db.prepare(
      "SELECT COUNT(*) AS c FROM customers WHERE shop_id='shop1' AND phone_norm IS NOT NULL"
    ).get() as any;
    expect(cntIndexed.c).toBeGreaterThanOrEqual(7000);

    // ---- measurement ----------------------------------------------------------
    const missPhones: string[] = [];
    while (missPhones.length < 500) {
      const p = randomPhone(rng);
      if (!seen.has(p)) missPhones.push(p);
    }

    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const p = knownPhones[i]!;
      const t = performance.now();
      const hit = lookupCustomerByPhone(db, "shop1", p);
      samples.push(performance.now() - t);
      expect(hit).not.toBeNull();
      expect(hit?.phoneNorm).toBe(normalizePhone(p));
    }
    for (let i = 0; i < 500; i++) {
      const p = missPhones[i]!;
      const t = performance.now();
      const miss = lookupCustomerByPhone(db, "shop1", p);
      samples.push(performance.now() - t);
      expect(miss).toBeNull();
    }

    samples.sort((a, b) => a - b);
    const p50 = quantile(samples, 0.5);
    const p95 = quantile(samples, 0.95);
    const p99 = quantile(samples, 0.99);

    const report = {
      branch: "A3",
      package: "@pharmacare/directory-repo",
      probe: "lookupCustomerByPhone",
      rows: N_CUSTOMERS,
      iterations: ITER,
      hits: 500,
      misses: 500,
      p50_ms: +p50.toFixed(3),
      p95_ms: +p95.toFixed(3),
      p99_ms: +p99.toFixed(3),
      gate_ms: P95_GATE_MS,
      seed_ms: +seedMs.toFixed(0),
      timestamp: new Date().toISOString(),
    };

    const outDir = path.resolve(__dirname, "../../../docs/evidence/a3");
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "perf.json"), JSON.stringify(report, null, 2) + "\n");
    } catch {
      // CI may restrict writes; report still asserts on stdout via expect
    }

    // eslint-disable-next-line no-console
    console.log(`A3 perf: p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms (gate ${P95_GATE_MS}ms)`);
    expect(p95).toBeLessThan(P95_GATE_MS);

    db.close();
  }, 60_000);
});
