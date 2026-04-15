// @pharmacare/reports-repo — day-book, GSTR-1 summary, top movers.
// All date inputs are YYYY-MM-DD local-day, compared against billed_at
// using SQLite substr(billed_at,1,10). Money in paise.

import type Database from "better-sqlite3";

export interface DayBookRow {
  readonly billId: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly paymentMode: string;
  readonly grandTotalPaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly isVoided: number;
}

export interface DayBookSummary {
  readonly billCount: number;
  readonly grossPaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly byPayment: Readonly<Record<string, number>>;
}

export interface DayBook {
  readonly date: string;
  readonly rows: readonly DayBookRow[];
  readonly summary: DayBookSummary;
}

/** Day-book for a single local day, excluding voided bills from summary. */
export function dayBook(db: Database.Database, shopId: string, date: string): DayBook {
  const rows = db.prepare(`
    SELECT id, bill_no, billed_at, payment_mode,
           grand_total_paise, total_cgst_paise, total_sgst_paise, total_igst_paise, is_voided
    FROM bills
    WHERE shop_id = ? AND substr(billed_at,1,10) = ?
    ORDER BY billed_at ASC
  `).all(shopId, date) as any[];

  const live = rows.filter((r) => r.is_voided === 0);
  const byPayment: Record<string, number> = {};
  let gross = 0, cgst = 0, sgst = 0, igst = 0;
  for (const r of live) {
    gross += r.grand_total_paise;
    cgst += r.total_cgst_paise;
    sgst += r.total_sgst_paise;
    igst += r.total_igst_paise;
    byPayment[r.payment_mode] = (byPayment[r.payment_mode] ?? 0) + r.grand_total_paise;
  }

  return {
    date,
    rows: rows.map((r) => ({
      billId: r.id, billNo: r.bill_no, billedAt: r.billed_at,
      paymentMode: r.payment_mode, grandTotalPaise: r.grand_total_paise,
      cgstPaise: r.total_cgst_paise, sgstPaise: r.total_sgst_paise,
      igstPaise: r.total_igst_paise, isVoided: r.is_voided,
    })),
    summary: { billCount: live.length, grossPaise: gross, cgstPaise: cgst,
               sgstPaise: sgst, igstPaise: igst, byPayment },
  };
}

export interface GstrBucket {
  readonly gstRate: number;
  readonly taxableValuePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly lineCount: number;
}

/** GSTR-1 outward supplies summary grouped by gst_rate, across a date range. */
export function gstr1Summary(
  db: Database.Database, shopId: string, from: string, to: string,
): readonly GstrBucket[] {
  const rows = db.prepare(`
    SELECT bl.gst_rate AS gst_rate,
           SUM(bl.taxable_value_paise) AS taxable,
           SUM(bl.cgst_paise) AS cgst,
           SUM(bl.sgst_paise) AS sgst,
           SUM(bl.igst_paise) AS igst,
           COUNT(*) AS cnt
    FROM bill_lines bl
    JOIN bills b ON b.id = bl.bill_id
    WHERE b.shop_id = ?
      AND b.is_voided = 0
      AND substr(b.billed_at,1,10) BETWEEN ? AND ?
    GROUP BY bl.gst_rate
    ORDER BY bl.gst_rate ASC
  `).all(shopId, from, to) as any[];
  return rows.map((r) => ({
    gstRate: r.gst_rate,
    taxableValuePaise: r.taxable ?? 0,
    cgstPaise: r.cgst ?? 0,
    sgstPaise: r.sgst ?? 0,
    igstPaise: r.igst ?? 0,
    lineCount: r.cnt,
  }));
}

export interface TopMoverRow {
  readonly productId: string;
  readonly name: string;
  readonly qtySold: number;
  readonly revenuePaise: number;
  readonly billCount: number;
}

/** Top-N movers by revenue across a date range. */
export function topMovers(
  db: Database.Database, shopId: string, from: string, to: string, limit = 10,
): readonly TopMoverRow[] {
  const rows = db.prepare(`
    SELECT p.id AS id, p.name AS name,
           SUM(bl.qty) AS qty_sold,
           SUM(bl.line_total_paise) AS revenue,
           COUNT(DISTINCT bl.bill_id) AS bill_count
    FROM bill_lines bl
    JOIN bills b ON b.id = bl.bill_id
    JOIN products p ON p.id = bl.product_id
    WHERE b.shop_id = ?
      AND b.is_voided = 0
      AND substr(b.billed_at,1,10) BETWEEN ? AND ?
    GROUP BY p.id, p.name
    ORDER BY revenue DESC
    LIMIT ?
  `).all(shopId, from, to, limit) as any[];
  return rows.map((r) => ({
    productId: r.id, name: r.name, qtySold: r.qty_sold ?? 0,
    revenuePaise: r.revenue ?? 0, billCount: r.bill_count ?? 0,
  }));
}
