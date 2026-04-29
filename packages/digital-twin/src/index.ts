// @pharmacare/digital-twin
// Asset registry + telemetry collection + fault detector for the shop's
// physical equipment. The visualisation (React-Three-Fiber 3D scene) is
// the rendering layer that sits on top of these data structures.
// ADR-0062.

// ────────────────────────────────────────────────────────────────────────
// Asset taxonomy
// ────────────────────────────────────────────────────────────────────────

export type AssetKind =
  | "shelf"
  | "fridge"
  | "scanner"
  | "thermal_printer"
  | "inkjet_printer"
  | "cash_drawer"
  | "monitor_primary"
  | "monitor_cfd"
  | "router"
  | "ups"
  | "biometric_reader";

export type AssetState = "ok" | "warn" | "fault" | "offline";

export interface ShopAsset {
  readonly id: string;
  readonly kind: AssetKind;
  readonly label: string;            // human-readable, e.g. "Vaccine Fridge 1"
  readonly position: readonly [number, number, number];   // 3D coords for R3F
  readonly state: AssetState;
  readonly lastSeenAt: string;       // ISO; for offline detection
  readonly metric?: { value: number; unit: string };
  readonly fault?: string;           // human-readable fault reason
}

export interface ShopLayout {
  readonly shopId: string;
  readonly assets: readonly ShopAsset[];
  readonly updatedAt: string;
  readonly summary: {
    readonly ok: number;
    readonly warn: number;
    readonly fault: number;
    readonly offline: number;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Telemetry events
// ────────────────────────────────────────────────────────────────────────

export interface TelemetryEvent {
  readonly assetId: string;
  readonly at: string;
  readonly metric?: { value: number; unit: string };
  readonly state?: AssetState;
  readonly faultReason?: string;
}

/** How long without a heartbeat before we consider an asset offline (default 5 min). */
export const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

/** Apply a single telemetry event to an existing asset. */
export function applyEvent(asset: ShopAsset, event: TelemetryEvent): ShopAsset {
  if (event.assetId !== asset.id) return asset;
  return {
    ...asset,
    lastSeenAt: event.at,
    ...(event.metric !== undefined ? { metric: event.metric } : {}),
    ...(event.state !== undefined ? { state: event.state } : {}),
    ...(event.faultReason !== undefined ? { fault: event.faultReason } : {}),
  };
}

/** Recompute every asset's effective state given current time. Assets that
 *  haven't been seen in OFFLINE_THRESHOLD become "offline" regardless of
 *  their previously-reported state. */
export function recomputeOfflineStates(layout: ShopLayout, now: Date = new Date()): ShopLayout {
  const updated = layout.assets.map((a): ShopAsset => {
    const elapsed = now.getTime() - Date.parse(a.lastSeenAt);
    if (elapsed > OFFLINE_THRESHOLD_MS && a.state !== "offline") {
      return { ...a, state: "offline", fault: a.fault ?? `No heartbeat for ${Math.floor(elapsed / 60000)} min` };
    }
    return a;
  });
  return { ...layout, assets: updated, updatedAt: now.toISOString(), summary: summarize(updated) };
}

function summarize(assets: readonly ShopAsset[]): ShopLayout["summary"] {
  let ok = 0, warn = 0, fault = 0, offline = 0;
  for (const a of assets) {
    if (a.state === "ok") ok++;
    else if (a.state === "warn") warn++;
    else if (a.state === "fault") fault++;
    else offline++;
  }
  return { ok, warn, fault, offline };
}

// ────────────────────────────────────────────────────────────────────────
// Health scoring (single number 0..100 for owner-app dashboard)
// ────────────────────────────────────────────────────────────────────────

export interface HealthScore {
  readonly score: number;            // 0..100
  readonly grade: "A" | "B" | "C" | "D" | "F";
  readonly worstAssets: readonly ShopAsset[];
}

export function computeHealth(layout: ShopLayout): HealthScore {
  const total = layout.assets.length || 1;
  const weights = { ok: 1.0, warn: 0.6, fault: 0.0, offline: 0.3 };
  const sum = layout.assets.reduce((s, a) => s + weights[a.state], 0);
  const score = Math.round((sum / total) * 100);
  const grade = score >= 95 ? "A" : score >= 85 ? "B" : score >= 70 ? "C" : score >= 50 ? "D" : "F";
  const worst = [...layout.assets]
    .filter((a) => a.state !== "ok")
    .sort((a, b) => weights[a.state] - weights[b.state])
    .slice(0, 5);
  return { score, grade, worstAssets: worst };
}

// ────────────────────────────────────────────────────────────────────────
// Predictive maintenance (basic): assets that have been "warn" for > N hours
// are likely heading to "fault" — flag them for the owner.
// ────────────────────────────────────────────────────────────────────────

export interface MaintenanceFlag {
  readonly asset: ShopAsset;
  readonly hoursInWarnState: number;
  readonly recommendation: string;
}

export const PREDICTIVE_WARN_HOURS = 24;

export function predictiveMaintenanceFlags(
  layout: ShopLayout,
  warnEnteredAt: Readonly<Record<string, string>>,
  now: Date = new Date(),
): readonly MaintenanceFlag[] {
  const out: MaintenanceFlag[] = [];
  for (const a of layout.assets) {
    if (a.state !== "warn") continue;
    const since = warnEnteredAt[a.id];
    if (!since) continue;
    const hours = (now.getTime() - Date.parse(since)) / (60 * 60 * 1000);
    if (hours >= PREDICTIVE_WARN_HOURS) {
      out.push({
        asset: a, hoursInWarnState: hours,
        recommendation: recommendationFor(a),
      });
    }
  }
  return out;
}

function recommendationFor(asset: ShopAsset): string {
  switch (asset.kind) {
    case "fridge":
      return "Vaccine fridge has been in WARN state for 24h — schedule technician inspection. Move stock to backup if temperature drift continues.";
    case "thermal_printer":
      return "Thermal printer warning — likely paper-jam or head wear. Clean print head and load fresh paper.";
    case "scanner":
      return "Barcode scanner unstable — check USB cable + lens cleanliness.";
    case "cash_drawer":
      return "Cash drawer warning — solenoid lubrication recommended.";
    case "ups":
      return "UPS warning — battery may be near end-of-life. Test runtime and replace if < 5 min cover.";
    default:
      return `${asset.label} (${asset.kind}) needs attention — check connections + power.`;
  }
}
