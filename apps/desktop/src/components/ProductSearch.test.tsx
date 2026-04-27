// ProductSearch — debounced FTS5 search + keyboard cursor.
// Coverage-gaps 2026-04-18 §Medium.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductSearch } from "./ProductSearch.js";
import { setIpcHandler, type IpcCall, type ProductHit } from "../lib/ipc.js";

function hit(overrides: Partial<ProductHit> = {}): ProductHit {
  return {
    id: "p1",
    name: "Crocin 500 Tab",
    genericName: "Paracetamol",
    manufacturer: "GSK",
    hsn: "3004",
    gstRate: 12,
    schedule: "OTC",
    mrpPaise: 4200,
    ...overrides,
  };
}

function installHandler(opts: { hits?: readonly ProductHit[]; calls?: IpcCall[] } = {}): void {
  const calls = opts.calls ?? [];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    if (call.cmd === "search_products") return opts.hits ?? [];
    return null;
  });
}

describe("ProductSearch", () => {
  it("renders the input with the configured testId", () => {
    installHandler();
    render(<ProductSearch onPick={() => {}} testId="my-search" />);
    expect(screen.getByTestId("my-search")).toBeInTheDocument();
  });

  it("typing fires search_products after 80ms debounce", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, hits: [hit()] });
    const user = userEvent.setup();
    render(<ProductSearch onPick={() => {}} />);
    await user.type(screen.getByTestId("product-search"), "croc");
    await waitFor(() => {
      const c = calls.find((x) => x.cmd === "search_products");
      expect(c).toBeTruthy();
    });
    const c = calls.find((x) => x.cmd === "search_products");
    if (c && c.cmd === "search_products") {
      expect(c.args.q).toBe("croc");
      expect(c.args.limit).toBe(8);
    }
  });

  it("dropdown opens once results arrive; ArrowDown moves cursor; Enter picks", async () => {
    installHandler({ hits: [hit({ id: "p1", name: "Crocin" }), hit({ id: "p2", name: "Dolo 650" })] });
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<ProductSearch onPick={onPick} />);

    await user.type(screen.getByTestId("product-search"), "x");
    await screen.findByTestId("search-dropdown");
    expect(screen.getByTestId("search-hit-0")).toBeInTheDocument();
    expect(screen.getByTestId("search-hit-1")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("product-search"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("product-search"), { key: "Enter" });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0].id).toBe("p2");
  });

  it("Escape closes the dropdown without firing onPick", async () => {
    installHandler({ hits: [hit()] });
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<ProductSearch onPick={onPick} />);
    await user.type(screen.getByTestId("product-search"), "x");
    await screen.findByTestId("search-dropdown");
    fireEvent.keyDown(screen.getByTestId("product-search"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("search-dropdown")).toBeNull());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("empty query clears hits + closes dropdown", async () => {
    installHandler({ hits: [hit()] });
    const user = userEvent.setup();
    render(<ProductSearch onPick={() => {}} />);
    await user.type(screen.getByTestId("product-search"), "x");
    await screen.findByTestId("search-dropdown");
    await user.clear(screen.getByTestId("product-search"));
    await waitFor(() => expect(screen.queryByTestId("search-dropdown")).toBeNull());
  });

  it("Schedule chip shown for non-OTC hits (regulatory cue)", async () => {
    installHandler({ hits: [hit({ schedule: "H1", name: "Tramadol 50mg" })] });
    const user = userEvent.setup();
    render(<ProductSearch onPick={() => {}} />);
    await user.type(screen.getByTestId("product-search"), "tram");
    await screen.findByTestId("search-dropdown");
    expect(screen.getByText("H1")).toBeInTheDocument();
  });

  it("initialQuery prop pre-fills the input + fires search", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, hits: [hit({ name: "Crocin" })] });
    render(<ProductSearch onPick={() => {}} initialQuery="crocin" />);
    await waitFor(() => {
      const c = calls.find((x) => x.cmd === "search_products");
      expect(c).toBeTruthy();
    });
    const c = calls.find((x) => x.cmd === "search_products");
    if (c && c.cmd === "search_products") {
      expect(c.args.q).toBe("crocin");
    }
  });

  it("clicking a hit fires onPick + closes dropdown + clears query", async () => {
    installHandler({ hits: [hit({ id: "p9", name: "Combiflam" })] });
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<ProductSearch onPick={onPick} />);
    await user.type(screen.getByTestId("product-search"), "comb");
    const item = await screen.findByTestId("search-hit-0");
    fireEvent.mouseDown(item);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0].id).toBe("p9");
    await waitFor(() => expect(screen.queryByTestId("search-dropdown")).toBeNull());
  });
});
