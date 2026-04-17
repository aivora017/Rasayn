// X2a: Compliance dashboard — read-only list of products missing an image.
// Owner uses this to spot Schedule H/H1/X products that bypassed the gate
// (legacy imports, mock-migrations, etc). Uploads happen in Product Master.
import { useCallback, useEffect, useState } from "react";
import {
  listProductsMissingImageRpc,
  type MissingImageRowDTO,
} from "../lib/ipc.js";

type State =
  | { kind: "loading" }
  | { kind: "ready"; rows: readonly MissingImageRowDTO[] }
  | { kind: "error"; message: string };

export function ComplianceDashboard(): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const rows = await listProductsMissingImageRpc();
      setState({ kind: "ready", rows });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.kind === "loading") {
    return (
      <div data-testid="cd-loading">Loading compliance report…</div>
    );
  }

  if (state.kind === "error") {
    return (
      <div>
        <div data-testid="cd-error" role="alert">{state.message}</div>
        <button data-testid="cd-refresh" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
    );
  }

  const rows = state.rows;
  const blockerCount = rows.filter((r) => r.severity === "blocker").length;
  const warningCount = rows.filter((r) => r.severity === "warning").length;

  if (rows.length === 0) {
    return (
      <div>
        <div data-testid="cd-empty">All products have images. ✓</div>
        <button data-testid="cd-refresh" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div>
      <div data-testid="cd-summary">
        {rows.length} products missing images — {blockerCount} blockers (Schedule H/H1/X),{" "}
        {warningCount} warnings
      </div>
      <button data-testid="cd-refresh" onClick={() => void refresh()}>
        Refresh
      </button>
      <table data-testid="cd-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Schedule</th>
            <th>Name</th>
            <th>Manufacturer</th>
            <th>Product ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.productId}
              className={r.severity === "blocker" ? "row-blocker" : "row-warning"}
              data-testid={`cd-row-${r.productId}`}
            >
              <td>{r.severity}</td>
              <td>{r.schedule}</td>
              <td>{r.name}</td>
              <td>{r.manufacturer}</td>
              <td>{r.productId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ComplianceDashboard;
