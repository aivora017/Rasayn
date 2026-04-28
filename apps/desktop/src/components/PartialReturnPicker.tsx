// A8 · Partial-refund picker (ADR 0021 §UX).
// -----------------------------------------------------------------------------
// Opened on F4 from ReturnsScreen. Loads the original bill via
// getBillFullRpc, then caches refundable qty per line via getRefundableQtyRpc
// (Rust `get_refundable_qty`). The cashier edits `return qty` + `reason` per
// line, opens TenderReversalModal on F6, and saves on F9.
//
// Keyboard contract (per ADR 0021 §UX-Flow):
//   * Enter on bill-id input → load bill.
//   * Tab / Shift-Tab navigates cells inside the return-qty column.
//   * F7 on the focused row → return-in-full-this-line (sets return qty =
//     refundable).
//   * F6 → open TenderReversalModal (reuses A8 Alt+1/2/3/4 hotkeys).
//   * F9 → save_partial_return. Success → toast + print credit note + close.
//   * Esc → cancel at any step.
//
// Q5 concurrency (ADR 0021 §Resolved Q5):
//   * Cache bill.updatedAt *before* mount (as of load-time). We approximate
//     via `bill.billedAt` + line-count hash since BillHeaderDTO does not
//     expose updated_at directly — first writer wins; on
//     QTY_EXCEEDS_REFUNDABLE we refetch refundable columns and mark any row
//     whose return_qty > new_refundable in red. The banner below the table
//     appears whenever a refetch detected changed refundable values.
// -----------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
import {
  getBillFullRpc,
  getRefundableQtyRpc,
  savePartialReturnRpc,
  nextReturnNoRpc,
  type BillFullDTO,
  type BillLineFullDTO,
  type PaymentRowDTO,
  type PartialReturnLineInputDTO,
  type ReturnReasonCode,
  type ReturnTenderDTO,
  type SavePartialReturnResultDTO,
} from "../lib/ipc.js";
import { TenderReversalModal } from "./TenderReversalModal.js";

export interface PartialReturnPickerProps {
  readonly open: boolean;
  readonly shopId: string;
  readonly actorUserId: string;
  readonly onSaved: (result: SavePartialReturnResultDTO) => void;
  readonly onCancel: () => void;
  /**
   * Hook surface for tests. If set, we skip the real crypto.randomUUID and
   * delegate to this function; otherwise we call crypto.randomUUID().
   */
  readonly idFactory?: () => string;
}

interface DraftLine {
  readonly billLine: BillLineFullDTO;
  refundable: number;
  returnQty: string;
  reasonCode: ReturnReasonCode;
  /** True iff refundable shrank below current returnQty after a refetch. */
  overQty: boolean;
}

const REASON_OPTIONS: ReadonlyArray<{
  readonly code: ReturnReasonCode;
  readonly label: string;
}> = [
  { code: "wrong_sku", label: "Wrong item" },
  { code: "damaged", label: "Damaged" },
  { code: "expired_at_return", label: "Expired" },
  { code: "customer_change_of_mind", label: "Customer cancelled" },
  { code: "doctor_changed_rx", label: "Adverse reaction" },
  { code: "other", label: "Other" },
];

function formatRupees(paise: number): string {
  return formatINR(paise as Paise);
}

