import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComplianceDashboard } from "./ComplianceDashboard.js";
import {
  setIpcHandler,
  type IpcCall,
  type MissingImageRowDTO,
  type DuplicateSuspectRowDTO,
} from "../lib/ipc.js";

const MISSING: readonly MissingImageRowDTO[] = [
  { productId: "p1", name: "Alprazolam 0.5mg", schedule: "H1", manufacturer: "Abbott", severity: "blocker" },
  { productId: "p2", name: "Morphine 10mg",    schedule: "X",  manufacturer: "Sun",    severity: "blocker" },
  { productId: "p3", name: "Amoxy 500",        schedule: "H",  manufacturer: "Cipla",  severity: "blocker" },
  { productId: "p4", name: "Paracetamol",      schedule: "OTC",manufacturer: "GSK",    severity: "warning" },
  { productId: "p5", name: "Vitamin C",        schedule: "G",  manufacturer: "Himalaya", severity: "warning" },
];

const SUSPECTS: readonly DuplicateSuspectRowDTO[] = [
  { productIdA: "px1", nameA: "Crocin 500",      productIdB: "px2", nameB: "Crocin 500 (dup)",   distance: 0 },
  { productIdA: "px3", nameA: "Amoxy 500",       productIdB: "px4", nameB: "Amoxycillin 500",    distance: 5 },
  { productIdA: "px5", nameA: "Azithral 250",    productIdB: "px6", nameB: "Azee 250",           distance: 9 },
];

type HandlerOpts = {
  missing?: readonly MissingImageRowDTO[];
  suspects?: readonly DuplicateSuspectRowDTO[];
  missingThrows?: Error;
  suspectsThrows?: Error;
};

function installHandler(opts: HandlerOpts): { calls: IpcCall[] } {
  const calls: IpcCall[] = [];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    if (call.cmd === "list_products_missing_image") {
      if (opts.missingThrows) throw opts.missingThrows;
      return opts.missing ?? [];
    }
    if (call.cmd === "get_duplicate_suspects") {
      if (opts.suspectsThrows) throw opts.suspectsThrows;
      return opts.suspects ?? [];
    }
    throw new Error(`unexpected ${call.cmd}`);
  });
  return { calls };
}

