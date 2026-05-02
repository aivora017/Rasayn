// DPDPConsentScreen — DPDP Act 2023 compliance.
// Real RPC wiring (S19) — replaces S18 DEMO_* fixtures.
// Two tabs: per-customer consent matrix + DSR (data-subject-rights) queue.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import { dsrUrgency, type DsrStatus } from "@pharmacare/dpdp";
import {
  dpdpUpsertConsentRpc,
  dpdpListConsentsRpc,
  dpdpOpenDsrRpc,
  dpdpUpdateDsrStatusRpc,
  dpdpListDsrRpc,
  type DpdpConsentDTO,
  type DpdpDsrRequestDTO,
} from "../lib/ipc.js";

const PURPOSES = ["billing","compliance","marketing","abdm","loyalty","research-anon"] as const;
type Purpose = typeof PURPOSES[number];
type Tab = "consents" | "dsr";
type Toast = { kind: "ok" | "err"; msg: string } | null;

function genDsrId(): string {
  return `dsr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function DPDPConsentScreen(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("dsr");
  const [dsr, setDsr] = useState<readonly DpdpDsrRequestDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // Consent-tab state
  const [customerId, setCustomerId] = useState("");
  const [consents, setConsents] = useState<readonly DpdpConsentDTO[]>([]);

  // DSR-open form
  const [newDsrCustomerId, setNewDsrCustomerId] = useState("");
  const [newDsrKind, setNewDsrKind] = useState<DpdpDsrRequestDTO["kind"]>("access");

  const reloadDsr = useCallback(async () => {
    setBusy(true);
    try {
      const list = await dpdpListDsrRpc({ openOnly: true, limit: 100 });
      setDsr(list);
    } catch (e) {
      setToast({ kind: "err", msg: `Failed to list DSR: ${String(e)}` });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void reloadDsr(); }, [reloadDsr]);

  const reloadConsents = useCallback(async () => {
    if (!customerId.trim()) { setConsents([]); return; }
    setBusy(true);
    try {
      const list = await dpdpListConsentsRpc(customerId.trim());
      setConsents(list);
    } catch (e) { setToast({ kind: "err", msg: `Failed to list consents: ${String(e)}` }); }
    finally { setBusy(false); }
  }, [customerId]);

  const onTogglePurpose = useCallback(async (purpose: Purpose, granted: boolean) => {
    if (!customerId.trim()) return;
    setBusy(true);
    try {
      await dpdpUpsertConsentRpc({
        customerId: customerId.trim(),
        purpose,
        granted,
        evidence: granted ? "dashboard-toggle" : "dashboard-withdraw",
      });
      setToast({ kind: "ok", msg: `${purpose} ${granted ? "granted" : "withdrawn"}` });
      await reloadConsents();
    } catch (e) { setToast({ kind: "err", msg: String(e) }); }
    finally { setBusy(false); }
  }, [customerId, reloadConsents]);

  const onOpenDsr = useCallback(async () => {
    if (!newDsrCustomerId.trim()) {
      setToast({ kind: "err", msg: "Customer ID required" });
      return;
    }
    setBusy(true);
    try {
      await dpdpOpenDsrRpc({
        id: genDsrId(),
        customerId: newDsrCustomerId.trim(),
        kind: newDsrKind,
      });
      setToast({ kind: "ok", msg: `DSR opened for ${newDsrCustomerId}` });
      setNewDsrCustomerId("");
      await reloadDsr();
    } catch (e) { setToast({ kind: "err", msg: String(e) }); }
    finally { setBusy(false); }
  }, [newDsrCustomerId, newDsrKind, reloadDsr]);

  const onAdvance = useCallback(async (id: string, status: DsrStatus) => {
    setBusy(true);
    try {
      await dpdpUpdateDsrStatusRpc({ id, status });
      await reloadDsr();
    } catch (e) { setToast({ kind: "err", msg: String(e) }); }
    finally { setBusy(false); }
  }, [reloadDsr]);

  const consentMap = useMemo(() => {
    const map = new Map<string, DpdpConsentDTO>();
    for (const c of consents) map.set(c.purpose, c);
    return map;
  }, [consents]);

  const openCount = dsr.length;

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="dpdp">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">DPDP Act — Consent &amp; DSR</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Per-purpose consent registry · 30-day DSR clock · Right-to-erasure queue
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant={tab === "dsr" ? "default" : "ghost"} onClick={() => setTab("dsr")}>DSR queue ({openCount})</Button>
          <Button variant={tab === "consents" ? "default" : "ghost"} onClick={() => setTab("consents")}>Consent matrix</Button>
        </div>
      </header>

      {toast && (
        <Glass>
          <div className={`flex items-start gap-2 p-3 text-[13px] ${toast.kind === "ok" ? "text-[var(--pc-state-success)]" : "text-[var(--pc-state-danger)]"}`}>
            {toast.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
            {toast.msg}
          </div>
        </Glass>
      )}

      {tab === "dsr" && (
        <>
          <Glass>
            <div className="p-4 flex flex-col gap-3" data-testid="dsr-open-form">
              <h2 className="font-medium text-[14px]">Open new DSR</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input placeholder="Customer ID" value={newDsrCustomerId} onChange={(e) => setNewDsrCustomerId(e.target.value)} />
                <select className="border rounded px-2 py-1 text-[13px]" value={newDsrKind} onChange={(e) => setNewDsrKind(e.target.value as DpdpDsrRequestDTO["kind"])} aria-label="kind">
                  <option value="access">Access</option>
                  <option value="erasure">Erasure</option>
                  <option value="correction">Correction</option>
                  <option value="portability">Portability</option>
                </select>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={reloadDsr} disabled={busy}><RefreshCw size={14} /> Refresh</Button>
                  <Button onClick={() => void onOpenDsr()} disabled={busy}>Open DSR</Button>
                </div>
              </div>
            </div>
          </Glass>

          <Glass>
            <div className="p-4" data-testid="dsr-queue">
              {dsr.length === 0 ? (
                <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">No open DSR requests.</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                      <th className="py-2 font-medium">Customer</th>
                      <th className="py-2 font-medium">Kind</th>
                      <th className="py-2 font-medium">Received</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 font-medium">Clock</th>
                      <th className="py-2 font-medium">Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dsr.map((r) => {
                      const u = dsrUrgency({ id: r.id, customerId: r.customerId, kind: r.kind, receivedAt: r.receivedAt, status: r.status });
                      const tone = u.category === "overdue" ? "danger" : u.category === "warning" ? "warning" : "success";
                      return (
                        <tr key={r.id} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                          <td className="py-2 font-mono">{r.customerId}</td>
                          <td className="py-2"><Badge variant="info">{r.kind}</Badge></td>
                          <td className="py-2 text-[var(--pc-text-secondary)]">{new Date(r.receivedAt).toLocaleDateString("en-IN")}</td>
                          <td className="py-2"><Badge variant="neutral">{r.status}</Badge></td>
                          <td className="py-2">
                            <Badge variant={tone}>
                              {u.category === "overdue" ? "OVERDUE"
                                : u.hoursLeft === Number.POSITIVE_INFINITY ? "—"
                                : `${Math.floor(u.hoursLeft / 24)}d ${Math.floor(u.hoursLeft % 24)}h`}
                            </Badge>
                          </td>
                          <td className="py-2">
                            {r.status === "received" && <Button onClick={() => void onAdvance(r.id, "verifying")} disabled={busy}>Start verifying</Button>}
                            {r.status === "verifying" && <Button onClick={() => void onAdvance(r.id, "in-progress")} disabled={busy}>Begin work</Button>}
                            {r.status === "in-progress" && (
                              <div className="flex gap-1">
                                <Button onClick={() => void onAdvance(r.id, "fulfilled")} disabled={busy}><CheckCircle2 size={12} /> Fulfilled</Button>
                                <Button variant="ghost" onClick={() => void onAdvance(r.id, "rejected")} disabled={busy}>Reject</Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Glass>
        </>
      )}

      {tab === "consents" && (
        <>
          <Glass>
            <div className="p-4 flex flex-col gap-3" data-testid="consent-lookup">
              <h2 className="font-medium text-[14px]">Look up customer consents</h2>
              <div className="flex gap-2">
                <Input placeholder="Customer ID" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
                <Button onClick={() => void reloadConsents()} disabled={busy || !customerId.trim()}>Look up</Button>
              </div>
            </div>
          </Glass>

          <Glass>
            <div className="p-4 overflow-x-auto" data-testid="consent-matrix">
              {!customerId.trim() ? (
                <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">Enter a customer ID above.</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                      <th className="py-2 font-medium">Purpose</th>
                      <th className="py-2 font-medium">Granted</th>
                      <th className="py-2 font-medium">Evidence</th>
                      <th className="py-2 font-medium">Toggle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PURPOSES.map((p) => {
                      const c = consentMap.get(p);
                      const granted = c?.granted === 1;
                      return (
                        <tr key={p} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                          <td className="py-2 font-mono">{p}</td>
                          <td className="py-2">
                            {granted
                              ? <Badge variant="success">Granted</Badge>
                              : <Badge variant="neutral">—</Badge>}
                          </td>
                          <td className="py-2 text-[var(--pc-text-secondary)]">{c?.evidence ?? "—"}</td>
                          <td className="py-2">
                            <Button variant={granted ? "ghost" : "default"} onClick={() => void onTogglePurpose(p, !granted)} disabled={busy}>
                              {granted ? "Withdraw" : "Grant"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Glass>
        </>
      )}
    </div>
  );
}
