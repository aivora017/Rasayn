# ADR 0076 — `pcall` ported to bash with `cargo metadata` gate (S28-B4)

**Date:** 2026-05-08 · **Status:** ACCEPTED · **Decider:** Sourav Shaw, founder
**Authority rank:** Rank-3 (operational tooling).

**Relates to:** WORKING_PATTERNS sec 13 (never push on red), sec 14
(`cargo metadata` precedes `cargo fmt`), sec 15 (sandbox-first), sec 17
(WSL2 migration mandatory). OPERATING_MODE.md rule 1 (sandbox-first,
PowerShell-last). FORWARD_PLAN_v5 Day 1 wave B4.

---

## Context

The S27 push regression on 2026-05-08 left `cargo fmt` reporting
`error: key with no value, expected '='` at `Cargo.toml:53`. The local
PowerShell `pcall` validator ran turbo typecheck (which has no Cargo.toml
dependency) and reported green. Sourav nearly pushed a manifest-corrupt
build; only an eyeballed scroll of the `cargo fmt` output caught it in
time. WORKING_PATTERNS sec 14 codified the rule: **`cargo metadata`
must gate before `cargo fmt`**, because fmt's own error messages on a
malformed manifest are misleading ("unclosed delimiter" when the real
problem is a wrap that lost its `#`).

Two compounding reasons drove a bash port:

1. **Sandbox-first (sec 15, OPERATING_MODE rule 1)**: The Cowork
   sandbox + WSL2 are now the default development environment.
   PowerShell remains for Windows-only artifacts (DigiCert signing,
   Tauri MSI build, onsite installs). Validation tooling living in
   PowerShell forces every push through the user's terminal — exactly
   the per-keystroke round-trip OPERATING_MODE banned.
2. **WSL2 mandatory (sec 17)**: With WSL2 mandatory for development,
   any new pre-push tool ships in bash form first. PowerShell parity,
   if ever needed, is a separate file (`pcall.ps1`) — not the source
   of truth.

We also need:

- **Fail-fast** so a manifest break does not waste 60s of turbo run.
- **Cheap-first ordering** so the most likely failure trips first.
- **Machine-parseable logs** so CI / future tooling can grep
  `[PCALL gate=<name> status=<state>]` without DOM-scraping.
- **Atomic JSON summary** (`pcall-summary.json`) so two parallel
  agents pushing in separate worktrees do not corrupt each other's
  post-mortem artifact.

## Decision

Ship a bash-only `pcall` with the gate-chain below. PowerShell parity
is **explicitly deferred**.

### Gate chain (canonical order)

| # | Gate | Source of truth | Failure semantics |
|---|------|-----------------|-------------------|
| 1 | `cargo-metadata` | `cargo metadata --no-deps -q` | FAIL → abort. Manifest invalid; fmt/clippy cannot meaningfully run. |
| 2 | `cargo-fmt` | `cargo fmt -- --check` | FAIL → abort. CI's first hard gate. |
| 3 | `clippy` | `cargo clippy --no-deps -- -D warnings` | Opt-in via `PCALL_CLIPPY=1` or `--gate=clippy`. CI runs unconditionally. |
| 4 | `tsc` | `turbo run typecheck` | FAIL → abort. |
| 5 | `turbo-test` | `turbo run test --filter=...[HEAD^1]` | FAIL → abort. Falls back to full suite if `HEAD^1` absent. |
| 6 | `graph-lint` | `pnpm graph-lint` if defined | WARN-and-continue if not yet wired (S29 task). |

Gate names are stable contract; renames require an ADR amendment.

### Skip semantics

- `PCALL_SKIP=a,b,c` — env var, comma-separated. Skips by name.
- `--gate=<name>` — runs only that gate; all others skipped with
  reason `single-gate-mode`.
- A gate may also self-skip (return 77) when its toolchain is missing
  (`cargo-not-on-PATH`, `no-pnpm-no-npm`, `manifest-not-found`).
  Self-skips do NOT abort the chain — they degrade gracefully so the
  hook still validates whatever IS available.
- A gate may WARN (return 78) when the underlying check is not yet
  wired (e.g. SYSTEM_GRAPH lint script not in `package.json`). WARN is
  green-but-noisy.

### Output contract

Every gate emits exactly two lines on stdout:

