import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComplianceDashboard } from "./ComplianceDashboard.js";
import {
  setIpcHandler,
  type IpcCall,
  type MissingImageRowDTO,
} from "../lib/ipc.js";

const SAMPLE: readonly MissingImageRowDTO[] = [
  { productId: "p1", name: "Alprazolam 0.5mg", schedule: "H1", manufacturer: "Abbott", severity: "blocker" },
  { productId: "p2", name: "Morphine 10mg",    schedule: "X",  manufacturer: "Sun",    severity: "blocker" },
  { productId: "p3", name: "Amoxy 500",        schedule: "H",  manufacturer: "Cipla",  severity: "blocker" },
  { productId: "p4", name: "Paracetamol",      schedule: "OTC",manufacturer: "GSK",    severity: "warning" },
  { productId: "p5", name: "Vitamin C",        schedule: "G",  manufacturer: "Himalaya", severity: "warning" },
];

describe("ComplianceDashboard (X2a)", () => {
  beforeEach(() => {
    setIpcHandler(async () => {
      throw new Error("handler not installed");
    });
  });

  it("renders loading on first tick", () => {
    setIpcHandler(async () => SAMPLE);
    render(<ComplianceDashboard />);
    expect(screen.getByTestId("cd-loading")).toBeTruthy();
  });

  it("renders empty state when RPC returns []", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "list_products_missing_image") return [];
      throw new Error(`unexpected ${call.cmd}`);
    });
    render(<ComplianceDashboard />);
    expect(await screen.findByTestId("cd-empty")).toBeTruthy();
    expect(screen.getByTestId("cd-empty").textContent).toMatch(/All products have images/);
    expect(screen.queryByTestId("cd-table")).toBeNull();
  });

  it("renders summary with correct counts (3 blockers + 2 warnings = 5 total)", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "list_products_missing_image") return SAMPLE;
      throw new Error(`unexpected ${call.cmd}`);
    });
    render(<ComplianceDashboard />);
    const summary = await screen.findByTestId("cd-summary");
    expect(summary.textContent).toMatch(/5 products missing images/);
    expect(summary.textContent).toMatch(/3 blockers/);
    expect(summary.textContent).toMatch(/2 warnings/);
  });

  it("renders table rows with blocker/warning CSS classes", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "list_products_missing_image") return SAMPLE;
      throw new Error(`unexpected ${call.cmd}`);
    });
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-table");
    expect(screen.getByTestId("cd-row-p1").className).toBe("row-blocker");
    expect(screen.getByTestId("cd-row-p2").className).toBe("row-blocker");
    expect(screen.getByTestId("cd-row-p3").className).toBe("row-blocker");
    expect(screen.getByTestId("cd-row-p4").className).toBe("row-warning");
    expect(screen.getByTestId("cd-row-p5").className).toBe("row-warning");
  });

  it("Refresh button re-calls the RPC", async () => {
    const spy = vi.fn(async () => SAMPLE);
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "list_products_missing_image") return spy();
      throw new Error(`unexpected ${call.cmd}`);
    });
    const user = userEvent.setup();
    render(<ComplianceDashboard />);
    await screen.findByTestId("cd-table");
    expect(spy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("cd-refresh"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("renders error state when RPC throws", async () => {
    setIpcHandler(async () => {
      throw new Error("db unavailable");
    });
    render(<ComplianceDashboard />);
    const err = await screen.findByTestId("cd-error");
    expect(err.textContent).toMatch(/db unavailable/);
  });
});
