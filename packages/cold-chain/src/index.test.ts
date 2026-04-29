import { describe, it, expect } from "vitest";
import {
  STORAGE_WINDOWS,
  classifyReading,
  step,
  INITIAL_ALERT_STATE,
  buildComplianceLog,
  type Asset,
  type TemperatureReading,
  type Alert,
  type AlertEngineState,
} from "./index.js";

const FRIDGE: Asset = {
  id: "fridge_1",
  name: "Vaccine fridge #1",
  storageClass: "refrigerated",
  graceMinutes: 30,
};

const ROOM: Asset = {
  id: "shelf_1",
  name: "OTC shelf",
  storageClass: "room",
  graceMinutes: 30,
};

function r(at: string, t: number, asset = FRIDGE): TemperatureReading {
  return { assetId: asset.id, atIso: at, tempC: t, source: "probe-usb" };
}

describe("classifyReading", () => {
  it("in-window stays ok", () => {
    expect(classifyReading(FRIDGE, r("2026-04-29T10:00:00Z", 5)).severity).toBe("ok");
  });
  it("0.3°C above max → warning", () => {
    expect(classifyReading(FRIDGE, r("2026-04-29T10:00:00Z", 8.3)).severity).toBe("warning");
  });
  it("1°C above max → critical", () => {
    expect(classifyReading(FRIDGE, r("2026-04-29T10:00:00Z", 9)).severity).toBe("critical");
  });
  it("0.3°C below min → warning", () => {
    expect(classifyReading(FRIDGE, r("2026-04-29T10:00:00Z", 1.7)).severity).toBe("warning");
  });
  it("note describes direction + delta", () => {
    const c = classifyReading(FRIDGE, r("2026-04-29T10:00:00Z", 12));
    expect(c.note).toContain("above max");
    expect(c.note).toContain("4.00");
  });
  it("respects per-asset thresholds override", () => {
    const tighter: Asset = { ...FRIDGE, thresholds: { minC: 4, maxC: 6 } };
    expect(classifyReading(tighter, r("2026-04-29T10:00:00Z", 7)).severity).toBe("critical");
  });
  it("STORAGE_WINDOWS exposes the four classes", () => {
    expect(STORAGE_WINDOWS.refrigerated).toEqual({ minC: 2, maxC: 8 });
    expect(STORAGE_WINDOWS.room).toEqual({ minC: 15, maxC: 30 });
  });
});

