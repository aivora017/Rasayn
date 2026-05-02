// ColdChainScreen — S19.
// Live BLE-paired sensor management + temperature log entry + open-excursion review.
// Backed by cold_chain_* Tauri commands (S18).

import { useCallback, useEffect, useState } from "react";
import { Snowflake, Plus, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  coldChainUpsertSensorRpc,
  coldChainListSensorsRpc,
  coldChainLogReadingRpc,
  coldChainListExcursionsRpc,
  coldChainCloseExcursionRpc,
  type ColdChainSensorDTO,
  type ColdChainExcursionDTO,
} from "../lib/ipc.js";

type Toast = { kind: "ok" | "err"; msg: string } | null;
const DEFAULT_SHOP_ID = "shop_main";

export interface ColdChainScreenProps { readonly visible?: boolean }

export default function ColdChainScreen({ visible = true }: ColdChainScreenProps): React.ReactElement {
  const [sensors, setSensors] = useState<readonly ColdChainSensorDTO[]>([]);
  const [excursions, setExcursions] = useState<readonly ColdChainExcursionDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // Add-sensor form
  const [sId, setSId] = useState("");
  const [sLabel, setSLabel] = useState("");
  const [sMac, setSMac] = useState("");
  const [sMin, setSMin] = useState("2");
  const [sMax, setSMax] = useState("8");

  // Reading form
  const [rSensor, setRSensor] = useState("");
  const [rTemp, setRTemp] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [s, e] = await Promise.all([
        coldChainListSensorsRpc(DEFAULT_SHOP_ID),
        coldChainListExcursionsRpc({ openOnly: true, limit: 50 }),
      ]);
      setSensors(s);
      setExcursions(e);
    } catch (err) {
      setToast({ kind: "err", msg: `Reload failed: ${String(err)}` });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { if (visible) void reload(); }, [visible, reload]);

  const onAddSensor = useCallback(async () => {
    if (!sId.trim() || !sLabel.trim() || !sMac.trim()) {
      setToast({ kind: "err", msg: "Sensor ID, label, and BLE MAC are required" });
      return;
    }
    setBusy(true);
    try {
      await coldChainUpsertSensorRpc({
        id: sId.trim(),
        shopId: DEFAULT_SHOP_ID,
        bleMac: sMac.trim(),
        label: sLabel.trim(),
        minSafeC: Number.parseFloat(sMin) || 2,
        maxSafeC: Number.parseFloat(sMax) || 8,
      });
      setToast({ kind: "ok", msg: `Sensor ${sId} saved` });
      setSId(""); setSLabel(""); setSMac("");
      await reload();
    } catch (err) { setToast({ kind: "err", msg: String(err) }); }
    finally { setBusy(false); }
  }, [sId, sLabel, sMac, sMin, sMax, reload]);

  const onLog = useCallback(async () => {
    if (!rSensor.trim() || !rTemp.trim()) {
      setToast({ kind: "err", msg: "Pick a sensor and enter a temperature" });
      return;
    }
    const t = Number.parseFloat(rTemp);
    if (Number.isNaN(t)) {
      setToast({ kind: "err", msg: "Temperature must be a number" });
      return;
    }
    setBusy(true);
    try {
      await coldChainLogReadingRpc({ sensorId: rSensor, tempC: t });
      setToast({ kind: "ok", msg: `Reading ${t.toFixed(1)}°C logged for ${rSensor}` });
      setRTemp("");
      await reload();
    } catch (err) { setToast({ kind: "err", msg: String(err) }); }
    finally { setBusy(false); }
  }, [rSensor, rTemp, reload]);

  const onClose = useCallback(async (exId: number, aefiFiled: boolean) => {
    setBusy(true);
    try {
      await coldChainCloseExcursionRpc({ excursionId: exId, aefiFiled });
      setToast({ kind: "ok", msg: `Excursion #${exId} closed` });
      await reload();
    } catch (err) { setToast({ kind: "err", msg: String(err) }); }
    finally { setBusy(false); }
  }, [reload]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="coldchain">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Snowflake size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Cold-Chain (BLE Sensors)</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Live temperature streams · 2-8°C window enforcement · auto-flag excursions for AEFI
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={reload} disabled={busy}><RefreshCw size={14} /> Refresh</Button>
      </header>

      {toast && (
        <Glass>
          <div className={`flex items-start gap-2 p-3 text-[13px] ${toast.kind === "ok" ? "text-[var(--pc-state-success)]" : "text-[var(--pc-state-danger)]"}`}>
            {toast.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
            {toast.msg}
          </div>
        </Glass>
      )}

      <Glass>
        <div className="p-4 flex flex-col gap-3" data-testid="coldchain-add-sensor">
          <h2 className="font-medium text-[14px] flex items-center gap-2"><Plus size={14} /> Pair a sensor</h2>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <Input placeholder="Sensor ID (e.g. fridge_01)" value={sId} onChange={(e) => setSId(e.target.value)} />
            <Input placeholder="Label" value={sLabel} onChange={(e) => setSLabel(e.target.value)} />
            <Input placeholder="BLE MAC (AA:BB:CC:…)" value={sMac} onChange={(e) => setSMac(e.target.value)} />
            <Input placeholder="Min °C" value={sMin} onChange={(e) => setSMin(e.target.value)} />
            <Input placeholder="Max °C" value={sMax} onChange={(e) => setSMax(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void onAddSensor()} disabled={busy}>Save sensor</Button>
          </div>
        </div>
      </Glass>

      <Glass>
        <div className="p-4 flex flex-col gap-2" data-testid="coldchain-sensors">
          <h2 className="font-medium text-[14px]">Paired sensors ({sensors.length})</h2>
          {sensors.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              No sensors paired yet. Add one above.
            </div>
          ) : (
            <table className="text-[12px] w-full">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">ID</th>
                  <th className="py-2 font-medium">Label</th>
                  <th className="py-2 font-medium">MAC</th>
                  <th className="py-2 font-medium">Window</th>
                  <th className="py-2 font-medium">Installed</th>
                </tr>
              </thead>
              <tbody>
                {sensors.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2 font-mono">{s.id}</td>
                    <td className="py-2">{s.label}</td>
                    <td className="py-2 font-mono">{s.bleMac}</td>
                    <td className="py-2">
                      <Badge variant="info">{s.minSafeC.toFixed(1)} – {s.maxSafeC.toFixed(1)}°C</Badge>
                    </td>
                    <td className="py-2 text-[var(--pc-text-secondary)]">{new Date(s.installedAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Glass>

      <Glass>
        <div className="p-4 flex flex-col gap-3" data-testid="coldchain-log-reading">
          <h2 className="font-medium text-[14px] flex items-center gap-2"><Snowflake size={14} /> Log a reading</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select className="border rounded px-2 py-1 text-[13px]" value={rSensor} onChange={(e) => setRSensor(e.target.value)} aria-label="sensor">
              <option value="">Select sensor…</option>
              {sensors.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.id})</option>)}
            </select>
            <Input placeholder="Temperature °C" value={rTemp} onChange={(e) => setRTemp(e.target.value)} />
            <Button onClick={() => void onLog()} disabled={busy || !rSensor}>Log reading</Button>
          </div>
        </div>
      </Glass>

      <Glass>
        <div className="p-4 flex flex-col gap-2" data-testid="coldchain-excursions">
          <h2 className="font-medium text-[14px] flex items-center gap-2">
            <AlertTriangle size={14} /> Open excursions ({excursions.length})
          </h2>
          {excursions.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              All sensors within safe range.
            </div>
          ) : (
            <table className="text-[12px] w-full">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">#</th>
                  <th className="py-2 font-medium">Sensor</th>
                  <th className="py-2 font-medium">Started</th>
                  <th className="py-2 font-medium">Range °C</th>
                  <th className="py-2 font-medium">Mins out</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {excursions.map((x) => (
                  <tr key={x.id} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2 font-mono">#{x.id}</td>
                    <td className="py-2 font-mono">{x.sensorId}</td>
                    <td className="py-2 text-[var(--pc-text-secondary)]">{new Date(x.excursionStart).toLocaleString("en-IN")}</td>
                    <td className="py-2">
                      <Badge variant="warning">
                        {x.minTempC?.toFixed(1) ?? "—"} → {x.maxTempC?.toFixed(1) ?? "—"}
                      </Badge>
                    </td>
                    <td className="py-2">{x.minutesOutside}</td>
                    <td className="py-2 flex gap-1">
                      <Button variant="ghost" onClick={() => void onClose(x.id, false)} disabled={busy}>Close</Button>
                      <Button onClick={() => void onClose(x.id, true)} disabled={busy}>Close + AEFI</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Glass>
    </div>
  );
}
