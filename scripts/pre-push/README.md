# `pcall` — pre-push validator (bash port)

> Local pre-push gate-chain. Runs the same validation CI runs, ordered
> cheapest-first so a corrupt `Cargo.toml` trips in <500ms instead of
> after a minute of turbo. Codified after the S27 push regression
> (see `_research_brain/08_rules/WORKING_PATTERNS.md` sec 13–14).

## What it does

Runs six gates in this order on every `git push`. Each gate prints
machine-parseable lines:

```
[PCALL gate=<name> status=START]
[PCALL gate=<name> status=PASS|FAIL|SKIP|WARN elapsed=<ms>ms]
```

| # | Gate | What | Why |
|---|---|---|---|
| 1 | `cargo-metadata` | `cargo metadata --no-deps -q` against `apps/desktop/src-tauri/Cargo.toml` | Cheapest fail. Catches the S27 mojibake-comment-wrap class. `cargo fmt` cannot run on a manifest that won't parse — see WORKING_PATTERNS sec 14. |
| 2 | `cargo-fmt` | `cargo fmt -- --check` | CI's first hard gate. Anything fmt rejects = anything CI rejects. |
| 3 | `clippy` | `cargo clippy --no-deps -- -D warnings` | Opt-in. Off by default to keep pre-push fast. Set `PCALL_CLIPPY=1` or `--gate=clippy`. |
| 4 | `tsc` | `turbo run typecheck` | Fans across all packages via root script. |
| 5 | `turbo-test` | `turbo run test --filter=...[HEAD^1]` | Changed packages only. Falls back to full suite if `HEAD^1` doesn't exist (shallow clone, fresh branch). |
| 6 | `graph-lint` | root `graph-lint` script if defined | SYSTEM_GRAPH consistency. WARN-and-skip if the script doesn't exist yet. |

Any FAIL aborts the chain immediately (fail-fast). Per
`WORKING_PATTERNS sec 13`: never push on red.

## Install

```bash
bash scripts/pre-push/install-hook.sh
```

This sets `git config core.hooksPath .githooks` and writes a one-line
wrapper at `.githooks/pre-push` that execs `scripts/pre-push/pcall.sh`.
Idempotent — safe to re-run.

To uninstall:

```bash
git config --unset core.hooksPath
```

## Usage

| Want to | Do |
|---|---|
| See what gates would run | `scripts/pre-push/pcall.sh --dry-run` |
| Show help | `scripts/pre-push/pcall.sh --gate=help` |
| Run only one gate | `scripts/pre-push/pcall.sh --gate=cargo-fmt` |
| Skip a gate this push | `PCALL_SKIP=clippy git push` |
| Skip multiple gates | `PCALL_SKIP=clippy,turbo-test git push` |
| Force-run clippy in default chain | `PCALL_CLIPPY=1 git push` |
| Override summary path | `PCALL_SUMMARY=/tmp/x.json scripts/pre-push/pcall.sh` |
| Disable colors | `NO_COLOR=1 scripts/pre-push/pcall.sh` |
| Bypass entirely (last resort) | `git push --no-verify` |

> `--no-verify` is for true emergencies. If you find yourself reaching
> for it more than once a sprint, fix the gate, don't bypass it.

## Output: `pcall-summary.json`

Always written at `<repo-root>/pcall-summary.json` (override with
`PCALL_SUMMARY`). Atomic write (temp file + `mv`), so concurrent runs
do not corrupt it.

```json
{
  "schema": "pcall-summary/v1",
  "ts_iso": "2026-05-08T07:21:06Z",
  "gates": [
    {"name": "cargo-metadata", "status": "PASS", "elapsed_ms": 412, "reason": ""},
    {"name": "cargo-fmt",      "status": "PASS", "elapsed_ms": 187, "reason": ""},
    {"name": "clippy",         "status": "SKIP", "elapsed_ms": 0,   "reason": "opt-in-only-set-PCALL_CLIPPY=1"},
    {"name": "tsc",            "status": "PASS", "elapsed_ms": 8420,"reason": ""},
    {"name": "turbo-test",     "status": "PASS", "elapsed_ms": 12100,"reason": ""},
    {"name": "graph-lint",     "status": "WARN", "elapsed_ms": 1,   "reason": "no-graph-lint-script-in-package.json"}
  ]
}
```

Status values:

- `PASS` — gate ran and returned 0.
- `FAIL` — gate ran and returned non-zero. Push aborted.
- `SKIP` — gate not run. Reasons: `PCALL_SKIP=...`, `single-gate-mode`, `cargo-not-on-PATH`, `manifest-not-found:<path>`, `no-pnpm-no-npm`, `opt-in-only-set-PCALL_CLIPPY=1`.
- `WARN` — gate cannot run but the situation is benign (e.g. SYSTEM_GRAPH lint not yet wired). Does not abort.

## Toolchain expectations

| Tool | Required? | If missing |
|---|---|---|
| `bash` 4+ | Yes | Hook fails to run |
| `git` | Yes | Hook fails (used to find repo root) |
| `cargo` | Recommended | Cargo gates SKIP with `cargo-not-on-PATH`. JS gates still run. Founder must `rustup` on dev rig. |
| `pnpm` | Preferred | Falls back to `npm`. |
| `npm` | Required if no pnpm | JS gates SKIP with `no-pnpm-no-npm`. |
| `python3` | No | Not used at runtime. (Used in test scaffolding only.) |
| `shellcheck` | No | Optional; CI may add it later. |
| `bats` | No | Tests use plain bash. |

## Design notes — why these defaults

- **`cargo-metadata` first**: WORKING_PATTERNS sec 14. The S27 push
  regression was a Cargo.toml comment-wrap that `cargo fmt` rejected
  with a confusing "unclosed delimiter" message. `cargo metadata` is
  the canonical "is this manifest valid?" check and fails in <500ms.
- **`clippy` opt-in**: Empirically clippy on this repo takes ~30-90s
  on a cold cache. Pushes happen many times an hour. Default-off keeps
  the hook fast; CI runs clippy unconditionally so nothing slips.
- **Turbo `--filter=...[HEAD^1]`**: Changed-package mode. Full suite
  is enforced by CI. Fallback to full when `HEAD^1` is absent (one-
  commit branch, shallow clone) keeps the tool robust.
- **JSON summary always written, even on FAIL**: Post-mortem artifact.
  Makes "why did the hook fail?" answerable from a one-line `jq`.
- **Atomic write**: Two parallel pushes in two terminals must not
  half-overwrite each other's summary. `mv` after `mktemp`.
- **No PowerShell shimming**: Bash-first per OPERATING_MODE rule 1.
  Windows users go through WSL2 or the Cowork sandbox. PowerShell
  parity, if ever needed, would be a separate `pcall.ps1`.

## Tests

```bash
bash scripts/pre-push/__tests__/test_pcall.sh
```

Four cases:
1. All-skip-mode runs clean (exit 0, JSON written, all SKIP).
2. `cargo-metadata` FAIL aborts the chain (fail-fast; cargo-fmt never starts).
3. `cargo-fmt` FAIL after `cargo-metadata` PASS (exit 1, FAIL logged).
4. `--gate=tsc` isolates tsc (others skipped with single-gate-mode reason).

Each test uses a scratch repo + a fake `cargo` shim on `PATH` to
exercise the dispatcher without needing a real toolchain.

## ADR

`docs/adr/0076-pcall-bash-port.md` — decision rationale, gate ordering,
WORKING_PATTERNS sec 13/14 references.
