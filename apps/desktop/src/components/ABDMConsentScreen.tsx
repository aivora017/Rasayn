// ABDMConsentScreen — S17.3.
// View ABHA-linked customers + revoke / re-grant consent + see recent
// FHIR dispensation pushes.

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Trash2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  abdmListDispensationsRpc, abdmRevokeConsentRpc, abdmGetProfileRpc, abdmUpsertProfileRpc,
  type AbhaProfileDTO, type AbdmDispensationDTO,
} from "../lib/ipc.js";

type Toast = { kind: "ok" | "err"; msg: string } | null;

export default function ABDMConsentScreen(): React.ReactElement {
  const [customerId, setCustomerId] = useState("");
  const [profile, setProfile] = useState<AbhaProfileDTO | null>(null);
  const [dispensations, setDispensations] = useState<readonly AbdmDispensationDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // Form state for new ABHA registration
  const [abha, setAbha] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const list = await abdmListDispensationsRpc({ limit: 50 });
      setDispensations(list);
    } catch (e) {
      setToast({ kind: "err", msg: `Failed to list dispensations: ${String(e)}` });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onLookup = useCallback(async () => {
    if (!customerId.trim()) return;
    setBusy(true);
    try {
      const p = await abdmGetProfileRpc(customerId.trim());
      setProfile(p);
      if (!p) setToast({ kind: "err", msg: `No ABHA profile for ${customerId}` });
    } catch (e) { setToast({ kind: "err", msg: String(e) }); }
    finally { setBusy(false); }
  }, [customerId]);

  const onLink = useCallback(async () => {
    if (!customerId.trim() || !abha.trim() || !name.trim()) {
      setToast({ kind: "err", msg: "Customer ID, ABHA #, and name required" });
      return;
    }
    setBusy(true);
    try {
      const p = await abdmUpsertProfileRpc({
        customerId: customerId.trim(),
        abhaNumber: abha.trim(),
        name: name.trim(),
        ...(mobile.trim() ? { mobileE164: mobile.trim() } : {}),
      });
      setProfile(p);
      setToast({ kind: "ok", msg: `Linked ABHA ${p.abhaNumber} to ${p.customerId}` });
      setAbha(""); setName(""); setMobile("");
    } catch (e) { setToast({ kind: "err", msg: String(e) }); }
    finally { setBusy(false); }
  }, [customerId, abha, name, mobile]);

  const onRevoke = useCallback(async () => {
    if (!profile) return;
    setBusy(true);
    try {
      await abdmRevokeConsentRpc(profile.customerId);
      const refreshed = await abdmGetProfileRpc(profile.customerId);
      setProfile(refreshed);
      setToast({ kind: "ok", msg: `Consent token cleared for ${profile.customerId}` });
    } catch (e) { setToast({ kind: "err", msg: String(e) }); }
    finally { setBusy(false); }
  }, [profile]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="abdm-consents">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">ABDM Consent Registry</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              ABHA verification · DPDP § Right-to-revoke · FHIR dispensation log
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
        <div className="p-4 flex flex-col gap-3" data-testid="abdm-lookup">
          <h2 className="font-medium text-[14px]">Look up customer</h2>
          <div className="flex gap-2">
            <Input placeholder="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
            <Button onClick={() => void onLookup()} disabled={busy}>Look up</Button>
          </div>
          {profile && (
            <Glass>
              <div className="p-3 flex flex-col gap-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <strong>{profile.name}</strong>
                  <Badge variant={profile.consentTokenEncrypted ? "success" : "warning"}>
                    {profile.consentTokenEncrypted ? "Consent active" : "Consent revoked"}
                  </Badge>
                </div>
                <div className="font-mono">ABHA: {profile.abhaNumber}</div>
                {profile.mobileE164 && <div>Mobile: {profile.mobileE164}</div>}
                <div className="text-[var(--pc-text-secondary)]">Verified: {new Date(profile.verifiedAt).toLocaleString("en-IN")}</div>
                {profile.consentTokenEncrypted && (
                  <Button variant="ghost" onClick={() => void onRevoke()} disabled={busy}>
                    <Trash2 size={12} /> Revoke consent
                  </Button>
                )}
              </div>
            </Glass>
          )}
        </div>
      </Glass>

      <Glass>
        <div className="p-4 flex flex-col gap-3" data-testid="abdm-link">
          <h2 className="font-medium text-[14px]">Link new ABHA to a customer</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="ABHA # (12-3456-7890-1234)" value={abha} onChange={(e) => setAbha(e.target.value)} />
            <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Mobile (+91…)" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void onLink()} disabled={busy || !customerId.trim()}>Link</Button>
          </div>
          {!customerId.trim() && (
            <p className="text-[11px] text-[var(--pc-text-tertiary)]">Enter a customer ID above first.</p>
          )}
        </div>
      </Glass>

      <Glass>
        <div className="p-4 flex flex-col gap-2" data-testid="abdm-dispensations">
          <h2 className="font-medium text-[14px]">Recent FHIR dispensations ({dispensations.length})</h2>
          {dispensations.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              No dispensations pushed yet. Bills with ABHA-linked customers will appear here.
            </div>
          ) : (
            <table className="text-[12px] w-full">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[10px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Bill ID</th>
                  <th className="py-2 font-medium">ABHA #</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Pushed</th>
                </tr>
              </thead>
              <tbody>
                {dispensations.map((d) => (
                  <tr key={d.billId} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                    <td className="py-2 font-mono">{d.billId.slice(0, 16)}…</td>
                    <td className="py-2 font-mono">{d.abhaNumber}</td>
                    <td className="py-2">
                      <Badge variant={d.status === "ok" ? "success" : d.status === "failed" ? "danger" : "warning"}>
                        {d.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-2 text-[var(--pc-text-secondary)]">{new Date(d.pushedAt).toLocaleString("en-IN")}</td>
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
