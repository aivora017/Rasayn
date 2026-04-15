// @pharmacare/shared-db · migration runner + connection helper.
// Used by host tools and tests. The Tauri app runs the same .sql files via rusqlite.

import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// package layout: dist/index.js -> ../migrations/*.sql
export const MIGRATIONS_DIR = join(HERE, "..", "migrations");

export interface OpenOptions {
  readonly path: string;          // ":memory:" for tests
  readonly readonly?: boolean;
}

export function openDb(opts: OpenOptions): Database.Database {
  const db = new Database(opts.path, { readonly: opts.readonly ?? false });
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

export function listMigrations(dir: string = MIGRATIONS_DIR): readonly { version: number; name: string; path: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const m = /^(\d{4})_(.+)\.sql$/.exec(f);
      if (!m) throw new Error(`bad migration filename: ${f}`);
      return { version: parseInt(m[1]!, 10), name: m[2]!, path: join(dir, f) };
    });
}

export function runMigrations(db: Database.Database, dir: string = MIGRATIONS_DIR): number {
  // Ensure _migrations table exists (idempotent).
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Set(
    db.prepare("SELECT version FROM _migrations").all().map((r: any) => r.version as number),
  );
  let ran = 0;
  for (const m of listMigrations(dir)) {
    if (applied.has(m.version)) continue;
    const sql = readFileSync(m.path, "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      // INSERT is inside 0001_init.sql; for other migrations we also record:
      db.prepare("INSERT OR IGNORE INTO _migrations (version, name) VALUES (?, ?)").run(m.version, m.name);
      db.exec("COMMIT");
      ran++;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return ran;
}

export function currentVersion(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM _migrations").get() as { v: number | null };
  return row.v ?? 0;
}
