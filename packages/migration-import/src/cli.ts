#!/usr/bin/env node
// pharmacare-import — Marg → Rasayn CSV import CLI.
// Usage: pharmacare-import --from-marg <csv> --to <db> --shop-id <id> [--dry-run]
// Exits: 0 ok · 1 parse · 2 DB · 3 unsupported. Schema: shared-db/migrations/0001_init.sql.
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { adaptMargItemMasterCsv, parseCsv, type ImportRow } from "./index.js";

interface CliArgs { fromMarg: string; to: string; shopId: string; dryRun: boolean; }
export interface RunResult { ok: number; skip: number; err: number; ms: number; exit: 0 | 1 | 2 | 3; }

export function parseCli(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: argv as string[],
    options: {
      "from-marg": { type: "string" },
      "to":        { type: "string" },
      "shop-id":   { type: "string" },
      "dry-run":   { type: "boolean", default: false },
      "help":      { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false, strict: true,
  });
  if (values["help"]) {
    process.stdout.write("pharmacare-import --from-marg <csv> --to <db> --shop-id <id> [--dry-run]\n");
    process.exit(0);
  }
  const f = values["from-marg"], t = values["to"], s = values["shop-id"];
  if (!f || !t || !s) {
    process.stderr.write("missing required: --from-marg <csv> --to <db> --shop-id <id>\n");
    process.exit(1);
  }
  return { fromMarg: f, to: t, shopId: s, dryRun: !!values["dry-run"] };
}
function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function looksLikeBinary(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 4096));
  let bad = 0;
  for (const c of slice) {
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) bad++;
  }
  return bad / Math.max(1, slice.length) > 0.05;
}
function gstRateFor(raw: string): number {
  const n = parseInt(raw || "0", 10);
  return [0, 5, 12, 18, 28].includes(n) ? n : 12;
}
// Marg literal headers → adapter-expected ("Item Code"/"Item Name"/"Manufacturer").
function remapMargHeader(csv: string): string {
  const nl = csv.indexOf("\n");
  if (nl < 0) return csv;
  return csv.slice(0, nl)
    .replace(/\bProductCode\b/i, "Item Code")
    .replace(/\bItemName\b/i, "Item Name")
    .replace(/\bMfr\b/i, "Manufacturer")
    .replace(/\bHSN\b/i, "HSN Code") + csv.slice(nl);
}

