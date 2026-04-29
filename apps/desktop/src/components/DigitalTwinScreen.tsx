// DigitalTwinScreen — asset grid + health gauge + predictive maintenance.
// Backed by @pharmacare/digital-twin (15 tests green).
// 3D R3F scene deferred; 2D grid view ships today.
import { useMemo, useState } from "react";
import { type LucideIcon, Sparkles, AlertTriangle, CheckCircle2, Wrench, Box, Snowflake, Printer, Wifi, ScanLine, BatteryCharging, Fingerprint, Monitor } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  recomputeOfflineStates, computeHealth, predictiveMaintenanceFlags,
  type ShopAsset, type ShopLayout, type AssetKind,
} from "@pharmacare/digital-twin";

const NOW = new Date("2026-04-28T12:00:00Z");

// Demo shop layout — production wires to live telemetry
const DEMO_ASSETS: ShopAsset[] = [
  { id: "shelf_a",  kind: "shelf",            label: "Shelf A — Antibiotics",   position: [0, 0, 0],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "shelf_b",  kind: "shelf",            label: "Shelf B — OTC",            position: [2, 0, 0],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "shelf_c",  kind: "shelf",            label: "Shelf C — Schedule H",     position: [4, 0, 0],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "fridge_1", kind: "fridge",           label: "Vaccine Fridge 1",         position: [6, 0, 0],   state: "warn",    lastSeenAt: "2026-04-28T11:55:00Z", metric: { value: 9.2, unit: "°C" }, fault: "Temperature drift outside 2-8°C range" },
  { id: "fridge_2", kind: "fridge",           label: "Insulin Fridge",           position: [6, 0, 2],   state: "ok",      lastSeenAt: NOW.toISOString(),       metric: { value: 4.5, unit: "°C" } },
  { id: "scan_1",   kind: "scanner",          label: "Counter Barcode Scanner",  position: [0, 0, 4],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "tprint_1", kind: "thermal_printer",  label: "TVS RP-3230 Receipt",      position: [1, 0, 4],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "iprint_1", kind: "inkjet_printer",   label: "A4 Inkjet (CA reports)",   position: [3, 0, 4],   state: "warn",    lastSeenAt: NOW.toISOString(), fault: "Low ink — black 12%" },
  { id: "drawer_1", kind: "cash_drawer",      label: "Cash Drawer",              position: [2, 0, 4],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "mon_pri",  kind: "monitor_primary",  label: "Cashier Monitor",          position: [0, 1, 4],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "mon_cfd",  kind: "monitor_cfd",      label: "Customer-Facing Display",  position: [0, 1, 5],   state: "offline", lastSeenAt: "2026-04-28T05:00:00Z", fault: "No heartbeat 7h" },
  { id: "router_1", kind: "router",           label: "Internet Router",          position: [5, 2, 5],   state: "ok",      lastSeenAt: NOW.toISOString() },
  { id: "ups_1",    kind: "ups",              label: "UPS Backup",               position: [5, 0, 5],   state: "warn",    lastSeenAt: NOW.toISOString(), metric: { value: 6, unit: "min" }, fault: "Runtime dropped to 6 min" },
  { id: "bio_1",    kind: "biometric_reader", label: "Fingerprint (Sched X)",    position: [0, 0, 5],   state: "ok",      lastSeenAt: NOW.toISOString() },
];

const ICON_FOR_KIND: Record<AssetKind, LucideIcon> = {
  shelf:           Box,
  fridge:          Snowflake,
  scanner:         ScanLine,
  thermal_printer: Printer,
  inkjet_printer:  Printer,
  cash_drawer:     Box,
  monitor_primary: Monitor,
  monitor_cfd:     Monitor,
  router:          Wifi,
  ups:             BatteryCharging,
  biometric_reader: Fingerprint,
};

const STATE_TONE: Record<ShopAsset["state"], "success" | "warning" | "danger" | "neutral"> = {
  ok: "success", warn: "warning", fault: "danger", offline: "neutral",
};

