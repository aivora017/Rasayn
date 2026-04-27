// A8 · Tender reversal modal (ADR 0021 §2 + §UX-F6).
// -----------------------------------------------------------------------------
// Reuses the A8 PaymentModal shell in "reverse" mode. Opens on F6 from
// PartialReturnPicker. Alt+1 cash · Alt+2 UPI · Alt+3 card · Alt+4 credit ·
// Alt+5 wallet. Confirm (F10) when |sum(tenders) − refundTotalPaise| ≤
// TENDER_TOLERANCE_PAISE.
//
// Default seeding (ADR 0021 §2):
//   1. Single-tender original → mirror its mode, amount = refund_total.
//   2. Split original → proportional per tender, residual-to-largest, rounded
//      half-away-from-zero at paise (same rule as bill-repo tenderSplit).
//   3. UPI-unreachable → owner can force "cash" (or later store-credit when
//      ADR 0022 lands).
//
// Contract:
//   * role="dialog" aria-modal data-testid="tender-reversal-modal"
//   * data-testid="tender-reversal-confirm" = commit
//   * Esc = cancel
//   * `mode='credit_note'` is not exposed until ADR 0022 ships — the parent
//     must block that case with REFUND_TENDER_UNAVAILABLE:upi_unreachable.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatINR, type Paise } from "@pharmacare/shared-types";
import {
  TENDER_TOLERANCE_PAISE,
  type PaymentRowDTO,
  type ReturnTenderDTO,
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

interface DraftReversal {
  readonly mode: TenderMode;
  readonly amountPaise: number;
  readonly refNo: string;
}

export interface TenderReversalModalProps {
  readonly open: boolean;
  readonly refundTotalPaise: number;
  /**
   * Original bill payment rows, used to seed the default reversal plan per
   * ADR 0021 §2. Empty array → single-cash fallback.
   */
  readonly originalPayments: readonly PaymentRowDTO[];
  readonly onConfirm: (tenders: readonly ReturnTenderDTO[]) => void;
  readonly onCancel: () => void;
}

function parseRupeesToPaise(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return NaN;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

function roundHalfAwayFromZero(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

/**
 * Apportion a refund across the original tender rows using the ADR 0021 §2
 * rule. Returns an array of DraftReversal exactly covering `refundTotalPaise`
 * (residual absorbed by the largest-amount tender).
 *
 * Exported for unit testing.
 */
export function seedDefaultReversal(
  refundTotalPaise: number,
  originalPayments: readonly PaymentRowDTO[],
): readonly DraftReversal[] {
  if (refundTotalPaise <= 0) return [];
  if (originalPayments.length === 0) {
    return [{ mode: "cash", amountPaise: refundTotalPaise, refNo: "" }];
  }
  if (originalPayments.length === 1) {
    const row = originalPayments[0]!;
    // `credit_note` is deferred to ADR 0022 — callers must not offer it yet,
    // but defensively map any unknown mode to cash so the modal never locks
    // the cashier out.
    const mode: TenderMode = (["cash", "upi", "card", "credit", "wallet"] as const).includes(
      row.mode as TenderMode,
    )
      ? (row.mode as TenderMode)
      : "cash";
    return [{ mode, amountPaise: refundTotalPaise, refNo: "" }];
  }
  // Split — proportional per-row, residual to largest.
  const totalOrig = originalPayments.reduce((s, p) => s + p.amountPaise, 0);
  if (totalOrig <= 0) {
    return [{ mode: "cash", amountPaise: refundTotalPaise, refNo: "" }];
  }
  const raw = originalPayments.map((p) => ({
    mode: p.mode,
    amt: roundHalfAwayFromZero((p.amountPaise * refundTotalPaise) / totalOrig),
  }));
  const sum = raw.reduce((s, r) => s + r.amt, 0);
  const diff = refundTotalPaise - sum;
  if (diff !== 0) {
    // Largest original amount absorbs the residual.
    let maxIdx = 0;
    let maxVal = originalPayments[0]!.amountPaise;
    for (let i = 1; i < originalPayments.length; i++) {
      const amt = originalPayments[i]!.amountPaise;
      if (amt > maxVal) {
        maxVal = amt;
        maxIdx = i;
      }
    }
    raw[maxIdx]!.amt += diff;
  }
  return raw.map((r) => ({
    mode: r.mode as TenderMode,
    amountPaise: r.amt,
    refNo: "",
  }));
}

export function TenderReversalModal(
  props: TenderReversalModalProps,
): JSX.Element | null {
  const { open, refundTotalPaise, originalPayments, onConfirm, onCancel } = props;

  const [tenders, setTenders] = useState<readonly DraftReversal[]>([]);
  const [mode, setMode] = useState<TenderMode>("cash");
  const [amountStr, setAmountStr] = useState<string>("");
  const [refNo, setRefNo] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Seed on open from the original payments (ADR 0021 §2).
  useEffect(() => {
    if (!open) return;
    const seeded = seedDefaultReversal(refundTotalPaise, originalPayments);
    setTenders(seeded);
    setMode(seeded[0]?.mode ?? "cash");
    setAmountStr("0.00");
    setRefNo("");
    setErr(null);
    queueMicrotask(() => amountRef.current?.focus());
  }, [open, refundTotalPaise, originalPayments]);

  const sumPaise = useMemo(
    () => tenders.reduce((a, t) => a + t.amountPaise, 0),
    [tenders],
  );
  const remainingPaise = refundTotalPaise - sumPaise;
  const isBalanced =
    Math.abs(sumPaise - refundTotalPaise) <= TENDER_TOLERANCE_PAISE;

  const addTender = useCallback(
    (tenderMode: TenderMode) => {
      const paise = parseRupeesToPaise(amountStr);
      if (!Number.isFinite(paise) || paise <= 0) {
        setErr("Amount must be a positive number");
        return;
      }
      setErr(null);
      setTenders((prev) => [
        ...prev,
        { mode: tenderMode, amountPaise: paise, refNo: refNo.trim() },
      ]);
      const nextRemaining = refundTotalPaise - (sumPaise + paise);
      setAmountStr(nextRemaining > 0 ? (nextRemaining / 100).toFixed(2) : "0.00");
      setRefNo("");
    },
    [amountStr, refNo, sumPaise, refundTotalPaise],
  );

  const removeTender = useCallback((idx: number) => {
    setTenders((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const resetToDefault = useCallback(() => {
    const seeded = seedDefaultReversal(refundTotalPaise, originalPayments);
    setTenders(seeded);
    setErr(null);
  }, [refundTotalPaise, originalPayments]);

  const doConfirm = useCallback(() => {
    if (!isBalanced) {
      setErr(
        `Sum ${formatINR(sumPaise as Paise)} must equal refund total ${formatINR(
          refundTotalPaise as Paise,
        )} (±₹${(TENDER_TOLERANCE_PAISE / 100).toFixed(2)})`,
      );
      return;
    }
    const out: ReturnTenderDTO[] = tenders.map((t) => ({
      mode: t.mode,
      amountPaise: t.amountPaise,
      refNo: t.refNo === "" ? null : t.refNo,
    }));
    onConfirm(out);
  }, [isBalanced, tenders, sumPaise, refundTotalPaise, onConfirm]);

  // Keyboard routing.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        /^Digit[1-5]$/.test(e.code)
      ) {
        const d = Number(e.code.slice(-1));
        const pick = (
          Object.entries(MODE_HOTKEY).find(([, n]) => n === d)?.[0]
        ) as TenderMode | undefined;
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

  useEffect(() => {
    if (open && isBalanced) queueMicrotask(() => confirmRef.current?.focus());
  }, [open, isBalanced]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tender-reversal-title"
      data-testid="tender-reversal-modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "#1e293b",
          color: "#e5e7eb",
          padding: 20,
          borderRadius: 8,
          minWidth: 480,
          maxWidth: 620,
          border: "1px solid #334155",
        }}
      >
        <h3 id="tender-reversal-title" style={{ margin: "0 0 12px" }}>
          Refund tender reversal
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <Stat
            label="Refund total"
            value={formatINR(refundTotalPaise as Paise)}
            testId="tender-reversal-refund"
          />
          <Stat
            label="Assigned"
            value={formatINR(sumPaise as Paise)}
            testId="tender-reversal-assigned"
          />
          <Stat
            label={remainingPaise >= 0 ? "Remaining" : "Over-assigned"}
            value={formatINR(Math.abs(remainingPaise) as Paise)}
            testId="tender-reversal-remaining"
            tone={remainingPaise === 0 ? "ok" : remainingPaise > 0 ? "warn" : "info"}
          />
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {(Object.keys(MODE_LABEL) as TenderMode[]).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                data-testid={`tender-reversal-mode-${m}`}
                onClick={() => setMode(m)}
                aria-pressed={active}
                aria-keyshortcuts={`Alt+${MODE_HOTKEY[m]}`}
                style={{
                  padding: "6px 10px",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  background: active ? "#2563eb" : "#0f172a",
                  color: active ? "white" : "#cbd5e1",
                  cursor: "pointer",
                }}
              >
                {MODE_LABEL[m]}{" "}
                <span style={{ opacity: 0.6, fontSize: 11 }}>
                  Alt+{MODE_HOTKEY[m]}
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          <label
            htmlFor="tender-reversal-amount"
            style={{ fontSize: 12, color: "#94a3b8", minWidth: 60 }}
          >
            Amount ₹
          </label>
          <input
            id="tender-reversal-amount"
            ref={amountRef}
            data-testid="tender-reversal-amount"
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
              flex: 1,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#e5e7eb",
            }}
          />
          {(mode === "card" || mode === "upi" || mode === "credit") && (
            <input
              data-testid="tender-reversal-ref"
              type="text"
              placeholder={
                mode === "card"
                  ? "Card last 4"
                  : mode === "upi"
                    ? "UPI RRN"
                    : "Slip no"
              }
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
              style={{
                width: 110,
                padding: "6px 8px",
                borderRadius: 4,
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e5e7eb",
              }}
            />
          )}
          <button
            type="button"
            data-testid="tender-reversal-add"
            onClick={() => addTender(mode)}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              border: "none",
              background: "#16a34a",
              color: "white",
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>

        <div data-testid="tender-reversal-list" style={{ marginBottom: 12 }}>
          {tenders.length === 0 && (
            <div style={{ fontSize: 12, color: "#64748b", padding: "6px 0" }}>
              No reversal tenders yet.
            </div>
          )}
          {tenders.map((t, i) => (
            <div
              key={i}
              data-testid={`tender-reversal-row-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px",
                borderBottom: "1px solid #1e293b",
              }}
            >
              <span style={{ minWidth: 60, fontSize: 12 }}>
                {MODE_LABEL[t.mode]}
              </span>
              <span style={{ flex: 1, fontFamily: "monospace" }}>
                {formatINR(t.amountPaise as Paise)}
              </span>
              {t.refNo && (
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{t.refNo}</span>
              )}
              <button
                type="button"
                data-testid={`tender-reversal-remove-${i}`}
                onClick={() => removeTender(i)}
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "#f87171",
                  cursor: "pointer",
                }}
                aria-label={`Remove tender ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {err && (
          <div
            data-testid="tender-reversal-err"
            role="alert"
            style={{
              color: "#f87171",
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            data-testid="tender-reversal-reset"
            onClick={resetToDefault}
            style={{
              padding: "8px 14px",
              background: "#64748b",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Reset to default
          </button>
          <button
            type="button"
            data-testid="tender-reversal-cancel"
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              background: "#334155",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            ref={confirmRef}
            data-testid="tender-reversal-confirm"
            onClick={doConfirm}
            disabled={!isBalanced}
            aria-keyshortcuts="F10"
            style={{
              padding: "8px 14px",
              background: isBalanced ? "#16a34a" : "#64748b",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 700,
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
  label: string;
  value: string;
  testId?: string;
  tone?: "ok" | "warn" | "info";
}): JSX.Element {
  const color =
    props.tone === "warn"
      ? "#f59e0b"
      : props.tone === "info"
        ? "#22d3ee"
        : "#22c55e";
  return (
    <div style={{ padding: "6px 8px", background: "#0f172a", borderRadius: 4 }}>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{props.label}</div>
      <div
        data-testid={props.testId}
        style={{ fontSize: 16, color, fontWeight: 700 }}
      >
        {props.value}
      </div>
    </div>
  );
}
