# ADR-002: SQLite as LAN-local datastore; dual-runtime SQL

**Date:** 2026-04-14
**Status:** Accepted
**Supersedes:** —

## Context
Playbook v2.0 §8.1 locks SQLite as the local store for the desktop POS (LAN-first, offline-capable, sub-2s billing on Win7/4GB). We need:
1. A single source of truth for schema + migrations, consumed by two runtimes (Rust/`rusqlite` in Tauri app, Node/`better-sqlite3` for host tooling and tests).
2. Referential integrity, FEFO dispensing, expired-batch hard block — enforced *at the DB layer*, not just app layer.

## Decision
- Schema + migrations live as plain `.sql` files under `packages/shared-db/migrations/NNNN_slug.sql`.
- Both Rust (`rusqlite` via `tauri-plugin-sql` + `rusqlite_migration`) and Node (`better-sqlite3` in tests/tools) execute the same files.
- Compliance invariants enforced by `CHECK` constraints + `BEFORE INSERT`/`BEFORE UPDATE` triggers (expired-batch block, qty >= 0, MRP > 0, FEFO surfaced via view).
- `PRAGMA foreign_keys=ON`, `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL` set at connection open.
- Money stored as `INTEGER` paise. ISO-8601 strings for dates.

## Consequences
+ Zero schema drift between app and tests.
+ DB-level guardrails prevent expired-drug sales even if app logic is bypassed (DBA tool, ad-hoc script).
+ WAL mode → sub-2s billing on HDD.
- Triggers add a small write-path cost; benchmarked acceptable.
- Schema changes require SQL, not an ORM abstraction; manageable at this scale.

## Alternatives considered
- **Prisma/Drizzle ORM** — rejected: dual-runtime (Rust+Node) makes a JS-only ORM unusable in Tauri core.
- **SeaORM (Rust-only)** — rejected: breaks the Node host-tooling path; migrations would become Rust-only.
- **Enforce invariants only in app code** — rejected: violates Playbook §2.5 ("compliance automatic, never manual"). DB is last line of defense.
