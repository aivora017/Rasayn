#!/usr/bin/env node
// pharmacare-validate-import — pre-flight Marg/Tally CSV before pilot install.
// Wraps validateImportCsv + renderMarkdownReport for the SOP T-3 step.
//
// Usage:
//   pharmacare-validate-import <input.csv>
//   pharmacare-validate-import --map marg <input.csv>
//   pharmacare-validate-import --map tally <input.csv>
//   pharmacare-validate-import --json <input.csv>          # emit JSON not markdown
//   pharmacare-validate-import --out report.md <input.csv> # write to file
//   pharmacare-validate-import --default-otc <input.csv>   # downgrade unknown schedule to OTC

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import {
  MARG_COLUMN_MAP,
  TALLY_COLUMN_MAP,
  validateImportCsv,
  renderMarkdownReport,
  type ImportColumnMap,
} from "./importValidator.js";

interface CliArgs {
  input: string;
  map: "marg" | "tally";
  json: boolean;
  out: string | null;
  defaultOtc: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let input = "";
  let map: "marg" | "tally" = "marg";
  let json = false;
  let out: string | null = null;
  let defaultOtc = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--map") {
      const v = argv[++i];
      if (v !== "marg" && v !== "tally") {
        throw new Error(`--map must be 'marg' or 'tally', got '${v}'`);
      }
      map = v;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--out") {
      out = argv[++i] ?? null;
    } else if (a === "--default-otc") {
      defaultOtc = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a && !a.startsWith("-")) {
      input = a;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!input) {
    printHelp();
    throw new Error("missing input file");
  }
  return { input, map, json, out, defaultOtc };
}

function printHelp(): void {
  console.log(`pharmacare-validate-import — pre-flight CSV before pilot import.

Usage:
  pharmacare-validate-import [options] <input.csv>

Options:
  --map marg|tally   Column-mapping preset (default: marg)
  --json             Emit JSON instead of markdown
  --out <file>       Write report to file (default: stdout)
  --default-otc      Downgrade unknown Schedule values to OTC (warn, not error)
  -h, --help         Show this help

Exit codes:
  0  no errors (clean or warn-only)
  1  one or more errors — owner must reconcile before import`);
}

function pickMap(name: "marg" | "tally"): ImportColumnMap {
  return name === "marg" ? MARG_COLUMN_MAP : TALLY_COLUMN_MAP;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const csv = readFileSync(args.input, "utf-8");
  const cols = pickMap(args.map);
  const report = validateImportCsv(csv, cols, args.defaultOtc ? { defaultScheduleToOtc: true } : {});

  const body = args.json
    ? JSON.stringify(report, null, 2)
    : renderMarkdownReport(report, basename(args.input));

  if (args.out) {
    writeFileSync(args.out, body, "utf-8");
    console.log(`[ok] wrote report to ${args.out}`);
  } else {
    console.log(body);
  }
  console.log(
    `\n[summary] total=${report.summary.totalRows} clean=${report.summary.cleanRowCount} ` +
    `errors=${report.summary.errorCount} warns=${report.summary.warnCount}`,
  );
  if (report.summary.errorCount > 0) process.exit(1);
}

main();
