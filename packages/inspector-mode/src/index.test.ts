import { describe, it, expect } from "vitest";
import {
  buildInspectorReport, renderInspectorReportMarkdown,
  type ScheduleHRow, type ScheduleXRow, type IrnReconRow, type NppaBreachRow, type ExpiredDisposalRow, type NdpsRow,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

const baseArgs = {
  shopId: "shop_local",
  periodStart: "2026-04-01",
  periodEnd: "2026-04-30",
  generatedAt: "2026-04-28T12:00:00Z",
  generatedByUserId: "u_owner",
  schedHRows: [] as ScheduleHRow[],
  schedXRows: [] as ScheduleXRow[],
  ndpsRows:   [] as NdpsRow[],
  irnRows:    [] as IrnReconRow[],
  nppaRows:   [] as NppaBreachRow[],
  expiredRows: [] as ExpiredDisposalRow[],
  counselingSummary: { bills_with_counseling: 0, bills_requiring_counseling: 0 },
};

describe("buildInspectorReport — empty period", () => {
  it("clean headline when no data", () => {
    const r = buildInspectorReport(baseArgs);
    expect(r.summary.headline).toMatch(/clean/i);
    expect(r.summary.redFlags).toHaveLength(0);
  });
});

describe("IRN reconciliation buckets", () => {
  const irn = (status: IrnReconRow["status"]): IrnReconRow => ({
    billId: `b-${Math.random()}`, billNo: "B1", billedAt: "2026-04-15",
    grandTotalPaise: paise(10000), status,
  });

  it("counts each status correctly", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      irnRows: [irn("ok"), irn("ok"), irn("missing"), irn("failed"), irn("cancelled")],
    });
    expect(r.irnReconciliation.ok).toBe(2);
    expect(r.irnReconciliation.missing).toBe(1);
    expect(r.irnReconciliation.failed).toBe(1);
    expect(r.irnReconciliation.cancelled).toBe(1);
  });

  it("missing IRN is a red flag", () => {
    const r = buildInspectorReport({ ...baseArgs, irnRows: [irn("missing")] });
    expect(r.summary.redFlags.some((f) => /missing IRN/.test(f))).toBe(true);
  });

  it("100% ok IRN promotes to compliant", () => {
    const r = buildInspectorReport({ ...baseArgs, irnRows: [irn("ok"), irn("ok")] });
    expect(r.summary.compliantSections.some((c) => /IRN/.test(c))).toBe(true);
  });
});

describe("NPPA breach handling", () => {
  it("flags unapproved breaches", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      nppaRows: [{
        billId: "b1", billNo: "B1", productId: "p1", productName: "Crocin",
        mrpPaise: paise(5000), nppaCapPaise: paise(4500),
        overChargePaise: paise(500),
      }],
    });
    expect(r.nppaBreaches.unapprovedCount).toBe(1);
    expect(r.summary.redFlags.some((f) => /NPPA/.test(f))).toBe(true);
  });

  it("approved breach doesn't appear in red flags", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      nppaRows: [{
        billId: "b1", billNo: "B1", productId: "p1", productName: "Crocin",
        mrpPaise: paise(5000), nppaCapPaise: paise(4500),
        overChargePaise: paise(500), approvedByUserId: "u_owner",
        approvalReason: "stock-out emergency",
      }],
    });
    expect(r.nppaBreaches.unapprovedCount).toBe(0);
    expect(r.summary.redFlags.length).toBe(0);
  });

  it("aggregates total over-charge", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      nppaRows: [
        { billId: "b1", billNo: "B1", productId: "p1", productName: "A", mrpPaise: paise(0), nppaCapPaise: paise(0), overChargePaise: paise(300), approvedByUserId: "u_owner" },
        { billId: "b2", billNo: "B2", productId: "p2", productName: "B", mrpPaise: paise(0), nppaCapPaise: paise(0), overChargePaise: paise(700), approvedByUserId: "u_owner" },
      ],
    });
    expect(r.nppaBreaches.totalOverChargePaise).toBe(1000);
  });
});

describe("Expired stock disposal", () => {
  it("flags pending disposal as red", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      expiredRows: [{
        batchId: "b1", productName: "Insulin", batchNo: "BN1", expiryDate: "2026-03-01", qty: 5,
      }],
    });
    expect(r.expiredStock.pendingDisposalCount).toBe(1);
    expect(r.summary.redFlags.some((f) => /expired/i.test(f))).toBe(true);
  });

  it("all-disposed is compliant", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      expiredRows: [{
        batchId: "b1", productName: "Insulin", batchNo: "BN1", expiryDate: "2026-03-01", qty: 5,
        disposedAt: "2026-04-01", disposalMethod: "incinerated", approvedByUserId: "u_owner",
      }],
    });
    expect(r.expiredStock.pendingDisposalCount).toBe(0);
    expect(r.summary.compliantSections.some((c) => /disposal/i.test(c))).toBe(true);
  });
});

describe("Schedule H/X presence", () => {
  it("Schedule H rows surface in compliant section", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      schedHRows: [{
        billId: "b1", billNo: "B1", billedAt: "2026-04-15",
        customerName: "Mr.X", doctorName: "Dr.Y", doctorRegNo: "MH-12345",
        drugName: "Amoxicillin", batchNo: "BN1", qty: 10,
      }],
    });
    expect(r.summary.compliantSections.some((c) => /Schedule H/.test(c))).toBe(true);
  });

  it("Schedule X requires witness; missing witness is silent (Schedule X is rare)", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      schedXRows: [{
        billId: "b1", billNo: "B1", billedAt: "2026-04-15",
        customerName: "Mr.X", doctorName: "Dr.Y", doctorRegNo: "MH-12345",
        drugName: "Morphine", batchNo: "BN1", qty: 1,
        witnessUserId: "u2", witnessName: "Pharmacist B",
      }],
    });
    expect(r.summary.compliantSections.some((c) => /Schedule X/.test(c))).toBe(true);
  });
});

describe("counseling summary", () => {
  it("flags missing counseling for Sched-H bills", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      counselingSummary: { bills_with_counseling: 5, bills_requiring_counseling: 8 },
    });
    expect(r.summary.redFlags.some((f) => /counseling/.test(f))).toBe(true);
  });
});

describe("renderInspectorReportMarkdown", () => {
  it("includes period + headline + section counts", () => {
    const r = buildInspectorReport({
      ...baseArgs,
      irnRows: [{ billId: "b1", billNo: "B1", billedAt: "2026-04-15", grandTotalPaise: paise(10000), status: "ok" }],
    });
    const md = renderInspectorReportMarkdown(r);
    expect(md).toContain("# Compliance Inspector Report");
    expect(md).toContain("2026-04-01 → 2026-04-30");
    expect(md).toContain("OK: 1");
  });
});
