/**
 * A11 — InventoryScreen tab scaffold.
 *
 * Covers:
 *   - Batches tab renders by default
 *   - Clicking the Reconcile tab switches content
 *   - Keyboard shortcut `R` switches to Reconcile, `B` switches back
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { InventoryScreen } from "./InventoryScreen.js";
import { setIpcHandler, type IpcCall } from "../lib/ipc.js";

function installStub() {
  setIpcHandler(async (call: IpcCall) => {
    if (call.cmd === "list_stock") return [];
    if (call.cmd === "user_get") return { id: "user_sourav_owner", name: "Sourav", role: "owner", isActive: true };
    if (call.cmd === "list_count_sessions") return [];
    return undefined;
  });
}

describe("InventoryScreen tabs", () => {
  beforeEach(installStub);

  it("renders the Batches tab by default", async () => {
    render(<InventoryScreen />);
    await waitFor(() => expect(screen.getByTestId("batches-tab")).toBeInTheDocument());
    expect(screen.queryByTestId("reconcile-tab")).toBeNull();
    expect((screen.getByTestId("inv-tab-batches") as HTMLButtonElement).getAttribute("aria-selected")).toBe("true");
  });

  it("switches to Reconcile on click", async () => {
    render(<InventoryScreen />);
    await waitFor(() => expect(screen.getByTestId("batches-tab")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId("inv-tab-reconcile")); });
    expect(screen.getByTestId("reconcile-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("batches-tab")).toBeNull();
  });

  it("switches tabs via keyboard shortcuts B / R", async () => {
    render(<InventoryScreen />);
    await waitFor(() => expect(screen.getByTestId("batches-tab")).toBeInTheDocument());

    await act(async () => { fireEvent.keyDown(window, { key: "R" }); });
    expect(screen.getByTestId("reconcile-tab")).toBeInTheDocument();

    await act(async () => { fireEvent.keyDown(window, { key: "B" }); });
    expect(screen.getByTestId("batches-tab")).toBeInTheDocument();
  });
});
