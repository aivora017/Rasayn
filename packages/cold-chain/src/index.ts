// @pharmacare/cold-chain
// Pure cold-chain temperature monitoring + alert state machine.
// Drug-class storage windows (Indian Pharmacopoeia / WHO):
//   refrigerated: 2°C – 8°C   (insulin, vaccines, biologics)
//   cool:         8°C – 15°C  (some antibiotics, suppositories)
//   room:        15°C – 30°C  (most tablets, capsules, syrups)
//   below_25:    < 25°C       (heat-sensitive: nitroglycerin, prostaglandins)
//
// All input/output is data; the actual sensor I/O (USB temp probe, BLE TempStick,
// IoT bridge) lives in a separate transport. Tests run end-to-end on classify
// + alert generation + roll-up reports for inspector mode.

export type StorageClass = "refrigerated" | "cool" | "room" | "below_25";

export interface StorageWindow {
  readonly minC: number;
  readonly maxC: number;
}

export const STORAGE_WINDOWS: Record<StorageClass, StorageWindow> = {
  refrigerated: { minC: 2,  maxC: 8 },
  cool:         { minC: 8,  maxC: 15 },
  room:         { minC: 15, maxC: 30 },
  below_25:     { minC: -Infinity, maxC: 25 },
};

// ────────────────────────────────────────────────────────────────────────
// Reading + asset
// ────────────────────────────────────────────────────────────────────────

export interface TemperatureReading {
  readonly assetId: string;
  readonly atIso: string;
  readonly tempC: number;
  readonly humidityPct?: number;     // optional (some probes report RH)
  readonly source: "manual" | "probe-usb" | "probe-ble" | "iot-bridge";
}

