// A8 · Payment modal (ADR 0012).
// -----------------------------------------------------------------------------
// Keyboard-first tender capture. Opens on F6 from BillingScreen.
//
// Contract (ADR 0009 modal shell + 0012 tender semantics):
//   * role="dialog" aria-modal data-testid="payment-modal"
//   * Alt+1 cash · Alt+2 UPI · Alt+3 card · Alt+4 credit (append row)
//   * Enter on amount field = same as Alt+mode if amount > 0
//   * F10 / data-testid="payment-confirm" = commit tenders to parent
//   * Esc = cancel (parent handles close)
//   * Change calc: sum(tenders) - grand_total; positive = tender > bill = change.
//   * Confirm disabled until |sum - grand_total| <= TENDER_TOLERANCE_PAISE
//     OR the last tender being typed is Cash and (sum - amountPaise) < grand_total
//     so the cash row absorbs the remainder. Simplest correct behaviour:
//     require exact balance in state, treat "change" as cash-only and show it.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
import {
  TENDER_TOLERANCE_PAISE,
  type Tender,
  type TenderMode,
} from "../lib/ipc.js";

const MODE_LABEL: Record<TenderMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "Credit",
  wallet: "Wallet",
};

const MODE_HOTKEY: Record<TenderMode, number> = {
  cash: 1,
  upi: 2,
  card: 3,
  credit: 4,
  wallet: 5,
};

interface DraftTender {
  readonly mode: TenderMode;
  readonly amountPaise: number;
  readonly refNo: string;
}

export interface PaymentModalProps {
  readonly open: boolean;
  readonly grandTotalPaise: number;
  readonly onConfirm: (tenders: readonly Tender[]) => void;
  readonly onCancel: () => void;
}

/**
 * Parse a user-typed rupee string into paise. Accepts "100", "100.5", "1,234.56".
 * Returns NaN for invalid input so the caller can disable confirm.
 */
