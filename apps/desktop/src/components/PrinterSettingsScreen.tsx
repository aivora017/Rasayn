// PrinterSettingsScreen — S14.1
//
// Lists installed printers (via Tauri printer_list), lets the owner pick a
// default thermal + label printer (persisted in localStorage via lib/printer.ts),
// and exposes a "Test fire" button that sends a tiny ESC/POS init+text+cut burst
// to the named printer via printer_test.

import { useCallback, useEffect, useState } from "react";
import { Printer, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  listInstalledPrinters,
  printerTestFire,
  getDefaultThermalPrinter, setDefaultThermalPrinter,
  getDefaultLabelPrinter, setDefaultLabelPrinter,
} from "../lib/printer.js";
import type { DiscoveredPrinterDTO } from "../lib/ipc.js";

type Toast = { kind: "ok" | "err"; msg: string } | null;

export default function PrinterSettingsScreen(): React.ReactElement {
  const [printers, setPrinters] = useState<readonly DiscoveredPrinterDTO[]>([]);
  const [thermal, setThermal] = useState<string | null>(getDefaultThermalPrinter());
  const [label, setLabel] = useState<string | null>(getDefaultLabelPrinter());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const reload = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const list = await listInstalledPrinters();
      setPrinters(list);
    } catch (e) {
      setErr(`Failed to list printers: ${String(e)}. Run from a packaged app for OS access.`);
      setPrinters([]);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onPickThermal = useCallback((name: string) => {
    setDefaultThermalPrinter(name);
    setThermal(name);
    setToast({ kind: "ok", msg: `Default thermal printer set: ${name}` });
  }, []);
  const onPickLabel = useCallback((name: string) => {
    setDefaultLabelPrinter(name);
    setLabel(name);
    setToast({ kind: "ok", msg: `Default label printer set: ${name}` });
  }, []);

  const onTestFire = useCallback(async (name: string) => {
    setBusy(true); setErr(null);
    try {
      await printerTestFire(name);
      setToast({ kind: "ok", msg: `Test fired on ${name} — check the receipt drawer` });
    } catch (e) {
      setToast({ kind: "err", msg: `Test failed: ${String(e)}` });
    } finally { setBusy(false); }
  }, []);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="printer-settings">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Printer size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Printer Settings</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Default thermal &amp; label printers · ESC/POS test fire
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={reload} disabled={busy}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </header>

      {err && (
        <Glass>
          <div className="flex items-start gap-2 p-3 text-[13px] text-[var(--pc-state-warning)]">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        </Glass>
      )}

      {toast && (
        <Glass>
          <div className={`flex items-start gap-2 p-3 text-[13px] ${
            toast.kind === "ok" ? "text-[var(--pc-state-success)]" : "text-[var(--pc-state-danger)]"
          }`}>
            {toast.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
            {toast.msg}
          </div>
        </Glass>
      )}

      <Glass>
        <div className="p-4 flex flex-col gap-3" data-testid="printer-list">
          <h2 className="font-medium">Installed printers ({printers.length})</h2>
          {printers.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              No printers detected. Connect via USB / Wi-Fi and click Refresh.
            </div>
          ) : (
            <table className="text-[13px] w-full">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Kind</th>
                  <th className="py-2 font-medium text-center">Default</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {printers.map((p) => {
                  const isThermal = p.name === thermal;
                  const isLabel = p.name === label;
                  return (
                    <tr key={p.name} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td className="py-2 text-[var(--pc-text-secondary)]">
                        <Badge variant={p.kind === "thermal" ? "saffron" : p.kind === "label" ? "info" : "neutral"}>
                          {p.kind}
                        </Badge>
                      </td>
                      <td className="py-2 text-center">
                        {isThermal && <Badge variant="success">Thermal</Badge>}
                        {isLabel && <Badge variant="success">Label</Badge>}
                      </td>
                      <td className="py-2 text-right">
                        <div className="inline-flex flex-wrap gap-2 justify-end">
                          <Button variant="ghost" onClick={() => onPickThermal(p.name)} disabled={busy || isThermal}>
                            Set thermal
                          </Button>
                          <Button variant="ghost" onClick={() => onPickLabel(p.name)} disabled={busy || isLabel}>
                            Set label
                          </Button>
                          <Button variant="secondary" onClick={() => void onTestFire(p.name)} disabled={busy}>
                            Test fire
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Glass>

      <Glass>
        <div className="p-4 text-[12px] text-[var(--pc-text-secondary)]">
          <p>Tips:</p>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            <li>Thermal printer = default for receipts (ESC/POS, 80mm or 58mm).</li>
            <li>Label printer = default for SKU labels (ZPL II / Argox / TSC / Zebra).</li>
            <li>Test fire sends a 30-byte init burst — verify paper feeds + auto-cut.</li>
            <li>Default selections persist via localStorage; safe to clear browser storage to reset.</li>
          </ul>
        </div>
      </Glass>
    </div>
  );
}
