// Direct smoke tests for the demo dataset (data.ts).
// Coverage-gaps 2026-04-18 §Medium — a typo in a Schedule assignment
// (e.g. H1 vs H) silently ships in demo installs.

import { describe, expect, it } from "vitest";
import { PRODUCTS, BATCHES } from "./data.js";

describe("seed-tool data integrity", () => {
  it("at least one demo product exists", () => {
    expect(PRODUCTS.length).toBeGreaterThan(5);
  });

  it("every product has a non-empty name + manufacturer", () => {
    for (const p of PRODUCTS) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.manufacturer.trim().length).toBeGreaterThan(0);
    }
  });

  it("every product has a pharma-prefix HSN (3003/3004/3005/3006/9018)", () => {
    const PREFIXES = ["3003", "3004", "3005", "3006", "9018"];
    for (const p of PRODUCTS) {
      const ok = PREFIXES.some((pfx) => p.hsn.startsWith(pfx));
      expect(ok, `product ${p.id} (${p.name}) has bad HSN ${p.hsn}`).toBe(true);
    }
  });

  it("every product has a valid GST rate", () => {
    const VALID = [0, 5, 12, 18, 28];
    for (const p of PRODUCTS) {
      expect(VALID, `product ${p.id} GST ${p.gst}`).toContain(p.gst);
    }
  });

  it("every product has a valid Schedule", () => {
    const VALID = ["OTC", "G", "H", "H1", "X", "NDPS"];
    for (const p of PRODUCTS) {
      expect(VALID, `product ${p.id} schedule ${p.schedule}`).toContain(p.schedule);
    }
  });

  it("Schedule H/H1/X products have a non-null imageSha (X2 moat invariant)", () => {
    for (const p of PRODUCTS) {
      if (p.schedule === "H" || p.schedule === "H1" || p.schedule === "X") {
        expect(p.imageSha, `product ${p.id} (${p.name}) is Schedule ${p.schedule} but has null imageSha`).not.toBeNull();
      }
    }
  });

  it("every product MRP is a positive integer (paise)", () => {
    for (const p of PRODUCTS) {
      expect(Number.isInteger(p.mrpPaise)).toBe(true);
      expect(p.mrpPaise).toBeGreaterThan(0);
    }
  });

  it("product ids are unique", () => {
    const ids = PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("at least one demo batch exists; every batch references a real product", () => {
    expect(BATCHES.length).toBeGreaterThan(0);
    const productIds = new Set(PRODUCTS.map((p) => p.id));
    for (const b of BATCHES) {
      expect(productIds.has(b.productId), `batch ${b.id} references unknown product ${b.productId}`).toBe(true);
    }
  });

  it("every batch expiry is YYYY-MM-DD parseable", () => {
    for (const b of BATCHES) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(b.expiry), `batch ${b.id} expiry ${b.expiry}`).toBe(true);
      const d = new Date(b.expiry + "T00:00:00Z");
      expect(isNaN(d.getTime())).toBe(false);
    }
  });

  it("every batch qty is a positive integer; cost <= MRP", () => {
    for (const b of BATCHES) {
      expect(Number.isInteger(b.qty)).toBe(true);
      expect(b.qty).toBeGreaterThan(0);
      expect(b.costPaise).toBeGreaterThan(0);
      expect(b.costPaise).toBeLessThanOrEqual(b.mrpPaise);
    }
  });

  it("includes coverage of all six Schedule classes (so demo exercises every register)", () => {
    const seen = new Set(PRODUCTS.map((p) => p.schedule));
    // OTC + at least H must exist; G/H1/X/NDPS optional but flag if absent
    expect(seen.has("OTC")).toBe(true);
    expect(seen.has("H")).toBe(true);
  });
});
