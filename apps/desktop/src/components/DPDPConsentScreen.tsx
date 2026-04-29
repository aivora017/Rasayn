// DPDPConsentScreen — DPDP Act 2023 compliance.
// Two tabs: per-customer consent matrix + DSR (data-subject-rights) queue.

import { useCallback, useMemo, useState } from "react";
import { ShieldCheck, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  hasEffectiveConsent, transition, dsrUrgency, validateConsent,
  type Consent, type ConsentPurpose, type DsrRequest, type DsrStatus,
} from "@pharmacare/dpdp";

const PURPOSES: readonly ConsentPurpose[] = ["billing","compliance","marketing","abdm","loyalty","research-anon"];

// Demo data — replace with real RPC backed by dpdp_consents + dpdp_dsr_requests
const DEMO_CONSENTS: Consent[] = [
  { customerId: "c1", purpose: "billing",    granted: true,  grantedAt: "2026-01-15", evidence: "OTP" },
  { customerId: "c1", purpose: "compliance", granted: true,  grantedAt: "2026-01-15", evidence: "OTP" },
  { customerId: "c1", purpose: "marketing",  granted: true,  grantedAt: "2026-02-01", evidence: "OTP" },
  { customerId: "c1", purpose: "loyalty",    granted: false, evidence: "paper-form" },
  { customerId: "c2", purpose: "billing",    granted: true,  grantedAt: "2026-03-10", evidence: "OTP" },
  { customerId: "c2", purpose: "compliance", granted: true,  grantedAt: "2026-03-10", evidence: "OTP" },
  { customerId: "c2", purpose: "abdm",       granted: true,  grantedAt: "2026-03-12", withdrawnAt: "2026-04-15", evidence: "OTP" },
];
const DEMO_DSR: DsrRequest[] = [
  { id: "r1", customerId: "c1", kind: "access",      receivedAt: "2026-04-25T10:00:00Z", status: "in-progress" },
  { id: "r2", customerId: "c2", kind: "erasure",     receivedAt: "2026-04-05T10:00:00Z", status: "received" },
  { id: "r3", customerId: "c3", kind: "correction",  receivedAt: "2026-03-20T10:00:00Z", status: "received" },
];

type Tab = "consents" | "dsr";

export default function DPDPConsentScreen(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("dsr");
  const [dsr, setDsr] = useState<DsrRequest[]>(DEMO_DSR);
  const customerIds = useMemo(() => Array.from(new Set(DEMO_CONSENTS.map((c) => c.customerId))), []);

  const advance = useCallback((id: string, to: DsrStatus) => {
    setDsr((cur) => cur.map((r) => r.id === id ? transition(r, to, new Date().toISOString(), "u_owner") : r));
  }, []);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="dpdp">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">DPDP Act — Consent & DSR</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Per-purpose consent registry · 30-day DSR clock · auto-respond drafts via Copilot
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant={tab === "dsr"      ? "default" : "ghost"} onClick={() => setTab("dsr")}>DSR queue ({dsr.filter((r) => r.status !== "fulfilled" && r.status !== "rejected").length})</Button>
          <Button variant={tab === "consents" ? "default" : "ghost"} onClick={() => setTab("consents")}>Consent matrix</Button>
        </div>
      </header>

      {tab === "dsr" && (
        <Glass>
          <div className="p-4" data-testid="dsr-queue">
            {dsr.length === 0 ? (
              <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">No DSR requests in queue.</div>
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
                    const u = dsrUrgency(r);
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
                          {r.status === "received" && <Button onClick={() => advance(r.id, "verifying")}>Start verifying</Button>}
                          {r.status === "verifying" && <Button onClick={() => advance(r.id, "in-progress")}>Begin work</Button>}
                          {r.status === "in-progress" && (
                            <div className="flex gap-1">
                              <Button onClick={() => advance(r.id, "fulfilled")}><CheckCircle2 size={12} /> Mark fulfilled</Button>
                              <Button variant="ghost" onClick={() => advance(r.id, "rejected")}>Reject</Button>
                            </div>
                          )}
                          {(r.status === "fulfilled" || r.status === "rejected") && <span className="text-[11px] text-[var(--pc-text-tertiary)]">Closed</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Glass>
      )}

      {tab === "consents" && (
        <Glass>
          <div className="p-4 overflow-x-auto" data-testid="consent-matrix">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Customer</th>
                  {PURPOSES.map((p) => <th key={p} className="py-2 font-medium text-center">{p}</th>)}
                </tr>
              </thead>
              <tbody>
                {customerIds.map((cid) => (
                  <tr key={cid} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2 font-mono">{cid}</td>
                    {PURPOSES.map((p) => {
                      const has = hasEffectiveConsent(DEMO_CONSENTS, cid, p);
                      return (
                        <td key={p} className="py-2 text-center">
                          {has
                            ? <CheckCircle2 size={14} className="inline text-[var(--pc-state-success)]" aria-label="granted" />
                            : <span className="text-[var(--pc-text-tertiary)]">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Glass>
      )}
    </div>
  );
}