```
[PCALL gate=<name> status=START]
[PCALL gate=<name> status=<PASS|FAIL|SKIP|WARN> elapsed=<ms>ms]
```

`pcall-summary.json` (`schema: "pcall-summary/v1"`) is always written,
even on FAIL — it's a post-mortem artifact. Atomic write via mktemp +
mv. Path overridable with `PCALL_SUMMARY=...`.

### Install path

`scripts/pre-push/install-hook.sh` sets `core.hooksPath = .githooks`
and writes `.githooks/pre-push` as a one-line wrapper:

```bash
exec "$(git rev-parse --show-toplevel)/scripts/pre-push/pcall.sh" "$@"
```

The wrapper stays trivial so changes to the gate-chain require zero
hook surgery.

## Consequences

### Positive

- The S27-class regression cannot recur silently: `cargo metadata`
  trips in <500ms before any other gate runs.
- Sandbox-first parity: every gate runs in the Cowork bash + WSL2
  with no PowerShell paste-back round-trip.
- Machine-parseable log lines and JSON summary unblock future CI hooks
  and a future "show me the last 10 push outcomes" CLI.
- Concurrent pushes in different worktrees do not corrupt
  `pcall-summary.json` (atomic mv).

### Negative

- Default-off clippy is a real gap: clippy errors will reach CI before
  the founder sees them locally. Mitigated by docs and `PCALL_CLIPPY=1`
  for the day-of-push run.
- No PowerShell parity: a Windows-native dev who has not migrated to
  WSL2 cannot run `pcall`. This is intentional — sec 17 declares WSL2
  mandatory — but it does mean we will NOT support a PowerShell port
  unless onboarding a non-WSL Windows contributor materially changes
  that calculus.
- `turbo-test --filter=...[HEAD^1]` can miss a regression that crosses
  package boundaries. CI runs the full suite; `pcall` is a fast-path,
  not the canonical answer.

### Mitigations

- README documents `PCALL_CLIPPY=1` as a "before-push-of-Rust-changes"
  habit.
- README documents `git push --no-verify` as the emergency bypass.
- A future ADR (TBD) may add a `cargo-test` gate gated behind
  `PCALL_FULL=1` for the lead's pre-merge gate run.

## Alternatives considered

1. **Keep PowerShell-only `pcall`.** Rejected. Forces every push
   through the user's terminal. OPERATING_MODE rule 1 violation.
2. **Single bash one-liner in `.githooks/pre-push`.** Rejected. Six
   gates with skip-list / single-gate / JSON summary semantics is a
   500-line script — not a one-liner.
3. **`pre-commit` framework.** Rejected. Heavy install footprint
   (Python venv, hook installer per repo), and we need cargo-aware
   gates not in its registry.
4. **Husky / lint-staged.** Rejected. JS-monorepo-shaped; awkward fit
   for a Rust+TS hybrid where the cheapest gate is Rust-side.

## Test plan

`scripts/pre-push/__tests__/test_pcall.sh` — 4 cases:

1. All-skip-mode → clean exit + JSON written.
2. `cargo-metadata` FAIL → fail-fast, cargo-fmt never starts.
3. `cargo-fmt` FAIL after metadata PASS → exit 1, fmt FAIL logged.
4. `--gate=tsc --dry-run` → only tsc planned; others skipped.

Each test uses a scratch repo + a fake `cargo` shim on `PATH`. Bats is
NOT required; switching later is a rename (`test_pcall.sh` →
`pcall.bats`) with each `test_NN` -> `@test "..." { ... }`.

## Roll-out

| Step | Owner | Status |
|---|---|---|
| Files written + tested sandbox-side | S28-B4 agent | DONE |
| `bash scripts/pre-push/install-hook.sh` on lead's worktree | Lead | TBD |
| Founder runs install-hook in WSL2 dev rig | Sourav | TBD |
| First push runs through bash hook, not PowerShell | Lead | TBD |
| ADR linked from WORKING_PATTERNS sec 14 | Lead | TBD |

## References

- WORKING_PATTERNS.md sec 13, 14, 15, 17
- OPERATING_MODE.md rule 1 (sandbox-first)
- FORWARD_PLAN_v5_2026-05-08.md Day 1 wave B4
- S27 push post-mortem (CURRENT_SPRINT_STATE 2026-05-08 entry)
