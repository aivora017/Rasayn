// FamilyVaultScreen — household medication binder + per-member consent matrix.
// Backed by @pharmacare/family-vault (15 tests green).
import { useCallback, useMemo, useState } from "react";
import { HeartHandshake, Plus, Trash2, ShieldCheck, Eye, ListChecks, Pill, X } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  addMember, removeMember, updateMemberConsent, buildConsolidatedLog,
  type Family, type FamilyMember, type Relation, type MedicationLogEntry,
} from "@pharmacare/family-vault";

const RELATIONS: readonly { id: Relation; label: string }[] = [
  { id: "self",     label: "Self" },
  { id: "spouse",   label: "Spouse" },
  { id: "child",    label: "Child" },
  { id: "parent",   label: "Parent" },
  { id: "sibling",  label: "Sibling" },
  { id: "guardian", label: "Guardian" },
  { id: "other",    label: "Other" },
];

const INITIAL_FAMILY: Family = {
  id: "fam_demo",
  headOfFamilyCustomerId: "c_priya",
  displayName: "Sharma family",
  members: [
    { customerId: "c_arjun", relation: "spouse", addedAt: "2026-01-20",
      canViewMedicationHistory: true, canRequestRefillOnBehalf: true, canScheduleAppointments: true },
    { customerId: "c_aanya", relation: "child", addedAt: "2026-02-01",
      canViewMedicationHistory: false, canRequestRefillOnBehalf: false, canScheduleAppointments: false },
    { customerId: "c_dadi",  relation: "parent", addedAt: "2026-02-15",
      canViewMedicationHistory: true, canRequestRefillOnBehalf: true, canScheduleAppointments: false },
  ],
  createdAt: "2026-01-15",
};

const DEMO_LOG: readonly MedicationLogEntry[] = [
  { customerId: "c_priya", billId: "B-101", billedAt: "2026-04-25T11:00:00Z", drugName: "Telmisartan 40mg", schedule: "H",   qty: 30, doctorName: "Dr. Khan" },
  { customerId: "c_arjun", billId: "B-102", billedAt: "2026-04-26T11:00:00Z", drugName: "Crocin 500mg",     schedule: "OTC", qty: 10 },
  { customerId: "c_aanya", billId: "B-103", billedAt: "2026-04-27T11:00:00Z", drugName: "Pediatric drops",   schedule: "OTC", qty: 1 },
  { customerId: "c_dadi",  billId: "B-104", billedAt: "2026-04-28T11:00:00Z", drugName: "Metformin 500mg",   schedule: "H",   qty: 60, doctorName: "Dr. Sharma" },
];

