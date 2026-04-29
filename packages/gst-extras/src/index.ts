// @pharmacare/gst-extras
// GSTR-3B summary, GSTR-2B reconciliation, GSTR-9 annual return.
// Pure aggregation logic over bills + purchases. ADR equivalent: extends gstr1.

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface BillRow {
  readonly billId: string;
  readonly billNo: string;
  readonly billedAt: string;             // ISO
  readonly customerStateCode: string;    // "27" intra-state with own state etc
  readonly taxablePaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly isRefund: boolean;            // true for credit-note rows
}

export interface PurchaseRow {
  readonly grnId: string;
  readonly invoiceNo: string;
  readonly invoiceDate: string;
  readonly supplierGstin: string;
  readonly taxablePaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly itcEligible: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// GSTR-3B
// ────────────────────────────────────────────────────────────────────────

export interface Gstr3bSection {
  readonly taxablePaise: Paise;
  readonly igstPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly cessPaise: Paise;
}

export interface Gstr3b {
  readonly period: string;                // "2026-04"
  readonly shopId: string;

  /** §3.1 — outward taxable supplies + tax payable. */
  readonly outwardSupplies: Gstr3bSection;

  /** §4 — eligible ITC from purchases. */
  readonly eligibleItc: Gstr3bSection;

  /** Net tax payable = outward − ITC (per component, never negative). */
  readonly taxPayable: Gstr3bSection;

