// @pharmacare/search-repo · product search (FTS5) + FEFO batch picker.
import type Database from "better-sqlite3";

export interface ProductHit {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly manufacturer: string;
  readonly gstRate: number;
  readonly schedule: string;
  readonly mrpPaise: number;
  readonly rank: number;
}

/** Prefix-match any token; escape FTS5 specials. */
function toFtsQuery(q: string): string {
  return q.trim()
    .replace(/["']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `${t}*`)
    .join(" ");
}

export function searchProducts(db: Database.Database, q: string, limit = 20): readonly ProductHit[] {
  const clean = toFtsQuery(q);
  if (!clean) return [];
  const rows = db.prepare(`
    SELECT p.id, p.name, p.generic_name, p.manufacturer, p.gst_rate, p.schedule, p.mrp_paise, bm25(products_fts) AS rank
    FROM products_fts
    JOIN products p ON p.id = products_fts.id
    WHERE products_fts MATCH ? AND p.is_active = 1
    ORDER BY rank
    LIMIT ?
  `).all(clean, limit) as any[];
  return rows.map((r) => ({
    id: r.id, name: r.name, genericName: r.generic_name, manufacturer: r.manufacturer,
    gstRate: r.gst_rate, schedule: r.schedule, mrpPaise: r.mrp_paise, rank: r.rank,
  }));
}

export interface BatchPick {
  readonly id: string;
  readonly batchNo: string;
  readonly expiryDate: string;
  readonly qtyOnHand: number;
  readonly mrpPaise: number;
}

/** Pick the FEFO batch (earliest non-expired, qty>0). Returns null if none. */
export function pickFefoBatch(db: Database.Database, productId: string): BatchPick | null {
  const row = db.prepare(`
    SELECT id, batch_no, expiry_date, qty_on_hand, mrp_paise
    FROM v_fefo_batches WHERE product_id = ?
    LIMIT 1
  `).get(productId) as any | undefined;
  return row ? {
    id: row.id, batchNo: row.batch_no, expiryDate: row.expiry_date,
    qtyOnHand: row.qty_on_hand, mrpPaise: row.mrp_paise,
  } : null;
}

// --- Inventory listing -----------------------------------------------------

export interface StockRow {
  readonly productId: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly manufacturer: string;
  readonly schedule: string;
  readonly gstRate: number;
  readonly mrpPaise: number;
  readonly totalQty: number;               // sum across non-expired batches
  readonly batchCount: number;             // non-expired batches with qty>0
  readonly nearestExpiry: string | null;   // FEFO batch's expiry (non-expired)
  readonly daysToExpiry: number | null;    // null if no non-expired stock
  readonly hasExpiredStock: number;        // units sitting in expired batches (>0 flags it)
}

export interface ListStockOptions {
  readonly q?: string;              // optional name/generic fuzzy filter (LIKE)
  readonly lowStockUnder?: number;  // filter: total_qty <= N (default: no filter)
  readonly nearExpiryDays?: number; // filter: days_to_expiry <= N (default: no filter)
  readonly limit?: number;          // default 200
}

/** Inventory snapshot. One row per active product with FEFO-aware aggregates. */
export function listStock(db: Database.Database, opts: ListStockOptions = {}): readonly StockRow[] {
  const { q, lowStockUnder, nearExpiryDays, limit = 200 } = opts;

  // Aggregate once in SQL; filter in outer query.
  const sql = `
    WITH live AS (
      SELECT product_id,
             SUM(qty_on_hand)                               AS total_qty,
             COUNT(*)                                       AS batch_count,
             MIN(expiry_date)                               AS nearest_expiry
      FROM batches
      WHERE qty_on_hand > 0 AND expiry_date >= strftime('%Y-%m-%d','now')
      GROUP BY product_id
    ),
    dead AS (
      SELECT product_id, SUM(qty_on_hand) AS expired_qty
      FROM batches
      WHERE qty_on_hand > 0 AND expiry_date <  strftime('%Y-%m-%d','now')
      GROUP BY product_id
    )
    SELECT
      p.id, p.name, p.generic_name, p.manufacturer, p.schedule, p.gst_rate, p.mrp_paise,
      COALESCE(live.total_qty, 0)    AS total_qty,
      COALESCE(live.batch_count, 0)  AS batch_count,
      live.nearest_expiry            AS nearest_expiry,
      CASE WHEN live.nearest_expiry IS NULL THEN NULL
           ELSE CAST(julianday(live.nearest_expiry) - julianday(strftime('%Y-%m-%d','now')) AS INTEGER)
      END                            AS days_to_expiry,
      COALESCE(dead.expired_qty, 0)  AS expired_qty
    FROM products p
    LEFT JOIN live ON live.product_id = p.id
    LEFT JOIN dead ON dead.product_id = p.id
    WHERE p.is_active = 1
      ${q ? "AND (LOWER(p.name) LIKE @like OR LOWER(COALESCE(p.generic_name,'')) LIKE @like)" : ""}
      ${lowStockUnder !== undefined ? "AND COALESCE(live.total_qty,0) <= @lowStockUnder" : ""}
      ${nearExpiryDays !== undefined ? "AND (live.nearest_expiry IS NOT NULL AND julianday(live.nearest_expiry) - julianday(strftime('%Y-%m-%d','now')) <= @nearExpiryDays)" : ""}
    ORDER BY
      (COALESCE(live.total_qty,0) = 0) DESC,   -- out-of-stock first
      days_to_expiry ASC,                       -- then soonest-expiry
      p.name ASC
    LIMIT @limit
  `;

  const params: Record<string, unknown> = { limit };
  if (q) params["like"] = `%${q.toLowerCase()}%`;
  if (lowStockUnder !== undefined) params["lowStockUnder"] = lowStockUnder;
  if (nearExpiryDays !== undefined) params["nearExpiryDays"] = nearExpiryDays;

  const rows = db.prepare(sql).all(params) as any[];
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    genericName: r.generic_name,
    manufacturer: r.manufacturer,
    schedule: r.schedule,
    gstRate: r.gst_rate,
    mrpPaise: r.mrp_paise,
    totalQty: r.total_qty,
    batchCount: r.batch_count,
    nearestExpiry: r.nearest_expiry,
    daysToExpiry: r.days_to_expiry,
    hasExpiredStock: r.expired_qty,
  }));
}
