// A4 golden-fixture generator.
// Run with: tsx packages/gst-engine/scripts/generate-golden.ts
// Writes packages/gst-engine/fixtures/golden-bills.json
//
// Each candidate bill is computed via BOTH production (`computeLine` /
// `computeInvoice`) AND the independent reference path (`reference.ts`).
// If they disagree by >0 paise on ANY field, generation aborts —
// this gives us a tripwire against silent drift between the two
// algebraic paths.

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paise, rupeesToPaise, type Paise } from "@pharmacare/shared-types";
import type { GstRate, GstTreatment } from "@pharmacare/shared-types";
import {
  computeLine, computeInvoice,
  type LineInput, type LineTax, type InvoiceTotals,
} from "../src/index.js";
import {
  referenceComputeLine, referenceComputeInvoice,
} from "../src/reference.js";

interface BillSpec {
  readonly id: string;
  readonly description: string;
  readonly treatment: GstTreatment;
  readonly lines: readonly LineInput[];
}

interface BillGolden extends BillSpec {
  readonly expectedLines: readonly LineTax[];
  readonly expectedInvoice: InvoiceTotals;
}

const CANONICAL: readonly BillSpec[] = [
  { id: "gold-001", description: "12% intra-state, Rs112 MRP, 1 qty", treatment: "intra_state",
    lines: [{ mrpPaise: rupeesToPaise(112), qty: 1, gstRate: 12 }] },
  { id: "gold-002", description: "5% inter-state, Rs105 MRP, 1 qty", treatment: "inter_state",
    lines: [{ mrpPaise: rupeesToPaise(105), qty: 1, gstRate: 5 }] },
  { id: "gold-003", description: "18% intra-state, Rs118 MRP, 2 qty", treatment: "intra_state",
    lines: [{ mrpPaise: rupeesToPaise(118), qty: 2, gstRate: 18 }] },
  { id: "gold-004", description: "Exempt (insulin Rs250 x 3)", treatment: "exempt",
    lines: [{ mrpPaise: rupeesToPaise(250), qty: 3, gstRate: 12 }] },
  { id: "gold-005", description: "Nil-rated (OTC Rs50 x 1)", treatment: "exempt",
    lines: [{ mrpPaise: rupeesToPaise(50), qty: 1, gstRate: 0 }] },
  { id: "gold-006", description: "12% intra, Rs200 x 1, 10pct discount", treatment: "intra_state",
    lines: [{ mrpPaise: rupeesToPaise(200), qty: 1, gstRate: 12, discountPct: 10 }] },
  { id: "gold-007", description: "18% intra, Rs500 x 1, Rs50 flat disc", treatment: "intra_state",
    lines: [{ mrpPaise: rupeesToPaise(500), qty: 1, gstRate: 18, discountPaise: paise(5000) }] },
  { id: "gold-008", description: "Mixed 5/12/18 three-line intra, walk-in", treatment: "intra_state",
    lines: [
      { mrpPaise: rupeesToPaise(105), qty: 1, gstRate: 5 },
      { mrpPaise: rupeesToPaise(112), qty: 2, gstRate: 12 },
      { mrpPaise: rupeesToPaise(118), qty: 1, gstRate: 18 },
    ]},
  { id: "gold-009", description: "Fractional qty (0.5 strip)", treatment: "intra_state",
    lines: [{ mrpPaise: rupeesToPaise(112), qty: 0.5, gstRate: 12 }] },
  { id: "gold-010", description: "Round-off triad", treatment: "intra_state",
    lines: [
      { mrpPaise: rupeesToPaise(411.56), qty: 1, gstRate: 12 },
      { mrpPaise: rupeesToPaise(411.5), qty: 1, gstRate: 12 },
      { mrpPaise: rupeesToPaise(411.5), qty: 1, gstRate: 12 },
    ]},
];

const RATES: readonly GstRate[] = [5, 12, 18];
const TREATMENTS: readonly GstTreatment[] = ["intra_state", "inter_state", "exempt"];
const QTY_PATTERNS = [1, 2, 5, 10, 0.5] as const;
const DISCOUNT_PATTERNS: readonly (undefined | { pct: number } | { abs: number })[] = [
  undefined, { pct: 5 }, { pct: 10 }, { abs: 500 },
];
const MRPS_PAISE: readonly Paise[] = [
  rupeesToPaise(47.5), rupeesToPaise(93.25), rupeesToPaise(167.75),
  rupeesToPaise(211), rupeesToPaise(299.99), rupeesToPaise(445),
  rupeesToPaise(789.33), rupeesToPaise(1024.75), rupeesToPaise(1499),
];

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

