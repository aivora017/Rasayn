#!/usr/bin/env python3
"""
scripts/perf/check-baseline.py

Compare a candidate perf-results JSON against tests/perf/baseline.json.

Exit codes:
  0  - all metrics within budget AND no >10% regression vs baseline
  1  - one or more metrics exceeds the §10 GA-gate budget_ms
  2  - one or more metrics regresses >10% vs baseline (but still under budget)
  3  - argument / IO / parse error

Usage:
  python3 scripts/perf/check-baseline.py path/to/results-<sha>-<utc>.json
  python3 scripts/perf/check-baseline.py path/to/results.json --baseline tests/perf/baseline.json

Prints a Markdown summary table to stdout suitable for pasting into a PR.
No external dependencies (Python 3.8+ stdlib only).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

REGRESS_PCT = 10.0  # >10% slower than baseline triggers exit 2.

EXIT_OK = 0
EXIT_BUDGET = 1
EXIT_REGRESSION = 2
EXIT_ERROR = 3

METRIC_KEYS = ("cold_start_ms", "bill_save_ms")


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def fnum(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def classify(
    name: str,
    candidate_p95: Optional[float],
    baseline_p95: Optional[float],
    budget_ms: Optional[float],
) -> Tuple[str, str]:
    """Return (status, note). status in {OK, BUDGET, REGRESSION, MISSING}."""
    if candidate_p95 is None:
        return ("MISSING", "candidate p95 missing")
    if budget_ms is not None and candidate_p95 > budget_ms:
        return ("BUDGET", f"exceeds budget {budget_ms:.0f}ms")
    if baseline_p95 is not None and baseline_p95 > 0:
        delta_pct = (candidate_p95 - baseline_p95) / baseline_p95 * 100.0
        if delta_pct > REGRESS_PCT:
            return ("REGRESSION", f"+{delta_pct:.1f}% vs baseline")
    return ("OK", "within budget and baseline")


def fmt_ms(v: Optional[float]) -> str:
    return "n/a" if v is None else f"{v:.1f} ms"


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("candidate", help="Path to candidate results JSON.")
    ap.add_argument(
        "--baseline",
        default="tests/perf/baseline.json",
        help="Path to baseline JSON (default: tests/perf/baseline.json).",
    )
    args = ap.parse_args(argv)

    cand_path = Path(args.candidate)
    base_path = Path(args.baseline)

    try:
        cand = load_json(cand_path)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: cannot read candidate {cand_path}: {e}", file=sys.stderr)
        return EXIT_ERROR
    try:
        base = load_json(base_path)
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: cannot read baseline {base_path}: {e}", file=sys.stderr)
        return EXIT_ERROR

    cand_metrics = cand.get("metrics", {}) or {}
    base_metrics = base.get("metrics", {}) or {}

    rows = []
    overall = EXIT_OK
    for key in METRIC_KEYS:
        c = cand_metrics.get(key, {}) or {}
        b = base_metrics.get(key, {}) or {}
        cand_p95 = fnum(c.get("p95"))
        base_p95 = fnum(b.get("p95"))
        budget = fnum(b.get("budget_ms"))
        status, note = classify(key, cand_p95, base_p95, budget)
        rows.append((key, cand_p95, base_p95, budget, status, note))
        if status == "BUDGET" and overall != EXIT_BUDGET:
            overall = EXIT_BUDGET
        elif status == "REGRESSION" and overall == EXIT_OK:
            overall = EXIT_REGRESSION
        elif status == "MISSING" and overall == EXIT_OK:
            overall = EXIT_BUDGET  # treat missing data as a hard fail.

    # Markdown summary
    sha = cand.get("git_sha", "?")
    ts = cand.get("captured_at", "?")
    host = (cand.get("host_info") or {}).get("hostname", "?")
    print(f"## Perf check: `{sha}` @ `{ts}` on `{host}`\n")
    print("| Metric | Candidate p95 | Baseline p95 | Budget (ADR-0067 / §10) | Status | Note |")
    print("|---|---|---|---|---|---|")
    for key, c95, b95, bud, status, note in rows:
        print(
            f"| `{key}` | {fmt_ms(c95)} | {fmt_ms(b95)} | "
            f"{fmt_ms(bud)} | **{status}** | {note} |"
        )
    print()
    print({
        EXIT_OK: "Result: PASS (within budget and baseline).",
        EXIT_BUDGET: "Result: FAIL - over budget. Block merge per §10 GA gate.",
        EXIT_REGRESSION: "Result: WARN - >10% regression vs baseline. File regression issue.",
    }.get(overall, f"Result: exit {overall}"))
    return overall


if __name__ == "__main__":
    sys.exit(main())
