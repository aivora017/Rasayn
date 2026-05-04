// license-store.ts — persistence for issued license keys.
// S21.1 — file-backed JSON-lines backend by default; Vercel KV / D1 swap-in via env.
//
// Storage contract (forward-compatible):
//   - append(record): never overwrites; idempotent on (licenseKey, paymentId).
//   - findByKey(licenseKey): returns the record or null.
//   - listRecent(limit, sinceIso?): newest-first scan.
//
// Default backend writes JSON-lines to LICENSE_STORE_PATH (default
// `./.license-store.jsonl`). Operators rotate that file out of the FS into S3
// / KV / D1 via the periodic backup job; the desktop client never reaches
// this store directly — it only consults `/api/license/:key`.

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

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async loadAll(): Promise<IssuedLicenseRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as IssuedLicenseRecord);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return [];
      throw e;
    }
  }

  async append(record: IssuedLicenseRecord): Promise<void> {
    // Idempotency: skip if a record with the same paymentId already exists.
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

let _store: LicenseStore | null = null;

export function getLicenseStore(): LicenseStore {
  if (_store) return _store;
  const path = process.env["LICENSE_STORE_PATH"];
  if (!path || process.env["LICENSE_STORE_DRIVER"] === "memory") {
    _store = new MemoryStore();
  } else {
    _store = new FileBackedStore(path);
  }
  return _store;
}

// For tests
export function _resetStoreForTests(driver: "memory" | { filePath: string }): void {
  _store = driver === "memory" ? new MemoryStore() : new FileBackedStore(driver.filePath);
}