describe("ComplianceDashboard (X2a + X2b)", () => {
  beforeEach(() => {
    setIpcHandler(async () => {
      throw new Error("handler not installed");
    });
  });

  it("renders loading on first tick", async () => {
    installHandler({ missing: MISSING, suspects: SUSPECTS });
    render(<ComplianceDashboard />);
    // Snap the loading state before the async RPC resolves — this is the
    // pre-effect signal we intentionally want to observe.
    expect(screen.getByTestId("cd-loading")).toBeTruthy();
    // Then flush the pending refresh() promise inside an act() boundary so
    // the post-resolve setState({ kind: "ready" }) doesn't leak past the
    // test and trip the act() warning.
    await act(async () => {});
  });

  it("X2a: renders missing-image empty state when list is []", async () => {
    installHandler({ missing: [], suspects: [] });
    render(<ComplianceDashboard />);
    expect(await screen.findByTestId("cd-empty")).toBeTruthy();
    expect(screen.queryByTestId("cd-table")).toBeNull();
  });

  it("X2a: renders missing-image summary with correct counts (3 blockers + 2 warnings = 5 total)", async () => {
    installHandler({ missing: MISSING, suspects: [] });
    render(<ComplianceDashboard />);
    const summary = await screen.findByTestId("cd-summary");
    expect(summary.textContent).toMatch(/5 products missing images/);
    expect(summary.textContent).toMatch(/3 blockers/);
    expect(summary.textContent).toMatch(/2 warnings/);
  });

  it("X2a: renders missing-image rows with blocker/warning CSS classes", async () => {
    installHandler({ missing: MISSING, suspects: [] });
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-table");
    expect(screen.getByTestId("cd-row-p1").className).toBe("row-blocker");
    expect(screen.getByTestId("cd-row-p2").className).toBe("row-blocker");
    expect(screen.getByTestId("cd-row-p3").className).toBe("row-blocker");
    expect(screen.getByTestId("cd-row-p4").className).toBe("row-warning");
    expect(screen.getByTestId("cd-row-p5").className).toBe("row-warning");
  });

  it("Refresh button re-calls both RPCs", async () => {
    const { calls } = installHandler({ missing: MISSING, suspects: SUSPECTS });
    const user = userEvent.setup();
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-table");
    expect(calls.filter((c) => c.cmd === "list_products_missing_image").length).toBe(1);
    expect(calls.filter((c) => c.cmd === "get_duplicate_suspects").length).toBe(1);
    await user.click(screen.getByTestId("cd-refresh"));
    await waitFor(() => {
      expect(calls.filter((c) => c.cmd === "list_products_missing_image").length).toBe(2);
      expect(calls.filter((c) => c.cmd === "get_duplicate_suspects").length).toBe(2);
    });
  });

  it("renders error state when either RPC throws", async () => {
    installHandler({ missingThrows: new Error("db unavailable") });
    render(<ComplianceDashboard />);
    const err = await screen.findByTestId("cd-error");
    expect(err.textContent).toMatch(/db unavailable/);
  });

  // ----- X2b (ADR 0019): duplicate suspects section -----

  it("X2b: renders duplicate-suspects empty state when list is []", async () => {
    installHandler({ missing: [], suspects: [] });
    render(<ComplianceDashboard />);
    expect(await screen.findByTestId("cd-suspects-empty")).toBeTruthy();
    expect(screen.queryByTestId("cd-suspects-table")).toBeNull();
  });

  it("X2b: calls get_duplicate_suspects with max_distance=12 (suspicious-band ceiling)", async () => {
    const { calls } = installHandler({ missing: [], suspects: [] });
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-suspects-empty");
    const call = calls.find((c) => c.cmd === "get_duplicate_suspects");
    expect(call).toBeTruthy();
    if (call && call.cmd === "get_duplicate_suspects") {
      expect(call.args.maxDistance).toBe(12);
    }
  });

  it("X2b: renders suspects summary — 2 near-duplicate (d≤6) + 1 suspicious (7-12)", async () => {
    installHandler({ missing: [], suspects: SUSPECTS });
    render(<ComplianceDashboard />);
    const summary = await screen.findByTestId("cd-suspects-summary");
    expect(summary.textContent).toMatch(/3 suspect pairs/);
    expect(summary.textContent).toMatch(/2 near-duplicate/);
    expect(summary.textContent).toMatch(/1 suspicious/);
  });

  it("X2b: classifies rows — d=0 and d=5 → near-duplicate, d=9 → suspicious", async () => {
    installHandler({ missing: [], suspects: SUSPECTS });
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-suspects-table");
    expect(screen.getByTestId("cd-suspect-px1__px2").className).toBe("row-near-duplicate");
    expect(screen.getByTestId("cd-suspect-px3__px4").className).toBe("row-near-duplicate");
    expect(screen.getByTestId("cd-suspect-px5__px6").className).toBe("row-suspicious");
  });

  it("X2b: boundary — d=6 is near-duplicate, d=7 is suspicious", async () => {
    const boundary: readonly DuplicateSuspectRowDTO[] = [
      { productIdA: "a1", nameA: "A1", productIdB: "b1", nameB: "B1", distance: 6 },
      { productIdA: "a2", nameA: "A2", productIdB: "b2", nameB: "B2", distance: 7 },
    ];
    installHandler({ missing: [], suspects: boundary });
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-suspects-table");
    expect(screen.getByTestId("cd-suspect-a1__b1").className).toBe("row-near-duplicate");
    expect(screen.getByTestId("cd-suspect-a2__b2").className).toBe("row-suspicious");
  });

  it("X2b: renders both missing-image and suspect sections side-by-side", async () => {
    installHandler({ missing: MISSING, suspects: SUSPECTS });
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-table");
    expect(screen.getByTestId("cd-table")).toBeTruthy();
    expect(screen.getByTestId("cd-suspects-table")).toBeTruthy();
    expect(screen.getByTestId("cd-summary").textContent).toMatch(/5 products missing/);
    expect(screen.getByTestId("cd-suspects-summary").textContent).toMatch(/3 suspect pairs/);
  });

  it("X2b: single suspect uses singular 'pair'", async () => {
    const one: readonly DuplicateSuspectRowDTO[] = [
      { productIdA: "s1", nameA: "X", productIdB: "s2", nameB: "Y", distance: 3 },
    ];
    installHandler({ missing: [], suspects: one });
    render(<ComplianceDashboard />);
    const summary = await screen.findByTestId("cd-suspects-summary");
    expect(summary.textContent).toMatch(/1 suspect pair — /);
    expect(summary.textContent).not.toMatch(/suspect pairs/);
  });
});
