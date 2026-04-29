-- Stock transfer (inter-store) — multi-store inventory move with in-transit ledger.
-- Phase-1 schema: header + lines + audit; reconciliation triggers land in 0041 if needed.

CREATE TABLE IF NOT EXISTS stock_transfers (
    id             TEXT PRIMARY KEY,
    from_shop_id   TEXT NOT NULL REFERENCES shops(id),
    to_shop_id     TEXT NOT NULL REFERENCES shops(id),
    status         TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_transit','received','cancelled')),
    created_by     TEXT NOT NULL REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    dispatched_at  TEXT,
    received_at    TEXT,
    received_by    TEXT REFERENCES users(id),
    notes          TEXT,
    CHECK (from_shop_id <> to_shop_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to   ON stock_transfers(to_shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status, created_at DESC);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id             TEXT PRIMARY KEY,
    transfer_id    TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id     TEXT NOT NULL REFERENCES products(id),
    batch_id       TEXT NOT NULL REFERENCES batches(id),
    qty_dispatched REAL NOT NULL CHECK (qty_dispatched > 0),
    qty_received   REAL,
    variance_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer ON stock_transfer_lines(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_product  ON stock_transfer_lines(product_id);