export function parseRupeesToPaise(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return NaN;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

export function PaymentModal(props: PaymentModalProps): JSX.Element | null {
  const { open, grandTotalPaise, onConfirm, onCancel } = props;

  const [tenders, setTenders] = useState<readonly DraftTender[]>([]);
  const [mode, setMode] = useState<TenderMode>("cash");
  const [amountStr, setAmountStr] = useState<string>("");
  const [refNo, setRefNo] = useState<string>("");
  const amountRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Reset when the modal closes, and pre-seed amount with outstanding when opens.
  useEffect(() => {
    if (!open) return;
    setTenders([]);
    setMode("cash");
    setAmountStr((grandTotalPaise / 100).toFixed(2));
    setRefNo("");
    // Focus the amount input after paint.
    queueMicrotask(() => amountRef.current?.select());
  }, [open, grandTotalPaise]);

  const sumPaise = useMemo(
    () => tenders.reduce((a, t) => a + t.amountPaise, 0),
    [tenders],
  );
  const typedPaise = useMemo(() => {
    const p = parseRupeesToPaise(amountStr);
    return Number.isFinite(p) && p > 0 ? p : 0;
  }, [amountStr]);
  // When the list is empty the typed amount acts as an implicit single tender
  // so single-cash flows are F10-confirmable without an explicit Add step.
  const effectiveSum = tenders.length > 0 ? sumPaise : typedPaise;
  const remainingPaise = grandTotalPaise - sumPaise;
  const isBalanced =
    Math.abs(effectiveSum - grandTotalPaise) <= TENDER_TOLERANCE_PAISE;

  const addTender = useCallback((tenderMode: TenderMode) => {
    const paise = parseRupeesToPaise(amountStr);
    if (!Number.isFinite(paise) || paise <= 0) return;
    setTenders((prev) => [
      ...prev,
      { mode: tenderMode, amountPaise: paise, refNo: refNo.trim() },
    ]);
    // Re-seed amount with the remaining after this tender.
    const newSum = sumPaise + paise;
    const nextRemaining = grandTotalPaise - newSum;
    setAmountStr(nextRemaining > 0 ? (nextRemaining / 100).toFixed(2) : "0.00");
    setRefNo("");
  }, [amountStr, refNo, sumPaise, grandTotalPaise]);

  const removeTender = useCallback((idx: number) => {
    setTenders((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const doConfirm = useCallback(() => {
    if (!isBalanced) return;
    const out: Tender[] = tenders.length > 0
      ? tenders.map((t) => ({
          mode: t.mode,
          amountPaise: t.amountPaise,
          refNo: t.refNo === "" ? null : t.refNo,
        }))
      : [{
          mode,
          amountPaise: typedPaise > 0 ? typedPaise : grandTotalPaise,
          refNo: null,
        }];
    onConfirm(out);
  }, [isBalanced, tenders, mode, typedPaise, grandTotalPaise, onConfirm]);

  // Keyboard routing — window-level while open.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      // Alt+digit mode select / add.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-5]$/.test(e.code)) {
        const d = Number(e.code.slice(-1));
        const pick = (Object.entries(MODE_HOTKEY).find(([, n]) => n === d)?.[0]) as TenderMode | undefined;
        if (pick) {
          e.preventDefault();
          setMode(pick);
          addTender(pick);
        }
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        doConfirm();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, addTender, doConfirm, onCancel]);

  // Focus confirm after we reach a balanced state so Enter/F10 is instant.
  useEffect(() => {
    if (open && isBalanced) queueMicrotask(() => confirmRef.current?.focus());
  }, [open, isBalanced]);

  if (!open) return null;

  const changeDuePaise = sumPaise > grandTotalPaise ? sumPaise - grandTotalPaise : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-title"
      data-testid="payment-modal"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
    >
      <div style={{
        background: "#1e293b", color: "#e5e7eb", padding: 20, borderRadius: 8,
        minWidth: 440, maxWidth: 560, border: "1px solid #334155",
      }}>
        <h3 id="payment-title" style={{ margin: "0 0 12px" }}>Payment</h3>

        {/* Totals */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          <Stat label="Bill total" value={formatINR(grandTotalPaise as Paise)} testId="payment-amount" />
          <Stat label="Received" value={formatINR(sumPaise as Paise)} testId="payment-received" />
          <Stat
            label={remainingPaise > 0 ? "Due" : "Change"}
            value={formatINR((remainingPaise > 0 ? remainingPaise : changeDuePaise) as Paise)}
            testId={remainingPaise > 0 ? "payment-due" : "payment-change"}
            tone={remainingPaise > 0 ? "warn" : (changeDuePaise > 0 ? "info" : "ok")}
          />
        </div>

        {/* Mode selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {(Object.keys(MODE_LABEL) as TenderMode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                data-testid={`tender-mode-${m}`}
                onClick={() => setMode(m)}
                aria-pressed={active}
                aria-keyshortcuts={`Alt+${MODE_HOTKEY[m]}`}
                style={{
                  padding: "6px 10px", border: "1px solid #334155", borderRadius: 4,
                  background: active ? "#2563eb" : "#0f172a",
                  color: active ? "white" : "#cbd5e1", cursor: "pointer",
                }}
              >
                {MODE_LABEL[m]} <span style={{ opacity: 0.6, fontSize: 11 }}>Alt+{MODE_HOTKEY[m]}</span>
              </button>
            );
          })}
        </div>

        {/* Amount + ref + add */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
          <label htmlFor="tender-amount" style={{ fontSize: 12, color: "#94a3b8", minWidth: 60 }}>Amount ₹</label>
          <input
            id="tender-amount"
            ref={amountRef}
            data-testid="tender-amount"
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTender(mode);
              }
            }}
            style={{
              flex: 1, padding: "6px 8px", borderRadius: 4, border: "1px solid #334155",
              background: "#0f172a", color: "#e5e7eb",
            }}
          />
          {(mode === "card" || mode === "upi" || mode === "credit") && (
            <input
              data-testid="tender-ref"
              type="text"
              placeholder={mode === "card" ? "Last 4" : mode === "upi" ? "RRN" : "Slip no"}
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
              style={{
                width: 100, padding: "6px 8px", borderRadius: 4, border: "1px solid #334155",
                background: "#0f172a", color: "#e5e7eb",
              }}
            />
          )}
          <button
            type="button"
            data-testid="tender-add"
            onClick={() => addTender(mode)}
            style={{
              padding: "6px 10px", borderRadius: 4, border: "none",
              background: "#16a34a", color: "white", cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>

        {/* Tender rows */}
        <div data-testid="tender-list" style={{ marginBottom: 12 }}>
          {tenders.length === 0 && (
            <div style={{ fontSize: 12, color: "#64748b", padding: "6px 0" }}>
              No tenders added. Confirming will record a single {MODE_LABEL[mode]} tender for the bill total.
            </div>
          )}
          {tenders.map((t, i) => (
            <div
              key={i}
              data-testid={`tender-row-${i}`}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "4px 6px", borderBottom: "1px solid #1e293b",
              }}
            >
              <span style={{ minWidth: 60, fontSize: 12 }}>{MODE_LABEL[t.mode]}</span>
              <span style={{ flex: 1, fontFamily: "monospace" }}>{formatINR(t.amountPaise as Paise)}</span>
              {t.refNo && <span style={{ fontSize: 11, color: "#94a3b8" }}>{t.refNo}</span>}
              <button
                type="button"
                data-testid={`tender-remove-${i}`}
                onClick={() => removeTender(i)}
                style={{
                  padding: "2px 8px", borderRadius: 4, border: "1px solid #334155",
                  background: "transparent", color: "#f87171", cursor: "pointer",
                }}
                aria-label={`Remove tender ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            data-testid="payment-cancel"
            style={{ padding: "8px 14px", background: "#334155", color: "white", border: "none", borderRadius: 4 }}
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={doConfirm}
            data-testid="payment-confirm"
            disabled={!isBalanced}
            aria-keyshortcuts="F10"
            style={{
              padding: "8px 14px",
              background: isBalanced ? "#16a34a" : "#64748b",
              color: "white", border: "none", borderRadius: 4, fontWeight: 700,
              cursor: isBalanced ? "pointer" : "not-allowed",
            }}
          >
            Confirm (F10)
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat(props: {
  label: string; value: string; testId?: string; tone?: "ok" | "warn" | "info";
}): JSX.Element {
  const color =
    props.tone === "warn" ? "#f59e0b"
      : props.tone === "info" ? "#22d3ee"
        : "#22c55e";
  return (
    <div style={{ padding: "6px 8px", background: "#0f172a", borderRadius: 4 }}>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{props.label}</div>
      <div data-testid={props.testId} style={{ fontSize: 16, color, fontWeight: 700 }}>
        {props.value}
      </div>
    </div>
  );
}
