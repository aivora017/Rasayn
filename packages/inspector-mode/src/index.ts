// @pharmacare/inspector-mode
// FDA / Drug Inspector single-tap report. Pure aggregator that composes
// Schedule registers + IRN reconciliation + NPPA breaches + expired stock
// disposal + counseling records into a printable bundle.
// ADR-0049.

import type { Paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Source row types — caller queries these from existing tables
// ────────────────────────────────────────────────────────────────────────

export interface ScheduleHRow {
  readonly billId: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly customerName: string;
  readonly doctorName: string;
  readonly doctorRegNo: string;
  readonly drugName: string;
  readonly batchNo: string;
  readonly qty: number;
  readonly rxImagePath?: string;
}

export interface ScheduleXRow extends ScheduleHRow {
  readonly witnessUserId: string;
  readonly witnessName: string;
}

export interface NdpsRow {
  readonly form: "3D" | "3E" | "3H";
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly drugName: string;
  readonly openingQty: number;
  readonly receivedQty: number;
  readonly dispensedQty: number;
  readonly closingQty: number;
}

export interface IrnReconRow {
  readonly billId: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly grandTotalPaise: Paise;
  readonly status: "ok" | "missing" | "cancelled" | "failed";
  readonly irn?: string;
  readonly errorReason?: string;
}

export interface NppaBreachRow {
  readonly billId: string;
  readonly billNo: string;
  readonly productId: string;
  readonly productName: string;
  readonly mrpPaise: Paise;
  readonly nppaCapPaise: Paise;
  readonly overChargePaise: Paise;
  readonly approvedByUserId?: string;
  readonly approvalReason?: string;
}

export interface ExpiredDisposalRow {
  readonly batchId: string;
  readonly productName: string;
  readonly batchNo: string;
  readonly expiryDate: string;
  readonly qty: number;
  readonly disposedAt?: string;
  readonly disposalMethod?: string;       // "RTS" | "incinerated" | "manufacturer-recall"
  readonly approvedByUserId?: string;
}

export interface CounselingSummaryRow {
  readonly bills_with_counseling: number;
  readonly bills_requiring_counseling: number;
}

// ────────────────────────────────────────────────────────────────────────
// Output report
// ────────────────────────────────────────────────────────────────────────

export interface InspectorReport {
  readonly shopId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
  readonly generatedByUserId: string;

  readonly schedH: { rows: readonly ScheduleHRow[]; totalCount: number };
  readonly schedX: { rows: readonly ScheduleXRow[]; totalCount: number };
  readonly ndps:   { form3D?: NdpsRow; form3E?: NdpsRow; form3H?: NdpsRow };

  readonly irnReconciliation: {
    readonly ok: number;
    readonly missing: number;
    readonly cancelled: number;
    readonly failed: number;
    readonly missingRows: readonly IrnReconRow[];
    readonly failedRows: readonly IrnReconRow[];
  };

  readonly nppaBreaches: {
    readonly count: number;
    readonly totalOverChargePaise: Paise;
    readonly unapprovedCount: number;
    readonly rows: readonly NppaBreachRow[];
  };

  readonly expiredStock: {
    readonly disposedCount: number;
    readonly pendingDisposalCount: number;
    readonly rows: readonly ExpiredDisposalRow[];
  };

  readonly counseling: CounselingSummaryRow;

  readonly summary: {
    readonly headline: string;
    readonly redFlags: readonly string[];
    readonly compliantSections: readonly string[];
  };
}

// ────────────────────────────────────────────────────────────────────────
// Inputs (caller provides; aggregator is pure)
// ────────────────────────────────────────────────────────────────────────

export interface BuildInspectorReportArgs {
  readonly shopId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt?: string;
  readonly generatedByUserId: string;
  readonly schedHRows: readonly ScheduleHRow[];
  readonly schedXRows: readonly ScheduleXRow[];
  readonly ndpsRows:   readonly NdpsRow[];
  readonly irnRows:    readonly IrnReconRow[];
  readonly nppaRows:   readonly NppaBreachRow[];
  readonly expiredRows: readonly ExpiredDisposalRow[];
  readonly counselingSummary: CounselingSummaryRow;
}

// ────────────────────────────────────────────────────────────────────────
// Build
// ────────────────────────────────────────────────────────────────────────

export function buildInspectorReport(a: BuildInspectorReportArgs): InspectorReport {
  // IRN bucketing
  const irnOk        = a.irnRows.filter((r) => r.status === "ok");
  const irnMissing   = a.irnRows.filter((r) => r.status === "missing");
  const irnCancelled = a.irnRows.filter((r) => r.status === "cancelled");
  const irnFailed    = a.irnRows.filter((r) => r.status === "failed");

  // NPPA aggregation
  const totalOver = a.nppaRows.reduce((s, r) => s + (r.overChargePaise as number), 0);
  const unapproved = a.nppaRows.filter((r) => !r.approvedByUserId).length;

  // Expired stock
  const disposed = a.expiredRows.filter((r) => r.disposedAt).length;
  const pending  = a.expiredRows.filter((r) => !r.disposedAt).length;

  // NDPS by form
  const ndpsMap = new Map<string, NdpsRow>();
  for (const n of a.ndpsRows) ndpsMap.set(n.form, n);

  // Red flags / compliant sections
  const redFlags: string[] = [];
  const compliant: string[] = [];

  if (irnMissing.length > 0)   redFlags.push(`${irnMissing.length} bills missing IRN`);
  if (irnFailed.length > 0)    redFlags.push(`${irnFailed.length} bills with FAILED IRN submission`);
  if (unapproved > 0)          redFlags.push(`${unapproved} NPPA over-charge entries WITHOUT owner approval`);
  if (pending > 0)             redFlags.push(`${pending} expired batches awaiting disposal`);
  if (a.counselingSummary.bills_requiring_counseling > 0
      && a.counselingSummary.bills_with_counseling < a.counselingSummary.bills_requiring_counseling) {
    redFlags.push(
      `${a.counselingSummary.bills_requiring_counseling - a.counselingSummary.bills_with_counseling} ` +
      `Schedule-H bills missing counseling record`,
    );
  }

  if (irnOk.length > 0 && irnMissing.length === 0 && irnFailed.length === 0)
    compliant.push("E-invoice IRN: 100% reconciled");
  if (a.schedHRows.length > 0)
    compliant.push(`Schedule H register: ${a.schedHRows.length} dispenses recorded`);
  if (a.schedXRows.length > 0 && a.schedXRows.every((r) => r.witnessName))
    compliant.push(`Schedule X register: ${a.schedXRows.length} dispenses, all with witness`);
  if (disposed > 0 && pending === 0)
    compliant.push(`Expired-stock disposal: ${disposed} batches, all logged`);

  const headline = redFlags.length === 0
    ? "All compliance sections clean for the period."
    : `${redFlags.length} compliance red flag${redFlags.length === 1 ? "" : "s"} — see details below.`;

  return {
    shopId: a.shopId,
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    generatedAt: a.generatedAt ?? new Date().toISOString(),
    generatedByUserId: a.generatedByUserId,
    schedH: { rows: a.schedHRows, totalCount: a.schedHRows.length },
    schedX: { rows: a.schedXRows, totalCount: a.schedXRows.length },
    ndps: {
      ...(ndpsMap.has("3D") ? { form3D: ndpsMap.get("3D")! } : {}),
      ...(ndpsMap.has("3E") ? { form3E: ndpsMap.get("3E")! } : {}),
      ...(ndpsMap.has("3H") ? { form3H: ndpsMap.get("3H")! } : {}),
    },
    irnReconciliation: {
      ok: irnOk.length,
      missing: irnMissing.length,
      cancelled: irnCancelled.length,
      failed: irnFailed.length,
      missingRows: irnMissing,
      failedRows: irnFailed,
    },
    nppaBreaches: {
      count: a.nppaRows.length,
      totalOverChargePaise: totalOver as Paise,
      unapprovedCount: unapproved,
      rows: a.nppaRows,
    },
    expiredStock: {
      disposedCount: disposed,
      pendingDisposalCount: pending,
      rows: a.expiredRows,
    },
    counseling: a.counselingSummary,
    summary: { headline, redFlags, compliantSections: compliant },
  };
}

/** Pretty Markdown rendering for paste into FDA/inspector PDF. */
export function renderInspectorReportMarkdown(r: InspectorReport): string {
  const lines: string[] = [];
  lines.push(`# Compliance Inspector Report`);
  lines.push(``);
  lines.push(`**Shop**: ${r.shopId}  ·  **Period**: ${r.periodStart} → ${r.periodEnd}`);
  lines.push(`**Generated**: ${r.generatedAt} by ${r.generatedByUserId}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(`> ${r.summary.headline}`);
  lines.push(``);
  if (r.summary.redFlags.length > 0) {
    lines.push(`### Red flags`);
    for (const f of r.summary.redFlags) lines.push(`- ⚠ ${f}`);
    lines.push(``);
  }
  if (r.summary.compliantSections.length > 0) {
    lines.push(`### Compliant`);
    for (const c of r.summary.compliantSections) lines.push(`- ✓ ${c}`);
    lines.push(``);
  }
  lines.push(`## Schedule H (${r.schedH.totalCount} entries) · Schedule X (${r.schedX.totalCount} entries)`);
  lines.push(`## E-invoice IRN reconciliation`);
  lines.push(`- OK: ${r.irnReconciliation.ok}  ·  Missing: ${r.irnReconciliation.missing}  ·  Cancelled: ${r.irnReconciliation.cancelled}  ·  Failed: ${r.irnReconciliation.failed}`);
  lines.push(`## NPPA breaches`);
  lines.push(`- Count: ${r.nppaBreaches.count}  ·  Unapproved: ${r.nppaBreaches.unapprovedCount}  ·  Total overcharge: ₹${(r.nppaBreaches.totalOverChargePaise as number) / 100}`);
  lines.push(`## Expired stock disposal`);
  lines.push(`- Disposed: ${r.expiredStock.disposedCount}  ·  Pending: ${r.expiredStock.pendingDisposalCount}`);
  return lines.join("\n");
}
