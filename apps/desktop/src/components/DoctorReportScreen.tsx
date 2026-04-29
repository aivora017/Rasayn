// DoctorReportScreen — top doctors leaderboard (Marg defectors ask for this).
// Phonetic dedup + drug-class breakdown.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Stethoscope, AlertTriangle } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import { paise, formatINR } from "@pharmacare/shared-types";

type Period = "30d" | "90d" | "365d";

interface DoctorRow {
  doctorId: string;
  doctorName: string;
  doctorRegNo: string;
  billCount: number;
  totalRxValuePaise: number;
  topDrugClass?: string;
}

// Inline mock RPC until Tauri command lands — keeps screen real for demo
async function fetchDoctorReport(_shopId: string, _period: Period): Promise<readonly DoctorRow[]> {
  // Return shaped sample data so the UI is real and demoable today.
  return [
    { doctorId: "d1", doctorName: "Dr. Sharma",   doctorRegNo: "MH-12345", billCount: 142, totalRxValuePaise: 3_45_000_00, topDrugClass: "Antihypertensive" },
    { doctorId: "d2", doctorName: "Dr. Patel",    doctorRegNo: "MH-23456", billCount: 89,  totalRxValuePaise: 1_98_000_00, topDrugClass: "Antidiabetic"     },
    { doctorId: "d3", doctorName: "Dr. Khan",     doctorRegNo: "MH-34567", billCount: 67,  totalRxValuePaise: 1_22_000_00, topDrugClass: "Antibiotic"       },
    { doctorId: "d4", doctorName: "Dr. Iyer",     doctorRegNo: "MH-45678", billCount: 54,  totalRxValuePaise:    98_000_00, topDrugClass: "Analgesic"        },
    { doctorId: "d5", doctorName: "Dr. Banerjee", doctorRegNo: "MH-56789", billCount: 41,  totalRxValuePaise:    72_000_00 },
  ];
}

/** Cheap phonetic key — simplified Soundex variant. Helps detect doppelganger spellings. */
export function phoneticKey(s: string): string {
  const cleaned = s.toLowerCase().replace(/^dr\.?\s*/, "").replace(/[^a-z]/g, "");
  if (!cleaned) return "";
  const first = cleaned[0]!;
  const rest = cleaned.slice(1)
    .replace(/[aeiouhwy]/g, "")
    .replace(/(.)\1+/g, "$1")
    .slice(0, 4);
  return (first + rest).padEnd(4, "0").slice(0, 4).toUpperCase();
}

export default function DoctorReportScreen(): React.ReactElement {
  const [period, setPeriod] = useState<Period>("30d");
  const [rows, setRows] = useState<readonly DoctorRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await fetchDoctorReport("shop_local", period)); }
    finally { setBusy(false); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);

  // Group by phonetic key — flag possible duplicates
  const possibleDupes = useMemo(() => {
    const buckets = new Map<string, DoctorRow[]>();
    for (const r of rows) {
      const k = phoneticKey(r.doctorName);
      const arr = buckets.get(k) ?? []; arr.push(r); buckets.set(k, arr);
    }
    return [...buckets.values()].filter((b) => b.length > 1);
  }, [rows]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="doctorreport">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Stethoscope size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Doctor-Wise Sales Report</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Top prescribers · drug-class breakdown · phonetic dedup
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          {(["30d","90d","365d"] as Period[]).map((p) => (
            <Button key={p}
              variant={period === p ? "default" : "ghost"}
              onClick={() => setPeriod(p)}
            >{p === "30d" ? "30 days" : p === "90d" ? "90 days" : "1 year"}</Button>
          ))}
        </div>
      </header>

      {possibleDupes.length > 0 && (
        <Glass>
          <div className="p-3 flex gap-2 text-[12px] text-[var(--pc-state-warning)]">
            <AlertTriangle size={14} className="mt-0.5" />
            <div>
              <strong>{possibleDupes.length}</strong> possible duplicate doctor name{possibleDupes.length === 1 ? "" : "s"} detected by phonetic key.
              Open Directory → Doctors to merge.
            </div>
          </div>
        </Glass>
      )}

      <Glass>
        <div className="p-4">
          {busy ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">No prescribed bills in this period.</div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Rank</th>
                  <th className="py-2 font-medium">Doctor</th>
                  <th className="py-2 font-medium">Reg No</th>
                  <th className="py-2 font-medium text-right">Bills</th>
                  <th className="py-2 font-medium text-right">Total Rx Value</th>
                  <th className="py-2 font-medium">Top Class</th>
                  <th className="py-2 font-medium">Phonetic</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.doctorId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2 font-mono">{i + 1}</td>
                    <td className="py-2 font-medium">{r.doctorName}</td>
                    <td className="py-2 text-[var(--pc-text-secondary)]">{r.doctorRegNo}</td>
                    <td className="py-2 font-mono tabular-nums text-right">{r.billCount}</td>
                    <td className="py-2 font-mono tabular-nums text-right">{formatINR(paise(r.totalRxValuePaise))}</td>
                    <td className="py-2">{r.topDrugClass ? <Badge variant="info">{r.topDrugClass}</Badge> : ""}</td>
                    <td className="py-2 text-[11px] text-[var(--pc-text-tertiary)] font-mono">{phoneticKey(r.doctorName)}</td>
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
