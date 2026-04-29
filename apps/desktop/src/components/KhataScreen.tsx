// KhataScreen — Pharmacy-OS table-stakes #2.
//
// ADR-0040 customer credit ledger.
// Backed by @pharmacare/khata (pure aging math, 20 tests green).

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, AlertTriangle, Send, Plus, ListChecks } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import { paise, formatINR } from "@pharmacare/shared-types";
import {
  searchCustomersRpc,
  khataAgingRpc,
  khataGetLimitRpc,
  khataSetLimitRpc,
  khataListEntriesRpc,
  khataRecordPaymentRpc,
  type KhataAgingDTO,
  type KhataLimitDTO,
  type KhataEntryDTO,
  type CustomerHit,
} from "../lib/ipc.js";
import { queueAndShare, openWaMe } from "../lib/whatsapp.js";
import { paise as paiseT } from "@pharmacare/shared-types";

interface BucketCardProps {
  label: string;
  amountPaise: number;
  tone: "neutral" | "warning" | "danger";
}

function BucketCard({ label, amountPaise, tone }: BucketCardProps): React.ReactElement {
  const cls = tone === "danger" ? "text-[var(--pc-state-danger)]"
            : tone === "warning" ? "text-[var(--pc-state-warning)]"
            : "";
  return (
    <Glass>
      <div className="p-3 flex flex-col gap-1">
        <span className="text-[11px] text-[var(--pc-text-tertiary)] uppercase tracking-wider">{label}</span>
        <span className={`font-mono tabular-nums text-[18px] ${cls}`}>{formatINR(paise(amountPaise))}</span>
      </div>
    </Glass>
  );
}