export interface Asset {
  readonly id: string;
  readonly name: string;              // "Vaccine fridge #1", "OTC shelf"
  readonly storageClass: StorageClass;
  readonly thresholds?: {
    readonly minC?: number;          // overrides STORAGE_WINDOWS for this asset
    readonly maxC?: number;
  };
  /** Some products tolerate a brief excursion before requiring discard.
   *  Default: 30 minutes outside window → alarm. */
  readonly graceMinutes?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────────────────

export type Severity = "ok" | "warning" | "critical";

export interface Classification {
  readonly tempC: number;
  readonly inWindow: boolean;
  readonly severity: Severity;
  readonly window: StorageWindow;
  readonly note: string;
}

/** WARNING band = ±0.5°C around the limit. CRITICAL = beyond that. */
export function classifyReading(asset: Asset, reading: TemperatureReading): Classification {
  const baseWindow = STORAGE_WINDOWS[asset.storageClass];
  const minC = asset.thresholds?.minC ?? baseWindow.minC;
  const maxC = asset.thresholds?.maxC ?? baseWindow.maxC;
  const t = reading.tempC;
  const window = { minC, maxC };
  if (t >= minC && t <= maxC) {
    return { tempC: t, inWindow: true, severity: "ok", window, note: "in-window" };
  }
  const tolerance = 0.5;
  const overByMax = t - maxC;
  const underByMin = minC - t;
  const breach = Math.max(overByMax, underByMin);
  const severity: Severity = breach <= tolerance ? "warning" : "critical";
  const direction = overByMax > 0 ? "above max" : "below min";
  return {
    tempC: t,
    inWindow: false,
    severity,
    window,
    note: `${direction} by ${breach.toFixed(2)}°C`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Excursion-and-grace alerting (state machine)
// ────────────────────────────────────────────────────────────────────────

export interface Alert {
  readonly id: string;
  readonly assetId: string;
  readonly startIso: string;
  readonly endIso?: string;          // null = still active
  readonly peakTempC: number;
  readonly severity: Severity;
  readonly durationMinutes: number;
}

export interface AlertEngineState {
  readonly excursionStartIso?: string;
  readonly peakTempC?: number;
  readonly peakSeverity?: Severity;
  readonly activeAlertId?: string;
  readonly hasOpenAlert: boolean;
}

export const INITIAL_ALERT_STATE: AlertEngineState = { hasOpenAlert: false };

export interface AlertStep {
  readonly state: AlertEngineState;
  readonly emit?: Alert;             // when set, caller should append to the alert log
  readonly close?: string;           // alertId to close
}

/** Pure transition: feed a reading + classification, return next state and any
 *  alert to emit/close. Caller threads the state through the full reading log. */
export function step(
  asset: Asset,
  prev: AlertEngineState,
  reading: TemperatureReading,
  classification: Classification,
  idGen: () => string,
): AlertStep {
  const grace = asset.graceMinutes ?? 30;
  const inWindow = classification.inWindow;

  if (inWindow && !prev.hasOpenAlert && prev.excursionStartIso === undefined) {
    return { state: prev };  // steady, in-window
  }

  if (inWindow && prev.excursionStartIso !== undefined && !prev.hasOpenAlert) {
    // Excursion ended within grace window → no alert was raised, just clear state.
    return { state: { hasOpenAlert: false } };
  }

  if (inWindow && prev.hasOpenAlert && prev.activeAlertId) {
    // Excursion ended; close the open alert.
    return {
      state: { hasOpenAlert: false },
      close: prev.activeAlertId,
    };
  }

  // Out of window from here on.
  const startIso = prev.excursionStartIso ?? reading.atIso;
  const peakTempC =
    prev.peakTempC === undefined
      ? reading.tempC
      : Math.abs(reading.tempC - midpoint(classification.window)) >
        Math.abs(prev.peakTempC - midpoint(classification.window))
        ? reading.tempC
        : prev.peakTempC;
  const peakSeverity = bumpSeverity(prev.peakSeverity, classification.severity);
  const durationMin = minutesBetween(startIso, reading.atIso);

  if (!prev.hasOpenAlert && (durationMin >= grace || classification.severity === "critical")) {
    // Raise alert.
    const id = idGen();
    const alert: Alert = {
      id,
      assetId: asset.id,
      startIso,
      peakTempC,
      severity: peakSeverity,
      durationMinutes: durationMin,
    };
    return {
      state: {
        excursionStartIso: startIso,
        peakTempC,
        peakSeverity,
        activeAlertId: id,
        hasOpenAlert: true,
      },
      emit: alert,
    };
  }

  // Still in pre-grace window or already-alerted; just update peaks.
  return {
    state: {
      excursionStartIso: startIso,
      peakTempC,
      peakSeverity,
      ...(prev.activeAlertId !== undefined ? { activeAlertId: prev.activeAlertId } : {}),
      hasOpenAlert: prev.hasOpenAlert,
    },
  };
}

function midpoint(w: StorageWindow): number {
  if (!isFinite(w.minC)) return w.maxC - 5;
  return (w.minC + w.maxC) / 2;
}

function bumpSeverity(prev: Severity | undefined, next: Severity): Severity {
  const order: Record<Severity, number> = { ok: 0, warning: 1, critical: 2 };
  if (prev === undefined) return next;
  return order[next] > order[prev] ? next : prev;
}

function minutesBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

// ────────────────────────────────────────────────────────────────────────
// Inspector-mode roll-up (compliance log)
// ────────────────────────────────────────────────────────────────────────

export interface ComplianceLogEntry {
  readonly assetId: string;
  readonly assetName: string;
  readonly periodStartIso: string;
  readonly periodEndIso: string;
  readonly readingCount: number;
  readonly minTempC: number;
  readonly maxTempC: number;
  readonly avgTempC: number;
  readonly outOfWindowMinutes: number;
  readonly criticalAlertCount: number;
  readonly warningAlertCount: number;
}

export function buildComplianceLog(
  asset: Asset,
  readings: readonly TemperatureReading[],
  alerts: readonly Alert[],
): ComplianceLogEntry {
  if (readings.length === 0) {
    return {
      assetId: asset.id,
      assetName: asset.name,
      periodStartIso: "",
      periodEndIso: "",
      readingCount: 0,
      minTempC: 0,
      maxTempC: 0,
      avgTempC: 0,
      outOfWindowMinutes: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
    };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const r of readings) {
    if (r.tempC < min) min = r.tempC;
    if (r.tempC > max) max = r.tempC;
    sum += r.tempC;
  }
  const avg = sum / readings.length;
  const oow = alerts
    .filter((a) => a.assetId === asset.id)
    .reduce((acc, a) => acc + a.durationMinutes, 0);
  const myAlerts = alerts.filter((a) => a.assetId === asset.id);
  return {
    assetId: asset.id,
    assetName: asset.name,
    periodStartIso: readings[0]!.atIso,
    periodEndIso: readings[readings.length - 1]!.atIso,
    readingCount: readings.length,
    minTempC: round1(min),
    maxTempC: round1(max),
    avgTempC: round1(avg),
    outOfWindowMinutes: oow,
    criticalAlertCount: myAlerts.filter((a) => a.severity === "critical").length,
    warningAlertCount: myAlerts.filter((a) => a.severity === "warning").length,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
