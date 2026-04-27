// G08 — SupplierTemplateScreen coverage (coverage-gaps 2026-04-18 §G08).
//
// X1 Tier A template config. The owner authors regex-based parsers that
// every future Gmail invoice import depends on. A bad regex or a malformed
// columnMap silently breaks every distributor going forward — symptoms
// don't surface until a cashier tries to import next week. Client-side
// JSON.parse + regex compile must catch problems BEFORE save.
//
// Coverage in this suite:
//
//   - Loads suppliers + templates on mount, populates the sidebar list
//   - Filtering by supplier refetches list_supplier_templates with that supplierId
//   - Picking a row hydrates the editor from the DTO (regex + columnMap JSON)
//   - Ctrl+N opens an empty draft seeded with sensible regex defaults
//   - Save without a name surfaces 'name required' inline; no upsert fires
//   - Save without a supplier surfaces 'supplier required'; no upsert fires
//   - Save with malformed columnMap JSON surfaces a parse error; no upsert fires
//   - Save happy path round-trips the input DTO + reloads the list
//   - Test (Ctrl+T) builds a SupplierTemplateDTO from the draft + invokes
//     test_supplier_template; result table renders header + line rows
//   - Test failure surfaces inline; no result table
//   - Delete triggers confirm() — cancel keeps row, accept calls
//     delete_supplier_template + clears draft
//
// Invariant: header `supplier` field is ONLY emitted when non-empty
// (build skips empty supplierKey to avoid sending a useless empty regex).

import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupplierTemplateScreen from "./SupplierTemplateScreen.js";
import {
  setIpcHandler,
  type IpcCall,
  type SupplierRow,
  type SupplierTemplateDTO,
  type TemplateTestResult,
  type UpsertSupplierTemplateInput,
} from "../lib/ipc.js";

const SHOP_ID = "shop_local";

const SUP_CIPLA: SupplierRow = { id: "sup_cipla", name: "Cipla Ltd", gstin: "27AAAAA0000A1Z5" };
const SUP_GSK: SupplierRow = { id: "sup_gsk", name: "GSK Pharma", gstin: null };

const TPL_CIPLA: SupplierTemplateDTO = {
  id: "tpl_1",
  supplierId: "sup_cipla",
  name: "Cipla CSV v1",
  headerPatterns: {
    invoiceNo: "Invoice\\s*No[:\\s]+(\\S+)",
    invoiceDate: "Date[:\\s]+(\\S+)",
    total: "Total[:\\s]+(\\S+)",
  },
  linePatterns: { row: "^(.+),(.+),(.+),(\\d+),(\\d+\\.\\d+)$" },
  columnMap: { product: 0, batchNo: 1, expiryDate: 2, qty: 3, ratePaise: 4 },
  dateFormat: "DD/MM/YYYY",
};

const PARSED_OK: TemplateTestResult = {
  header: {
    invoiceNo: "INV-555",
    invoiceDate: "2026-04-20",
    totalPaise: 250000,
    supplierHint: "Cipla",
    confidence: 0.95,
  },
  lines: [
    {
      productHint: "Crocin 500",
      batchNo: "BX12345",
      expiryDate: "2027-04-30",
      qty: 100,
      ratePaise: 4200,
      mrpPaise: 5000,
      gstRate: 12,
      confidence: 0.92,
    },
  ],
};

interface HandlerOpts {
  suppliers?: readonly SupplierRow[];
  templates?: readonly SupplierTemplateDTO[];
  upsertResult?: string;
  upsertThrows?: string;
  deleteThrows?: string;
  testResult?: TemplateTestResult;
  testThrows?: string;
  calls?: IpcCall[];
}

