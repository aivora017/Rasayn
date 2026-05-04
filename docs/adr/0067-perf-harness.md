# ADR 0067 — Perf harness (criterion benches for §10 GA-gate SLAs)

**Date:** 2026-05-04
**Status:** Accepted
**Decider:** Sourav Shaw, founder
**Authority rank:** Rank-3 (below Playbook v2.0 and the Design North Star).

> Numbering note: the user-facing instruction referenced "ADR-0031" but
> `docs/adr/0031-crypto-at-rest.md` already exists. This ADR is filed at the
> next free slot (0067) to avoid clobbering. Where the rest of the codebase
> says "ADR-0031 perf harness" treat that as referring to this file.

## Context

Playbook v2.0 §10 ("GA gate") fixes four hard performance budgets the
product must meet before pilot Day-1 sign-off:

1. Cold-start `< 3000 ms` on the reference rig (Lenovo i3-8100 / 4 GB RAM /
   spinning disk eligible / Windows 11 Pro). This is wall-clock from icon
   double-click to interactive Billing screen.
2. Bill save `p95 < 400 ms` measured against a warm SQLite DB with one
   shop's typical inventory (~3-5k SKUs, ~10k batches).
3. LAN failover `< 2000 ms` — when the active node drops, a sibling node
   must accept the next bill in under two seconds.
4. Cloud API `p95 < 250 ms` for the eight POS-critical endpoints.

As of S22 (main = `cf221f4` plus PRs #87-#92), there is no automated way
to measure any of those four numbers. We have 169/169 cargo tests and
294/294 desktop vitest tests, but every one of those tests is functional;
none time the hot paths. The risk is that we ship the GA build and then
discover at the pilot rig that, for example, cold-start is 6.4 s because
the 44 migrations are running against a cold OS file cache, and we have
no historical measurement to point at to argue regression vs. baseline.

The perf harness must satisfy four constraints:

- **Reproducible.** Anyone with the repo + Rust toolchain can run it.
- **Statistically honest.** Warm-up + outlier filtering, not a single
  `Instant::now()` delta.
- **Composable with CI later.** JSON output that a follow-up sprint can
  diff against a stored baseline and fail a PR on regression.
- **Cheap to skip.** Not part of `cargo test` because criterion runs are
  measured in minutes, not seconds.

## Decision

Adopt [`criterion 0.5`](https://bheisler.github.io/criterion.rs/) as the
benchmarking framework, wired into the existing `pharmacare-desktop`
crate so benches see the same migrations and the same rusqlite config
the production binary sees.

### Concrete shape

1. **`apps/desktop/src-tauri/Cargo.toml`** gains
   `criterion = "0.5"` under `[dev-dependencies]` and two
   `[[bench]]` entries (`harness = false` so criterion drives `main`).
2. **`apps/desktop/src-tauri/benches/cold_start.rs`** measures the
   migration-apply phase only — `Connection::open_in_memory()` followed
   by `execute_batch` of all 44 SQL files in
   `packages/shared-db/migrations/`. Migration apply is the dominant
   cost in cold-start after the OS loads the binary; UI bring-up is
   measured separately when S25 wires up the reference rig.
   - Budget: `1500 ms` for migrations alone (leaves `1500 ms` for UI),
     half of the §10 GA-gate `3000 ms` total.
3. **`apps/desktop/src-tauri/benches/bill_save.rs`** seeds a realistic
   in-memory DB (1 shop, 1 user, 1 supplier, 1 customer, 100 products,
   200 batches) and measures one full bill-save: 1 `bills` row + 5
   `bill_lines` + 1 `payments` row, using `iter_batched` so each sample
   gets a fresh seeded DB and we measure only the save path, not the
   seed.
   - Budget: `400 ms` p95, matching §10 directly.
4. **`scripts/perf/run-perf.sh`** + **`scripts/perf/run-perf.ps1`** wrap
   `cargo bench` and emit `tests/perf/results-<git-sha>-<utc>.json`.
5. **`tests/perf/baseline.json`** is the canonical "last known good"
   measurement keyed by metric, with budgets and SLA origins recorded
   inline. The values are `null` until S25 captures the first run on
   the reference rig at Jagannath Pharmacy (the Kalyan pilot shop).

### Out of scope for this ADR

- LAN failover (#3) and cloud API (#4) live in different layers
  (storefront + parent worker) and need their own harnesses; both will
  reuse the same `tests/perf/baseline.json` schema when they land.
- Wiring criterion's per-iteration JSON into the wrapper scripts: the
  current scripts dump the raw log and emit a stub summary. Parsing
  is a follow-up once we have one real run to template against.
- A regression-gate CI job. Benches are intentionally out of the default
  `cargo test` / `pnpm test` flows because a single criterion sample set
  takes minutes; we'll add a manual `perf` workflow later.

## Consequences

**Positive.**

- One new dev-dependency (`criterion 0.5`, MIT/Apache-2.0). No effect on
  the shipped binary because it's a `[dev-dependencies]` entry.
- Real numbers will exist before the pilot, not after.
- The same in-memory migration-apply pattern already used by the
  integration tests is reused, so the harness can't drift away from how
  production opens its DB.
- Future contributors get a documented place to add new benches; the
  pattern of "seed a DB, `iter_batched`, `BatchSize::SmallInput`" is
  copy-paste-ready.

**Negative / costs.**

- Criterion compilation adds ~20 s to the dev-dep tree on first build;
  acceptable.
- A run takes 2-5 minutes wall-clock. Devs running `cargo bench` locally
  must expect that; CI doesn't run it.
- Baseline JSON has to be refreshed manually each quarter. We document
  the cadence inside the file rather than relying on tribal knowledge.

**Mitigations.**

- The benches themselves are gated by `--bench` so `cargo test` and
  `cargo check` behaviour are unchanged.
- Wrapper scripts write to `tests/perf/` so the baseline + run history
  are captured in-repo (committed only when a run is meant to be the
  new baseline; ad-hoc runs stay un-tracked locally).

## Alternatives considered

1. **`hyperfine`.** Black-box only; can't see inside the process.
   Useful for measuring "icon double-click → main window visible" later,
   but useless for the migration-apply hot path or the bill-save hot
   path because both happen entirely inside one process invocation.
2. **Tauri's perf hooks.** Measure IPC roundtrip latency only. The
   migration phase happens before the Tauri runtime is up, and the
   bill-save inserts happen in-process under one IPC call, so Tauri
   hooks would tell us "bill_save was 380 ms" without the breakdown of
   how much was DB vs. serde vs. IPC framing.
3. **Hand-rolled `Instant::now()` macros.** No warm-up, no outlier
   filtering, no statistical confidence intervals. Would give us numbers
   but not numbers we'd trust to gate a release.
4. **`divan`** (newer Rust microbench framework). Promising but less
   mature than criterion; criterion's JSON output and HTML reports are
   battle-tested across the Rust ecosystem.

## Supersedes / superseded-by

- **Supersedes:** nothing.
- **Superseded by:** nothing yet. A follow-up ADR will land when the
  baseline is first populated (S25) and again if/when we move from
  criterion to a CI-integrated regression gate.

## Compliance check

- Playbook §10 GA-gate SLAs: addressed (cold-start + bill-save). LAN
  failover and cloud API still need their own harnesses; tracked.
- Authority rank: ADR is rank-3 (below Playbook + North Star), correct
  for an internal tooling decision.
- Pilot shop: reference rig is at Jagannath Pharmacy, Kalyan (per
  pilot_shop_jagannath memory entry).