export default function FamilyVaultScreen(): React.ReactElement {
  const [family, setFamily] = useState<Family>(INITIAL_FAMILY);
  const [viewer, setViewer] = useState<string>("c_priya");
  const [newMemberId, setNewMemberId] = useState("");
  const [newRelation, setNewRelation] = useState<Relation>("child");

  const onAdd = useCallback(() => {
    if (!newMemberId.trim()) return;
    try {
      const m: FamilyMember = {
        customerId: newMemberId.trim(),
        relation: newRelation,
        addedAt: new Date().toISOString(),
        canViewMedicationHistory: false,
        canRequestRefillOnBehalf: false,
        canScheduleAppointments: false,
      };
      setFamily(addMember(family, m));
      setNewMemberId("");
    } catch (_e) {
      // duplicate or circular — silently ignore in demo
    }
  }, [newMemberId, newRelation, family]);

  const onRemove = useCallback((customerId: string) => {
    setFamily(removeMember(family, customerId));
  }, [family]);

  const toggleConsent = useCallback((customerId: string, key: "canViewMedicationHistory" | "canRequestRefillOnBehalf" | "canScheduleAppointments") => {
    const m = family.members.find((x) => x.customerId === customerId);
    if (!m) return;
    setFamily(updateMemberConsent(family, customerId, { [key]: !m[key] }));
  }, [family]);

  const visibleLog = useMemo(() =>
    buildConsolidatedLog({ family, viewerCustomerId: viewer, rawLog: DEMO_LOG }),
    [family, viewer],
  );

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="family-vault">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HeartHandshake size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">{family.displayName}</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              {1 + family.members.length} members · ABHA-linked when ABDM enabled · privacy via per-member consent
            </p>
          </div>
        </div>
        <Badge variant="info">Head: {family.headOfFamilyCustomerId}</Badge>
      </header>

      {/* Viewer selector — to demo "what does X see?" */}
      <Glass>
        <div className="p-3 flex items-center gap-2 text-[12px]">
          <Eye size={14} aria-hidden />
          <span className="text-[var(--pc-text-secondary)]">Viewing as:</span>
          <select
            value={viewer}
            onChange={(e) => setViewer(e.target.value)}
            className="bg-transparent border border-[var(--pc-border-subtle)] rounded px-2 py-1 text-[12px] font-mono"
          >
            <option value={family.headOfFamilyCustomerId}>{family.headOfFamilyCustomerId} (head)</option>
            {family.members.map((m) => <option key={m.customerId} value={m.customerId}>{m.customerId}</option>)}
          </select>
          <span className="text-[var(--pc-text-tertiary)] ml-auto">
            Switch viewer to see how the consent matrix filters the log below.
          </span>
        </div>
      </Glass>

      {/* Member matrix */}
      <Glass>
        <div className="p-4 flex flex-col gap-3" data-testid="member-matrix">
          <h2 className="font-medium">Members & consent</h2>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                <th className="py-2 font-medium">Customer ID</th>
                <th className="py-2 font-medium">Relation</th>
                <th className="py-2 font-medium text-center">View Rx history</th>
                <th className="py-2 font-medium text-center">Request refill</th>
                <th className="py-2 font-medium text-center">Schedule appt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {family.members.map((m) => (
                <tr key={m.customerId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                  <td className="py-2 font-mono">{m.customerId}</td>
                  <td className="py-2 capitalize">{m.relation}</td>
                  <td className="py-2 text-center">
                    <button onClick={() => toggleConsent(m.customerId, "canViewMedicationHistory")}>
                      {m.canViewMedicationHistory ? <Badge variant="success">✓ ON</Badge> : <Badge variant="neutral">— OFF</Badge>}
                    </button>
                  </td>
                  <td className="py-2 text-center">
                    <button onClick={() => toggleConsent(m.customerId, "canRequestRefillOnBehalf")}>
                      {m.canRequestRefillOnBehalf ? <Badge variant="success">✓ ON</Badge> : <Badge variant="neutral">— OFF</Badge>}
                    </button>
                  </td>
                  <td className="py-2 text-center">
                    <button onClick={() => toggleConsent(m.customerId, "canScheduleAppointments")}>
                      {m.canScheduleAppointments ? <Badge variant="success">✓ ON</Badge> : <Badge variant="neutral">— OFF</Badge>}
                    </button>
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" onClick={() => onRemove(m.customerId)}><Trash2 size={11} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add member form */}
          <div className="flex items-end gap-2 pt-2 border-t border-[var(--pc-border-subtle)]">
            <div className="flex-1">
              <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">Customer ID</label>
              <Input value={newMemberId} onChange={(e) => setNewMemberId(e.target.value)} placeholder="c_arjun" />
            </div>
            <div>
              <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">Relation</label>
              <select
                value={newRelation}
                onChange={(e) => setNewRelation(e.target.value as Relation)}
                className="bg-transparent border border-[var(--pc-border-subtle)] rounded px-2 py-2 text-[13px]"
              >
                {RELATIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <Button onClick={onAdd}><Plus size={14} /> Add member</Button>
          </div>
        </div>
      </Glass>

      {/* Consolidated medication log */}
      <Glass>
        <div className="p-4 flex flex-col gap-3" data-testid="consolidated-log">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListChecks size={14} aria-hidden />
              <h2 className="font-medium">Consolidated medication log — visible to {viewer}</h2>
            </div>
            <Badge variant="neutral">{visibleLog.length} entries</Badge>
          </div>
          <div className="text-[11px] text-[var(--pc-text-tertiary)] flex items-start gap-1">
            <ShieldCheck size={11} className="mt-0.5" />
            <span>Filtered by per-member consent. Members who haven't granted "view Rx history" are excluded from this log.</span>
          </div>
          {visibleLog.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              No entries visible — {viewer} hasn't been granted view-permission for any family member.
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Member</th>
                  <th className="py-2 font-medium">Drug</th>
                  <th className="py-2 font-medium">Sched</th>
                  <th className="py-2 font-medium text-right">Qty</th>
                  <th className="py-2 font-medium">Doctor</th>
                </tr>
              </thead>
              <tbody>
                {visibleLog.map((e) => (
                  <tr key={e.billId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-1.5">{new Date(e.billedAt).toLocaleDateString("en-IN")}</td>
                    <td className="py-1.5 font-mono">{e.customerId}</td>
                    <td className="py-1.5 flex items-center gap-1"><Pill size={10} aria-hidden /> {e.drugName}</td>
                    <td className="py-1.5">
                      <Badge variant={e.schedule === "X" ? "danger" : e.schedule === "H1" ? "warning" : e.schedule === "H" ? "info" : "neutral"}>
                        {e.schedule}
                      </Badge>
                    </td>
                    <td className="py-1.5 font-mono tabular-nums text-right">{e.qty}</td>
                    <td className="py-1.5 text-[var(--pc-text-secondary)]">{e.doctorName ?? "—"}</td>
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
