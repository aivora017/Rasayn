import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  openCountSessionRpc,
  recordCountLineRpc,
  getCountSessionRpc,
  finalizeCountRpc,
  listCountSessionsRpc,
  userGetRpc,
  type CountSessionDTO,
  type CountSessionSnapshotDTO,
  type FinalizeDecisionDTO,
  type ReasonCodeDTO,
  type UserDTO,
} from "../../lib/ipc.js";
import {
  computeVariance,
  aggregateByProduct,
  rowsNeedingAdjustment,
  classifyReason,
  REASON_CODES,
  canFinalize,
  type BatchSystemState,
  type CountLine,
  type VarianceReport,
  type VarianceRow,
  type ReasonCode,
  type ProductVarianceAggregate,
} from "@pharmacare/stock-reconcile";

const SHOP_ID = "shop_vaidyanath_kalyan";
const OWNER_USER_ID = "user_sourav_owner";

type UIState = "idle" | "in_session" | "finalizing" | "done";

export function ReconcileTab() {
  const [sessions, setSessions] = useState<ReadonlyArray<CountSessionDTO>>([]);
  const [snap, setSnap] = useState<CountSessionSnapshotDTO | null>(null);
  const [user, setUser] = useState<UserDTO | null>(null);
  const [title, setTitle] = useState<string>(() => defaultTitle());
  const [scan, setScan] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ui, setUi] = useState<UIState>("idle");
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [decisions, setDecisions] = useState<Map<string, { reason: ReasonCode; notes: string }>>(new Map());
  const qtyInput = useRef<HTMLInputElement>(null);

  const refreshList = useCallback(async () => {
    try {
      const list = await listCountSessionsRpc(SHOP_ID);
      setSessions(list);
    } catch (e) {
      setErr(asMsg(e));
    }
  }, []);

  useEffect(() => {
    userGetRpc(OWNER_USER_ID).then(setUser).catch((e) => setErr(asMsg(e)));
    void refreshList();
  }, [refreshList]);

  const variance = useMemo<VarianceReport | null>(() => {
    if (!snap) return null;
    const system: BatchSystemState[] = snap.system.map((s) => ({
      batchId: s.batchId,
      productId: s.productId,
      productName: s.productName,
      batchNo: s.batchNo,
      expiryDate: s.expiryDate,
      systemQty: s.systemQty,
    }));
    const lines: CountLine[] = snap.lines.map((l) => ({
      batchId: l.batchId,
      productId: l.productId,
      countedQty: l.countedQty,
      countedBy: l.countedBy,
      countedAt: l.countedAt,
    }));
    return computeVariance({ system, lines });
  }, [snap]);

  const byProduct = useMemo(() => (variance ? aggregateByProduct(variance) : []), [variance]);
  const adjustable = useMemo(() => (variance ? rowsNeedingAdjustment(variance) : []), [variance]);

  const openNew = useCallback(async () => {
    setErr(null); setBusy(true);
    try {
      const u = user ?? (await userGetRpc(OWNER_USER_ID));
      if (!u) throw new Error("current user not found");
      const s = await openCountSessionRpc({ shopId: SHOP_ID, title: title.trim() || defaultTitle(), openedByUserId: u.id });
      const snapshot = await getCountSessionRpc(s.id);
      setSnap(snapshot);
      setUi("in_session");
      await refreshList();
      setTimeout(() => qtyInput.current?.focus(), 0);
    } catch (e) { setErr(asMsg(e)); }
    finally { setBusy(false); }
  }, [user, title, refreshList]);

  const loadSession = useCallback(async (id: string) => {
    setErr(null); setBusy(true);
    try {
      const snapshot = await getCountSessionRpc(id);
      setSnap(snapshot);
      setUi(snapshot.session.status === "open" ? "in_session" : "done");
    } catch (e) { setErr(asMsg(e)); }
    finally { setBusy(false); }
  }, []);

  const addLine = useCallback(async () => {
    if (!snap) return;
    const batchCode = scan.trim();
    const q = Number(qty);
    if (!batchCode) { setErr("scan a batch code"); return; }
    if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) { setErr("qty must be a non-negative integer"); return; }
    // Resolve batch_no (or id) → batchId
    const match = snap.system.find((b) => b.batchId === batchCode || b.batchNo.toUpperCase() === batchCode.toUpperCase());
    if (!match) { setErr(`batch not found: ${batchCode}`); return; }
    const u = user ?? (await userGetRpc(OWNER_USER_ID));
    if (!u) { setErr("no user"); return; }
    setBusy(true); setErr(null);
    try {
      await recordCountLineRpc({
        sessionId: snap.session.id,
        batchId: match.batchId,
        countedQty: q,
        countedByUserId: u.id,
      });
      const refreshed = await getCountSessionRpc(snap.session.id);
      setSnap(refreshed);
      setScan(""); setQty("");
      setTimeout(() => qtyInput.current?.focus(), 0);
    } catch (e) { setErr(asMsg(e)); }
    finally { setBusy(false); }
  }, [snap, scan, qty, user]);

  const openConfirm = useCallback(() => {
    if (!variance || !user) return;
    const fin = canFinalize({
      sessionStatus: snap?.session.status ?? "open",
      lines: [...(snap?.lines ?? [])],
      userRole: user.role,
      userActive: user.isActive,
    });
    if (!fin.ok) { setErr(fin.reason); return; }
    // Seed decisions map with auto-suggestions.
    const next = new Map<string, { reason: ReasonCode; notes: string }>();
    for (const r of adjustable) {
      const suggested = (r.suggestedReason ?? classifyReason({
        kind: r.kind, delta: r.delta, systemQty: r.systemQty, expiryDate: r.expiryDate,
      })) ?? "other";
      next.set(r.batchId, { reason: suggested, notes: "" });
    }
    setDecisions(next);
    setConfirmFinalize(true);
  }, [variance, user, snap, adjustable]);

  const doFinalize = useCallback(async () => {
    if (!snap || !user) return;
    if (adjustable.length === 0) {
      setErr("nothing to adjust");
      return;
    }
    setBusy(true); setErr(null); setUi("finalizing");
    try {
      const payload: FinalizeDecisionDTO[] = adjustable.map((r) => {
        const d = decisions.get(r.batchId) ?? { reason: "other" as ReasonCode, notes: "" };
        return {
          batchId: r.batchId,
          countedQty: r.countedQty ?? 0,
          reasonCode: d.reason as ReasonCodeDTO,
          reasonNotes: d.notes || null,
        };
      });
      await finalizeCountRpc({ sessionId: snap.session.id, actorUserId: user.id, decisions: payload });
      setConfirmFinalize(false);
      const refreshed = await getCountSessionRpc(snap.session.id);
      setSnap(refreshed);
      setUi("done");
      await refreshList();
    } catch (e) { setErr(asMsg(e)); setUi("in_session"); }
    finally { setBusy(false); }
  }, [snap, user, adjustable, decisions, variance, refreshList]);

  // F-keys (scoped to this tab)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); if (ui === "idle") void openNew(); }
      else if (e.key === "F4") { e.preventDefault(); if (ui === "in_session") void addLine(); }
      else if (e.key === "F12") { e.preventDefault(); if (ui === "in_session") openConfirm(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [ui, openNew, addLine, openConfirm]);

  const finalizeAllowed =
    !!user && user.role === "owner" && user.isActive && snap?.session.status === "open";

  return (
    <div data-testid="reconcile-tab" style={{ padding: 4 }}>
      {err && <div data-testid="rec-err" style={{ color: "#dc2626", marginBottom: 8 }}>{err}</div>}

      {ui === "idle" && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
          <label style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Session title</div>
            <input
              data-testid="rec-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ padding: 8, width: "100%", border: "1px solid #cbd5e1", borderRadius: 4 }}
            />
          </label>
          <button
            data-testid="rec-open"
            onClick={openNew}
            disabled={busy}
            style={{ padding: "8px 16px", background: "#0f172a", color: "white", border: 0, borderRadius: 4, cursor: "pointer" }}
          >
            {busy ? "…" : "Open new session (F2)"}
          </button>
        </div>
      )}

      {ui === "idle" && (
        <section data-testid="rec-history" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Previous sessions</h3>
          <table style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ textAlign: "left", padding: 6 }}>Title</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Adjustments</th>
                <th>Opened</th>
                <th>Finalized</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && (
                <tr><td colSpan={7} data-testid="rec-history-empty" style={{ padding: 12, color: "#64748b" }}>No sessions yet.</td></tr>
              )}
              {sessions.map((s) => (
                <tr key={s.id} data-testid={`rec-history-row-${s.id}`}>
                  <td style={{ padding: 6 }}>{s.title}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td style={{ textAlign: "center" }}>{s.lineCount}</td>
                  <td style={{ textAlign: "center" }}>{s.adjustmentCount}</td>
                  <td>{formatDT(s.openedAt)}</td>
                  <td>{s.finalizedAt ? formatDT(s.finalizedAt) : <span style={{ color: "#94a3b8" }}>—</span>}</td>
                  <td>
                    <button
                      data-testid={`rec-history-open-${s.id}`}
                      onClick={() => loadSession(s.id)}
                      style={{ padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
                    >Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(ui !== "idle") && snap && variance && (
        <SessionView
          snap={snap}
          variance={variance}
          byProduct={byProduct}
          adjustable={adjustable}
          scan={scan} setScan={setScan}
          qty={qty} setQty={setQty}
          onAddLine={addLine}
          onOpenConfirm={openConfirm}
          qtyInputRef={qtyInput}
          finalizeAllowed={finalizeAllowed}
          busy={busy}
          onBack={() => { setSnap(null); setUi("idle"); void refreshList(); }}
        />
      )}

      {confirmFinalize && snap && variance && (
        <ConfirmFinalizeModal
          adjustable={adjustable}
          decisions={decisions}
          setDecisions={setDecisions}
          onCancel={() => setConfirmFinalize(false)}
          onConfirm={doFinalize}
          busy={busy}
        />
      )}
    </div>
  );
}

function SessionView(props: {
  snap: CountSessionSnapshotDTO;
  variance: VarianceReport;
  byProduct: ReadonlyArray<ProductVarianceAggregate>;
  adjustable: VarianceRow[];
  scan: string; setScan: (v: string) => void;
  qty: string; setQty: (v: string) => void;
  onAddLine: () => void;
  onOpenConfirm: () => void;
  qtyInputRef: React.RefObject<HTMLInputElement>;
  finalizeAllowed: boolean;
  busy: boolean;
  onBack: () => void;
}) {
  const { snap, variance, adjustable, byProduct, finalizeAllowed, busy } = props;
  const isOpen = snap.session.status === "open";
  return (
    <div data-testid="rec-session" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <button onClick={props.onBack} style={{ padding: "4px 10px", fontSize: 12 }} data-testid="rec-back">← back</button>
        <strong data-testid="rec-session-title">{snap.session.title}</strong>
        <StatusBadge status={snap.session.status} />
        <span style={{ fontSize: 12, color: "#64748b" }}>Opened {formatDT(snap.session.openedAt)}</span>
      </div>

      {isOpen && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            data-testid="rec-scan"
            placeholder="Scan or type batch code / id"
            value={props.scan}
            onChange={(e) => props.setScan(e.target.value)}
            style={{ flex: 2, padding: 8, border: "1px solid #cbd5e1", borderRadius: 4 }}
          />
          <input
            data-testid="rec-qty"
            ref={props.qtyInputRef}
            placeholder="Qty"
            value={props.qty}
            onChange={(e) => props.setQty(e.target.value)}
            style={{ flex: 1, padding: 8, border: "1px solid #cbd5e1", borderRadius: 4 }}
          />
          <button
            data-testid="rec-add-line"
            onClick={props.onAddLine}
            disabled={busy}
            style={{ padding: "8px 16px", background: "#0f172a", color: "white", border: 0, borderRadius: 4, cursor: "pointer" }}
          >
            {busy ? "…" : "Add (F4)"}
          </button>
          <button
            data-testid="rec-finalize"
            onClick={props.onOpenConfirm}
            disabled={!finalizeAllowed || busy || adjustable.length === 0}
            style={{ padding: "8px 16px", background: "#b91c1c", color: "white", border: 0, borderRadius: 4, cursor: finalizeAllowed && adjustable.length > 0 ? "pointer" : "not-allowed" }}
          >
            Finalize (F12)
          </button>
        </div>
      )}

      <div data-testid="rec-summary" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
        <Stat label="Batches" value={String(variance.totals.batches)} />
        <Stat label="Matched" value={String(variance.totals.matched)} />
        <Stat label="Shortages" value={String(variance.totals.shortages)} color="#b91c1c" />
        <Stat label="Overages" value={String(variance.totals.overages)} color="#0369a1" />
        <Stat label="Uncounted" value={String(variance.totals.uncounted)} color="#64748b" />
      </div>

      <h4 style={{ fontSize: 13, margin: "4px 0" }}>Variance by product</h4>
      <table data-testid="rec-by-product" style={{ width: "100%", fontSize: 13, marginBottom: 16 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={{ textAlign: "left", padding: 6 }}>Product</th>
            <th>Batches affected</th>
            <th style={{ textAlign: "right" }}>Net Δ (units)</th>
          </tr>
        </thead>
        <tbody>
          {byProduct.length === 0 && (
            <tr><td colSpan={3} style={{ padding: 8, color: "#64748b" }}>No variance.</td></tr>
          )}
          {byProduct.map((p) => (
            <tr key={p.productId} data-testid={`rec-prod-${p.productId}`}>
              <td style={{ padding: 6 }}>{p.productName}</td>
              <td style={{ textAlign: "center" }}>{p.batchesAffected}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: p.netDelta < 0 ? "#b91c1c" : "#0369a1" }}>
                {p.netDelta > 0 ? "+" : ""}{p.netDelta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ fontSize: 13, margin: "4px 0" }}>All batches</h4>
      <table data-testid="rec-rows" style={{ width: "100%", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={{ textAlign: "left", padding: 6 }}>Product</th>
            <th>Batch</th>
            <th>Expiry</th>
            <th style={{ textAlign: "right" }}>System</th>
            <th style={{ textAlign: "right" }}>Counted</th>
            <th style={{ textAlign: "right" }}>Δ</th>
            <th>Kind</th>
            <th>Suggested reason</th>
          </tr>
        </thead>
        <tbody>
          {variance.rows.map((r) => (
            <tr key={r.batchId} data-testid={`rec-row-${r.batchId}`}>
              <td style={{ padding: 6 }}>{r.productName}</td>
              <td>{r.batchNo}</td>
              <td>{r.expiryDate}</td>
              <td style={{ textAlign: "right" }}>{r.systemQty}</td>
              <td style={{ textAlign: "right" }}>{r.countedQty ?? "—"}</td>
              <td style={{ textAlign: "right", color: r.delta < 0 ? "#b91c1c" : r.delta > 0 ? "#0369a1" : "#64748b" }}>
                {r.delta > 0 ? "+" : ""}{r.delta}
              </td>
              <td><KindBadge kind={r.kind} /></td>
              <td>{r.suggestedReason ?? <span style={{ color: "#94a3b8" }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmFinalizeModal(props: {
  adjustable: VarianceRow[];
  decisions: Map<string, { reason: ReasonCode; notes: string }>;
  setDecisions: (m: Map<string, { reason: ReasonCode; notes: string }>) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const { adjustable, decisions, setDecisions, onCancel, onConfirm, busy } = props;
  const update = (batchId: string, patch: Partial<{ reason: ReasonCode; notes: string }>) => {
    const next = new Map(decisions);
    const prev = next.get(batchId) ?? { reason: "other" as ReasonCode, notes: "" };
    next.set(batchId, { ...prev, ...patch });
    setDecisions(next);
  };
  return (
    <div
      role="dialog"
      data-testid="rec-confirm-finalize"
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div style={{ background: "white", padding: 20, borderRadius: 6, minWidth: 640, maxWidth: "90vw", maxHeight: "85vh", overflow: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Finalize count — confirm adjustments</h3>
        <p style={{ color: "#64748b", fontSize: 13 }}>
          Owner-only action. Writes {adjustable.length} stock_adjustments rows and updates batch qty_on_hand.
          <br/>Append-only — this cannot be undone.
        </p>
        <table style={{ width: "100%", fontSize: 12, marginBottom: 12 }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              <th style={{ textAlign: "left", padding: 6 }}>Batch</th>
              <th>Δ</th>
              <th>Reason</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {adjustable.map((r) => {
              const d = decisions.get(r.batchId) ?? { reason: "other" as ReasonCode, notes: "" };
              return (
                <tr key={r.batchId} data-testid={`rec-decision-${r.batchId}`}>
                  <td style={{ padding: 6 }}>{r.productName} · {r.batchNo}</td>
                  <td style={{ textAlign: "right", color: r.delta < 0 ? "#b91c1c" : "#0369a1" }}>
                    {r.delta > 0 ? "+" : ""}{r.delta}
                  </td>
                  <td>
                    <select
                      data-testid={`rec-decision-reason-${r.batchId}`}
                      value={d.reason}
                      onChange={(e) => update(r.batchId, { reason: e.target.value as ReasonCode })}
                      style={{ padding: 4 }}
                    >
                      {REASON_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      data-testid={`rec-decision-notes-${r.batchId}`}
                      value={d.notes}
                      onChange={(e) => update(r.batchId, { notes: e.target.value })}
                      style={{ width: "100%", padding: 4 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button data-testid="rec-cancel-finalize" onClick={onCancel} style={{ padding: "8px 16px" }}>Cancel</button>
          <button
            data-testid="rec-confirm-finalize-btn"
            onClick={onConfirm}
            disabled={busy}
            style={{ padding: "8px 16px", background: "#b91c1c", color: "white", border: 0, borderRadius: 4, cursor: "pointer" }}
          >
            {busy ? "Writing…" : `Finalize ${adjustable.length} adjustments`}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CountSessionDTO["status"] }) {
  const colors: Record<CountSessionDTO["status"], string> = {
    open: "#059669", finalized: "#0369a1", cancelled: "#64748b",
  };
  return (
    <span style={{ background: colors[status], color: "white", padding: "1px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
      {status.toUpperCase()}
    </span>
  );
}

function KindBadge({ kind }: { kind: VarianceRow["kind"] }) {
  const colors: Record<VarianceRow["kind"], string> = {
    match: "#059669", shortage: "#b91c1c", overage: "#0369a1", uncounted: "#94a3b8",
  };
  return (
    <span style={{ background: colors[kind], color: "white", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>
      {kind}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: 8, background: "#f8fafc", borderRadius: 4 }}>
      <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? "#0f172a" }}>{value}</div>
    </div>
  );
}

function asMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}

function defaultTitle(): string {
  const d = new Date();
  return `${d.toLocaleString("en-IN", { month: "long", year: "numeric" })} stock count`;
}

function formatDT(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}
