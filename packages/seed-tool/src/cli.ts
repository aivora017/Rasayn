#!/usr/bin/env node
// pharmacare-seed — create/refresh a demo SQLite DB for pilot rehearsal.
//
//   Default path:
//     Windows  : %APPDATA%/PharmaCarePro/demo.db
//     macOS    : ~/Library/Application Support/PharmaCarePro/demo.db
//     Linux    : ~/.local/share/PharmaCarePro/demo.db
//
//   Usage:
//     pharmacare-seed                   # seed default path
//     pharmacare-seed --path ./foo.db   # custom path
//     pharmacare-seed --reset           # delete DB first (fresh install)

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { platform, homedir } from "node:os";
import { seedFile } from "./seed.js";

function defaultDbPath(): string {
  const app = "PharmaCarePro";
  const p = platform();
  if (p === "win32") {
    const appdata = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appdata, app, "demo.db");
  }
  if (p === "darwin") {
    return join(homedir(), "Library", "Application Support", app, "demo.db");
  }
  const xdg = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(xdg, app, "demo.db");
}

interface Args { path: string; reset: boolean; }

function parseArgs(argv: readonly string[]): Args {
  let path = defaultDbPath();
  let reset = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path" || a === "-p") { path = argv[++i] ?? path; }
    else if (a === "--reset") { reset = true; }
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
  }
  return { path, reset };
}

function printHelp(): void {
  console.log(`pharmacare-seed — seed a demo PharmaCare Pro SQLite DB.

Options:
  -p, --path <file>   Target DB file (default: ${defaultDbPath()})
      --reset         Delete the DB file before seeding
  -h, --help          Show this help`);
}

function main(): void {
  const { path, reset } = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(path), { recursive: true });
  if (reset && existsSync(path)) {
    rmSync(path);
    // also drop WAL/SHM siblings if present
    for (const sfx of ["-wal", "-shm"]) {
      const s = path + sfx;
      if (existsSync(s)) rmSync(s);
    }
    console.log(`[reset] removed existing ${path}`);
  }
  const r = seedFile(path);
  console.log(`[ok] ${r.path}`);
  console.log(`     migrations ran : ${r.migrationsRan}`);
  console.log(`     shops          : ${r.shops}`);
  console.log(`     users          : ${r.users}`);
  console.log(`     suppliers      : ${r.suppliers}`);
  console.log(`     customers      : ${r.customers}`);
  console.log(`     doctors        : ${r.doctors}`);
  console.log(`     products       : ${r.products}`);
  console.log(`     batches        : ${r.batches}`);
}

main();
