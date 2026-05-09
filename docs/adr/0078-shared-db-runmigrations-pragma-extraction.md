# ADR-0078 · `runMigrations` extracts `PRAGMA journal_mode` and applies it before BEGIN

- **Status:** Accepted
- **Date:** 2026-05-09
- **Sprint:** S28-F2
- **Replaces:** —
- **Supersedes:** —

## Context

`packages/shared-db/src/index.ts` exposes `runMigrations(db, dir)` which the
host migration runner, the `@pharmacare/migration-import` CLI, and several
tests use to bring a fresh SQLite file (or `:memory:` db) up to the current
schema version.

The runner wraps each migration in a transaction:

```ts
db.exec("BEGIN");
try {
  db.exec(sql);
  db.prepare("INSERT OR IGNORE INTO _migrations …").run(m.version, m.name);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
```

`packages/shared-db/migrations/0001_init.sql` declares connection-level
pragmas at the top of the file:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

SQLite forbids changing `journal_mode` while a transaction is open. Because
`runMigrations` opens an explicit `BEGIN` before `db.exec(sql)`, the WAL
pragma raises:

```
SqliteError: cannot change into wal mode from within a transaction
```

This first surfaced in the `@pharmacare/migration-import` `cli.test.ts`
"idempotent" test (S27 importer scaffold), where `seedShop()` calls
`runMigrations(db)` against a freshly opened file-backed DB. We logged the
gap as a P1 in `_research_brain/06_pilot/post_pilot_backlog.md` and
preemptively `it.skip`'d the test in S28-PUSH4 to keep CI green for the
pilot push. The underlying defect is real — production migration runs against
a freshly-created Vaidyanath DB will hit the same path.

## Decision

`runMigrations` will:

1. Call `db.pragma("journal_mode = WAL")` ONCE at the top of the function,
   before any `BEGIN`. This sets the connection-level mode at the only safe
   moment.
2. Strip `PRAGMA journal_mode = …` lines from each migration's SQL via a
   case-insensitive line-anchored regex (`stripJournalModePragmas`) before
   `db.exec(sql)`. This keeps the migration files themselves unchanged
   (so the rusqlite-driven Tauri host that reads them outside the tx still
   sees the pragma declaration as documentation of intent), while preventing
   the runtime conflict inside `runMigrations`.

`openDb()` already calls `db.pragma("journal_mode = WAL")` itself, so the
duplicate inside `runMigrations` is harmless — but `runMigrations` is also
invoked against connections opened by callers other than `openDb` (notably
the test in `packages/migration-import/src/cli.test.ts:seedShop` which
constructs `new Database(p)` directly), so the explicit call inside the
runner is required for those paths.

## Consequences

### Positive
- Restores the `cli.test.ts` "idempotent" test from `it.skip` to `it`.
- Production importer + any future direct `runMigrations(new Database(p))`
  caller no longer crashes on first migration.
- Migration `.sql` files keep their pragma declarations as
  self-documenting source of truth.
- Stripper is generic — any future migration that re-states
  `PRAGMA journal_mode` (e.g. a hypothetical "re-affirm WAL after ALTER") is
  also safely handled.

### Negative
- `stripJournalModePragmas` is regex-based, not a SQL parser. It only
  catches lines that match the anchored pattern
  `^\s*PRAGMA\s+journal_mode\s*=\s*<ident>\s*;?\s*$`. A pragma embedded in a
  multi-line SQL statement (which would already be a SQLite syntax error)
  is not handled; not a real concern.
- Other in-transaction-illegal pragmas (`page_size`, `auto_vacuum`,
  `foreign_keys`, etc.) are NOT stripped. We accept the narrow scope because
  (a) `foreign_keys` is set per-connection by `openDb()` and migrations
  re-stating it inside a tx is a no-op rather than a hard error, and (b) we
  have no `page_size` or `auto_vacuum` pragmas in any current migration.
  If we add one, this ADR's stripper extends to it.

### Neutral
- `db.pragma("journal_mode = WAL")` against a `:memory:` db reports
  `journal_mode` as `memory`, not `wal`. Existing tests already rely on this
  behavior (e.g. `index.test.ts` "PRAGMA foreign_keys is ON" test runs
  against `:memory:`). The new test asserts membership in `["wal", "memory"]`
  to handle both backends.

## Alternatives considered

1. **Open a separate connection for the pragma.** Rejected — proliferates
   connections, complicates lifetime management, doesn't help once you've
   handed back the original `db` to the caller.
2. **Edit `0001_init.sql` to remove the pragma line.** Rejected — the
   migration files are also read by tooling outside the runner (rusqlite
   path, manual `sqlite3` review by the founder, ADR cross-references
   pointing at the line numbers). Removing the line silently changes intent.
   Stripping at runtime preserves source-of-truth + fixes the bug.
3. **Drop the explicit `BEGIN` / `COMMIT` and let SQLite implicit-tx each
   statement.** Rejected — atomic per-migration semantics are load-bearing.
   Half-applied migrations would corrupt the `_migrations` ledger.
4. **Always strip and never call `db.pragma("journal_mode = WAL")` inside
   `runMigrations`, relying on `openDb` to do it.** Rejected — the test
   suite + production code paths sometimes call `runMigrations` against a
   raw `new Database(p)` connection that didn't go through `openDb`. The
   explicit call inside the runner makes the contract self-contained.

## References

- `packages/shared-db/src/index.ts` (runMigrations + stripJournalModePragmas)
- `packages/shared-db/src/index.test.ts` (new test: "runs a migration
  containing PRAGMA journal_mode=wal without erroring")
- `packages/migration-import/src/cli.test.ts:67` (idempotent test restored
  from `it.skip` to `it`)
- `_research_brain/06_pilot/post_pilot_backlog.md` §3 — WAL P1 row marked
  DONE (S28-F2)
- SQLite docs: <https://www.sqlite.org/pragma.html#pragma_journal_mode>
  ("It is not possible to change journal_mode to WAL in the middle of a
  transaction.")