describe("alert state machine", () => {
  let nextId = 0;
  const idGen = () => `alert_${++nextId}`;

  it("steady in-window emits nothing", () => {
    nextId = 0;
    const state = INITIAL_ALERT_STATE;
    const reading = r("2026-04-29T10:00:00Z", 5);
    const cls = classifyReading(FRIDGE, reading);
    const out = step(FRIDGE, state, reading, cls, idGen);
    expect(out.state.hasOpenAlert).toBe(false);
    expect(out.emit).toBeUndefined();
  });

  it("warning excursion under grace doesn't alert", () => {
    nextId = 0;
    let state: AlertEngineState = INITIAL_ALERT_STATE;
    // 10 minutes warning (just above max, within tolerance)
    const a = r("2026-04-29T10:00:00Z", 8.3);
    state = step(FRIDGE, state, a, classifyReading(FRIDGE, a), idGen).state;
    const b = r("2026-04-29T10:10:00Z", 8.4);
    const out = step(FRIDGE, state, b, classifyReading(FRIDGE, b), idGen);
    expect(out.emit).toBeUndefined();
    expect(out.state.hasOpenAlert).toBe(false);
  });

  it("critical reading raises alert immediately (no grace)", () => {
    nextId = 0;
    const state = INITIAL_ALERT_STATE;
    const reading = r("2026-04-29T10:00:00Z", 15);  // way above 8°C
    const cls = classifyReading(FRIDGE, reading);
    expect(cls.severity).toBe("critical");
    const out = step(FRIDGE, state, reading, cls, idGen);
    expect(out.emit).toBeDefined();
    expect(out.emit?.severity).toBe("critical");
    expect(out.state.hasOpenAlert).toBe(true);
  });

  it("excursion past grace minutes raises a warning alert", () => {
    nextId = 0;
    let state: AlertEngineState = INITIAL_ALERT_STATE;
    const r1 = r("2026-04-29T10:00:00Z", 8.3); // warning, just over
    const r2 = r("2026-04-29T10:35:00Z", 8.4); // 35 min later — past 30-min grace
    const out1 = step(FRIDGE, state, r1, classifyReading(FRIDGE, r1), idGen);
    expect(out1.emit).toBeUndefined();
    state = out1.state;
    const out2 = step(FRIDGE, state, r2, classifyReading(FRIDGE, r2), idGen);
    expect(out2.emit).toBeDefined();
    expect(out2.emit?.durationMinutes).toBe(35);
    expect(out2.emit?.severity).toBe("warning");
  });

  it("returning to window closes the active alert", () => {
    nextId = 0;
    let state: AlertEngineState = INITIAL_ALERT_STATE;
    const a = r("2026-04-29T10:00:00Z", 12);   // critical
    state = step(FRIDGE, state, a, classifyReading(FRIDGE, a), idGen).state;
    expect(state.hasOpenAlert).toBe(true);
    const back = r("2026-04-29T10:30:00Z", 6); // back in window
    const out = step(FRIDGE, state, back, classifyReading(FRIDGE, back), idGen);
    expect(out.close).toBeDefined();
    expect(out.state.hasOpenAlert).toBe(false);
  });

  it("peak severity escalates from warning to critical", () => {
    nextId = 0;
    let state: AlertEngineState = INITIAL_ALERT_STATE;
    const a = r("2026-04-29T10:00:00Z", 8.3);  // warning
    state = step(FRIDGE, state, a, classifyReading(FRIDGE, a), idGen).state;
    const b = r("2026-04-29T10:35:00Z", 8.4);  // raise warning alert
    state = step(FRIDGE, state, b, classifyReading(FRIDGE, b), idGen).state;
    expect(state.peakSeverity).toBe("warning");
    const c = r("2026-04-29T10:40:00Z", 12);   // bump to critical
    state = step(FRIDGE, state, c, classifyReading(FRIDGE, c), idGen).state;
    expect(state.peakSeverity).toBe("critical");
  });
});

describe("buildComplianceLog", () => {
  it("rolls up min/max/avg over readings", () => {
    const readings: TemperatureReading[] = [
      r("2026-04-29T10:00:00Z", 4),
      r("2026-04-29T11:00:00Z", 6),
      r("2026-04-29T12:00:00Z", 5),
    ];
    const log = buildComplianceLog(FRIDGE, readings, []);
    expect(log.minTempC).toBe(4);
    expect(log.maxTempC).toBe(6);
    expect(log.avgTempC).toBe(5);
    expect(log.readingCount).toBe(3);
    expect(log.criticalAlertCount).toBe(0);
  });

  it("includes asset name + period boundaries", () => {
    const readings: TemperatureReading[] = [
      r("2026-04-29T10:00:00Z", 5),
      r("2026-04-29T22:00:00Z", 5),
    ];
    const log = buildComplianceLog(FRIDGE, readings, []);
    expect(log.assetName).toBe("Vaccine fridge #1");
    expect(log.periodStartIso).toBe("2026-04-29T10:00:00Z");
    expect(log.periodEndIso).toBe("2026-04-29T22:00:00Z");
  });

  it("counts alerts by severity", () => {
    const alerts: Alert[] = [
      { id: "1", assetId: FRIDGE.id, startIso: "x", peakTempC: 12, severity: "critical", durationMinutes: 60 },
      { id: "2", assetId: FRIDGE.id, startIso: "x", peakTempC: 8.4, severity: "warning",  durationMinutes: 30 },
      { id: "3", assetId: ROOM.id,   startIso: "x", peakTempC: 31,  severity: "warning",  durationMinutes: 10 },
    ];
    const log = buildComplianceLog(FRIDGE, [r("2026-04-29T10:00:00Z", 5)], alerts);
    expect(log.criticalAlertCount).toBe(1);
    expect(log.warningAlertCount).toBe(1);
    expect(log.outOfWindowMinutes).toBe(90);
  });

  it("handles empty readings", () => {
    const log = buildComplianceLog(FRIDGE, [], []);
    expect(log.readingCount).toBe(0);
  });
});