  /** §3.1 sub-row split: zero-rated supplies (export), nil-rated, non-GST. */
  readonly zeroRatedTaxablePaise: Paise;
  readonly nilRatedTaxablePaise: Paise;
}

export interface BuildGstr3bArgs {
  readonly period: string;
  readonly shopId: string;
  readonly bills: readonly BillRow[];
  readonly purchases: readonly PurchaseRow[];
}

function sumSection(rows: ReadonlyArray<{
  taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; cessPaise: Paise;
}>): Gstr3bSection {
  let t = 0, c = 0, s = 0, i = 0, ce = 0;
  for (const r of rows) {
    t  += r.taxablePaise as number;
    c  += r.cgstPaise as number;
    s  += r.sgstPaise as number;
    i  += r.igstPaise as number;
    ce += r.cessPaise as number;
  }
  return {
    taxablePaise: paise(t), cgstPaise: paise(c), sgstPaise: paise(s),
    igstPaise: paise(i), cessPaise: paise(ce),
  };
}

export function buildGstr3b(a: BuildGstr3bArgs): Gstr3b {
  // Outward = sales − refunds (sign-flip refunds).
  const sales = a.bills.filter((b) => !b.isRefund);
  const refunds = a.bills.filter((b) => b.isRefund);
  const salesSec = sumSection(sales);
  const refundsSec = sumSection(refunds);
  const outwardSupplies: Gstr3bSection = {
    taxablePaise: paise((salesSec.taxablePaise as number) - (refundsSec.taxablePaise as number)),
    cgstPaise:    paise((salesSec.cgstPaise   as number) - (refundsSec.cgstPaise   as number)),
    sgstPaise:    paise((salesSec.sgstPaise   as number) - (refundsSec.sgstPaise   as number)),
    igstPaise:    paise((salesSec.igstPaise   as number) - (refundsSec.igstPaise   as number)),
    cessPaise:    paise((salesSec.cessPaise   as number) - (refundsSec.cessPaise   as number)),
  };

  const eligibleItc = sumSection(a.purchases.filter((p) => p.itcEligible));
  const taxPayable: Gstr3bSection = {
    taxablePaise: paise(0),                // not applicable to net cell
    igstPaise: paise(Math.max(0, (outwardSupplies.igstPaise as number) - (eligibleItc.igstPaise as number))),
    cgstPaise: paise(Math.max(0, (outwardSupplies.cgstPaise as number) - (eligibleItc.cgstPaise as number))),
    sgstPaise: paise(Math.max(0, (outwardSupplies.sgstPaise as number) - (eligibleItc.sgstPaise as number))),
    cessPaise: paise(Math.max(0, (outwardSupplies.cessPaise as number) - (eligibleItc.cessPaise as number))),
  };

  // Pharmacy edge case: a bill whose taxable+tax rows are all zero (exempt drug)
  // contributes to nil-rated rather than taxable. We approximate that as
  // outward where every tax field is zero.
  const nilRated = sales.filter((b) =>
    (b.cgstPaise as number) === 0 && (b.sgstPaise as number) === 0 &&
    (b.igstPaise as number) === 0 && (b.cessPaise as number) === 0);
  const nilRatedTaxablePaise = paise(nilRated.reduce((s, b) => s + (b.taxablePaise as number), 0));

  return {
    period: a.period,
    shopId: a.shopId,
    outwardSupplies,
    eligibleItc,
    taxPayable,
    zeroRatedTaxablePaise: paise(0),       // export tracking would set this — not implemented
    nilRatedTaxablePaise,
  };
}

// ────────────────────────────────────────────────────────────────────────
// GSTR-2B reconciliation — match supplier-filed invoices against our GRNs
// ────────────────────────────────────────────────────────────────────────

export interface Gstr2bPortalRow {
  readonly supplierGstin: string;
  readonly invoiceNo: string;
  readonly invoiceDate: string;
  readonly taxablePaise: Paise;
  readonly igstPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly cessPaise: Paise;
}

export type ReconStatus = "match" | "mismatch" | "missing-on-our-side" | "missing-on-portal";

export interface Gstr2bMatchRow {
  readonly supplierGstin: string;
  readonly invoiceNo: string;
  readonly status: ReconStatus;
  readonly ourTaxablePaise?: Paise;
  readonly portalTaxablePaise?: Paise;
  readonly diffPaise?: Paise;             // signed
  readonly notes?: string;
}

const TOLERANCE_PAISE = 100; // ₹1 noise floor — bigger than that flags mismatch

export function reconcile2b(
  ourGrns: readonly PurchaseRow[],
  portal: readonly Gstr2bPortalRow[],
): readonly Gstr2bMatchRow[] {
  const ourByKey = new Map<string, PurchaseRow>();
  for (const g of ourGrns) ourByKey.set(`${g.supplierGstin}|${g.invoiceNo}`, g);

  const portalByKey = new Map<string, Gstr2bPortalRow>();
  for (const p of portal) portalByKey.set(`${p.supplierGstin}|${p.invoiceNo}`, p);

  const out: Gstr2bMatchRow[] = [];

  // Walk portal rows first — easiest to detect missing-on-our-side
  for (const p of portal) {
    const k = `${p.supplierGstin}|${p.invoiceNo}`;
    const ours = ourByKey.get(k);
    if (!ours) {
      out.push({
        supplierGstin: p.supplierGstin, invoiceNo: p.invoiceNo,
        status: "missing-on-our-side",
        portalTaxablePaise: p.taxablePaise,
        notes: "Supplier filed but we have no GRN — claim ITC or chase missing invoice.",
      });
      continue;
    }
    const diff = (ours.taxablePaise as number) - (p.taxablePaise as number);
    if (Math.abs(diff) <= TOLERANCE_PAISE) {
      out.push({
        supplierGstin: p.supplierGstin, invoiceNo: p.invoiceNo,
        status: "match",
        ourTaxablePaise: ours.taxablePaise,
        portalTaxablePaise: p.taxablePaise,
        diffPaise: paise(diff),
      });
    } else {
      out.push({
        supplierGstin: p.supplierGstin, invoiceNo: p.invoiceNo,
        status: "mismatch",
        ourTaxablePaise: ours.taxablePaise,
        portalTaxablePaise: p.taxablePaise,
        diffPaise: paise(diff),
        notes: diff > 0
          ? "We recorded MORE than supplier filed — verify GRN line totals."
          : "Supplier filed MORE than we recorded — recheck for missing GRN line.",
      });
    }
  }

  // Now walk our GRNs and surface what's missing on the portal
  for (const g of ourGrns) {
    const k = `${g.supplierGstin}|${g.invoiceNo}`;
    if (!portalByKey.has(k)) {
      out.push({
        supplierGstin: g.supplierGstin, invoiceNo: g.invoiceNo,
        status: "missing-on-portal",
        ourTaxablePaise: g.taxablePaise,
        notes: "Supplier hasn't filed yet — chase before GSTR-3B due date or ITC blocked.",
      });
    }
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────
// GSTR-9 annual — aggregates 12 GSTR-3B and adds annual reconciliation
// ────────────────────────────────────────────────────────────────────────

export interface Gstr9 {
  readonly fy: string;                    // "2026-27"
  readonly shopId: string;
  readonly months: readonly Gstr3b[];
  readonly annualTotals: Gstr3bSection;
  readonly itcReversedPaise: Paise;       // ITC reversed during year (returns etc)
}

export function buildGstr9(fy: string, shopId: string, months: readonly Gstr3b[]): Gstr9 {
  let t = 0, c = 0, s = 0, i = 0, ce = 0;
  for (const m of months) {
    t  += m.outwardSupplies.taxablePaise as number;
    c  += m.outwardSupplies.cgstPaise as number;
    s  += m.outwardSupplies.sgstPaise as number;
    i  += m.outwardSupplies.igstPaise as number;
    ce += m.outwardSupplies.cessPaise as number;
  }
  return {
    fy, shopId, months,
    annualTotals: {
      taxablePaise: paise(t), cgstPaise: paise(c), sgstPaise: paise(s),
      igstPaise: paise(i), cessPaise: paise(ce),
    },
    itcReversedPaise: paise(0),       // populated by caller from credit-note ITC reversals
  };
}
