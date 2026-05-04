// license-store.ts — persistence for issued license keys.
// S21 — file-backed JSON-lines backend by default.
// S22c — Vercel KV adapter via @vercel/kv (LICENSE_STORE_DRIVER=kv).
//
// Storage contract (forward-compatible):
//   - append(record): never overwrites; idempotent on (licenseKey, paymentId).
//   - findByKey(licenseKey): returns the record or null.
//   - listRecent(limit, sinceIso?): newest-first scan.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface IssuedLicenseRecord {
  readonly licenseKey: string;
  readonly tier: "starter" | "pro";
  readonly email: string;
  readonly shopName: string;
  readonly shopFingerprintShort: string;
  readonly issuedAt: string;
  readonly validUntil: string;
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
}

interface LicenseStore {
  append(record: IssuedLicenseRecord): Promise<void>;
  findByKey(licenseKey: string): Promise<IssuedLicenseRecord | null>;
  listRecent(limit?: number): Promise<readonly IssuedLicenseRecord[]>;
}

class FileBackedStore implements LicenseStore {
  private readonly filePath: string;
  constructor(filePath: string) { this.filePath = filePath; }

  private async loadAll(): Promise<IssuedLicenseRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as IssuedLicenseRecord);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return [];
      throw e;
    }
  }

  async append(record: IssuedLicenseRecord): Promise<void> {
    const existing = await this.loadAll();
    if (existing.some((r) => r.razorpayPaymentId === record.razorpayPaymentId)) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8");
  }

  async findByKey(licenseKey: string): Promise<IssuedLicenseRecord | null> {
    const all = await this.loadAll();
    return all.find((r) => r.licenseKey === licenseKey) ?? null;
  }

  async listRecent(limit = 50): Promise<readonly IssuedLicenseRecord[]> {
    const all = await this.loadAll();
    return all.slice(-limit).reverse();
  }
}

class MemoryStore implements LicenseStore {
  private readonly records: IssuedLicenseRecord[] = [];

  async append(record: IssuedLicenseRecord): Promise<void> {
    if (this.records.some((r) => r.razorpayPaymentId === record.razorpayPaymentId)) return;
    this.records.push(record);
  }
  async findByKey(licenseKey: string): Promise<IssuedLicenseRecord | null> {
    return this.records.find((r) => r.licenseKey === licenseKey) ?? null;
  }
  async listRecent(limit = 50): Promise<readonly IssuedLicenseRecord[]> {
    return [...this.records].slice(-limit).reverse();
  }
}

// ─── Vercel KV adapter (S22c.2) ─────────────────────────────────────────
//
// Activated by LICENSE_STORE_DRIVER=kv. Requires @vercel/kv to be installed
// and the standard KV_* env vars (KV_URL, KV_REST_API_URL, etc).
// Layout:
//   - per-key:        license:<licenseKey>          → IssuedLicenseRecord (JSON)
//   - per-payment:    license_pay:<paymentId>       → licenseKey (idempotency lock)
//   - newest-first:   license_recent (zset)          → score = issuedAt epoch ms
class KvStore implements LicenseStore {
  private kvPromise: Promise<typeof import("@vercel/kv").kv> | null = null;

  private async kv(): Promise<typeof import("@vercel/kv").kv> {
    if (!this.kvPromise) {
      this.kvPromise = import("@vercel/kv").then((m) => m.kv);
    }
    return this.kvPromise;
  }

  async append(record: IssuedLicenseRecord): Promise<void> {
    const kv = await this.kv();
    // Idempotency: only set the payment-id lock if it doesn't exist (NX).
    const acquired = await kv.set(`license_pay:${record.razorpayPaymentId}`, record.licenseKey, { nx: true });
    if (!acquired) return;
    await kv.set(`license:${record.licenseKey}`, record);
    await kv.zadd("license_recent", { score: Date.parse(record.issuedAt), member: record.licenseKey });
  }

  async findByKey(licenseKey: string): Promise<IssuedLicenseRecord | null> {
    const kv = await this.kv();
    const r = await kv.get<IssuedLicenseRecord>(`license:${licenseKey}`);
    return r ?? null;
  }

  async listRecent(limit = 50): Promise<readonly IssuedLicenseRecord[]> {
    const kv = await this.kv();
    const keys = await kv.zrange<string[]>("license_recent", 0, limit - 1, { rev: true });
    if (!keys || keys.length === 0) return [];
    const fetched = await Promise.all(keys.map((k) => kv.get<IssuedLicenseRecord>(`license:${k}`)));
    return fetched.filter((r): r is IssuedLicenseRecord => r != null);
  }
}

let _store: LicenseStore | null = null;

export function getLicenseStore(): LicenseStore {
  if (_store) return _store;
  const driver = process.env["LICENSE_STORE_DRIVER"];
  if (driver === "kv") {
    _store = new KvStore();
  } else if (driver === "memory" || !process.env["LICENSE_STORE_PATH"]) {
    _store = new MemoryStore();
  } else {
    _store = new FileBackedStore(process.env["LICENSE_STORE_PATH"]!);
  }
  return _store;
}

// For tests
export function _resetStoreForTests(driver: "memory" | { filePath: string }): void {
  _store = driver === "memory" ? new MemoryStore() : new FileBackedStore(driver.filePath);
}
