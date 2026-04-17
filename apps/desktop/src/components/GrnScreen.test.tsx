/**
 * X1.2 — GrnScreen load-from-inbox integration.
 *
 * Covers:
 *   - pending draft on mount prefills invoice # / date
 *   - per-parsed-line auto-match via searchProductsRpc → matchParsedLine
 *   - high-confidence exact-name match auto-appends a DraftLine with
 *     qty / rate / batch / expiry / mrp carried from the parsed line
 *   - low-confidence and unmatched rows stay in the banner with
 *     Skip + "use search ↓" hint (no auto-append)
 *   - Skip marks the row as skipped (kind=skipped) without touching lines
 *   - empty parsed lines renders banner header but no per-line rows
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GrnScreen } from "./GrnScreen.js";
import { setIpcHandler, type IpcCall, type ProductHit } from "../lib/ipc.js";
import {
  setPendingGrnDraft,
  _resetPendingGrnDraftForTests,
  type PendingGrnDraft,
} from "../lib/pendingGrnDraft.js";

const CROCIN: ProductHit = {
  id: "p-crocin", name: "Crocin 500", genericName: "Paracetamol",
  manufacturer: "GSK", gstRate: 12, schedule: "OTC", mrpPaise: 11200,
};
const AZITHRAL: ProductHit = {
  id: "p-azi", name: "Azithral 500 Tablet", genericName: "Azithromycin",
  manufacturer: "Alembic", gstRate: 5, schedule: "H", mrpPaise: 9800,
};

function makeHandler(fixtures: ProductHit[], calls?: IpcCall[]) {
  return async (call: IpcCall) => {
    calls?.push(call);
    if (call.cmd === "search_products") {
      const q = call.args.q.toLowerCase();
      return fixtures.filter((f) =>
        f.name.toLowerCase().includes(q.split(" ")[0]!) ||
        q.split(" ").some((t) => f.name.toLowerCase().includes(t)),
      );
    }
    if (call.cmd === "save_grn") return { grnId: "grn_test", linesInserted: 1 };
    return null;
  };
}

function draftWith(
  parsedLines: PendingGrnDraft["parsedLines"],
  opts: Partial<Omit<PendingGrnDraft, "parsedLines">> = {},
): PendingGrnDraft {
  return {
    invoiceNo: opts.invoiceNo ?? "INV-001",
    invoiceDate: opts.invoiceDate ?? "2026-04-17",
    supplierHint: opts.supplierHint ?? "GSK Ltd",
    sourceMessageId: opts.sourceMessageId ?? "msg_001",
    parsedLines,
  };
}

describe("GrnScreen · X1.2 load-from-inbox", () => {
  beforeEach(() => {
    _resetPendingGrnDraftForTests();
    setIpcHandler(makeHandler([CROCIN, AZITHRAL]));
  });
  afterEach(() => {
    _resetPendingGrnDraftForTests();
  });

  it("renders empty state when no pending draft", () => {
    render(<GrnScreen />);
    expect(screen.queryByTestId("grn-imported-banner")).toBeNull();
    expect(screen.getByTestId("grn-empty")).toBeInTheDocument();
  });

  it("prefills invoice # and invoice date from pending draft", async () => {
    setPendingGrnDraft(draftWith([], { invoiceNo: "INV-42", invoiceDate: "2026-04-15" }));
    render(<GrnScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("grn-imported-banner")).toBeInTheDocument();
      expect((screen.getByTestId("grn-invoice-no") as HTMLInputElement).value).toBe("INV-42");
      expect((screen.getByTestId("grn-invoice-date") as HTMLInputElement).value).toBe("2026-04-15");
    });
  });

  it("auto-appends a DraftLine for a high-confidence exact-name match", async () => {
    setPendingGrnDraft(draftWith([
      {
        productHint: "Crocin 500",
        batchNo: "B-01", expiryDate: "2027-06-30",
        qty: 10, ratePaise: 8000, mrpPaise: 11200, gstRate: 12, confidence: 0.9,
      },
    ]));
    render(<GrnScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("grn-imp-match-high")).toHaveTextContent(/high/i);
      expect(screen.getByTestId("grn-row-0")).toBeInTheDocument();
    });
    expect((screen.getByTestId("grn-batch-0") as HTMLInputElement).value).toBe("B-01");
    expect((screen.getByTestId("grn-expiry-0") as HTMLInputElement).value).toBe("2027-06-30");
    expect((screen.getByTestId("grn-qty-0") as HTMLInputElement).value).toBe("10");
    expect((screen.getByTestId("grn-cost-0") as HTMLInputElement).value).toBe("80.00");
    expect((screen.getByTestId("grn-mrp-0") as HTMLInputElement).value).toBe("112.00");
  });

  it("does NOT auto-append when match is unmatched (no candidates found)", async () => {
    setIpcHandler(makeHandler([])); // empty product list
    setPendingGrnDraft(draftWith([
      {
        productHint: "UnknownMed",
        batchNo: null, expiryDate: null,
        qty: 3, ratePaise: 1000, mrpPaise: null, gstRate: null, confidence: 0.5,
      },
    ]));
    render(<GrnScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("grn-imp-match-unmatched")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("grn-row-0")).toBeNull();
    expect(screen.getByTestId("grn-empty")).toBeInTheDocument();
    // Skip button present on unmatched.
    expect(screen.getByTestId("grn-imp-skip-0")).toBeInTheDocument();
  });

  it("Skip marks an unmatched row as skipped without adding a line", async () => {
    setIpcHandler(makeHandler([]));
    setPendingGrnDraft(draftWith([
      {
        productHint: "UnknownMed",
        batchNo: null, expiryDate: null,
        qty: 3, ratePaise: 1000, mrpPaise: null, gstRate: null, confidence: 0.5,
      },
    ]));
    const user = userEvent.setup();
    render(<GrnScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("grn-imp-skip-0")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("grn-imp-skip-0"));
    expect(screen.getByTestId("grn-imp-match-skipped")).toHaveTextContent(/skipped/i);
    expect(screen.queryByTestId("grn-row-0")).toBeNull();
  });

  it("renders 2 parsed lines — both auto-match distinct products", async () => {
    setPendingGrnDraft(draftWith([
      {
        productHint: "Crocin 500",
        batchNo: "B-C1", expiryDate: "2027-01-01",
        qty: 5, ratePaise: 5000, mrpPaise: null, gstRate: 12, confidence: 0.9,
      },
      {
        productHint: "Azithral 500 Tablet",
        batchNo: "B-A1", expiryDate: "2027-02-02",
        qty: 2, ratePaise: 4000, mrpPaise: 9800, gstRate: 5, confidence: 0.9,
      },
    ]));
    render(<GrnScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("grn-row-0")).toBeInTheDocument();
      expect(screen.getByTestId("grn-row-1")).toBeInTheDocument();
    });
    expect((screen.getByTestId("grn-batch-0") as HTMLInputElement).value).toBe("B-C1");
    expect((screen.getByTestId("grn-batch-1") as HTMLInputElement).value).toBe("B-A1");
  });

  it("Dismiss removes the banner but keeps already-appended DraftLines", async () => {
    setPendingGrnDraft(draftWith([
      {
        productHint: "Crocin 500",
        batchNo: "B-01", expiryDate: "2027-06-30",
        qty: 10, ratePaise: 8000, mrpPaise: 11200, gstRate: 12, confidence: 0.9,
      },
    ]));
    const user = userEvent.setup();
    render(<GrnScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("grn-row-0")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("grn-imported-dismiss"));
    expect(screen.queryByTestId("grn-imported-banner")).toBeNull();
    expect(screen.getByTestId("grn-row-0")).toBeInTheDocument();
  });
});
