import { describe, it, expect } from "vitest";
import {
  applyEvent, recomputeOfflineStates, computeHealth,
  predictiveMaintenanceFlags, OFFLINE_THRESHOLD_MS, PREDICTIVE_WARN_HOURS,
  type ShopAsset, type ShopLayout, type TelemetryEvent,
} from "./index.js";

const NOW = new Date("2026-04-28T12:00:00Z");

const asset = (id: string, overrides: Partial<ShopAsset> = {}): ShopAsset => ({
  id, kind: "shelf", label: `${id}-label`,
  position: [0, 0, 0], state: "ok", lastSeenAt: NOW.toISOString(),
  ...overrides,
});

const layout = (assets: ShopAsset[]): ShopLayout => ({
  shopId: "shop_local", assets, updatedAt: NOW.toISOString(),
  summary: { ok: 0, warn: 0, fault: 0, offline: 0 },
});

describe("applyEvent", () => {
  it("updates lastSeenAt + state", () => {
    const a = asset("p1");
    const e: TelemetryEvent = { assetId: "p1", at: "2026-04-28T12:30:00Z", state: "warn", faultReason: "low ink" };
    const r = applyEvent(a, e);
    expect(r.lastSeenAt).toBe("2026-04-28T12:30:00Z");
    expect(r.state).toBe("warn");
    expect(r.fault).toBe("low ink");
  });
  it("ignores events for other assets", () => {
    const a = asset("p1");
    const e: TelemetryEvent = { assetId: "OTHER", at: "x", state: "fault" };
    expect(applyEvent(a, e)).toBe(a);
  });
});

describe("recomputeOfflineStates", () => {
  it("flags stale assets as offline", () => {
    const stale = asset("s1", { lastSeenAt: "2026-04-28T11:00:00Z" });   // 1 hour ago
    const fresh = asset("s2", { lastSeenAt: "2026-04-28T11:58:00Z" });   // 2 min ago
    const r = recomputeOfflineStates(layout([stale, fresh]), NOW);
    const staleNow = r.assets.find((a) => a.id === "s1");
    const freshNow = r.assets.find((a) => a.id === "s2");
    expect(staleNow?.state).toBe("offline");
    expect(freshNow?.state).toBe("ok");
  });
  it("offline-state asset stays offline (idempotent)", () => {
    const off = asset("o1", { state: "offline", lastSeenAt: "2025-01-01" });
    const r = recomputeOfflineStates(layout([off]), NOW);
    expect(r.assets[0]?.state).toBe("offline");
  });
  it("populates summary counters", () => {
    const a = [
      asset("ok1"),
      asset("ok2"),
      asset("w1", { state: "warn" }),
      asset("f1", { state: "fault" }),
      asset("st", { lastSeenAt: "2025-01-01" }),
    ];
    const r = recomputeOfflineStates(layout(a), NOW);
    expect(r.summary.ok).toBe(2);
    expect(r.summary.warn).toBe(1);
    expect(r.summary.fault).toBe(1);
    expect(r.summary.offline).toBe(1);
  });
});

describe("computeHealth", () => {
  it("all-ok shop scores 100/A", () => {
    const r = computeHealth(layout([asset("a"), asset("b"), asset("c")]));
    expect(r.score).toBe(100);
    expect(r.grade).toBe("A");
  });
  it("any fault drops score significantly", () => {
    const r = computeHealth(layout([
      asset("ok1"), asset("ok2"), asset("ok3"),
      asset("fault1", { state: "fault" }),
    ]));
    expect(r.score).toBeLessThan(80);
    expect(r.worstAssets[0]?.id).toBe("fault1");
  });
  it("D grade for half-broken", () => {
    const r = computeHealth(layout([
      asset("ok"), asset("warn", { state: "warn" }),
      asset("fault", { state: "fault" }), asset("offline", { state: "offline" }),
    ]));
    expect(r.grade).toMatch(/[CDF]/);   // mix of warn/fault/offline = ~47, F band
  });
  it("worstAssets ordered by severity", () => {
    const r = computeHealth(layout([
      asset("ok1"), asset("warn1", { state: "warn" }),
      asset("fault1", { state: "fault" }), asset("offline1", { state: "offline" }),
    ]));
    expect(r.worstAssets[0]?.state).toBe("fault");
  });
});

describe("predictiveMaintenanceFlags", () => {
  it("flags assets in WARN > 24 h", () => {
    const a = asset("fridge1", { kind: "fridge", state: "warn", label: "Vaccine Fridge" });
    const warnSince = { fridge1: "2026-04-26T12:00:00Z" };  // 48 h ago
    const flags = predictiveMaintenanceFlags(layout([a]), warnSince, NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.hoursInWarnState).toBeGreaterThanOrEqual(24);
    expect(flags[0]?.recommendation).toContain("technician");
  });
  it("does not flag if < 24h in warn", () => {
    const a = asset("p1", { state: "warn" });
    const warnSince = { p1: "2026-04-28T11:00:00Z" };       // 1 h ago
    expect(predictiveMaintenanceFlags(layout([a]), warnSince, NOW)).toHaveLength(0);
  });
  it("does not flag healthy assets", () => {
    const a = asset("p1", { state: "ok" });
    const warnSince = { p1: "2025-01-01" };
    expect(predictiveMaintenanceFlags(layout([a]), warnSince, NOW)).toHaveLength(0);
  });
  it("recommendation tailored per asset kind", () => {
    const fridge = asset("f1", { kind: "fridge", state: "warn" });
    const printer = asset("p1", { kind: "thermal_printer", state: "warn" });
    const since = { f1: "2026-04-26T12:00:00Z", p1: "2026-04-26T12:00:00Z" };
    const flags = predictiveMaintenanceFlags(layout([fridge, printer]), since, NOW);
    expect(flags.find((f) => f.asset.kind === "fridge")?.recommendation).toContain("temperature");
    expect(flags.find((f) => f.asset.kind === "thermal_printer")?.recommendation).toContain("paper-jam");
  });
});

describe("constants", () => {
  it("OFFLINE_THRESHOLD_MS = 5 minutes", () => {
    expect(OFFLINE_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });
  it("PREDICTIVE_WARN_HOURS = 24", () => {
    expect(PREDICTIVE_WARN_HOURS).toBe(24);
  });
});