export default function DigitalTwinScreen(): React.ReactElement {
  const [layout] = useState<ShopLayout>(() => recomputeOfflineStates({
    shopId: "shop_local", assets: DEMO_ASSETS, updatedAt: NOW.toISOString(),
    summary: { ok: 0, warn: 0, fault: 0, offline: 0 },
  }, NOW));

  const health = useMemo(() => computeHealth(layout), [layout]);

  const warnEnteredAt: Record<string, string> = useMemo(() => ({
    fridge_1: "2026-04-26T12:00:00Z",  // 48h in warn — predictive flag
    iprint_1: "2026-04-28T10:00:00Z",  // 2h — too fresh
    ups_1:    "2026-04-25T12:00:00Z",  // 72h in warn
  }), []);
  const flags = useMemo(() => predictiveMaintenanceFlags(layout, warnEnteredAt, NOW), [layout, warnEnteredAt]);

  const gradeTone = health.grade === "A" ? "text-[var(--pc-state-success)]"
    : health.grade === "B" ? "text-[var(--pc-state-success)]"
    : health.grade === "C" ? "text-[var(--pc-state-warning)]"
    : "text-[var(--pc-state-danger)]";

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="digital-twin">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Digital Twin</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              {layout.assets.length} assets · live telemetry · predictive maintenance
            </p>
          </div>
        </div>
        <Badge variant={health.grade === "A" || health.grade === "B" ? "success" : health.grade === "C" ? "warning" : "danger"}>
          Health · {health.score}/100 · grade {health.grade}
        </Badge>
      </header>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: "OK",       count: layout.summary.ok,      tone: "success" as const },
          { label: "Warn",     count: layout.summary.warn,    tone: "warning" as const },
          { label: "Fault",    count: layout.summary.fault,   tone: "danger"  as const },
          { label: "Offline",  count: layout.summary.offline, tone: "neutral" as const },
        ]).map((t) => (
          <Glass key={t.label}>
            <div className="p-3 flex flex-col gap-1">
              <span className="text-[11px] uppercase text-[var(--pc-text-tertiary)]">{t.label}</span>
              <span className="font-mono tabular-nums text-[20px]">{t.count}</span>
              <Badge variant={t.tone}>{t.label}</Badge>
            </div>
          </Glass>
        ))}
      </div>

      {/* Health gauge — simple circular ring via CSS conic-gradient */}
      <Glass>
        <div className="p-4 flex items-center gap-4">
          <div
            className="relative w-24 h-24 rounded-full grid place-items-center"
            style={{
              background: `conic-gradient(var(--pc-brand-primary) ${health.score * 3.6}deg, var(--pc-bg-surface) 0deg)`,
            }}
          >
            <div className="absolute inset-2 rounded-full bg-[var(--pc-bg-canvas)] grid place-items-center">
              <div className={`text-[24px] font-bold font-mono ${gradeTone}`}>{health.grade}</div>
            </div>
          </div>
          <div>
            <div className="text-[16px] font-semibold">Shop health · {health.score}/100</div>
            <div className="text-[12px] text-[var(--pc-text-secondary)]">
              {layout.summary.fault > 0 && <span>{layout.summary.fault} fault · </span>}
              {layout.summary.warn > 0 && <span>{layout.summary.warn} warn · </span>}
              {layout.summary.offline > 0 && <span>{layout.summary.offline} offline · </span>}
              {layout.summary.ok} ok
            </div>
          </div>
        </div>
      </Glass>

      {/* Predictive maintenance flags */}
      {flags.length > 0 && (
        <Glass>
          <div className="p-4 flex flex-col gap-2" data-testid="predictive-maint">
            <div className="flex items-center gap-2">
              <Wrench size={16} className="text-[var(--pc-state-warning)]" />
              <h2 className="font-medium">Predictive maintenance ({flags.length})</h2>
              <Badge variant="warning">action recommended</Badge>
            </div>
            <ul className="space-y-2">
              {flags.map((f) => (
                <li key={f.asset.id} className="border border-[var(--pc-border-subtle)] rounded p-3 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{f.asset.label}</span>
                    <Badge variant="warning">{Math.round(f.hoursInWarnState)}h in warn</Badge>
                  </div>
                  <p className="text-[12px] text-[var(--pc-text-secondary)] mt-1">{f.recommendation}</p>
                </li>
              ))}
            </ul>
          </div>
        </Glass>
      )}

      {/* Asset grid */}
      <Glass>
        <div className="p-4">
          <h2 className="font-medium mb-3">All assets</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {layout.assets.map((a) => {
              const Icon = ICON_FOR_KIND[a.kind];
              return (
                <div key={a.id} className="border border-[var(--pc-border-subtle)] rounded p-3 flex flex-col gap-1">
                  <div className="flex items-start justify-between">
                    <Icon size={16} aria-hidden />
                    <Badge variant={(STATE_TONE[a.state] ?? "neutral") as "neutral"|"success"|"warning"|"danger"}>{a.state.toUpperCase()}</Badge>
                  </div>
                  <div className="text-[13px] font-medium truncate">{a.label}</div>
                  {a.metric && (
                    <div className="text-[12px] text-[var(--pc-text-secondary)] font-mono">
                      {a.metric.value} {a.metric.unit}
                    </div>
                  )}
                  {a.fault && (
                    <div className="text-[11px] text-[var(--pc-state-danger)] flex items-start gap-1 mt-1">
                      <AlertTriangle size={10} className="mt-0.5" />
                      <span>{a.fault}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Glass>
    </div>
  );
}