export default function KhataScreen(): React.ReactElement {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly CustomerHit[]>([]);
  const [selected, setSelected] = useState<CustomerHit | null>(null);
  const [aging, setAging] = useState<KhataAgingDTO | null>(null);
  const [limit, setLimit] = useState<KhataLimitDTO | null>(null);
  const [entries, setEntries] = useState<readonly KhataEntryDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [newLimit, setNewLimit] = useState("");

  const onSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setHits([]); return; }
    try {
      const r = await searchCustomersRpc("shop_local", q.trim(), 10);
      setHits(r);
    } catch (e) { setErr(String(e)); }
  }, []);

  const onSelectCustomer = useCallback(async (c: CustomerHit) => {
    setSelected(c); setBusy(true); setErr(null);
    try {
      const [a, l, es] = await Promise.all([
        khataAgingRpc(c.id),
        khataGetLimitRpc(c.id),
        khataListEntriesRpc(c.id),
      ]);
      setAging(a); setLimit(l); setEntries(es);
      setNewLimit(l ? String((l.creditLimitPaise / 100).toFixed(2)) : "0");
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, []);

  const onUpdateLimit = useCallback(async () => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const rupees = Number.parseFloat(newLimit);
      if (Number.isNaN(rupees) || rupees < 0) {
        setErr("Limit must be a non-negative number");
        setBusy(false); return;
      }
      const updated = await khataSetLimitRpc(selected.id, Math.round(rupees * 100));
      setLimit(updated);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, [selected, newLimit]);

  const onRecordPayment = useCallback(async () => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const rupees = Number.parseFloat(paymentAmount);
      if (Number.isNaN(rupees) || rupees <= 0) {
        setErr("Payment amount must be > 0");
        setBusy(false); return;
      }
      await khataRecordPaymentRpc({
        customerId: selected.id,
        amountPaise: Math.round(rupees * 100),
      });
      setPaymentAmount("");
      // refresh
      await onSelectCustomer(selected);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }, [selected, paymentAmount, onSelectCustomer]);

  const utilisation = useMemo(() => {
    if (!limit || limit.creditLimitPaise === 0) return null;
    return Math.min(1, limit.currentDuePaise / limit.creditLimitPaise);
  }, [limit]);

  const onSendDunning = useCallback(async () => {
    if (!selected || !aging) return;
    if (!selected.phone || !/^\+\d{10,15}$/.test(selected.phone)) {
      setErr("Customer phone must be E.164 (+91...) to send WhatsApp reminder");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const amount = (aging.totalDuePaise / 100).toFixed(2);
      const days = aging.ninetyPlus > 0 ? "90+" : aging.sixty > 0 ? "60+" : "30+";
      const result = await queueAndShare({
        templateKey: "khata_payment_due",
        toPhone: selected.phone,
        locale: "en_IN",
        values: [selected.name, amount, days, "Jagannath Pharmacy"],
      });
      openWaMe(result.waMeUrl);
      void paiseT; // type marker, silence unused
    } catch (e) {
      setErr(`WhatsApp queue failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [selected, aging]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="khata">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Khata — Customer Credit Ledger</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Aging buckets · credit limits · payment recording · dunning
            </p>
          </div>
        </div>
      </header>

      {err && (
        <Glass>
          <div className="flex gap-2 p-3 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        </Glass>
      )}

      {/* ── Customer search ─────────────────────────────────────────── */}
      <Glass>
        <div className="p-4 flex flex-col gap-3">
          <Input
            type="text"
            placeholder="Search customer by name or phone…"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
          />
          {hits.length > 0 && (
            <div className="flex flex-col divide-y divide-[var(--pc-border-subtle)]">
              {hits.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelectCustomer(c)}
                  className="flex items-center justify-between px-2 py-2 text-left hover:bg-[var(--pc-bg-hover)] rounded transition-colors"
                >
                  <span className="font-medium text-[13px]">{c.name}</span>
                  <span className="text-[12px] text-[var(--pc-text-secondary)]">{c.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Glass>

      {/* ── Selected customer detail ─────────────────────────────────── */}
      {selected && aging && (
        <>
          <Glass>
            <div className="p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-[var(--pc-text-tertiary)] uppercase">Customer</div>
                <div className="font-medium text-[15px]">{selected.name}</div>
                <div className="text-[12px] text-[var(--pc-text-secondary)]">{selected.phone}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-[var(--pc-text-tertiary)] uppercase">Total due</div>
                <div className="font-mono tabular-nums text-[20px]">{formatINR(paise(aging.totalDuePaise))}</div>
                {limit && limit.creditLimitPaise > 0 && (
                  <div className="text-[11px] text-[var(--pc-text-secondary)]">
                    Limit {formatINR(paise(limit.creditLimitPaise))}
                    {utilisation !== null && (
                      <span className={utilisation > 0.8 ? " text-[var(--pc-state-danger)]" : utilisation > 0.5 ? " text-[var(--pc-state-warning)]" : ""}>
                        {" · "}{Math.round(utilisation * 100)}% used
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Glass>

          {/* Aging buckets */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="aging-grid">
            <BucketCard label="0–30 days"  amountPaise={aging.current}    tone="neutral" />
            <BucketCard label="30–60 days" amountPaise={aging.thirty}     tone="warning" />
            <BucketCard label="60–90 days" amountPaise={aging.sixty}      tone="warning" />
            <BucketCard label="90+ days"   amountPaise={aging.ninetyPlus} tone="danger"  />
          </div>

          {/* Actions: record payment, update limit, send dunning */}
          <Glass>
            <div className="p-4 flex flex-col gap-4">
              <div className="flex items-end gap-3">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">Record payment (₹)</label>
                  <Input
                    type="number"
                    step={0.01}
                    placeholder="amount in rupees"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <Button onClick={onRecordPayment} disabled={busy || !paymentAmount}>
                  <Plus size={14} /> Record
                </Button>
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">Credit limit (₹)</label>
                  <Input
                    type="number"
                    step={1}
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <Button onClick={onUpdateLimit} disabled={busy} variant="ghost">Update Limit</Button>
              </div>

              {aging.ninetyPlus > 0 && (
                <div className="flex items-center justify-between border-t border-[var(--pc-border-subtle)] pt-3">
                  <div className="flex items-center gap-2 text-[var(--pc-state-danger)] text-[13px]">
                    <AlertTriangle size={14} />
                    <span>{formatINR(paise(aging.ninetyPlus))} owed for 90+ days</span>
                  </div>
                  <Button variant="ghost" onClick={onSendDunning} disabled={busy}><Send size={14} /> Send WhatsApp reminder</Button>
                </div>
              )}
            </div>
          </Glass>

          {/* Recent ledger entries */}
          <Glass>
            <div className="p-4 flex flex-col gap-2" data-testid="ledger-entries">
              <div className="flex items-center gap-2">
                <ListChecks size={14} aria-hidden />
                <h2 className="font-medium text-[14px]">Recent entries</h2>
              </div>
              {entries.length === 0 ? (
                <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">No entries yet</div>
              ) : (
                <table className="text-[12px] w-full">
                  <thead>
                    <tr className="text-left text-[var(--pc-text-tertiary)] border-b border-[var(--pc-border-subtle)]">
                      <th className="py-1 font-medium">Date</th>
                      <th className="py-1 font-medium">Type</th>
                      <th className="py-1 font-medium">Amount</th>
                      <th className="py-1 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.slice(0, 20).map((e) => {
                      const isDebit = e.debitPaise > 0;
                      return (
                        <tr key={e.id} className="border-b border-[var(--pc-border-subtle)] last:border-0">
                          <td className="py-1.5">{new Date(e.createdAt).toLocaleDateString("en-IN")}</td>
                          <td className="py-1.5">
                            {isDebit ? (
                              <Badge variant="warning">PURCHASE</Badge>
                            ) : (
                              <Badge variant="success">PAYMENT</Badge>
                            )}
                          </td>
                          <td className="py-1.5 font-mono tabular-nums">
                            {formatINR(paise(isDebit ? e.debitPaise : e.creditPaise))}
                          </td>
                          <td className="py-1.5 text-[var(--pc-text-secondary)]">{e.note ?? ""}</td>
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
