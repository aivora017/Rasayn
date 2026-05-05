#!/usr/bin/env python3
"""
scripts/perf/promote-baseline.py

Promote a candidate perf-results JSON to tests/perf/baseline.json.

Usage:
  python3 scripts/perf/promote-baseline.py tests/perf/results/results-<sha>-<utc>.json

Validates the candidate has all required fields, preserves the
authoritative budget_ms / sla_origin keys from the existing baseline
(ADR-0067 / Playbook v2.0 §10), then atomically replaces baseline.json
via write-temp + os.rename.

Python 3.8+ stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict

REQUIRED_TOP = ("version", "captured_at", "git_sha", "host_info", "metrics")
REQUIRED_HOST = ("hostname", "cpu", "ram_mb", "disk", "os")
REQUIRED_METRICS = ("cold_start_ms", "bill_save_ms")
REQUIRED_METRIC_FIELDS = ("p50", "p95", "samples")


def fail(msg: str) -> "None":
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(2)


def validate(doc: Dict[str, Any]) -> None:
    for k in REQUIRED_TOP:
        if k not in doc:
            fail(f"candidate missing top-level key: {k}")
    host = doc.get("host_info") or {}
    for k in REQUIRED_HOST:
        if k not in host:
            fail(f"candidate.host_info missing key: {k}")
    metrics = doc.get("metrics") or {}
    for m in REQUIRED_METRICS:
        if m not in metrics:
            fail(f"candidate.metrics missing key: {m}")
        for f in REQUIRED_METRIC_FIELDS:
            if f not in metrics[m]:
                fail(f"candidate.metrics.{m} missing field: {f}")
        # Reject promotion of a result with null p95 - that means the
        # bench run did not produce numbers, do not poison the baseline.
        if metrics[m].get("p95") is None:
            fail(f"candidate.metrics.{m}.p95 is null - refusing to promote")


def main(argv: "list[str] | None" = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("candidate", help="Path to candidate results JSON.")
    ap.add_argument(
        "--baseline",
        default="tests/perf/baseline.json",
        help="Path to baseline JSON (default: tests/perf/baseline.json).",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="Skip validation (still required: file must parse).",
    )
    args = ap.parse_args(argv)

    cand_path = Path(args.candidate)
    base_path = Path(args.baseline)

    try:
        with cand_path.open("r", encoding="utf-8") as f:
            cand = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        fail(f"cannot read candidate {cand_path}: {e}")

    if not args.force:
        validate(cand)

    # Preserve budget_ms / sla_origin from existing baseline (Section 10
    # authoritative numbers, ADR-0067). If baseline does not exist yet,
    # fall back to defaults; the operator must hand-edit then.
    existing: Dict[str, Any] = {}
    if base_path.exists():
        try:
            with base_path.open("r", encoding="utf-8") as f:
                existing = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            fail(f"cannot read existing baseline {base_path}: {e}")

    existing_metrics = (existing.get("metrics") or {})

    promoted_metrics: Dict[str, Any] = {}
    for m in REQUIRED_METRICS:
        cand_m = cand["metrics"][m]
        prev_m = existing_metrics.get(m, {}) or {}
        promoted_metrics[m] = {
            "p50": cand_m.get("p50"),
            "p95": cand_m.get("p95"),
            "samples": cand_m.get("samples", 0),
            # Preserve §10 budget / origin from prior baseline.
            "budget_ms": prev_m.get("budget_ms"),
            "sla_origin": prev_m.get("sla_origin"),
        }

    promoted = {
        "version": 1,
        "captured_at": cand.get("captured_at"),
        "captured_on_machine": (cand.get("host_info") or {}).get("hostname"),
        "git_sha": cand.get("git_sha"),
        "host_info": cand.get("host_info"),
        "metrics": promoted_metrics,
        "is_pilot_baseline": True,
        "notes": (
            "Promoted from "
            f"{cand_path.name} via scripts/perf/promote-baseline.py. "
            "See docs/runbooks/perf-drill-jagannath.md."
        ),
    }

    # Atomic write: temp file in same dir, then os.rename.
    base_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=".baseline-", suffix=".json.tmp", dir=str(base_path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(promoted, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp_name, base_path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    print(f"promoted: {base_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
