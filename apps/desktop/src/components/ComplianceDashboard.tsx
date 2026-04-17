// X2a: Compliance dashboard — read-only list of products missing an image.
// Owner uses this to spot Schedule H/H1/X products that bypassed the gate
// (legacy imports, mock-migrations, etc). Uploads happen in Product Master.
//
// X2b (ADR 0019): adds a "Duplicate suspects" section powered by pHash
// Hamming distance. Flags pairs of products whose stored images are visually
// similar enough that one is likely a mis-attached duplicate. Threshold
// buckets (inclusive):
//   distance ≤ 6   → near-duplicate (high-confidence, highlighted red)
//   distance 7-12  → suspicious     (review, highlighted amber)
// Max distance queried = 12, matching the suspicious-band ceiling.
import { useCallback, useEffect, useState } from "react";
import {
  listProductsMissingImageRpc,
  getDuplicateSuspectsRpc,
  type MissingImageRowDTO,
  type DuplicateSuspectRowDTO,
} from "../lib/ipc.js";

const SUSPECT_MAX_DISTANCE = 12;
const NEAR_DUPLICATE_THRESHOLD = 6;

type State =
  | { kind: "loading" }
  | {
      kind: "ready";
      rows: readonly MissingImageRowDTO[];
      suspects: readonly DuplicateSuspectRowDTO[];
    }
  | { kind: "error"; message: string };

function suspectSeverity(distance: number): "near-duplicate" | "suspicious" {
  return distance <= NEAR_DUPLICATE_THRESHOLD ? "near-duplicate" : "suspicious";
}

export function ComplianceDashboard(): JSX.Element {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [rows, suspects] = await Promise.all([
        listProductsMissingImageRpc(),
        getDuplicateSuspectsRpc(SUSPECT_MAX_DISTANCE),
      ]);
      setState({ kind: "ready", rows, suspects });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.kind === "loading") {
    return <div data-testid="cd-loading">Loading compliance report…</div>;
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

  const { rows, suspects } = state;
  const blockerCount = rows.filter((r) => r.severity === "blocker").length;
  const warningCount = rows.filter((r) => r.severity === "warning").length;
  const nearDupCount = suspects.filter(
    (s) => s.distance <= NEAR_DUPLICATE_THRESHOLD,
  ).length;
  const suspiciousCount = suspects.length - nearDupCount;

  return (
    <div>
      <section data-testid="cd-missing-section">
        {rows.length === 0 ? (
          <div data-testid="cd-empty">All products have images. ✓</div>
        ) : (
          <>
            <div data-testid="cd-summary">
              {rows.length} products missing images — {blockerCount} blockers (Schedule H/H1/X),{" "}
              {warningCount} warnings
            </div>
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
          </>
        )}
      </section>

      <section data-testid="cd-suspects-section">
        <h3>Duplicate suspects (image pHash)</h3>
        {suspects.length === 0 ? (
          <div data-testid="cd-suspects-empty">
            No visually-similar product pairs detected. ✓
          </div>
        ) : (
          <>
            <div data-testid="cd-suspects-summary">
              {suspects.length} suspect pair{suspects.length === 1 ? "" : "s"} — {nearDupCount} near-duplicate,{" "}
              {suspiciousCount} suspicious
            </div>
            <table data-testid="cd-suspects-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Distance</th>
                  <th>Product A</th>
                  <th>Product B</th>
                </tr>
              </thead>
              <tbody>
                {suspects.map((s) => {
                  const sev = suspectSeverity(s.distance);
                  const key = `${s.productIdA}__${s.productIdB}`;
                  return (
                    <tr
                      key={key}
                      className={sev === "near-duplicate" ? "row-near-duplicate" : "row-suspicious"}
                      data-testid={`cd-suspect-${key}`}
                    >
                      <td>{sev}</td>
                      <td>{s.distance}</td>
                      <td>
                        {s.nameA} <span className="muted">({s.productIdA})</span>
                      </td>
                      <td>
                        {s.nameB} <span className="muted">({s.productIdB})</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <button data-testid="cd-refresh" onClick={() => void refresh()}>
        Refresh
      </button>
    </div>
  );
}

export default ComplianceDashboard;
