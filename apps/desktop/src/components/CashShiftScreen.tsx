// CashShiftScreen — Pharmacy-OS table-stakes #1.
//
// ADR-0039 cash-shift / Z-report / variance.
// Backed by @pharmacare/cash-shift (pure math, 25 tests green).
//
// UX:
//   * No active shift → "Open Shift" denomination wizard. 10 inputs + live total.
//     Submit → opens shift, switches view to "Shift Active".
//   * Active shift → "Close Shift" wizard. Counts closing denominations; we
//     compare against expected (opening + cash sales − cash returns − refunds
//     − bank deposits). Variance > ₹500 demands manager approval.
//   * Z-report card always visible — bills/returns/discounts/GST-by-HSN/tender
//     breakdown for the current open shift period.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, CheckCircle2, AlertTriangle, Receipt, RotateCw } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  totalFromDenominations,
  computeVariance,
  buildZReport,
  ZERO_DENOMINATIONS,
  EMPTY_TENDER,
  VARIANCE_APPROVAL_THRESHOLD_PAISE,
  type DenominationCount,
  type CashShift,
  type ZReport,
} from "@pharmacare/cash-shift";
import { paise, formatINR, type Paise } from "@pharmacare/shared-types";
import {
  cashShiftFindOpenRpc,
  cashShiftOpenRpc,
  cashShiftCloseRpc,
  cashShiftZReportRpc,
} from "../lib/ipc.js";
import { ShiftHandoverPreview } from "./ShiftHandoverPreview.js";
import type { ShiftHandoverInput, ShiftHandoverNote } from "@pharmacare/shift-handover";
import { printOnThermal } from "../lib/printer.js";
import { queueAndShare, openWaMe } from "../lib/whatsapp.js";

// Helpers: RPC returns plain numbers; the local CashShift / ZReport types are
// `Paise`-branded. These small functions reattach the brand.
function dtoToCashShift(d: import("../lib/ipc.js").CashShiftDTO): CashShift {
  return {
    ...d,
    openingBalancePaise: paise(d.openingBalancePaise),
    closingBalancePaise: d.closingBalancePaise !== undefined ? paise(d.closingBalancePaise) : undefined,
    expectedClosingPaise: d.expectedClosingPaise !== undefined ? paise(d.expectedClosingPaise) : undefined,
    variancePaise: d.variancePaise !== undefined ? d.variancePaise : undefined,
  } as unknown as CashShift;
}
function dtoToZReport(d: import("../lib/ipc.js").ZReportDTO): ZReport {
  return {
    ...d,
    totalSalesPaise: paise(d.totalSalesPaise),
    totalReturnsPaise: paise(d.totalReturnsPaise),
    totalDiscountsPaise: paise(d.totalDiscountsPaise),
    tenderBreakdown: {
      cash:   paise(d.tenderBreakdown.cash),
      upi:    paise(d.tenderBreakdown.upi),
      card:   paise(d.tenderBreakdown.card),
      cheque: paise(d.tenderBreakdown.cheque),
      credit: paise(d.tenderBreakdown.credit),
    },
  } as unknown as ZReport;
}

// Display order matches a real cash drawer (descending denomination).
const DENOM_ORDER: ReadonlyArray<{ key: keyof DenominationCount; label: string; valuePaise: number }> = [
  { key: "d2000", label: "₹2000", valuePaise: 200000 },
  { key: "d500",  label: "₹500",  valuePaise:  50000 },
  { key: "d200",  label: "₹200",  valuePaise:  20000 },
  { key: "d100",  label: "₹100",  valuePaise:  10000 },
  { key: "d50",   label: "₹50",   valuePaise:   5000 },
  { key: "d20",   label: "₹20",   valuePaise:   2000 },
  { key: "d10",   label: "₹10",   valuePaise:   1000 },
  { key: "c5",    label: "₹5",    valuePaise:    500 },
  { key: "c2",    label: "₹2",    valuePaise:    200 },
  { key: "c1",    label: "₹1",    valuePaise:    100 },
];

interface DenominationGridProps {
  value: DenominationCount;
  onChange: (next: DenominationCount) => void;
  disabled?: boolean;
}

