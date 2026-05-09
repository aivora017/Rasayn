// DSRPanel — DPDP §11 data principal export auto-respond UI.
// S28-C1, ADR-0077. Pairs with `dsr_export.rs` Tauri commands +
// migration `0053_dsr_audit.sql`.
//
// Two zones:
//   1. "Recent DSR exports" list — read from `dsr_list_exports` IPC.
//   2. "New DSR" form — owner records a walk-in request and one-click
//      fulfils via `request_personal_data_export`. Resulting bundle
//      paths are surfaced so the owner can hand the customer the files
//      (or zip + email later).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  requestPersonalDataExportRpc,
  dsrListExportsRpc,
  type DsrExportDTO,
  type DsrExportResultDTO,
} from "../lib/ipc.js";

type Toast = { kind: "ok" | "err"; msg: string } | null;

function statusTone(s: string): "success" | "warning" | "danger" | "neutral" {
  if (s === "done") return "success";
  if (s === "in-progress") return "warning";
  if (s === "failed" || s === "rejected") return "danger";
  return "neutral";
}

export default function DSRPanel(): React.ReactElement {
  const [exports, setExports] = useState<readonly DsrExportDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // New DSR form state
  const [customerId, setCustomerId] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [reason, setReason] = useState("");

  // Last-fulfilled bundle
  const [lastBundle, setLastBundle] = useState<DsrExportResultDTO | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const list = await dsrListExportsRpc(50);
      setExports(list);
    } catch (e) {
      setToast({ kind: "err", msg: `Failed to list exports: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onFulfil = useCallback(async () => {
    if (!customerId.trim()) {
      setToast({ kind: "err", msg: "Customer ID is required" });
      return;
    }
    if (!reason.trim()) {
      setToast({ kind: "err", msg: "Reason / DSR description is required" });
      return;
    }
    setBusy(true);
    try {
      const result = await requestPersonalDataExportRpc(
        customerId.trim(),
        requesterPhone.trim(),
        reason.trim(),
      );
      setLastBundle(result);
      setToast({
        kind: "ok",
        msg: `Bundle generated for ${customerId.trim()} (request ${result.requestId})`,
      });
      // Clear form on success
      setCustomerId("");
      setRequesterPhone("");
      setReason("");
      await reload();
    } catch (e) {
      setToast({ kind: "err", msg: `Export failed: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  }, [customerId, requesterPhone, reason, reload]);

  const fulfilFromQueue = useCallback(
    async (row: DsrExportDTO) => {
      // Re-run an export against the same customer (e.g. customer requests
      // a fresh bundle 90 days later — we generate a NEW request_id).
      setBusy(true);
      try {
        const result = await requestPersonalDataExportRpc(
          row.customerId,
          row.requesterPhone ?? "",
          row.reason ?? "re-fulfil",
        );
        setLastBundle(result);
        setToast({
          kind: "ok",
          msg: `Re-fulfilled for ${row.customerId} (request ${result.requestId})`,
        });
        await reload();
      } catch (e) {
        setToast({ kind: "err", msg: `Re-fulfil failed: ${String(e)}` });
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const openCount = useMemo(
    () =>
      exports.filter((r) => r.status === "in-progress" || r.status === "failed").length,
    [exports],
  );

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="dsr">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold leading-tight">DPDP DSR Auto-Respond</h1>
          <p className="text-[12px] text-[var(--pc-text-secondary)]">
            §11 Data Principal export bundle — JSON + CSV + README. 30-day SLA per §13(2).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={openCount > 0 ? "warning" : "neutral"}>
            {openCount} open
          </Badge>
          <Button variant="ghost" onClick={() => void reload()} disabled={busy}>
            Refresh
          </Button>
        </div>
      </header>

      {toast && (
        <Glass>
          <div
            className={`flex items-start gap-2 p-3 text-[13px] ${
              toast.kind === "ok"
                ? "text-[var(--pc-state-success)]"
                : "text-[var(--pc-state-danger)]"
            }`}
            role="status"
          >
            {toast.msg}
          </div>
        </Glass>
      )}

      {/* New DSR form */}
      <Glass>
        <div className="p-4 flex flex-col gap-3" data-testid="dsr-new-form">
          <h2 className="font-medium text-[14px]">New DSR — record walk-in / phone request</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Customer ID"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              aria-label="customer-id"
            />
            <Input
              placeholder="Requester phone (for verification)"
              value={requesterPhone}
              onChange={(e) => setRequesterPhone(e.target.value)}
              aria-label="requester-phone"
            />
            <Input
              placeholder="Reason / description"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="reason"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void onFulfil()} disabled={busy} data-testid="fulfil-btn">
              {busy ? "Generating bundle..." : "Fulfil access request"}
            </Button>
          </div>
        </div>
      </Glass>

      {/* Last bundle */}
      {lastBundle && (
        <Glass>
          <div className="p-4" data-testid="last-bundle">
            <h3 className="font-medium text-[13px]">Latest bundle generated</h3>
            <p className="text-[12px] text-[var(--pc-text-secondary)] mb-2">
              Request: <span className="font-mono">{lastBundle.requestId}</span>
            </p>
            <ul className="text-[12px] font-mono text-[var(--pc-text-secondary)] list-disc pl-4">
              {lastBundle.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </Glass>
      )}

      {/* Recent exports list */}
      <Glass>
        <div className="p-4" data-testid="dsr-list">
          <h2 className="font-medium text-[14px] mb-2">Recent DSR exports</h2>
          {exports.length === 0 ? (
            <div className="text-[12px] text-[var(--pc-text-tertiary)] py-6 text-center">
              No DSR exports recorded yet.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[var(--pc-text-tertiary)] uppercase text-[11px] border-b border-[var(--pc-border-subtle)]">
                  <th className="py-2 font-medium">Request</th>
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium">Kind</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Created</th>
                  <th className="py-2 font-medium">Bundle</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--pc-border-subtle)] last:border-0"
                    data-testid={`dsr-row-${r.id}`}
                  >
                    <td className="py-2 font-mono text-[11px]">{r.requestId}</td>
                    <td className="py-2 font-mono">{r.customerId}</td>
                    <td className="py-2">
                      <Badge variant="info">{r.kind}</Badge>
                    </td>
                    <td className="py-2">
                      <Badge variant={statusTone(r.status)}>{r.status}</Badge>
                    </td>
                    <td className="py-2 text-[var(--pc-text-secondary)]">
                      {new Date(r.createdAt).toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 font-mono text-[11px] break-all">
                      {r.filesPath ?? "—"}
                    </td>
                    <td className="py-2">
                      <Button
                        variant="ghost"
                        onClick={() => void fulfilFromQueue(r)}
                        disabled={busy}
                      >
                        Re-fulfil
                      </Button>
                    </td>
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