function installHandler(opts: HandlerOpts = {}): void {
  const calls = opts.calls ?? [];
  let templates: readonly SupplierTemplateDTO[] = opts.templates ?? [];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    switch (call.cmd) {
      case "list_suppliers":
        return opts.suppliers ?? [];
      case "list_supplier_templates":
        return templates;
      case "upsert_supplier_template": {
        if (opts.upsertThrows) throw new Error(opts.upsertThrows);
        const id = opts.upsertResult ?? "tpl_new";
        const inp = call.args.input as UpsertSupplierTemplateInput;
        const dto: SupplierTemplateDTO = {
          id,
          supplierId: inp.supplierId,
          name: inp.name,
          headerPatterns: inp.headerPatterns,
          linePatterns: inp.linePatterns,
          columnMap: inp.columnMap,
          dateFormat: inp.dateFormat ?? "DD/MM/YYYY",
        };
        templates = [...templates.filter((t) => t.id !== id), dto];
        return id;
      }
      case "delete_supplier_template":
        if (opts.deleteThrows) throw new Error(opts.deleteThrows);
        templates = templates.filter((t) => t.id !== (call.args as { id: string }).id);
        return null;
      case "test_supplier_template":
        if (opts.testThrows) throw new Error(opts.testThrows);
        return opts.testResult ?? PARSED_OK;
      default:
        return null;
    }
  });
}