function enumerate(): BillSpec[] {
  const rnd = mulberry32(0xA4C017);
  const out: BillSpec[] = [];
  let idx = 11;
  while (out.length < 90) {
    const rate = RATES[Math.floor(rnd() * RATES.length)]!;
    const treatment = TREATMENTS[Math.floor(rnd() * TREATMENTS.length)]!;
    const lineCount = 1 + Math.floor(rnd() * 5);
    const lines: LineInput[] = [];
    for (let i = 0; i < lineCount; i++) {
      const mrp = MRPS_PAISE[Math.floor(rnd() * MRPS_PAISE.length)]!;
      const qty = QTY_PATTERNS[Math.floor(rnd() * QTY_PATTERNS.length)]!;
      const discPat = DISCOUNT_PATTERNS[Math.floor(rnd() * DISCOUNT_PATTERNS.length)];
      const line: LineInput = {
        mrpPaise: mrp,
        qty,
        gstRate: rate,
        ...(discPat !== undefined && "pct" in discPat ? { discountPct: discPat.pct } : {}),
        ...(discPat !== undefined && "abs" in discPat
          ? { discountPaise: paise(Math.min(discPat.abs, Math.max(0, mrp * qty - 1))) } : {}),
      };
      lines.push(line);
    }
    const id = `gold-${String(idx).padStart(3, "0")}`;
    idx++;
    out.push({ id, description: `auto ${treatment} @ ${rate}% x ${lineCount} line(s)`, treatment, lines });
  }
  return out;
}

function equalLineTax(a: LineTax, b: LineTax): string[] {
  const diffs: string[] = [];
  const keys: (keyof LineTax)[] = [
    "grossPaise", "discountPaise", "taxableValuePaise",
    "cgstPaise", "sgstPaise", "igstPaise", "cessPaise", "lineTotalPaise",
  ];
  for (const k of keys) if (a[k] !== b[k]) diffs.push(`${k}: prod=${a[k]} ref=${b[k]}`);
  return diffs;
}
function equalInvoice(a: InvoiceTotals, b: InvoiceTotals): string[] {
  const diffs: string[] = [];
  const keys: (keyof InvoiceTotals)[] = [
    "subtotalPaise", "discountPaise", "cgstPaise", "sgstPaise", "igstPaise",
    "cessPaise", "preRoundPaise", "roundOffPaise", "grandTotalPaise",
  ];
  for (const k of keys) if (a[k] !== b[k]) diffs.push(`${k}: prod=${a[k]} ref=${b[k]}`);
  return diffs;
}

function freeze(spec: BillSpec): BillGolden | { id: string; divergence: string[] } {
  const prodLines = spec.lines.map((l) => computeLine(l, spec.treatment));
  const refLines = spec.lines.map((l) => referenceComputeLine(l, spec.treatment));
  const divergences: string[] = [];
  for (let i = 0; i < prodLines.length; i++) {
    const d = equalLineTax(prodLines[i]!, refLines[i]!);
    if (d.length) divergences.push(`line[${i}]: ${d.join(", ")}`);
  }
  const prodInv = computeInvoice(prodLines);
  const refInv = referenceComputeInvoice(refLines);
  const dInv = equalInvoice(prodInv, refInv);
  if (dInv.length) divergences.push(`invoice: ${dInv.join(", ")}`);
  if (divergences.length) return { id: spec.id, divergence: divergences };
  return { ...spec, expectedLines: prodLines, expectedInvoice: prodInv };
}

function main(): void {
  const specs = [...CANONICAL, ...enumerate()];
  const out: BillGolden[] = [];
  const diverged: { id: string; divergence: string[] }[] = [];
  for (const s of specs) {
    const r = freeze(s);
    if ("divergence" in r) diverged.push(r);
    else out.push(r);
  }
  if (diverged.length) {
    console.error("GENERATION ABORTED - production vs. reference disagree:");
    for (const d of diverged) console.error(`  ${d.id}: ${d.divergence.join(" | ")}`);
    process.exit(1);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "fixtures", "golden-bills.json");
  const doc = {
    version: "1",
    generatedAt: "2026-04-16",
    count: out.length,
    seed: "0xA4C017",
    note: "Production and reference.ts cross-checked at generation time.",
    bills: out,
  };
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote ${out.length} golden bills to ${outPath}`);
}

main();
