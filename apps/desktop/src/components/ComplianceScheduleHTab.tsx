// ComplianceScheduleHTab — Schedule H/H1/X register UI.
// FDA-inspector ready table; period filter; export to CSV/PDF.
import { useState, useMemo } from "react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import { Download, Search, Pill } from "lucide-react";

interface RegisterRow {
  billId: string; billNo: string; billedAt: string;
  schedule: "H" | "H1" | "X";
  customerName: string; doctorName: string; doctorRegNo: string;
  drug: string; batchNo: string; qty: number;
  rxImage?: boolean; witnessName?: string;
}

const DEMO: RegisterRow[] = [
  { billId: "b1", billNo: "B-101", billedAt: "2026-04-15", schedule: "H",  customerName: "Asha Iyer",     doctorName: "Dr. Sharma", doctorRegNo: "MH-12345", drug: "Amoxicillin 500mg", batchNo: "BN-AMX-23", qty: 21, rxImage: true },
  { billId: "b2", billNo: "B-102", billedAt: "2026-04-16", schedule: "H1", customerName: "Ramesh Kumar",  doctorName: "Dr. Patel",  doctorRegNo: "MH-23456", drug: "Tramadol 50mg",     batchNo: "BN-TRM-12", qty: 10, rxImage: true },
  { billId: "b3", billNo: "B-110", billedAt: "2026-04-22", schedule: "H",  customerName: "Priya Sharma",  doctorName: "Dr. Khan",   doctorRegNo: "MH-34567", drug: "Pantoprazole 40mg", batchNo: "BN-PAN-08", qty: 30, rxImage: false },
  { billId: "b4", billNo: "B-115", billedAt: "2026-04-25", schedule: "X",  customerName: "John Doe",     doctorName: "Dr. Iyer",   doctorRegNo: "MH-45678", drug: "Morphine 10mg",     batchNo: "BN-MOR-02", qty: 5,  rxImage: true, witnessName: "Pharmacist B" },
];

function downloadCsv(filename: string, header: readonly string[], rows: readonly (readonly string[])[]): void {
  const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const csv = [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ComplianceScheduleHTab(): React.ReactElement {
  const [filter, setFilter] = useState<"all" | "H" | "H1" | "X">("all");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    return DEMO.filter((r) => {
      if (filter !== "all" && r.schedule !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return r.customerName.toLowerCase().includes(q)
            || r.doctorName.toLowerCase().includes(q)
            || r.drug.toLowerCase().includes(q)
            || r.batchNo.toLowerCase().includes(q);
      }
      return true;
    });
  }, [filter, search]);

  const exportCsv = () => downloadCsv(
    `register_${filter}_${new Date().toISOString().slice(0, 10)}.csv`,
    ["Bill No","Date","Schedule","Customer","Doctor","Reg No","Drug","Batch","Qty","Rx Img","Witness"],
    filtered.map((r) => [
      r.billNo, r.billedAt, r.schedule, r.customerName, r.doctorName, r.doctorRegNo,
      r.drug, r.batchNo, String(r.qty), r.rxImage ? "Y" : "N", r.witnessName ?? "",
    ]),
  );

  return (
    <div className="flex flex-col gap-3" data-testid="schedule-h-tab">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pill size={16} aria-hidden /><h2 className="font-medium">Schedule H · H1 · X register</h2>
          <Badge variant="neutral">{filtered.length} entries</Badge>
        </div>
        <div className="flex gap-1">
          {(["all","H","H1","X"] as const).map((s) => (
            <Button key={s} variant={filter === s ? "default" : "ghost"} onClick={() => setFilter(s)}>{s.toUpperCase()}</Button>
          ))}
          <Button variant="ghost" onClick={exportCsv}><Download size={12} /> CSV</Button>
        </div>
      </div>

      <Glass>
        <div className="p-3 flex items-center gap-2">
          <Search size={14} className="text-[var(--pc-text-secondary)]" aria-hidden />
          <Input placeholder="Search customer · doctor · drug · batch…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Glass>

      <Glass>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                <th className="py-2 font-medium">Bill</th>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Sched</th>
                <th className="py-2 font-medium">Customer</th>
                <th className="py-2 font-medium">Doctor</th>
                <th className="py-2 font-medium">Reg No</th>
                <th className="py-2 font-medium">Drug</th>
                <th className="py-2 font-medium">Batch</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium">Rx</th>
                <th className="py-2 font-medium">Witness</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.billId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                  <td className="py-1.5 font-mono">{r.billNo}</td>
                  <td className="py-1.5">{r.billedAt}</td>
                  <td className="py-1.5">
                    <Badge variant={r.schedule === "X" ? "danger" : r.schedule === "H1" ? "warning" : "info"}>{r.schedule}</Badge>
                  </td>
                  <td className="py-1.5">{r.customerName}</td>
                  <td className="py-1.5">{r.doctorName}</td>
                  <td className="py-1.5 text-[var(--pc-text-secondary)]">{r.doctorRegNo}</td>
                  <td className="py-1.5">{r.drug}</td>
                  <td className="py-1.5 font-mono text-[var(--pc-text-secondary)]">{r.batchNo}</td>
                  <td className="py-1.5 font-mono tabular-nums text-right">{r.qty}</td>
                  <td className="py-1.5">{r.rxImage ? <Badge variant="success">✓</Badge> : <Badge variant="warning">—</Badge>}</td>
                  <td className="py-1.5">{r.witnessName ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">No entries match.</div>
          )}
        </div>
      </Glass>
    </div>
  );
}