export function runImport(args: CliArgs): RunResult {
  const t0 = Date.now();
  const r: RunResult = { ok: 0, skip: 0, err: 0, ms: 0, exit: 0 };
  if (!existsSync(args.fromMarg)) {
    process.stderr.write(`source not found: ${args.fromMarg}\n`); r.exit = 1; r.ms = Date.now() - t0; return r;
  }
  const buf = readFileSync(args.fromMarg);
  if (looksLikeBinary(buf)) {
    process.stderr.write(`source ${args.fromMarg} looks binary, not CSV (exit 3)\n`); r.exit = 3; r.ms = Date.now() - t0; return r;
  }
  let csv = buf.toString("utf8");
  if (csv.charCodeAt(0) === 0xfeff) csv = csv.slice(1);
  const rawRows = parseCsv(csv);
  if (rawRows.length <= 1) {
    process.stderr.write("no data rows in CSV\n"); r.exit = 1; r.ms = Date.now() - t0; return r;
  }
  const source = adaptMargItemMasterCsv(remapMargHeader(csv));
  for (const w of source.warnings) process.stderr.write(`warn: ${w}\n`);
  const header = (rawRows[0] ?? []).map((h) => h.toLowerCase().trim());
  const ix = (n: string) => header.indexOf(n.toLowerCase());
  const C = { code: ix("productcode"), exp: ix("expiry"), bn: ix("batchno"), mrp: ix("mrp"),
              pur: ix("purchaserate"), stk: ix("stock"), gst: ix("gst"), pack: ix("pack") };

  let db: Database.Database | null = null, insP: Database.Statement | null = null, insB: Database.Statement | null = null;
  if (!args.dryRun) {
    try {
      db = new Database(args.to);
      db.pragma("foreign_keys = ON");
      insP = db.prepare(`INSERT OR IGNORE INTO products
        (id, name, generic_name, manufacturer, hsn, gst_rate, schedule, pack_form, pack_size, mrp_paise)
        VALUES (@id, @name, @gen, @mfr, @hsn, @gst, @sch, @pack, @size, @mrp)`);
      insB = db.prepare(`INSERT OR IGNORE INTO batches
        (id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, purchase_price_paise, mrp_paise, supplier_id)
        VALUES (@id, @pid, @bn, @mfg, @exp, @qty, @cost, @mrp, @sup)`);
    } catch (e) {
      process.stderr.write(`DB open error: ${(e as Error).message}\n`); r.exit = 2; r.ms = Date.now() - t0; return r;
    }
  }

  const okRows: { row: ImportRow; raw: readonly string[] }[] = [];
  for (const row of source.rows) {
    const raw = rawRows[(row.sourceLine ?? 1) - 1] ?? [];
    const code = (raw[C.code] ?? "").trim();
    const expiry = (raw[C.exp] ?? "").trim();
    const mrp = parseFloat(raw[C.mrp] ?? "0");
    if (!code || !mrp || mrp <= 0) {
      process.stdout.write(`SKIP row ${row.sourceLine}: missing code/MRP\n`); r.skip++; continue;
    }
    if (!isValidIsoDate(expiry)) {
      process.stdout.write(`SKIP row ${row.sourceLine}: bad expiry "${expiry}"\n`); r.skip++; continue;
    }
    process.stdout.write(`OK row ${row.sourceLine}: ${row.fields["name"]}\n`);
    okRows.push({ row, raw }); r.ok++;
  }

  if (!args.dryRun && db && insP && insB && okRows.length > 0) {
    try {
      const txn = db.transaction((items: typeof okRows) => {
        for (const { row, raw } of items) {
          const code = (raw[C.code] ?? "").trim();
          const exp = (raw[C.exp] ?? "").trim();
          const pid = `marg-${args.shopId}-${code}`;
          const mrpP = Math.round(parseFloat(raw[C.mrp] ?? "0") * 100);
          insP!.run({ id: pid, name: row.fields["name"], gen: row.fields["genericName"] ?? null,
            mfr: String(row.fields["manufacturer"] ?? "") || "Unknown",
            hsn: String(row.fields["hsn"] ?? "") || "00000000",
            gst: gstRateFor(raw[C.gst] ?? ""), sch: row.fields["schedule"] ?? "OTC",
            pack: (raw[C.pack] ?? "1").trim() || "1", size: 1, mrp: mrpP });
          insB!.run({ id: `marg-${args.shopId}-${code}-${(raw[C.bn] ?? "").trim()}`, pid,
            bn: (raw[C.bn] ?? "").trim(), mfg: exp.slice(0, 7) + "-01", exp,
            qty: parseInt(raw[C.stk] ?? "0", 10),
            cost: Math.round(parseFloat(raw[C.pur] ?? "0") * 100), mrp: mrpP, sup: args.shopId });
        }
      });
      txn(okRows);
    } catch (e) {
      process.stderr.write(`DB write error: ${(e as Error).message}\n`);
      r.err = okRows.length; r.ok = 0; r.exit = 2; r.ms = Date.now() - t0;
      if (db) db.close(); return r;
    }
  }
  if (db) db.close();
  r.ms = Date.now() - t0;
  process.stdout.write(`Marg import complete. ${r.ok} ok, ${r.skip} skipped, ${r.err} errors. ${r.ms}ms.\n`);
  return r;
}

const invokedAsCli = process.argv[1] && (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"));
if (invokedAsCli) {
  const a = parseCli(process.argv.slice(2));
  process.exit(runImport(a).exit);
}