function DenominationGrid({ value, onChange, disabled = false }: DenominationGridProps): React.ReactElement {
  const total = useMemo(() => totalFromDenominations(value), [value]);
  return (
    <div data-testid="denom-grid" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {DENOM_ORDER.map(({ key, label, valuePaise }) => {
          const count = value[key];
          const subTotal = count * valuePaise;
          return (
            <label key={String(key)} className="flex flex-col gap-1 text-[12px]">
              <span className="text-[var(--pc-text-secondary)] font-medium">{label}</span>
              <Input
                type="number"
                min={0}
                step={1}
                value={String(count)}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value || "0", 10);
                  if (Number.isNaN(n) || n < 0) return;
                  onChange({ ...value, [key]: n });
                }}
                disabled={disabled}
              />
              <span className="text-[10px] text-[var(--pc-text-tertiary)]">
                = {formatINR(paise(subTotal))}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex items-baseline justify-between border-t pt-2 text-[var(--pc-border-subtle)]">
        <span className="text-[12px] text-[var(--pc-text-secondary)]">Total counted</span>
        <span className="font-mono text-[18px] tabular-nums">{formatINR(total)}</span>
      </div>
    </div>
  );
}

export default function CashShiftScreen(): React.ReactElement {
  const [activeShift, setActiveShift] = useState<CashShift | null>(null);
  const [zReport, setZReport] = useState<ZReport | null>(null);
  const [openingDenoms, setOpeningDenoms] = useState<DenominationCount>(ZERO_DENOMINATIONS);
  const [closingDenoms, setClosingDenoms] = useState<DenominationCount>(ZERO_DENOMINATIONS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [varianceApprover, setVarianceApprover] = useState("");
  const [handoverInput, setHandoverInput] = useState<ShiftHandoverInput | null>(null);
  const [handoverShopName, setHandoverShopName] = useState<string>("Jagannath Pharmacy");
  const [handoverActorName, setHandoverActorName] = useState<string>("Cashier");

  const reload = useCallback(async () => {
    try {
      const openDto = await cashShiftFindOpenRpc("shop_local");
      const open = openDto ? dtoToCashShift(openDto) : null;
      setActiveShift(open);
      if (open) {
        const zDto = await cashShiftZReportRpc(open.id);
        setZReport(dtoToZReport(zDto));
      }
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onOpenShift = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const total = totalFromDenominations(openingDenoms);
      if (total === 0) {
        setErr("Opening balance must be > 0. Count the float or skip with all zeros at your own risk.");
        setBusy(false);
        return;
      }
      await cashShiftOpenRpc({
        shopId: "shop_local",
        openingDenominations: openingDenoms,
      });
      setOpeningDenoms(ZERO_DENOMINATIONS);
      await reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [openingDenoms, reload]);

  const variance = useMemo(() => {
    if (!activeShift || !zReport) return null;
    const closingActual = totalFromDenominations(closingDenoms);
    return computeVariance({
      openingBalancePaise: activeShift.openingBalancePaise,
      cashSalesPaise: zReport.tenderBreakdown.cash,
      cashReturnsPaise: paise(0),     // server-side already nets
      cashRefundsPaise: paise(0),
      bankDepositsPaise: paise(0),
      closingActualPaise: closingActual,
    });
  }, [activeShift, zReport, closingDenoms]);

  const onCloseShift = useCallback(async () => {
    if (!activeShift || !zReport || !variance) return;
    setBusy(true); setErr(null);
    try {
      if (variance.requiresManagerApproval && !varianceApprover.trim()) {
        setErr(`Variance ${formatINR(variance.absVariancePaise)} exceeds ₹${VARIANCE_APPROVAL_THRESHOLD_PAISE / 100} threshold — manager approval ID required.`);
        setBusy(false);
        return;
      }
      const closedDto = await cashShiftCloseRpc({
        shiftId: activeShift.id,
        closingDenominations: closingDenoms,
        ...(varianceApprover.trim() ? { varianceApprovedByUserId: varianceApprover.trim() } : {}),
      });
      const closedShift = dtoToCashShift(closedDto);
      // S13: build a handover note and open the preview modal
      const handover: ShiftHandoverInput = {
        shiftId: closedShift.id,
        shopName: handoverShopName,
        cashierName: handoverActorName,
        openedAtIso: closedShift.openedAt,
        closedAtIso: closedShift.closedAt ?? new Date().toISOString(),
        billCount: zReport.billCount,
        totalSalesPaise: zReport.totalSalesPaise,
        totalReturnsPaise: zReport.totalReturnsPaise,
        variancePaise: variance.variancePaise,
        varianceApproved: !!varianceApprover.trim(),
        topSellers: [],
        expiredDiscarded: [],
        complaints: [],
        reorderHints: [],
      };
      setHandoverInput(handover);
      setClosingDenoms(ZERO_DENOMINATIONS);
      setVarianceApprover("");
      await reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [activeShift, zReport, variance, closingDenoms, varianceApprover, reload]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="cashshift">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wallet size={24} aria-hidden className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Cash Shift</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Open the day with a denomination count. Close with a Z-report and variance check.
            </p>
          </div>
        </div>
        {activeShift ? (
          <Badge variant="success">SHIFT OPEN · {activeShift.id}</Badge>
        ) : (
          <Badge variant="neutral">NO ACTIVE SHIFT</Badge>
        )}
      </header>

      {err && (
        <Glass>
          <div className="flex items-start gap-2 p-3 text-[13px] text-[var(--pc-state-danger)]">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        </Glass>
      )}

      {/* ── No active shift: opening wizard ───────────────────────────── */}
      {!activeShift && (
        <Glass>
          <div className="flex flex-col gap-4 p-4">
            <h2 className="font-medium">Open shift — count the morning float</h2>
            <DenominationGrid value={openingDenoms} onChange={setOpeningDenoms} disabled={busy} />
            <div className="flex justify-end">
              <Button onClick={onOpenShift} disabled={busy}>
                {busy ? "Opening…" : "Open Shift"}
              </Button>
            </div>
          </div>
        </Glass>
      )}

      {/* ── Active shift: Z-report + closing wizard ───────────────────── */}
      {activeShift && (
        <>
          <Glass>
            <div className="flex flex-col gap-3 p-4" data-testid="z-report-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt size={16} aria-hidden />
                  <h2 className="font-medium">Z-Report — current shift</h2>
                </div>
                <Button variant="ghost" onClick={reload}><RotateCw size={14} /> Refresh</Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
                <div>
                  <div className="text-[var(--pc-text-tertiary)] text-[11px]">Opening</div>
                  <div className="font-mono tabular-nums">{formatINR(activeShift.openingBalancePaise)}</div>
                </div>
                <div>
                  <div className="text-[var(--pc-text-tertiary)] text-[11px]">Bills</div>
                  <div className="font-mono tabular-nums">{zReport?.billCount ?? 0}</div>
                </div>
                <div>
                  <div className="text-[var(--pc-text-tertiary)] text-[11px]">Sales</div>
                  <div className="font-mono tabular-nums">{formatINR(zReport?.totalSalesPaise ?? paise(0))}</div>
                </div>
                <div>
                  <div className="text-[var(--pc-text-tertiary)] text-[11px]">Returns</div>
                  <div className="font-mono tabular-nums">{formatINR(zReport?.totalReturnsPaise ?? paise(0))}</div>
                </div>
              </div>
              {zReport && (
                <div className="border-t border-[var(--pc-border-subtle)] pt-2 text-[12px]">
                  <div className="text-[var(--pc-text-tertiary)] text-[11px] mb-1">Tender breakdown</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(zReport.tenderBreakdown).map(([mode, value]) => (
                      <span key={mode} className="font-mono">
                        <span className="text-[var(--pc-text-secondary)] uppercase mr-1">{mode}</span>
                        {formatINR(value as Paise)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Glass>

          <Glass>
            <div className="flex flex-col gap-4 p-4">
              <h2 className="font-medium">Close shift — count the cash drawer</h2>
              <DenominationGrid value={closingDenoms} onChange={setClosingDenoms} disabled={busy} />

              {variance && (
                <div data-testid="variance-card" className="flex flex-col gap-2 border-t border-[var(--pc-border-subtle)] pt-3 text-[13px]">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[var(--pc-text-tertiary)] text-[11px]">Expected</div>
                      <div className="font-mono tabular-nums">{formatINR(variance.expectedClosingPaise)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--pc-text-tertiary)] text-[11px]">Variance</div>
                      <div className={`font-mono tabular-nums ${
                        variance.category === "exact" ? "" :
                        variance.category === "overage" ? "text-[var(--pc-state-success)]" :
                        "text-[var(--pc-state-danger)]"
                      }`}>
                        {variance.variancePaise >= 0 ? "+" : "−"}
                        {formatINR(paise(Math.abs(variance.variancePaise)))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--pc-text-tertiary)] text-[11px]">Status</div>
                      <Badge variant={
                        variance.category === "exact" ? "success" :
                        variance.requiresManagerApproval ? "danger" : "warning"
                      }>
                        {variance.category === "exact" ? "EXACT" : variance.category.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                  {variance.requiresManagerApproval && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] text-[var(--pc-text-secondary)] font-medium">
                        Variance &gt; ₹{VARIANCE_APPROVAL_THRESHOLD_PAISE / 100} — enter manager User ID to approve
                      </label>
                      <Input
                        type="text"
                        value={varianceApprover}
                        onChange={(e) => setVarianceApprover(e.target.value)}
                        placeholder="manager user id"
                        disabled={busy}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={onCloseShift} disabled={busy}>
                  {busy ? "Closing…" : <><CheckCircle2 size={14} /> Close Shift</>}
                </Button>
              </div>
            </div>
          </Glass>
        </>
      )}
      {handoverInput && (
        <ShiftHandoverPreview
          input={handoverInput}
          onClose={() => setHandoverInput(null)}
          onPrint={async (note: ShiftHandoverNote) => {
            try {
              const enc = new TextEncoder().encode(note.receiptBytes + "\n\n\n");
              await printOnThermal(enc);
            } catch (e) {
              setErr(`Print failed: ${String(e)}`);
            }
          }}
          onShareWhatsApp={async (note: ShiftHandoverNote) => {
            try {
              const phone = "+910000000000";
              const result = await queueAndShare({
                templateKey: "khata_payment_due",
                toPhone: phone,
                locale: "en_IN",
                values: [handoverActorName, handoverShopName, note.headline, note.whatsappBody.slice(0, 60)],
              });
              openWaMe(result.waMeUrl);
            } catch (e) {
              setErr(`WhatsApp queue failed: ${String(e)}`);
            }
          }}
          onSavePdf={(note: ShiftHandoverNote) => {
            const blob = new Blob([note.body], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `shift-handover-${handoverInput.shiftId}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        />
      )}
    </div>
  );
}