function parseQty(raw: string): number {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function newId(idFactory?: () => string): string {
  if (idFactory) return idFactory();
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pro-rata pure-TS math. Mirrors @pharmacare/bill-repo.computeLineProRata
 * (and the Rust equivalent in save_partial_return). Exported-style helper
 * kept local to avoid adding a new monorepo dep surface in step 7 — the
 * canonical implementation stays in bill-repo; this function MUST stay
 * equation-identical.
 */
function computeLineProRataLocal(params: {
  readonly qty: number;
  readonly qtyReturned: number;
  readonly taxableValuePaise: number;
  readonly discountPaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly cessPaise: number;
}): number {
  const { qty, qtyReturned } = params;
  if (qty <= 0 || qtyReturned <= 0 || qtyReturned > qty) return 0;
  const ratio = qtyReturned / qty;
  const r = (v: number): number => Math.round(v * ratio);
  const taxable = r(params.taxableValuePaise);
  const disc = r(params.discountPaise);
  const cgst = r(params.cgstPaise);
  const sgst = r(params.sgstPaise);
  const igst = r(params.igstPaise);
  const cess = r(params.cessPaise);
  return taxable - disc + cgst + sgst + igst + cess;
}

export function PartialReturnPicker(
  props: PartialReturnPickerProps,
): JSX.Element | null {
  const { open, shopId, actorUserId, onSaved, onCancel, idFactory } = props;

  const [billIdInput, setBillIdInput] = useState<string>("");
  const [bill, setBill] = useState<BillFullDTO | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [focusedRow, setFocusedRow] = useState<number>(-1);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [concurrencyHint, setConcurrencyHint] = useState<string | null>(null);
  const [tenderModalOpen, setTenderModalOpen] = useState<boolean>(false);
  const [tenders, setTenders] = useState<readonly ReturnTenderDTO[] | null>(null);
  const billIdInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state when modal re-opens.
  useEffect(() => {
    if (!open) return;
    setBillIdInput("");
    setBill(null);
    setLines([]);
    setErr(null);
    setConcurrencyHint(null);
    setTenderModalOpen(false);
    setTenders(null);
    setFocusedRow(-1);
    queueMicrotask(() => billIdInputRef.current?.focus());
  }, [open]);

  // ---- Load bill + refundable quantities --------------------------------
  const loadBill = useCallback(async () => {
    const id = billIdInput.trim();
    if (!id) return;
    setLoading(true);
    setErr(null);
    setConcurrencyHint(null);
    try {
      const full = await getBillFullRpc(id);
      if (full.bill.isVoided === 1) {
        setErr("Bill is voided — partial refunds not allowed.");
        setBill(null);
        setLines([]);
        return;
      }
      // Per-line refundable.
      const refundables = await Promise.all(
        full.lines.map((l) => getRefundableQtyRpc(l.id)),
      );
      const initial: DraftLine[] = full.lines.map((bl, i) => ({
        billLine: bl,
        refundable: refundables[i] ?? 0,
        returnQty: "0",
        reasonCode: "wrong_sku",
        overQty: false,
      }));
      setBill(full);
      setLines(initial);
      setFocusedRow(initial.findIndex((l) => l.refundable > 0));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBill(null);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [billIdInput]);

  // ---- Q5 concurrency — refetch refundables after QTY_EXCEEDS_REFUNDABLE -
  const refetchRefundables = useCallback(async () => {
    if (!bill) return;
    const refundables = await Promise.all(
      bill.lines.map((l) => getRefundableQtyRpc(l.id)),
    );
    setLines((prev) =>
      prev.map((l, i) => {
        const nextR = refundables[i] ?? 0;
        const qty = parseQty(l.returnQty);
        return {
          ...l,
          refundable: nextR,
          overQty: qty > nextR,
        };
      }),
    );
    setConcurrencyHint(
      "Another cashier returned lines from this bill. Refundable quantities refreshed — rows in red exceed the new limit.",
    );
  }, [bill]);

  // ---- Row edits --------------------------------------------------------
  const setRowQty = useCallback((idx: number, raw: string) => {
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              returnQty: raw,
              overQty: parseQty(raw) > l.refundable,
            }
          : l,
      ),
    );
  }, []);

  const setRowReason = useCallback(
    (idx: number, reasonCode: ReturnReasonCode) => {
      setLines((prev) =>
        prev.map((l, i) => (i === idx ? { ...l, reasonCode } : l)),
      );
    },
    [],
  );

  const returnInFull = useCallback(
    (idx: number) => {
      setLines((prev) =>
        prev.map((l, i) =>
          i === idx
            ? { ...l, returnQty: String(l.refundable), overQty: false }
            : l,
        ),
      );
    },
    [],
  );

  // ---- Derived: refund line contributions (ADR 0021 §3 pro-rata) --------
  // Equation-identical to Rust save_partial_return + bill-repo
  // computeLineProRata. The pickers preview only — Rust is authoritative.
  const refundTotalPaise = useMemo(() => {
    if (!bill) return 0;
    let sum = 0;
    for (const l of lines) {
      const qty = parseQty(l.returnQty);
      if (qty <= 0 || qty > l.refundable) continue;
      sum += computeLineProRataLocal({
        qty: l.billLine.qty,
        qtyReturned: qty,
        taxableValuePaise: l.billLine.taxableValuePaise,
        discountPaise: l.billLine.discountPaise,
        cgstPaise: l.billLine.cgstPaise,
        sgstPaise: l.billLine.sgstPaise,
        igstPaise: l.billLine.igstPaise,
        cessPaise: l.billLine.cessPaise,
      });
    }
    return sum;
  }, [bill, lines]);

  const hasErrors = useMemo(() => {
    if (!bill) return true;
    if (lines.every((l) => parseQty(l.returnQty) <= 0)) return true;
    return lines.some((l) => l.overQty);
  }, [bill, lines]);

  // ---- Save path (F9) ---------------------------------------------------
  const doSave = useCallback(async () => {
    if (!bill) return;
    if (hasErrors) {
      setErr(
        lines.some((l) => l.overQty)
          ? "One or more rows exceed refundable — edit qty or reload."
          : "Enter a return qty on at least one line.",
      );
      return;
    }
    if (!tenders || tenders.length === 0) {
      setErr("Press F6 to set the tender reversal plan before saving.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const returnNo = await nextReturnNoRpc(shopId);
      const payloadLines: PartialReturnLineInputDTO[] = lines
        .map((l) => ({
          billLineId: l.billLine.id,
          qtyReturned: parseQty(l.returnQty),
          reasonCode: l.reasonCode,
        }))
        .filter((l) => l.qtyReturned > 0);

      const result = await savePartialReturnRpc({
        returnId: newId(idFactory),
        shopId,
        returnNo,
        originalBillId: bill.bill.id,
        reason: "partial_refund",
        actorUserId,
        lines: payloadLines,
        tenderPlan: tenders,
      });
      // Clear saving BEFORE onSaved — onSaved typically closes the picker
      // (unmounts it), so any state update queued after would land on an
      // unmounted component and fire React act() warnings in tests.
      setSaving(false);
      onSaved(result);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Q5 concurrency path.
      if (msg.startsWith("QTY_EXCEEDS_REFUNDABLE")) {
        await refetchRefundables();
        setErr(
          "Refundable quantities have changed. Review highlighted rows and try again.",
        );
      } else {
        setErr(msg);
      }
    }
    setSaving(false);
  }, [
    bill,
    hasErrors,
    tenders,
    shopId,
    idFactory,
    actorUserId,
    lines,
    onSaved,
    refetchRefundables,
  ]);

  // ---- Global key bindings while open ----------------------------------
  useEffect(() => {
    if (!open) return;
    // When the tender modal is open, let it own key routing.
    if (tenderModalOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === "F6") {
        e.preventDefault();
        if (refundTotalPaise > 0) setTenderModalOpen(true);
        else
          setErr(
            "Enter at least one non-zero return qty before setting tender reversal.",
          );
      } else if (e.key === "F7" && focusedRow >= 0) {
        e.preventDefault();
        returnInFull(focusedRow);
      } else if (e.key === "F9") {
        e.preventDefault();
        void doSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [
    open,
    tenderModalOpen,
    focusedRow,
    refundTotalPaise,
    returnInFull,
    doSave,
    onCancel,
  ]);

  const handleRowKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>, idx: number) => {
      // Tab/Shift-Tab use default behavior (DOM order). We also accept Enter
      // to commit and F7 to fill in-full (captured by window handler too).
      if (e.key === "Enter") {
        e.preventDefault();
        (
          document.querySelector(
            `[data-testid="ret-picker-qty-${idx + 1}"]`,
          ) as HTMLInputElement | null
        )?.focus();
      }
    },
    [],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="partial-return-picker-title"
      data-testid="partial-return-picker"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
      }}
    >
      <div
        style={{
          background: "var(--pc-bg-canvas)",
          color: "var(--pc-text-primary)",
          padding: 20,
          borderRadius: 8,
          minWidth: 820,
          maxWidth: 1040,
          maxHeight: "90vh",
          overflow: "auto",
          border: "1px solid #334155",
        }}
      >
        <h3
          id="partial-return-picker-title"
          style={{ margin: "0 0 12px", display: "flex", gap: 12 }}
        >
          Partial refund
          <span
            style={{ fontSize: 12, color: "var(--pc-text-secondary)", fontWeight: 400 }}
            aria-label="Keyboard shortcuts"
          >
            Enter load · F7 return-in-full · F6 tender · F9 save · Esc cancel
          </span>
        </h3>

        {/* Bill lookup row */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          <label
            htmlFor="ret-picker-bill-id"
            style={{ fontSize: 12, color: "var(--pc-text-tertiary)" }}
          >
            Bill ID
          </label>
          <input
            id="ret-picker-bill-id"
            ref={billIdInputRef}
            data-testid="ret-picker-bill-id"
            type="text"
            placeholder="Paste bill ID or scan invoice QR"
            value={billIdInput}
            onChange={(e) => setBillIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void loadBill();
              }
            }}
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #334155",
              background: "var(--pc-bg-surface-2)",
              color: "var(--pc-text-primary)",
              fontFamily: "monospace",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            data-testid="ret-picker-load"
            onClick={() => void loadBill()}
            disabled={loading}
            style={{
              padding: "6px 14px",
              borderRadius: 4,
              border: "none",
              background: "var(--pc-state-info)",
              color: "white",
              cursor: "pointer",
            }}
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </div>

        {err && (
          <div
            role="alert"
            data-testid="ret-picker-err"
            style={{
              color: "var(--pc-state-danger)",
              background: "var(--pc-state-danger)",
              padding: "6px 10px",
              borderRadius: 4,
              marginBottom: 10,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}

        {concurrencyHint && (
          <div
            role="status"
            data-testid="ret-picker-concurrency"
            style={{
              color: "var(--pc-state-warning-bg)",
              background: "var(--pc-state-warning)",
              padding: "6px 10px",
              borderRadius: 4,
              marginBottom: 10,
              fontSize: 13,
            }}
          >
            {concurrencyHint}
          </div>
        )}

        {bill && (
          <>
            <div
              style={{
                display: "flex",
                gap: 20,
                fontSize: 12,
                color: "var(--pc-text-tertiary)",
                marginBottom: 8,
              }}
            >
              <span>
                Bill <strong style={{ color: "var(--pc-text-primary)" }}>{bill.bill.billNo}</strong>
              </span>
              <span>
                Billed{" "}
                {bill.bill.billedAt.slice(0, 19).replace("T", " ")}
              </span>
              <span>
                Grand{" "}
                <strong style={{ color: "var(--pc-text-primary)" }}>
                  {formatRupees(bill.bill.grandTotalPaise)}
                </strong>
              </span>
              <span>
                Customer {bill.customer?.name ?? "—"}
              </span>
            </div>

            <table
              data-testid="ret-picker-table"
              style={{
                width: "100%",
                fontSize: 12,
                borderCollapse: "collapse",
                marginBottom: 14,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid #334155",
                    textAlign: "left",
                    color: "var(--pc-text-tertiary)",
                  }}
                >
                  <th style={{ padding: 4 }}>#</th>
                  <th style={{ padding: 4 }}>SKU</th>
                  <th style={{ padding: 4 }}>Batch</th>
                  <th style={{ padding: 4 }}>Orig qty</th>
                  <th style={{ padding: 4 }}>Refundable</th>
                  <th style={{ padding: 4 }}>Return qty</th>
                  <th style={{ padding: 4 }}>Reason</th>
                  <th style={{ padding: 4, textAlign: "right" }}>Refund ₹</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const qty = parseQty(l.returnQty);
                  const refundRow = computeLineProRataLocal({
                    qty: l.billLine.qty,
                    qtyReturned: qty,
                    taxableValuePaise: l.billLine.taxableValuePaise,
                    discountPaise: l.billLine.discountPaise,
                    cgstPaise: l.billLine.cgstPaise,
                    sgstPaise: l.billLine.sgstPaise,
                    igstPaise: l.billLine.igstPaise,
                    cessPaise: l.billLine.cessPaise,
                  });
                  return (
                    <tr
                      key={l.billLine.id}
                      data-testid={`ret-picker-row-${idx}`}
                      data-over-qty={l.overQty || undefined}
                      style={{
                        borderBottom: "1px solid #1e293b",
                        background: l.overQty ? "var(--pc-state-danger)" : "transparent",
                      }}
                    >
                      <td style={{ padding: 4, color: "var(--pc-text-secondary)" }}>{idx + 1}</td>
                      <td style={{ padding: 4 }}>{l.billLine.productName}</td>
                      <td style={{ padding: 4, fontSize: 11, color: "var(--pc-text-tertiary)" }}>
                        {l.billLine.batchNo ?? "—"}
                      </td>
                      <td style={{ padding: 4 }}>{l.billLine.qty}</td>
                      <td style={{ padding: 4 }}>{l.refundable}</td>
                      <td style={{ padding: 4 }}>
                        <input
                          data-testid={`ret-picker-qty-${idx}`}
                          type="text"
                          inputMode="decimal"
                          value={l.returnQty}
                          disabled={l.refundable <= 0}
                          onFocus={() => setFocusedRow(idx)}
                          onChange={(e) => setRowQty(idx, e.target.value)}
                          onKeyDown={(e) => handleRowKeyDown(e, idx)}
                          style={{
                            width: 70,
                            padding: "4px 6px",
                            borderRadius: 3,
                            border: "1px solid #334155",
                            background: "var(--pc-bg-surface-2)",
                            color: "var(--pc-text-primary)",
                            textAlign: "right",
                          }}
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <select
                          data-testid={`ret-picker-reason-${idx}`}
                          value={l.reasonCode}
                          onFocus={() => setFocusedRow(idx)}
                          onChange={(e) =>
                            setRowReason(idx, e.target.value as ReturnReasonCode)
                          }
                          style={{
                            padding: "3px 6px",
                            borderRadius: 3,
                            border: "1px solid #334155",
                            background: "var(--pc-bg-surface-2)",
                            color: "var(--pc-text-primary)",
                          }}
                        >
                          {REASON_OPTIONS.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td
                        style={{
                          padding: 4,
                          textAlign: "right",
                          fontFamily: "monospace",
                        }}
                      >
                        {qty > 0 ? formatRupees(refundRow) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{ padding: 12, color: "var(--pc-text-secondary)", textAlign: "center" }}
                    >
                      No lines on this bill.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 12, color: "var(--pc-text-tertiary)" }}>
                Tender plan:{" "}
                {tenders
                  ? tenders
                      .map(
                        (t) =>
                          `${t.mode}:${formatRupees(t.amountPaise)}${
                            t.refNo ? ` (${t.refNo})` : ""
                          }`,
                      )
                      .join(" + ")
                  : <em>(press F6 to set)</em>}
              </span>
              <strong
                data-testid="ret-picker-total"
                style={{ fontSize: 16, color: "var(--pc-state-success)" }}
              >
                Refund {formatRupees(refundTotalPaise)}
              </strong>
            </div>
          </>
        )}

        {/* Footer actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            data-testid="ret-picker-tender"
            onClick={() => {
              if (refundTotalPaise > 0) setTenderModalOpen(true);
              else
                setErr(
                  "Enter at least one non-zero return qty before setting tender reversal.",
                );
            }}
            disabled={!bill || refundTotalPaise <= 0}
            style={{
              padding: "6px 14px",
              background: "var(--pc-state-info)",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Tender reversal (F6)
          </button>
          <button
            type="button"
            data-testid="ret-picker-save"
            onClick={() => void doSave()}
            disabled={saving || !bill || hasErrors || !tenders}
            style={{
              padding: "6px 14px",
              background:
                !bill || hasErrors || !tenders ? "var(--pc-text-secondary)" : "var(--pc-state-success)",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 700,
            }}
          >
            {saving ? "Saving…" : "Save refund (F9)"}
          </button>
          <button
            type="button"
            data-testid="ret-picker-cancel"
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              background: "var(--pc-border-subtle)",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Cancel (Esc)
          </button>
        </div>
      </div>

      <TenderReversalModal
        open={tenderModalOpen}
        refundTotalPaise={refundTotalPaise}
        originalPayments={(bill?.payments ?? []) as readonly PaymentRowDTO[]}
        onConfirm={(t) => {
          setTenders(t);
          setTenderModalOpen(false);
        }}
        onCancel={() => setTenderModalOpen(false)}
      />
    </div>
  );
}
