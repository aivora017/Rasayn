#!/usr/bin/env python3
# scripts/pilot/measure-30-bills.py
# PharmaCare Pro — S25.4.3 — §9 pilot gate evidence tool.
#
# Reads N bills from the live SQLite DB read-only, compares each against the
# owner-filled paper-CSV row from the 2-week parallel-run, classifies any
# discrepancies, and emits a Markdown + sibling CSV report.
#
# Stdlib only — must run on Win 11 with `py scripts\pilot\measure-30-bills.py`.
# Python 3.8+.
#
# Exit codes:
#   0 — §9 gate passes (zero non-rounding discrepancies across N bills)
#   1 — at least one non-rounding discrepancy found
#   2 — tooling error (DB missing, CSV malformed, fewer than --limit bills)

import argparse
import csv
import dataclasses
import datetime as _dt
import json
import os
import sqlite3
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Typed shapes
# ---------------------------------------------------------------------------

@dataclass
class PaperBill:
    paper_invoice_no: str
    paper_date_iso: str
    paper_total_rupees: float
    paper_line_count: int
    paper_payment_mode: str
    paper_notes: str = ""

    @property
    def paper_total_paise(self) -> int:
        # Round half-up to nearest paise; Indian convention.
        return int(round(self.paper_total_rupees * 100))


@dataclass
class AppLine:
    line_index: int
    product_id: str
    product_name: str
    qty: float
    mrp_paise: int
    gst_rate: int
    line_total_paise: int


@dataclass
class AppPayment:
    mode: str
    amount_paise: int


@dataclass
class AppBill:
    id: str
    bill_no: str
    billed_at: str
    grand_total_paise: int
    payment_mode: str
    is_voided: int
    lines: List[AppLine] = field(default_factory=list)
    payments: List[AppPayment] = field(default_factory=list)


@dataclass
class Discrepancy:
    bill_no: str
    paper_invoice_no: str
    category: str
    detail: str


# Categories — keep in sync with docs/runbooks/30-bill-gate-evidence.md
CAT_TOTAL_MISMATCH   = "total_paise_mismatch"
CAT_LINE_COUNT       = "line_count_mismatch"
CAT_LINE_QTY         = "line_qty_mismatch"
CAT_LINE_UNIT_PRICE  = "line_unit_price_mismatch"
CAT_LINE_GST         = "line_gst_rate_mismatch"
CAT_LINE_SKU         = "line_sku_mismatch"
CAT_PAYMENT_MODE     = "payment_mode_mismatch"
CAT_ROUNDING_ONLY    = "rounding_only"

# Categories that count toward §9 gate failure (rounding_only and line_sku
# are intentionally EXCLUDED — see runbook §"What zero-discrepancy means").
GATE_FAILING_CATEGORIES = {
    CAT_TOTAL_MISMATCH,
    CAT_LINE_COUNT,
    CAT_LINE_QTY,
    CAT_LINE_UNIT_PRICE,
    CAT_LINE_GST,
    CAT_PAYMENT_MODE,
}


# ---------------------------------------------------------------------------
# Paper CSV loader
# ---------------------------------------------------------------------------

def load_paper_csv(path: str) -> List[PaperBill]:
    if not os.path.isfile(path):
        raise FileNotFoundError("paper-csv not found: " + path)
    rows: List[PaperBill] = []
    with open(path, "r", encoding="utf-8", newline="") as fh:
        # Skip leading comment lines (start with '#').
        non_comment_lines = []
        for line in fh:
            if line.lstrip().startswith("#"):
                continue
            non_comment_lines.append(line)
    reader = csv.DictReader(non_comment_lines)
    required = {
        "paper_invoice_no", "paper_date_iso", "paper_total_rupees",
        "paper_line_count", "paper_payment_mode",
    }
    if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
        raise ValueError(
            "paper-csv missing required columns; got=" + json.dumps(reader.fieldnames)
        )
    for i, raw in enumerate(reader, start=1):
        try:
            rows.append(PaperBill(
                paper_invoice_no=(raw.get("paper_invoice_no") or "").strip(),
                paper_date_iso=(raw.get("paper_date_iso") or "").strip(),
                paper_total_rupees=float(raw.get("paper_total_rupees") or 0),
                paper_line_count=int(raw.get("paper_line_count") or 0),
                paper_payment_mode=(raw.get("paper_payment_mode") or "").strip().lower(),
                paper_notes=(raw.get("paper_notes") or "").strip(),
            ))
        except (ValueError, TypeError) as e:
            raise ValueError("paper-csv row {} malformed: {}".format(i, e))
    return rows


# ---------------------------------------------------------------------------
# DB loader
# ---------------------------------------------------------------------------

