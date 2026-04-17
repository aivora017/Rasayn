// A13 · Owner override modal (ADR 0013).
// -----------------------------------------------------------------------------
// Shown when the cashier adds a line whose nearest-expiry batch is in the
// 1..=30 day window. The owner must enter a reason (>= 4 chars, enforced on
// both sides) and confirm; we then call record_expiry_override which writes
// a row that save_bill will match within the next 10 min.
//
// Contract (ADR 0009 modal shell + 0013 semantics):
//   * role="dialog" aria-modal data-testid="expiry-override-modal"
//   * `data-testid="expiry-override-confirm"` disabled while:
//       - reason.trim().length < 4      → REASON_TOO_SHORT (matches Rust)
//       - currentUser.role !== "owner"  → OVERRIDE_FORBIDDEN (matches Rust)
//   * Esc cancels; role failure displays a banner but does NOT silently close
//     — the operator needs to see why.
//   * On success: calls onOverride(result) with the auditId so the parent can
//     retry save_bill (which will now find the fresh audit row).
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import {
  recordExpiryOverrideRpc,
  type ExpiryOverrideResultDTO,
  type UserDTO,
} from "../lib/ipc.js";

export interface ExpiryOverrideTarget {
  readonly batchId: string;
  readonly batchNo: string;
  readonly expiryDate: string; // YYYY-MM-DD
  readonly daysToExpiry: number;
  readonly productName: string;
}

export interface OwnerOverrideModalProps {
  readonly open: boolean;
  readonly target: ExpiryOverrideTarget | null;
  readonly currentUser: UserDTO | null;
  readonly onOverride: (result: ExpiryOverrideResultDTO) => void;
  readonly onCancel: () => void;
}

export function OwnerOverrideModal(props: OwnerOverrideModalProps): JSX.Element | null {
  const { open, target, currentUser, onOverride, onCancel } = props;
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Reset on open so a stale reason from a previous line never leaks through.
  useEffect(() => {
    if (open) {
      setReason("");
      setErr(null);
      setSubmitting(false);
      queueMicrotask(() => reasonRef.current?.focus());
    }
  }, [open]);

  const isOwner = currentUser?.role === "owner" && currentUser.isActive;
  const reasonOk = reason.trim().length >= 4;
  const canConfirm = open && !!target && isOwner && reasonOk && !submitting;

  const doConfirm = useCallback(async () => {
    if (!canConfirm || !target || !currentUser) return;
    setSubmitting(true);
    setErr(null);
    try {
      const result = await recordExpiryOverrideRpc({
        batchId: target.batchId,
        actorUserId: currentUser.id,
        reason: reason.trim(),
      });
      onOverride(result);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }, [canConfirm, target, currentUser, reason, onOverride]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "F10" && canConfirm) {
        e.preventDefault();
        void doConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, doConfirm, canConfirm]);

  if (!open || !target) return null;

  const toneColor =
    target.daysToExpiry <= 30 ? "#ef4444" :
    target.daysToExpiry <= 90 ? "#f59e0b" :
    "#22c55e";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="expiry-override-title"
      data-testid="expiry-override-modal"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 101,
      }}
    >
      <div style={{
        background: "#1e293b", color: "#e5e7eb", padding: 20, borderRadius: 8,
        minWidth: 480, maxWidth: 560, border: "1px solid #334155",
      }}>
        <h3 id="expiry-override-title" style={{ margin: "0 0 12px" }}>
          Near-expiry override
        </h3>

        <div style={{
          marginBottom: 12, padding: "8px 10px", borderRadius: 4,
          background: "#0f172a", borderLeft: `3px solid ${toneColor}`,
        }}>
          <div data-testid="expiry-override-product" style={{ fontWeight: 600 }}>
            {target.productName}
          </div>
          <div data-testid="expiry-override-batch" style={{ fontSize: 12, color: "#cbd5e1" }}>
            Batch {target.batchNo} · expires {target.expiryDate}
          </div>
          <div
            data-testid="expiry-override-days"
            style={{ fontSize: 13, color: toneColor, fontWeight: 700, marginTop: 4 }}
          >
            {target.daysToExpiry} day{target.daysToExpiry === 1 ? "" : "s"} to expiry
          </div>
        </div>

        {!isOwner && (
          <div
            data-testid="expiry-override-role-warn"
            role="alert"
            style={{
              marginBottom: 12, padding: "8px 10px", borderRadius: 4,
              background: "#7f1d1d", color: "#fecaca", fontSize: 13,
            }}
          >
            Only an owner can approve a near-expiry sale. Current user:{" "}
            <strong>{currentUser?.name ?? "unknown"}</strong>{" "}
            ({currentUser?.role ?? "n/a"}).
          </div>
        )}

        <label htmlFor="expiry-override-reason" style={{ fontSize: 12, color: "#94a3b8" }}>
          Reason (min 4 chars — recorded to the audit log)
        </label>
        <textarea
          id="expiry-override-reason"
          ref={reasonRef}
          data-testid="expiry-override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          disabled={!isOwner || submitting}
          style={{
            width: "100%", marginTop: 4, marginBottom: 8, padding: "6px 8px",
            borderRadius: 4, border: "1px solid #334155",
            background: "#0f172a", color: "#e5e7eb", fontFamily: "inherit",
            resize: "vertical",
          }}
        />

        {err && (
          <div
            data-testid="expiry-override-error"
            role="alert"
            style={{
              marginBottom: 8, padding: "6px 8px", borderRadius: 4,
              background: "#7f1d1d", color: "#fecaca", fontSize: 12, fontFamily: "monospace",
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            data-testid="expiry-override-cancel"
            style={{
              padding: "8px 14px", background: "#334155", color: "white",
              border: "none", borderRadius: 4,
            }}
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={() => { void doConfirm(); }}
            data-testid="expiry-override-confirm"
            disabled={!canConfirm}
            aria-keyshortcuts="F10"
            style={{
              padding: "8px 14px",
              background: canConfirm ? "#b45309" : "#64748b",
              color: "white", border: "none", borderRadius: 4, fontWeight: 700,
              cursor: canConfirm ? "pointer" : "not-allowed",
            }}
          >
            Override &amp; continue (F10)
          </button>
        </div>
      </div>
    </div>
  );
}
