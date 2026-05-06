-- scripts/pilot/sample/seed-app-db.sql
-- Smoke-test fixture for measure-30-bills.py.
--
-- Apply on top of the full migration chain
-- (`for f in packages/shared-db/migrations/*.sql; do .read $f; done`).
-- Produces 5 bills whose bill_no exactly matches the rows in
-- scripts/pilot/sample/sample-paper.csv. Running the script against this
-- DB + that CSV is expected to exit 0 (gate PASS — though only with
-- --limit 5, since we only seed 5 bills).
--
-- All numbers are whole rupees: bills.grand_total_paise % 100 == 0.
-- All bills are not voided, all are intra_state, OTC product, no GST math
-- exercised — the script only diffs grand_total + line count + qty +
-- mrp + gst_rate + payment_mode.

PRAGMA foreign_keys = ON;

INSERT INTO shops (id, name, gstin, state_code, retail_license, address)
VALUES ('shop_main', 'Smoke Test Pharmacy', '27ABCDE1234F1Z5', '27',
        'RL-SMOKE-001', 'Kalyan, Mumbai');

INSERT INTO users (id, shop_id, name, role, pin_hash, is_active)
VALUES ('usr_smoke', 'shop_main', 'Smoke Cashier', 'cashier',
        'pinhash-not-real', 1);

INSERT INTO suppliers (id, shop_id, name)
VALUES ('sup_smoke', 'shop_main', 'Smoke Supplier');

-- OTC schedule so the X2 image-mandatory trigger does not fire.
INSERT INTO products
  (id, name, generic_name, manufacturer, hsn, gst_rate, schedule,
   pack_form, pack_size, mrp_paise)
VALUES
  ('prd_smoke', 'Smoke Tablet 500mg', 'Smoketamol', 'SmokeCo',
   '3004', 5, 'OTC', 'strip', 10, 5000);

-- Batch with qty 100, expiry well in the future so the
-- trg_bill_lines_block_expired trigger does not fire.
INSERT INTO batches
  (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand,
   purchase_price_paise, mrp_paise, supplier_id)
VALUES
  ('bat_smoke', 'prd_smoke', 'SMK-001',
   '2026-01-01', '2027-12-31', 100, 4000, 5000, 'sup_smoke');

-- ---- Bill 1: 1 line × ₹100 cash ----
INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                   gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
VALUES ('bil_001', 'shop_main', 'PILOT-2026-001', '2026-04-15T09:00:00.000Z',
        'usr_smoke', 'intra_state', 9524, 10000, 'cash');
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_001a', 'bil_001', 'prd_smoke', 'bat_smoke',
        2, 5000, 9524, 5, 10000);
INSERT INTO payments (id, bill_id, mode, amount_paise)
VALUES ('pay_001', 'bil_001', 'cash', 10000);

-- ---- Bill 2: 2 lines totalling ₹250 upi ----
INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                   gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
VALUES ('bil_002', 'shop_main', 'PILOT-2026-002', '2026-04-15T11:30:00.000Z',
        'usr_smoke', 'intra_state', 23810, 25000, 'upi');
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_002a', 'bil_002', 'prd_smoke', 'bat_smoke',
        3, 5000, 14286, 5, 15000);
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_002b', 'bil_002', 'prd_smoke', 'bat_smoke',
        2, 5000, 9524, 5, 10000);
INSERT INTO payments (id, bill_id, mode, amount_paise)
VALUES ('pay_002', 'bil_002', 'upi', 25000);

-- ---- Bill 3: 3 lines totalling ₹500 cash ----
INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                   gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
VALUES ('bil_003', 'shop_main', 'PILOT-2026-003', '2026-04-16T10:15:00.000Z',
        'usr_smoke', 'intra_state', 47619, 50000, 'cash');
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_003a', 'bil_003', 'prd_smoke', 'bat_smoke',
        2, 5000, 9524, 5, 10000);
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_003b', 'bil_003', 'prd_smoke', 'bat_smoke',
        4, 5000, 19048, 5, 20000);
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_003c', 'bil_003', 'prd_smoke', 'bat_smoke',
        4, 5000, 19047, 5, 20000);
INSERT INTO payments (id, bill_id, mode, amount_paise)
VALUES ('pay_003', 'bil_003', 'cash', 50000);

-- ---- Bill 4: 1 line × ₹150 credit (paper says 'khata') ----
INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                   gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
VALUES ('bil_004', 'shop_main', 'PILOT-2026-004', '2026-04-16T15:45:00.000Z',
        'usr_smoke', 'intra_state', 14286, 15000, 'credit');
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_004a', 'bil_004', 'prd_smoke', 'bat_smoke',
        3, 5000, 14286, 5, 15000);
INSERT INTO payments (id, bill_id, mode, amount_paise)
VALUES ('pay_004', 'bil_004', 'credit', 15000);

-- ---- Bill 5: 1 line × ₹75 upi ----
INSERT INTO bills (id, shop_id, bill_no, billed_at, cashier_id,
                   gst_treatment, subtotal_paise, grand_total_paise, payment_mode)
VALUES ('bil_005', 'shop_main', 'PILOT-2026-005', '2026-04-17T08:20:00.000Z',
        'usr_smoke', 'intra_state', 7143, 7500, 'upi');
INSERT INTO bill_lines (id, bill_id, product_id, batch_id, qty, mrp_paise,
                        taxable_value_paise, gst_rate, line_total_paise)
VALUES ('bln_005a', 'bil_005', 'prd_smoke', 'bat_smoke',
        1, 7500, 7143, 5, 7500);
INSERT INTO payments (id, bill_id, mode, amount_paise)
VALUES ('pay_005', 'bil_005', 'upi', 7500);
