import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runImport, type RunResult } from "./cli.js";
import { runMigrations } from "@pharmacare/shared-db";

const HEADER = "ProductCode,ItemName,Mfr,Pack,BatchNo,Expiry,MRP,PurchaseRate,Stock,HSN,GST,Schedule,Composition";
const SHOP = "shop_test";

let dir: string, csv: string, db: string;
let stdoutBuf: string, stderrBuf: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>, stderrSpy: ReturnType<typeof vi.spyOn>;

function seedShop(p: string): void {
  const d = new Database(p);
  runMigrations(d);
  d.prepare(`INSERT OR IGNORE INTO shops (id, name, gstin, state_code, retail_license, address)
    VALUES (?, ?, ?, ?, ?, ?)`).run(SHOP, "Test Shop", "27ABCDE1234F1Z5", "27", "RL-1", "Kalyan");
  d.prepare(`INSERT OR IGNORE INTO suppliers (id, shop_id, name) VALUES (?, ?, ?)`).run(SHOP, SHOP, "Self");
  d.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "marg-cli-"));
  csv = join(dir, "products.csv");
  db = join(dir, "app.db");
  stdoutBuf = ""; stderrBuf = "";
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((s: any) => { stdoutBuf += String(s); return true; });
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((s: any) => { stderrBuf += String(s); return true; });
});
afterEach(() => {
  stdoutSpy.mockRestore(); stderrSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe("cli runImport", () => {
  it("3 valid + 1 missing MRP â†’ 3 ok / 1 skip (dry-run)", () => {
    writeFileSync(csv, [HEADER,
      "P1,Para 500,Cipla,10x10,B1,2027-06-30,25.50,18.40,500,30049099,12,OTC,Para",
      "P2,Amox 500,Cipla,10x10,B2,2027-08-31,42.00,30.20,300,30041000,12,H,Amox",
      "P3,Met 500,Sun,10x10,B3,2027-09-30,38.00,25.00,400,30049099,12,OTC,Met",
      "P4,NoMRP,Sun,10x10,B4,2027-09-30,,15.00,200,30049099,12,OTC,X",
    ].join("\n") + "\n");
    const r: RunResult = runImport({ fromMarg: csv, to: db, shopId: SHOP, dryRun: true });
    expect(r.exit).toBe(0); expect(r.ok).toBe(3); expect(r.skip).toBe(1);
    expect(stdoutBuf).toMatch(/OK row 2: Para 500/);
    expect(stdoutBuf).toMatch(/SKIP row 5: missing code\/MRP/);
  });

  it("dry-run with bad expiry â†’ 4 ok / 1 skip / 0 db writes", () => {
    writeFileSync(csv, [HEADER,
      "A1,Aa,M,1,B1,2027-01-31,10.00,8,1,30049099,12,OTC,x",
      "A2,Bb,M,1,B2,2027-02-28,11.00,8,1,30049099,12,OTC,x",
      "A3,Cc,M,1,B3,bad-date,12.00,8,1,30049099,12,OTC,x",
      "A4,Dd,M,1,B4,2027-04-30,13.00,8,1,30049099,12,OTC,x",
      "A5,Ee,M,1,B5,2027-05-31,14.00,8,1,30049099,12,OTC,x",
    ].join("\n") + "\n");
    const r = runImport({ fromMarg: csv, to: db, shopId: SHOP, dryRun: true });
    expect(r.exit).toBe(0); expect(r.ok).toBe(4); expect(r.skip).toBe(1);
    expect(stdoutBuf).toMatch(/SKIP row 4: bad expiry "bad-date"/);
    // dry-run: DB file never created
    expect(() => new Database(db, { fileMustExist: true })).toThrow();
  });

  it("idempotent â€” running twice gives same row count (INSERT OR IGNORE)", () => {
    seedShop(db);
    writeFileSync(csv, [HEADER,
      "X1,One,M,1,B1,2027-06-30,10.00,8,1,30049099,12,OTC,x",
      "X2,Two,M,1,B2,2027-07-31,11.00,8,1,30049099,12,OTC,x",
    ].join("\n") + "\n");
    const r1 = runImport({ fromMarg: csv, to: db, shopId: SHOP, dryRun: false });
    expect(r1.exit).toBe(0); expect(r1.ok).toBe(2);
    const r2 = runImport({ fromMarg: csv, to: db, shopId: SHOP, dryRun: false });
    expect(r2.exit).toBe(0); expect(r2.ok).toBe(2);
    const d = new Database(db);
    const pc = (d.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number }).c;
    const bc = (d.prepare("SELECT COUNT(*) AS c FROM batches").get() as { c: number }).c;
    d.close();
    expect(pc).toBe(2); expect(bc).toBe(2);
  });

  it("binary file â†’ exit 3 (unsupported)", () => {
    writeFileSync(csv, Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0xfe, 0x00, 0xfd, 0x00]));
    const r = runImport({ fromMarg: csv, to: db, shopId: SHOP, dryRun: true });
    expect(r.exit).toBe(3);
    expect(stderrBuf).toMatch(/looks binary/);
  });
});