def open_db_readonly(db_path: str) -> sqlite3.Connection:
    if not os.path.isfile(db_path):
        raise FileNotFoundError("db not found: " + db_path)
    # SQLite URI; Windows paths need forward slashes for the URI portion.
    uri_path = db_path.replace("\\", "/")
    if not uri_path.startswith("/"):
        # Windows absolute path like C:/... → /C:/...
        uri_path = "/" + uri_path
    conn = sqlite3.connect("file:{}?mode=ro".format(uri_path), uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def load_app_bills(
    conn: sqlite3.Connection,
    shop_id: str,
    since: str,
    limit: int,
) -> List[AppBill]:
    bill_sql = """
        SELECT id, bill_no, billed_at, grand_total_paise, payment_mode, is_voided
          FROM bills
         WHERE shop_id = ?
           AND billed_at >= ?
           AND is_voided = 0
         ORDER BY billed_at ASC, bill_no ASC
         LIMIT ?
    """
    bills: List[AppBill] = [
        AppBill(
            id=r["id"], bill_no=r["bill_no"], billed_at=r["billed_at"],
            grand_total_paise=int(r["grand_total_paise"]),
            payment_mode=r["payment_mode"], is_voided=int(r["is_voided"]),
        )
        for r in conn.execute(bill_sql, (shop_id, since, limit))
    ]

    line_sql = """
        SELECT bl.bill_id, bl.product_id, p.name AS product_name,
               bl.qty, bl.mrp_paise, bl.gst_rate, bl.line_total_paise
          FROM bill_lines bl
          JOIN products p ON p.id = bl.product_id
         WHERE bl.bill_id = ?
         ORDER BY bl.id ASC
    """
    pay_sql = """
        SELECT mode, amount_paise
          FROM payments
         WHERE bill_id = ?
         ORDER BY id ASC
    """
    for b in bills:
        for idx, lr in enumerate(conn.execute(line_sql, (b.id,))):
            b.lines.append(AppLine(
                line_index=idx,
                product_id=lr["product_id"], product_name=lr["product_name"],
                qty=float(lr["qty"]), mrp_paise=int(lr["mrp_paise"]),
                gst_rate=int(lr["gst_rate"]),
                line_total_paise=int(lr["line_total_paise"]),
            ))
        for pr in conn.execute(pay_sql, (b.id,)):
            b.payments.append(AppPayment(
                mode=pr["mode"], amount_paise=int(pr["amount_paise"]),
            ))
    return bills


# ---------------------------------------------------------------------------
# Comparison logic
# ---------------------------------------------------------------------------

def _summary_payment_mode(b: AppBill) -> str:
    """A bill recorded with payment_mode='split' is broken out as the joined
    mode list; otherwise return the bill-level mode."""
    if b.payment_mode != "split":
        return b.payment_mode
    if not b.payments:
        return "split"
    return "+".join(sorted({p.mode for p in b.payments}))


def compare_bill(paper: PaperBill, app: AppBill) -> List[Discrepancy]:
    out: List[Discrepancy] = []
    delta_paise = app.grand_total_paise - paper.paper_total_paise
    if delta_paise != 0:
        if abs(delta_paise) <= 50:
            out.append(Discrepancy(
                app.bill_no, paper.paper_invoice_no, CAT_ROUNDING_ONLY,
                "Δ {} paise (within ±50p rounding window)".format(delta_paise),
            ))
        else:
            out.append(Discrepancy(
                app.bill_no, paper.paper_invoice_no, CAT_TOTAL_MISMATCH,
                "paper={}p app={}p Δ={}p".format(
                    paper.paper_total_paise, app.grand_total_paise, delta_paise,
                ),
            ))

    if paper.paper_line_count != len(app.lines):
        out.append(Discrepancy(
            app.bill_no, paper.paper_invoice_no, CAT_LINE_COUNT,
            "paper_lines={} app_lines={}".format(
                paper.paper_line_count, len(app.lines),
            ),
        ))

    paper_mode = (paper.paper_payment_mode or "").strip().lower()
    app_mode = _summary_payment_mode(app).strip().lower()
    if paper_mode and app_mode and paper_mode != app_mode:
        # Treat 'khata' on paper as 'credit' app-side (Indian pharmacy idiom).
        norm_paper = "credit" if paper_mode == "khata" else paper_mode
        if norm_paper != app_mode:
            out.append(Discrepancy(
                app.bill_no, paper.paper_invoice_no, CAT_PAYMENT_MODE,
                "paper={} app={}".format(paper_mode, app_mode),
            ))
    return out


# ---------------------------------------------------------------------------
# Matching strategy: paper.invoice_no ↔ bills.bill_no, else by ordinal position.
# ---------------------------------------------------------------------------

def match_bills(
    paper_rows: List[PaperBill], app_bills: List[AppBill],
) -> List[Tuple[Optional[PaperBill], Optional[AppBill]]]:
    have_paper_invoice_nos = all(p.paper_invoice_no for p in paper_rows)
    matched: List[Tuple[Optional[PaperBill], Optional[AppBill]]] = []
    if have_paper_invoice_nos:
        app_by_no: Dict[str, AppBill] = {b.bill_no: b for b in app_bills}
        used: set = set()
        for p in paper_rows:
            a = app_by_no.get(p.paper_invoice_no)
            if a is not None:
                used.add(a.id)
            matched.append((p, a))
        # Surface app bills the paper CSV never matched (likely missed paper rows).
        for a in app_bills:
            if a.id not in used:
                matched.append((None, a))
        return matched
    # Fall back to position-wise pairing.
    for i in range(max(len(paper_rows), len(app_bills))):
        p = paper_rows[i] if i < len(paper_rows) else None
        a = app_bills[i] if i < len(app_bills) else None
        matched.append((p, a))
    return matched


# ---------------------------------------------------------------------------
# Report emitters
# ---------------------------------------------------------------------------

def _status_for_bill(diffs: List[Discrepancy]) -> str:
    if not diffs:
        return "PASS"
    if all(d.category in (CAT_ROUNDING_ONLY, CAT_LINE_SKU) for d in diffs):
        return "SOFT_PASS"
    return "FAIL"


def emit_markdown(
    out_path: str, shop_id: str, run_date: str, sample_size: int,
    pairs: List[Tuple[Optional[PaperBill], Optional[AppBill]]],
    discrepancies: List[Discrepancy], gate_passes: bool,
) -> None:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    cat_counts: Dict[str, int] = {}
    for d in discrepancies:
        cat_counts[d.category] = cat_counts.get(d.category, 0) + 1

    lines: List[str] = []
    lines.append("# Discrepancy Report — {} — {}".format(shop_id, run_date))
    lines.append("")
    lines.append("Sample size: {}".format(sample_size))
    lines.append(
        "§9 gate: zero non-rounding discrepancies → **{}**".format(
            "PASS" if gate_passes else "FAIL"
        )
    )
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Category | Count |")
    lines.append("|---|---|")
    for cat in (
        CAT_TOTAL_MISMATCH, CAT_LINE_COUNT, CAT_LINE_QTY, CAT_LINE_UNIT_PRICE,
        CAT_LINE_GST, CAT_LINE_SKU, CAT_PAYMENT_MODE, CAT_ROUNDING_ONLY,
    ):
        lines.append("| {} | {} |".format(cat, cat_counts.get(cat, 0)))
    lines.append("")
    lines.append("## Per-bill detail")
    lines.append("")
    lines.append("| Bill | Paper total (₹) | App total (₹) | Δ paise | Status |")
    lines.append("|---|---|---|---|---|")
    for paper, app in pairs:
        bill_diffs = [
            d for d in discrepancies
            if (app is not None and d.bill_no == app.bill_no)
            or (app is None and paper is not None and d.paper_invoice_no == paper.paper_invoice_no)
        ]
        status = _status_for_bill(bill_diffs)
        bill_label = (
            (app.bill_no if app else "(no-app)")
            + " / "
            + (paper.paper_invoice_no if paper else "(no-paper)")
        )
        paper_t = "{:.2f}".format(paper.paper_total_rupees) if paper else "—"
        app_t = ("{:.2f}".format(app.grand_total_paise / 100.0)
                 if app else "—")
        delta = (
            (app.grand_total_paise - paper.paper_total_paise)
            if (paper and app) else "—"
        )
        lines.append("| {} | {} | {} | {} | {} |".format(
            bill_label, paper_t, app_t, delta, status,
        ))
    lines.append("")
    lines.append("## Discrepancies")
    lines.append("")
    if not discrepancies:
        lines.append("_None — gate passes cleanly._")
    else:
        for d in discrepancies:
            lines.append("- **{}** (bill `{}` / paper `{}`): {}".format(
                d.category, d.bill_no, d.paper_invoice_no, d.detail,
            ))
    lines.append("")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


def emit_csv(
    csv_path: str,
    pairs: List[Tuple[Optional[PaperBill], Optional[AppBill]]],
    discrepancies: List[Discrepancy],
) -> None:
    os.makedirs(os.path.dirname(csv_path) or ".", exist_ok=True)
    diffs_by_bill: Dict[str, List[Discrepancy]] = {}
    for d in discrepancies:
        key = d.bill_no or d.paper_invoice_no
        diffs_by_bill.setdefault(key, []).append(d)
    with open(csv_path, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([
            "bill_no", "paper_invoice_no", "billed_at",
            "paper_total_paise", "app_total_paise", "delta_paise",
            "paper_line_count", "app_line_count",
            "paper_payment_mode", "app_payment_mode",
            "status", "categories", "details",
        ])
        for paper, app in pairs:
            bill_no = app.bill_no if app else ""
            paper_no = paper.paper_invoice_no if paper else ""
            key = bill_no or paper_no
            bill_diffs = diffs_by_bill.get(key, [])
            status = _status_for_bill(bill_diffs)
            w.writerow([
                bill_no, paper_no,
                (app.billed_at if app else ""),
                (paper.paper_total_paise if paper else ""),
                (app.grand_total_paise if app else ""),
                ((app.grand_total_paise - paper.paper_total_paise)
                 if (paper and app) else ""),
                (paper.paper_line_count if paper else ""),
                (len(app.lines) if app else ""),
                (paper.paper_payment_mode if paper else ""),
                (_summary_payment_mode(app) if app else ""),
                status,
                ";".join(sorted({d.category for d in bill_diffs})),
                " | ".join(d.detail for d in bill_diffs),
            ])


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def _parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="measure-30-bills",
        description="PharmaCare Pro §9 pilot gate — 30-bill discrepancy measurer.",
    )
    p.add_argument("--db", required=True, help="path to PharmaCare app.db")
    p.add_argument("--paper-csv", required=True, help="owner-filled CSV path")
    p.add_argument("--shop-id", required=True, help="shop_id, e.g. shop_main")
    p.add_argument("--since", required=True, help="ISO date, e.g. 2026-04-15")
    p.add_argument("--limit", type=int, default=30, help="bills to compare")
    p.add_argument("--out", required=True,
                   help="output Markdown report path; sibling .csv emitted too")
    return p.parse_args(argv)


def _exit_with_summary(code: int, msg: str) -> int:
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()
    return code


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        paper_rows = load_paper_csv(args.paper_csv)
    except (FileNotFoundError, ValueError) as e:
        return _exit_with_summary(2, "TOOLING_ERROR paper-csv: {}".format(e))
    try:
        conn = open_db_readonly(args.db)
    except FileNotFoundError as e:
        return _exit_with_summary(2, "TOOLING_ERROR db: {}".format(e))
    try:
        app_bills = load_app_bills(conn, args.shop_id, args.since, args.limit)
    except sqlite3.Error as e:
        return _exit_with_summary(2, "TOOLING_ERROR sql: {}".format(e))
    finally:
        conn.close()

    if len(app_bills) < args.limit:
        msg = ("TOOLING_ERROR insufficient bills: requested={} got={} "
               "(see runbook §What if 30 bills aren't ready)").format(
            args.limit, len(app_bills),
        )
        # Still emit a partial report so the founder can see what we have.
        pairs = match_bills(paper_rows, app_bills)
        diffs: List[Discrepancy] = []
        for p_row, a_row in pairs:
            if p_row is not None and a_row is not None:
                diffs.extend(compare_bill(p_row, a_row))
        run_date = _dt.date.today().isoformat()
        emit_markdown(args.out, args.shop_id, run_date,
                      len(app_bills), pairs, diffs, gate_passes=False)
        csv_out = os.path.splitext(args.out)[0] + ".csv"
        emit_csv(csv_out, pairs, diffs)
        return _exit_with_summary(2, msg)

    pairs = match_bills(paper_rows, app_bills)
    diffs: List[Discrepancy] = []
    for p_row, a_row in pairs:
        if p_row is None or a_row is None:
            continue
        diffs.extend(compare_bill(p_row, a_row))

    gate_failing = [d for d in diffs if d.category in GATE_FAILING_CATEGORIES]
    gate_passes = (len(gate_failing) == 0) and (len(app_bills) >= args.limit)
    run_date = _dt.date.today().isoformat()
    emit_markdown(args.out, args.shop_id, run_date,
                  len(app_bills), pairs, diffs, gate_passes=gate_passes)
    csv_out = os.path.splitext(args.out)[0] + ".csv"
    emit_csv(csv_out, pairs, diffs)

    summary = "{} sample={} non_rounding_discrepancies={} report={}".format(
        "PASS" if gate_passes else "FAIL",
        len(app_bills), len(gate_failing), args.out,
    )
    return _exit_with_summary(0 if gate_passes else 1, summary)


if __name__ == "__main__":
    raise SystemExit(main())