describe("SupplierTemplateScreen — G08 X1 Tier A template config", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads suppliers + templates on mount and renders the sidebar list", async () => {
    installHandler({ suppliers: [SUP_CIPLA, SUP_GSK], templates: [TPL_CIPLA] });
    render(<SupplierTemplateScreen />);

    await waitFor(() =>
      expect(screen.getByTestId(`tpl-row-${TPL_CIPLA.id}`)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Cipla CSV v1/)).toBeInTheDocument();
    // Supplier filter dropdown carries both suppliers.
    const filter = screen.getByTestId("tpl-supplier-filter") as HTMLSelectElement;
    expect(filter.options.length).toBe(3); // "All suppliers" + 2 suppliers
  });

  it("supplier filter passes supplierId to list_supplier_templates", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, suppliers: [SUP_CIPLA, SUP_GSK], templates: [TPL_CIPLA] });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "list_suppliers")).toBe(true),
    );

    await user.selectOptions(screen.getByTestId("tpl-supplier-filter"), "sup_cipla");

    await waitFor(() => {
      const filtered = calls.filter(
        (c) =>
          c.cmd === "list_supplier_templates" &&
          (c.args as { supplierId?: string }).supplierId === "sup_cipla",
      );
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  it("picking a row hydrates the editor from the DTO (regex + columnMap JSON)", async () => {
    installHandler({ suppliers: [SUP_CIPLA], templates: [TPL_CIPLA] });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await screen.findByTestId(`tpl-row-${TPL_CIPLA.id}`);

    await user.click(screen.getByTestId(`tpl-row-${TPL_CIPLA.id}`));

    expect((screen.getByTestId("tpl-name") as HTMLInputElement).value).toBe("Cipla CSV v1");
    expect((screen.getByTestId("tpl-hdr-invno") as HTMLInputElement).value)
      .toBe("Invoice\\s*No[:\\s]+(\\S+)");
    expect((screen.getByTestId("tpl-line-row") as HTMLTextAreaElement).value)
      .toBe("^(.+),(.+),(.+),(\\d+),(\\d+\\.\\d+)$");

    // columnMap is pretty-printed JSON.
    const colmap = (screen.getByTestId("tpl-colmap") as HTMLTextAreaElement).value;
    const parsed = JSON.parse(colmap);
    expect(parsed).toEqual({ product: 0, batchNo: 1, expiryDate: 2, qty: 3, ratePaise: 4 });
  });

  it("Ctrl+N opens an empty draft with sensible regex defaults", async () => {
    installHandler({ suppliers: [SUP_CIPLA] });
    render(<SupplierTemplateScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("tpl-supplier-filter")).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });

    expect((screen.getByTestId("tpl-name") as HTMLInputElement).value).toBe("");
    // Default regex is non-empty and at least mentions "Invoice".
    expect((screen.getByTestId("tpl-hdr-invno") as HTMLInputElement).value)
      .toMatch(/Invoice/);
    // Default column map JSON parses to an object with `qty` key.
    const colmap = JSON.parse(
      (screen.getByTestId("tpl-colmap") as HTMLTextAreaElement).value,
    );
    expect(colmap.qty).toBeDefined();
  });

  it("Save without a name surfaces 'name required'; no upsert fires", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, suppliers: [SUP_CIPLA] });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("tpl-supplier-filter")).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    // Pick a supplier but leave name blank.
    await user.selectOptions(screen.getByTestId("tpl-supplier"), "sup_cipla");

    await user.click(screen.getByTestId("tpl-save"));

    const err = await screen.findByTestId("tpl-error");
    expect(err.textContent ?? "").toMatch(/name required/);
    expect(calls.some((c) => c.cmd === "upsert_supplier_template")).toBe(false);
  });

  it("Save without a supplier surfaces 'supplier required'; no upsert fires", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, suppliers: [SUP_CIPLA] });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("tpl-supplier-filter")).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    await user.type(screen.getByTestId("tpl-name"), "New tpl");
    // Don't pick a supplier in the form (the editor's supplier defaults to '').
    await user.click(screen.getByTestId("tpl-save"));

    const err = await screen.findByTestId("tpl-error");
    expect(err.textContent ?? "").toMatch(/supplier required/);
    expect(calls.some((c) => c.cmd === "upsert_supplier_template")).toBe(false);
  });

  it("Save with malformed columnMap JSON surfaces parse error; no upsert fires", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, suppliers: [SUP_CIPLA] });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("tpl-supplier-filter")).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    await user.type(screen.getByTestId("tpl-name"), "Broken");
    await user.selectOptions(screen.getByTestId("tpl-supplier"), "sup_cipla");

    const colmap = screen.getByTestId("tpl-colmap") as HTMLTextAreaElement;
    // user-event treats { as a key descriptor; escape as {{ for a literal {
    // (or just drive the change event directly).
    fireEvent.change(colmap, { target: { value: "not json {{{" } });

    await user.click(screen.getByTestId("tpl-save"));

    const err = await screen.findByTestId("tpl-error");
    expect(err.textContent ?? "").toMatch(/column map JSON/);
    expect(calls.some((c) => c.cmd === "upsert_supplier_template")).toBe(false);
  });

  it("Save happy path round-trips the input DTO + reloads the list", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      suppliers: [SUP_CIPLA],
      upsertResult: "tpl_42",
    });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("tpl-supplier-filter")).toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    await user.type(screen.getByTestId("tpl-name"), "Cipla v2");
    await user.selectOptions(screen.getByTestId("tpl-supplier"), "sup_cipla");

    await user.click(screen.getByTestId("tpl-save"));

    await waitFor(() => {
      const upsert = calls.find((c) => c.cmd === "upsert_supplier_template");
      expect(upsert).toBeTruthy();
    });
    const upsert = calls.find((c) => c.cmd === "upsert_supplier_template");
    if (upsert && upsert.cmd === "upsert_supplier_template") {
      const inp = upsert.args.input as UpsertSupplierTemplateInput;
      expect(inp.shopId).toBe(SHOP_ID);
      expect(inp.supplierId).toBe("sup_cipla");
      expect(inp.name).toBe("Cipla v2");
      expect(inp.headerPatterns.invoiceNo).toMatch(/Invoice/);
      // headerPatterns.supplier MUST be omitted when empty (UpsertSupplierTemplateInput
      // builder skips empty supplierKey).
      expect(inp.headerPatterns.supplier).toBeUndefined();
      expect(inp.linePatterns.row.length).toBeGreaterThan(0);
      expect(typeof inp.columnMap).toBe("object");
      expect(inp.dateFormat).toBe("DD/MM/YYYY");
      expect(inp.id).toBeUndefined(); // new template, no id
    }

    // After save, list reload fires and editor shows the new id.
    await waitFor(() => {
      const reloads = calls.filter((c) => c.cmd === "list_supplier_templates");
      // Initial mount + post-save = at least 2.
      expect(reloads.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("Test (Ctrl+T) invokes test_supplier_template + renders header + line rows", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      suppliers: [SUP_CIPLA],
      templates: [TPL_CIPLA],
    });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await screen.findByTestId(`tpl-row-${TPL_CIPLA.id}`);

    await user.click(screen.getByTestId(`tpl-row-${TPL_CIPLA.id}`));
    await user.type(
      screen.getByTestId("tpl-sample"),
      "Invoice No: INV-555\nDate: 20/04/2026\nCrocin 500,BX12345,2027-04-30,100,42.00",
    );

    fireEvent.keyDown(window, { key: "t", ctrlKey: true });

    await screen.findByTestId("tpl-result");
    expect(screen.getByTestId("tpl-result-invno").textContent).toBe("INV-555");
    expect(screen.getByTestId("tpl-result-line-0").textContent ?? "").toMatch(/Crocin 500/);

    const testCall = calls.find((c) => c.cmd === "test_supplier_template");
    expect(testCall).toBeTruthy();
    if (testCall && testCall.cmd === "test_supplier_template") {
      expect(testCall.args.template.id).toBe(TPL_CIPLA.id);
      expect(testCall.args.sampleText).toMatch(/INV-555/);
    }
  });

  it("Test failure surfaces inline; no result table renders", async () => {
    installHandler({
      suppliers: [SUP_CIPLA],
      templates: [TPL_CIPLA],
      testThrows: "regex compile failed: unbalanced ( in lineRow",
    });
    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await screen.findByTestId(`tpl-row-${TPL_CIPLA.id}`);

    await user.click(screen.getByTestId(`tpl-row-${TPL_CIPLA.id}`));
    await user.type(screen.getByTestId("tpl-sample"), "anything");

    fireEvent.keyDown(window, { key: "t", ctrlKey: true });

    const err = await screen.findByTestId("tpl-error");
    expect(err.textContent ?? "").toMatch(/regex compile failed/);
    expect(screen.queryByTestId("tpl-result")).toBeNull();
  });

  it("Delete confirms via window.confirm; cancel keeps row + draft", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      suppliers: [SUP_CIPLA],
      templates: [TPL_CIPLA],
    });
    vi.spyOn(window, "confirm").mockImplementation(() => false);

    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await screen.findByTestId(`tpl-row-${TPL_CIPLA.id}`);
    await user.click(screen.getByTestId(`tpl-row-${TPL_CIPLA.id}`));

    await user.click(screen.getByTestId("tpl-delete"));

    expect(calls.some((c) => c.cmd === "delete_supplier_template")).toBe(false);
    expect(screen.getByTestId(`tpl-row-${TPL_CIPLA.id}`)).toBeInTheDocument();
    // Draft stays populated (still showing the picked template).
    expect((screen.getByTestId("tpl-name") as HTMLInputElement).value).toBe("Cipla CSV v1");
  });

  it("Delete confirms via window.confirm; accept fires delete_supplier_template + clears draft", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      suppliers: [SUP_CIPLA],
      templates: [TPL_CIPLA],
    });
    vi.spyOn(window, "confirm").mockImplementation(() => true);

    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await screen.findByTestId(`tpl-row-${TPL_CIPLA.id}`);
    await user.click(screen.getByTestId(`tpl-row-${TPL_CIPLA.id}`));

    await user.click(screen.getByTestId("tpl-delete"));

    await waitFor(() => {
      const del = calls.find((c) => c.cmd === "delete_supplier_template");
      expect(del).toBeTruthy();
      if (del && del.cmd === "delete_supplier_template") {
        expect(del.args.id).toBe(TPL_CIPLA.id);
      }
    });
    // Editor reset to empty.
    await waitFor(() =>
      expect((screen.getByTestId("tpl-name") as HTMLInputElement).value).toBe(""),
    );
  });

  it("Delete shortcut (Del key) fires delete only when a row is selected", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      suppliers: [SUP_CIPLA],
      templates: [TPL_CIPLA],
    });
    vi.spyOn(window, "confirm").mockImplementation(() => true);

    const user = userEvent.setup();
    render(<SupplierTemplateScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("tpl-supplier-filter")).toBeInTheDocument(),
    );

    // No selection — Del is a no-op.
    fireEvent.keyDown(window, { key: "Delete" });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.cmd === "delete_supplier_template")).toBe(false);

    // Pick → Del → fires.
    await user.click(await screen.findByTestId(`tpl-row-${TPL_CIPLA.id}`));
    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "delete_supplier_template")).toBe(true),
    );
  });
});
