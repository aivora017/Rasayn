import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToasterProvider, useToast } from "./Toast.js";

function Probe() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast({ variant: "success", title: "Saved" })}>fire</button>
  );
}

describe("Toast", () => {
  it("renders a toast on demand", async () => {
    render(
      <ToasterProvider>
        <Probe />
      </ToasterProvider>,
    );
    await userEvent.click(screen.getByText("fire"));
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("Esc clears the stack", async () => {
    render(
      <ToasterProvider>
        <Probe />
      </ToasterProvider>,
    );
    await userEvent.click(screen.getByText("fire"));
    await userEvent.click(screen.getByText("fire"));
    expect(screen.getAllByText("Saved")).toHaveLength(2);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // AnimatePresence keeps exiting nodes mounted briefly — wait them out.
    await waitFor(() => {
      expect(screen.queryAllByText("Saved")).toHaveLength(0);
    }, { timeout: 1500 });
  });
});
