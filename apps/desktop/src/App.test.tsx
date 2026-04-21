import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.js";
import { setIpcHandler, type IpcCall, type ProductHit, type BatchPick, type StockRow } from "./lib/ipc.js";
import { _resetPendingGrnDraftForTests } from "./lib/pendingGrnDraft.js";

const FIXTURES: ProductHit[] = [
  { id: "p1", name: "Crocin 500", genericName: "Paracetamol", manufacturer: "GSK", gstRate: 12, schedule: "OTC", mrpPaise: 11200 },
  { id: "p2", name: "Azithral 500", genericName: "Azithromycin", manufacturer: "Alembic", gstRate: 12, schedule: "H", mrpPaise: 12000 },
];
const BATCH: BatchPick = { id: "b1", batchNo: "LOT-NEAR", expiryDate: "2027-03-31", qtyOnHand: 30, mrpPaise: 11200 };

const STOCK: StockRow[] = [
  { productId: "p1", name: "Crocin 500", genericName: "Paracetamol", manufacturer: "GSK",
    schedule: "OTC", gstRate: 12, mrpPaise: 11200,
    totalQty: 80, batchCount: 2, nearestExpiry: "2027-03-31", daysToExpiry: 350, hasExpiredStock: 20 },
  { productId: "p3", name: "Azithral 500", genericName: "Azithromycin", manufacturer: "Alembic",
    schedule: "H", gstRate: 12, mrpPaise: 12000,
    totalQty: 5, batchCount: 1, nearestExpiry: "2026-06-14", daysToExpiry: 60, hasExpiredStock: 0 },
  { productId: "p2", name: "Dolo 650", genericName: "Paracetamol", manufacturer: "Micro Labs",
    schedule: "OTC", gstRate: 12, mrpPaise: 3000,
    totalQty: 0, batchCount: 0, nearestExpiry: null, daysToExpiry: null, hasExpiredStock: 0 },
];

interface DirCustomer { id: string; name: string; phone: string | null; gstin: string | null; gender: "M" | "F" | "O" | null; consentAbdm: number; consentMarketing: number }
interface DirDoctor { id: string; regNo: string; name: string; phone: string | null }
interface DirRx { id: string; customerId: string; doctorId: string | null; kind: "paper" | "digital" | "abdm"; imagePath: string | null; issuedDate: string; notes: string | null }

function baseHandler(calls?: IpcCall[]) {
  const customers: DirCustomer[] = [
    { id: "c_rakesh", name: "Rakesh Kumar", phone: "9810000001", gstin: null, gender: "M", consentAbdm: 1, consentMarketing: 0 },
    { id: "c_sneha",  name: "Sneha Patel",  phone: "9820000002", gstin: null, gender: "F", consentAbdm: 0, consentMarketing: 1 },
  ];
  const doctors: DirDoctor[] = [
    { id: "d_mehta", regNo: "MH/12345", name: "Dr. Mehta", phone: "9998887770" },
  ];
  const rx: DirRx[] = [
    { id: "rx_1", customerId: "c_rakesh", doctorId: "d_mehta", kind: "paper", imagePath: null, issuedDate: "2026-03-01", notes: "Crocin x5" },
  ];
  let rxSeq = 2;
  let custSeq = 3;
  let docSeq = 2;

  const suppliers = [
    { id: "sup_gsk", name: "GSK", gstin: "27AAACG1570E1ZZ" },
    { id: "sup_cipla", name: "Cipla", gstin: "27AAACC9462C1ZS" },
  ];
  const templates: any[] = [
    {
      id: "stpl_seed", supplierId: "sup_gsk", name: "GSK v1",
      headerPatterns: { invoiceNo: "Inv\\s*(\\S+)", invoiceDate: "Date\\s*(\\S+)", total: "Total\\s*(\\S+)" },
      linePatterns: { row: "^(\\S+)\\s+(\\d+)$" },
      columnMap: { product: 0, qty: 1 },
      dateFormat: "DD/MM/YYYY",
    },
  ];
  let tplSeq = 2;
  let gmailState: { connected: boolean; email: string | null } = { connected: false, email: null };

  return async (call: IpcCall) => {
    calls?.push(call);
    if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
    if (call.cmd === "db_version") return 2;
    if (call.cmd === "search_products") {
      const q = call.args.q.toLowerCase();
      return FIXTURES.filter((f) =>
        f.name.toLowerCase().includes(q) ||
        (f.genericName?.toLowerCase().includes(q) ?? false),
      );
    }
    if (call.cmd === "pick_fefo_batch") return BATCH;
    if (call.cmd === "save_bill") return { billId: "bill_stub", grandTotalPaise: 11200, linesInserted: 1 };
    if (call.cmd === "day_book") {
      return {
        date: call.args.date,
        rows: [
          { billId: "b1", billNo: "B-1", billedAt: `${call.args.date}T09:00:00.000Z`,
            paymentMode: "cash", grandTotalPaise: 11200, cgstPaise: 600, sgstPaise: 600, igstPaise: 0, isVoided: 0 },
          { billId: "b2", billNo: "B-2", billedAt: `${call.args.date}T14:30:00.000Z`,
            paymentMode: "upi", grandTotalPaise: 5300, cgstPaise: 125, sgstPaise: 125, igstPaise: 0, isVoided: 0 },
        ],
        summary: { billCount: 2, grossPaise: 16500, cgstPaise: 725, sgstPaise: 725, igstPaise: 0,
                   byPayment: { cash: 11200, upi: 5300 } },
      };
    }
    if (call.cmd === "gstr1_summary") {
      return [
        { gstRate: 5, taxableValuePaise: 5000, cgstPaise: 125, sgstPaise: 125, igstPaise: 0, lineCount: 1 },
        { gstRate: 12, taxableValuePaise: 20000, cgstPaise: 600, sgstPaise: 600, igstPaise: 1200, lineCount: 2 },
      ];
    }
    if (call.cmd === "top_movers") {
      return [
        { productId: "p_otc", name: "Crocin 500", qtySold: 2, revenuePaise: 22400, billCount: 2 },
        { productId: "p_5",   name: "Low-GST", qtySold: 1, revenuePaise: 5300, billCount: 1 },
      ];
    }
    if (call.cmd === "save_grn") {
      return { grnId: call.args.grnId, linesInserted: call.args.input.lines.length, batchIds: ["b_stub_001"] };
    }
    if (call.cmd === "search_customers") {
      const q = call.args.q.toLowerCase();
      const hits = q ? customers.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone?.includes(q) ?? false) ||
        (c.gstin?.toLowerCase().includes(q) ?? false),
      ) : customers;
      return hits.slice(0, call.args.limit);
    }
    if (call.cmd === "upsert_customer") {
      const input = call.args.input;
      if (input.id) {
        const idx = customers.findIndex((c) => c.id === input.id);
        if (idx >= 0) {
          customers[idx] = {
            id: input.id,
            name: input.name,
            phone: input.phone ?? null,
            gstin: input.gstin ?? null,
            gender: input.gender ?? null,
            consentAbdm: input.consentAbdm ? 1 : 0,
            consentMarketing: input.consentMarketing ? 1 : 0,
          };
          return input.id;
        }
      }
      const id = `c_new${custSeq++}`;
      customers.push({
        id,
        name: input.name,
        phone: input.phone ?? null,
        gstin: input.gstin ?? null,
        gender: input.gender ?? null,
        consentAbdm: input.consentAbdm ? 1 : 0,
        consentMarketing: input.consentMarketing ? 1 : 0,
      });
      return id;
    }
    if (call.cmd === "search_doctors") {
      const q = call.args.q.toLowerCase();
      const hits = q ? doctors.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        d.regNo.toLowerCase().includes(q) ||
        (d.phone?.includes(q) ?? false),
      ) : doctors;
      return hits.slice(0, call.args.limit);
    }
    if (call.cmd === "upsert_doctor") {
      const input = call.args.input;
      const id = input.id ?? `d_new${docSeq++}`;
      const existing = doctors.findIndex((d) => d.id === id);
      const rec: DirDoctor = { id, regNo: input.regNo, name: input.name, phone: input.phone ?? null };
      if (existing >= 0) doctors[existing] = rec; else doctors.push(rec);
      return id;
    }
    if (call.cmd === "create_prescription") {
      const input = call.args.input;
      const id = `rx_${rxSeq++}`;
      rx.push({
        id, customerId: input.customerId, doctorId: input.doctorId ?? null,
        kind: input.kind, imagePath: input.imagePath ?? null,
        issuedDate: input.issuedDate, notes: input.notes ?? null,
      });
      return id;
    }
    if (call.cmd === "list_prescriptions") {
      return rx.filter((r) => r.customerId === call.args.customerId);
    }
    if (call.cmd === "list_stock") {
      const q = call.args.opts?.q?.toLowerCase();
      return q ? STOCK.filter((r) => r.name.toLowerCase().includes(q) || r.genericName?.toLowerCase().includes(q)) : STOCK;
    }
    if (call.cmd === "list_suppliers") {
      return suppliers;
    }
    if (call.cmd === "list_supplier_templates") {
      const { shopId: _shopId, supplierId } = call.args as any;
      return supplierId ? templates.filter((t) => t.supplierId === supplierId) : templates;
    }
    if (call.cmd === "upsert_supplier_template") {
      const input = call.args.input as any;
      const id = input.id ?? `stpl_new${tplSeq++}`;
      const rec = {
        id, supplierId: input.supplierId, name: input.name,
        headerPatterns: input.headerPatterns, linePatterns: input.linePatterns,
        columnMap: input.columnMap, dateFormat: input.dateFormat ?? "DD/MM/YYYY",
      };
      const idx = templates.findIndex((t) => t.id === id);
      if (idx >= 0) templates[idx] = rec; else templates.push(rec);
      return id;
    }
    if (call.cmd === "delete_supplier_template") {
      const { id } = call.args as any;
      const i = templates.findIndex((t) => t.id === id);
      if (i >= 0) templates.splice(i, 1);
      return null;
    }
    if (call.cmd === "test_supplier_template") {
      const { sampleText } = call.args as any;
      return {
        header: {
          invoiceNo: sampleText.includes("Inv") ? "INV-42" : null,
          invoiceDate: sampleText.includes("Date") ? "2026-04-01" : null,
          totalPaise: 1200,
          supplierHint: null,
          confidence: 0.67,
        },
        lines: [{ productHint: "Crocin", batchNo: null, expiryDate: null, qty: 10, ratePaise: 5000, mrpPaise: null, gstRate: null, confidence: 0.4 }],
      };
    }
    if (call.cmd === "gmail_status") {
      return {
        connected: gmailState.connected,
        accountEmail: gmailState.email,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        grantedAt: gmailState.connected ? "2026-04-15T00:00:00.000Z" : null,
      };
    }
    if (call.cmd === "gmail_connect") {
      gmailState = { connected: true, email: "owner@example.com" };
      return { connected: true, accountEmail: "owner@example.com", scopes: ["https://www.googleapis.com/auth/gmail.readonly"], grantedAt: "2026-04-15T00:00:00.000Z" };
    }
    if (call.cmd === "gmail_disconnect") {
      gmailState = { connected: false, email: null };
      return null;
    }
    if (call.cmd === "gmail_list_messages") {
      if (!gmailState.connected) throw new Error("not connected");
      return [
        {
          id: "mid_1", threadId: "tid_1",
          from: "Cipla Invoicing <bills@cipla.com>",
          subject: "Invoice Inv-101 Date 01/04/2026",
          date: "Wed, 01 Apr 2026 10:00:00 +0530",
          snippet: "Invoice attached",
          attachments: [
            { attachmentId: "att_a", filename: "bill.csv", mimeType: "text/csv", size: 128 },
          ],
        },
        {
          id: "mid_2", threadId: "tid_2",
          from: "GSK <noreply@gsk.com>",
          subject: "April statement",
          date: "Mon, 06 Apr 2026 11:00:00 +0530",
          snippet: "no attachments",
          attachments: [],
        },
      ];
    }
    if (call.cmd === "gmail_fetch_attachment") {
      return {
        path: `/tmp/pharmacare-gmail/${call.args.messageId}-${call.args.filename}`,
        size: 26,
        mimeType: call.args.mimeType,
        filename: call.args.filename,
        text: "Inv CIPLA-101 Date 01/04/2026",
      };
    }
    return null;
  };
}

function installMock() { setIpcHandler(baseHandler()); _resetPendingGrnDraftForTests(); }

describe("App · keyboard shell", () => {
  beforeEach(() => installMock());

  it("health ping populates footer on boot", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId("health").textContent).toMatch(/backend v0\.1\.0 · db@2/),
    );
  });

  it("F2 switches to inventory, F1 returns", async () => {
    render(<App />);
    // Wait for the App-mount healthCheck+dbVersion RPCs and BillingScreen's
    // userGet RPC to settle before driving keyboard nav, otherwise the
    // trailing setState lands outside act().
    await waitFor(() =>
      expect(screen.getByTestId("health").textContent).toMatch(/backend v/),
    );
    fireEvent.keyDown(window, { key: "2", altKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("inventory");
    fireEvent.keyDown(window, { key: "1", altKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("billing");
    // Inventory mount triggers listStockRpc; flush its trailing setState.
    await act(async () => {});
  });
});

describe("BillingScreen · product search → line add", () => {
  beforeEach(() => installMock());

  it("empty state until a product is picked", async () => {
    render(<App />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("grand-total").textContent).toMatch(/0\.00/);
    // Flush the mount-time healthCheck/dbVersion + BillingScreen userGet
    // RPCs so their trailing setState updates land inside act().
    await waitFor(() =>
      expect(screen.getByTestId("health").textContent).toMatch(/backend v/),
    );
  });

  it("typing shows dropdown; Enter picks top hit; line is added with batch + MRP", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    expect(screen.getByTestId("search-hit-0").textContent).toMatch(/Crocin 500/);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-batch-0")).toBeInTheDocument());
    expect(screen.getByTestId("line-batch-0").textContent).toMatch(/LOT-NEAR/);
    expect(screen.getByTestId("line-total-0").textContent).toMatch(/112\.00/);
    expect(screen.getByTestId("grand-total").textContent).toMatch(/112\.00/);
  });

  it("ArrowDown then Enter picks the second hit", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "500");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-batch-0")).toBeInTheDocument());
    const row = screen.getByTestId("line-batch-0").closest("tr")!;
    expect(row.textContent).toMatch(/Azithral 500/);
    expect(row.textContent).toMatch(/H/);
  });

  it("changing qty recomputes grand total", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-qty-0")).toBeInTheDocument());
    const qty = screen.getByTestId("line-qty-0") as HTMLInputElement;
    await user.clear(qty);
    await user.type(qty, "3");
    expect(screen.getByTestId("grand-total").textContent).toMatch(/336\.00/);
  });

  it("Save & Print button is disabled while bill is empty", async () => {
    render(<App />);
    const btn = screen.getByTestId("save-bill") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Flush the mount-time healthCheck/dbVersion + BillingScreen userGet
    // RPCs so their trailing setState updates land inside act().
    await waitFor(() =>
      expect(screen.getByTestId("health").textContent).toMatch(/backend v/),
    );
  });

  it("F10 saves the bill, shows success toast, and clears lines", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(baseHandler(calls));
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-batch-0")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() => expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"));
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    const saved = calls.find((c) => c.cmd === "save_bill");
    expect(saved).toBeDefined();
    const args = (saved as Extract<IpcCall, { cmd: "save_bill" }>).args;
    expect(args.input.lines).toHaveLength(1);
    expect(args.input.lines[0]?.batchId).toBe("b1");
    expect(args.input.shopId).toBe("shop_vaidyanath_kalyan");
    expect(args.input.paymentMode).toBe("cash");
  });

  it("save failure surfaces an error toast and keeps lines", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
      if (call.cmd === "db_version") return 2;
      if (call.cmd === "search_products") {
        const q = call.args.q.toLowerCase();
        return FIXTURES.filter((f) => f.name.toLowerCase().includes(q));
      }
      if (call.cmd === "pick_fefo_batch") return BATCH;
      if (call.cmd === "save_bill") throw new Error("expired batch blocked");
      return null;
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-batch-0")).toBeInTheDocument());
    await user.click(screen.getByTestId("save-bill"));
    await waitFor(() => expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "err"));
    expect(screen.getByTestId("toast").textContent).toMatch(/expired batch blocked/);
    expect(screen.getByTestId("line-batch-0")).toBeInTheDocument();
  });

  it("remove line returns to empty state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-remove-0")).toBeInTheDocument());
    await user.click(screen.getByTestId("line-remove-0"));
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });
});

describe("InventoryScreen", () => {
  beforeEach(() => installMock());

  it("renders rows with FEFO expiry and schedule badges", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "2", altKey: true });
    await waitFor(() => expect(screen.getByTestId("inv-row-p1")).toBeInTheDocument());
    expect(screen.getByTestId("inv-expiry-p1").textContent).toMatch(/2027-03-31/);
    expect(screen.getByTestId("inv-qty-p1").textContent).toBe("80");
    expect(screen.getByTestId("inv-row-p3").textContent).toMatch(/H/);
  });

  it("flags low stock, near-expiry, out-of-stock, expired-on-shelf", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "2", altKey: true });
    await waitFor(() => expect(screen.getByTestId("inv-flags-p3")).toBeInTheDocument());
    expect(screen.getByTestId("inv-flags-p3").textContent).toMatch(/LOW/);
    expect(screen.getByTestId("inv-flags-p1").textContent).toMatch(/EXPIRED/);
    expect(screen.getByTestId("inv-flags-p2").textContent).toMatch(/OUT/);
  });

  it("Near-expiry filter narrows the list", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "2", altKey: true });
    await waitFor(() => expect(screen.getByTestId("inv-row-p1")).toBeInTheDocument());
    await user.click(screen.getByTestId("inv-filter-near"));
    expect(screen.getByTestId("inv-row-p3")).toBeInTheDocument();
    expect(screen.queryByTestId("inv-row-p1")).toBeNull();
    expect(screen.queryByTestId("inv-row-p2")).toBeNull();
  });

  it("search filter passes q through IPC", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "2", altKey: true });
    await waitFor(() => expect(screen.getByTestId("inv-row-p1")).toBeInTheDocument());
    await user.type(screen.getByTestId("inv-search"), "azith");
    await waitFor(() => {
      expect(screen.queryByTestId("inv-row-p1")).toBeNull();
      expect(screen.getByTestId("inv-row-p3")).toBeInTheDocument();
    });
  });
});

describe("GrnScreen · receive stock", () => {
  beforeEach(() => installMock());

  it("F4 switches to GRN mode", async () => {
    render(<App />);
    // Wait for the App-mount healthCheck+dbVersion + BillingScreen userGet
    // RPCs to settle before driving keyboard nav.
    await waitFor(() =>
      expect(screen.getByTestId("health").textContent).toMatch(/backend v/),
    );
    fireEvent.keyDown(window, { key: "4", altKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("grn");
    expect(screen.getByTestId("grn-empty")).toBeInTheDocument();
    // GrnScreen mount triggers listSuppliersRpc + pendingGrnDraft import;
    // flush their trailing setState updates inside act().
    await act(async () => {});
  });

  it("Save is disabled until invoice no + line + batch + dates are valid", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "4", altKey: true });
    const btn = screen.getByTestId("save-grn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    await user.type(screen.getByTestId("grn-invoice-no"), "GSK/001");
    await user.type(screen.getByTestId("grn-product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("grn-row-0")).toBeInTheDocument());
    expect(btn.disabled).toBe(true); // still missing batch/dates

    await user.type(screen.getByTestId("grn-batch-0"), "CRN-NEW");
    fireEvent.change(screen.getByTestId("grn-mfg-0"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByTestId("grn-expiry-0"), { target: { value: "2028-03-31" } });
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it("F9 saves GRN, shows ok toast, and clears lines", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(baseHandler(calls));
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "4", altKey: true });

    await user.type(screen.getByTestId("grn-invoice-no"), "GSK/042");
    await user.type(screen.getByTestId("grn-product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("grn-row-0")).toBeInTheDocument());
    await user.type(screen.getByTestId("grn-batch-0"), "CRN-NEW");
    fireEvent.change(screen.getByTestId("grn-mfg-0"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByTestId("grn-expiry-0"), { target: { value: "2028-03-31" } });

    fireEvent.keyDown(window, { key: "F9" });
    await waitFor(() =>
      expect(screen.getByTestId("grn-toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    expect(screen.getByTestId("grn-empty")).toBeInTheDocument();

    const saved = calls.find((c) => c.cmd === "save_grn");
    expect(saved).toBeDefined();
    const args = (saved as Extract<IpcCall, { cmd: "save_grn" }>).args;
    expect(args.input.lines).toHaveLength(1);
    expect(args.input.lines[0]?.batchNo).toBe("CRN-NEW");
    expect(args.input.lines[0]?.mfgDate).toBe("2026-04-01");
    expect(args.input.supplierId).toBe("sup_gsk");
    expect(args.input.invoiceNo).toBe("GSK/042");
  });

  it("save failure surfaces err toast and keeps lines", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
      if (call.cmd === "db_version") return 2;
      if (call.cmd === "search_products") {
        const q = call.args.q.toLowerCase();
        return FIXTURES.filter((f) => f.name.toLowerCase().includes(q));
      }
      if (call.cmd === "list_suppliers") return [{ id: "sup_gsk", name: "GSK Pharma" }];
      if (call.cmd === "save_grn") throw new Error("UNIQUE constraint failed: batches.product_id, batches.batch_no");
      return null;
    });
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "4", altKey: true });
    await user.type(screen.getByTestId("grn-invoice-no"), "GSK/DUP");
    await user.type(screen.getByTestId("grn-product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("grn-row-0")).toBeInTheDocument());
    await user.type(screen.getByTestId("grn-batch-0"), "CRN2510");
    fireEvent.change(screen.getByTestId("grn-mfg-0"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByTestId("grn-expiry-0"), { target: { value: "2028-03-31" } });
    // Wait for save-grn to enable — list_suppliers is async, and on slower
    // runners (CI) the supplier select may still be empty at click time,
    // leaving the button disabled and the click a no-op.
    const btn = screen.getByTestId("save-grn") as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);
    await waitFor(() =>
      expect(screen.getByTestId("grn-toast")).toHaveAttribute("data-toast-kind", "err"),
    );
    expect(screen.getByTestId("grn-row-0")).toBeInTheDocument();
  });
});

describe("ReportsScreen · F3", () => {
  beforeEach(() => installMock());

  it("F3 lands on day-book with summary + rows", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "3", altKey: true });
    await waitFor(() => expect(screen.getByTestId("rpt-daybook-summary")).toBeInTheDocument());
    expect(screen.getByTestId("rpt-daybook-summary").textContent).toMatch(/Bills:\s*2/);
    expect(screen.getByTestId("rpt-daybook-row-b1")).toBeInTheDocument();
    expect(screen.getByTestId("rpt-daybook-row-b2")).toBeInTheDocument();
  });

  it("switching to GSTR-1 tab loads buckets", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "3", altKey: true });
    await waitFor(() => expect(screen.getByTestId("rpt-daybook-summary")).toBeInTheDocument());
    await user.click(screen.getByTestId("rpt-tab-gstr1"));
    await waitFor(() => expect(screen.getByTestId("rpt-gstr-row-5")).toBeInTheDocument());
    expect(screen.getByTestId("rpt-gstr-row-12").textContent).toMatch(/200\.00/);
  });

  it("top movers tab ranks by revenue", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "3", altKey: true });
    await waitFor(() => expect(screen.getByTestId("rpt-daybook-summary")).toBeInTheDocument());
    await user.click(screen.getByTestId("rpt-tab-movers"));
    await waitFor(() => expect(screen.getByTestId("rpt-mov-row-p_otc")).toBeInTheDocument());
    const rows = screen.getAllByTestId(/rpt-mov-row-/);
    expect(rows[0]?.textContent).toMatch(/Crocin 500/);
  });
});

describe("DirectoryScreen \u00B7 F5", () => {
  beforeEach(() => installMock());

  it("F5 opens directory with customers tab and seeded list", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "5", altKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("directory");
    await waitFor(() => expect(screen.getByTestId("dir-cust-c_rakesh")).toBeInTheDocument());
    expect(screen.getByTestId("dir-cust-c_sneha")).toBeInTheDocument();
  });

  it("search filters customers by name", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "5", altKey: true });
    await waitFor(() => expect(screen.getByTestId("dir-cust-c_rakesh")).toBeInTheDocument());
    await user.type(screen.getByTestId("dir-search"), "sneha");
    await waitFor(() => expect(screen.queryByTestId("dir-cust-c_rakesh")).not.toBeInTheDocument());
    expect(screen.getByTestId("dir-cust-c_sneha")).toBeInTheDocument();
  });

  it("new customer save captures DPDP consent and reloads list", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(baseHandler(calls));
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "5", altKey: true });
    await waitFor(() => expect(screen.getByTestId("dir-cust-c_rakesh")).toBeInTheDocument());
    await user.click(screen.getByTestId("dir-new-customer"));
    await user.type(screen.getByTestId("cust-name"), "Vikas Shah");
    await user.type(screen.getByTestId("cust-phone"), "9876543210");
    await user.click(screen.getByTestId("cust-consent-abdm"));
    await waitFor(() => expect(screen.getByTestId("cust-consent-method")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("cust-consent-method"), { target: { value: "signed" } });
    await user.click(screen.getByTestId("cust-save"));
    await waitFor(() =>
      expect(screen.getByTestId("dir-toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    const upsert = calls.find((c) => c.cmd === "upsert_customer");
    expect(upsert).toBeDefined();
    const input = (upsert as Extract<IpcCall, { cmd: "upsert_customer" }>).args.input;
    expect(input.name).toBe("Vikas Shah");
    expect(input.consentAbdm).toBe(true);
    expect(input.consentMethod).toBe("signed");
  });

  it("opening a customer loads Rx list and adding Rx appends a row", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "5", altKey: true });
    await waitFor(() => expect(screen.getByTestId("dir-cust-c_rakesh")).toBeInTheDocument());
    await user.click(screen.getByTestId("dir-cust-c_rakesh"));
    await waitFor(() => expect(screen.getByTestId("rx-row-rx_1")).toBeInTheDocument());
    await user.type(screen.getByTestId("rx-notes"), "Azithral 5-day course");
    await user.click(screen.getByTestId("rx-add"));
    await waitFor(() => expect(screen.getByTestId("rx-row-rx_2")).toBeInTheDocument());
    expect(screen.getByTestId("rx-row-rx_2").textContent).toMatch(/Azithral/);
  });

  it("doctors tab adds a new doctor via form", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(baseHandler(calls));
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "5", altKey: true });
    await user.click(screen.getByTestId("dir-tab-doctors"));
    await waitFor(() => expect(screen.getByTestId("dir-doc-d_mehta")).toBeInTheDocument());
    await user.type(screen.getByTestId("doc-reg"), "MH/99999");
    await user.type(screen.getByTestId("doc-name"), "Dr. Kapoor");
    await user.type(screen.getByTestId("doc-phone"), "9000000000");
    await user.click(screen.getByTestId("doc-save"));
    await waitFor(() =>
      expect(screen.getByTestId("dir-toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    const upsert = calls.find((c) => c.cmd === "upsert_doctor");
    expect(upsert).toBeDefined();
    const input = (upsert as Extract<IpcCall, { cmd: "upsert_doctor" }>).args.input;
    expect(input.regNo).toBe("MH/99999");
    expect(input.name).toBe("Dr. Kapoor");
  });
});

describe("BillingScreen \u00B7 Rx attach for Schedule-H", () => {
  beforeEach(() => installMock());

  it("adding Schedule-H product shows Rx banner and disables save", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "azit");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-batch-0")).toBeInTheDocument());
    expect(screen.getByTestId("rx-required-banner")).toBeInTheDocument();
    expect(screen.getByTestId("save-bill")).toBeDisabled();
  });

  it("picking customer + existing Rx enables save and submits with ids", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(baseHandler(calls));
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "azit");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("rx-required-banner")).toBeInTheDocument());
    await user.type(screen.getByTestId("cust-search"), "rakesh");
    await waitFor(() => expect(screen.getByTestId("cust-hit-c_rakesh")).toBeInTheDocument());
    await user.click(screen.getByTestId("cust-hit-c_rakesh"));
    await waitFor(() => expect(screen.getByTestId("rx-pick-rx_1")).toBeInTheDocument());
    await user.click(screen.getByTestId("rx-pick-rx_1").querySelector("input")!);
    await waitFor(() => expect(screen.getByTestId("save-bill")).not.toBeDisabled());
    await user.click(screen.getByTestId("save-bill"));
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    const saved = calls.find((c) => c.cmd === "save_bill");
    expect(saved).toBeDefined();
    const input = (saved as Extract<IpcCall, { cmd: "save_bill" }>).args.input;
    expect(input.customerId).toBe("c_rakesh");
    expect(input.rxId).toBe("rx_1");
  });

  it("inline new Rx capture enables save and auto-selects the new Rx", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(baseHandler(calls));
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByTestId("product-search"), "azit");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("rx-required-banner")).toBeInTheDocument());
    await user.type(screen.getByTestId("cust-search"), "sneha");
    await waitFor(() => expect(screen.getByTestId("cust-hit-c_sneha")).toBeInTheDocument());
    await user.click(screen.getByTestId("cust-hit-c_sneha"));
    await user.click(screen.getByTestId("rx-new-toggle"));
    await user.type(screen.getByTestId("rx-new-doctor-reg"), "MH/55");
    await user.type(screen.getByTestId("rx-new-doctor-name"), "Dr. Gupta");
    await user.type(screen.getByTestId("rx-new-notes"), "Azithral 5d");
    await user.click(screen.getByTestId("rx-new-save"));
    await waitFor(() => expect(screen.getByTestId("save-bill")).not.toBeDisabled());
    await user.click(screen.getByTestId("save-bill"));
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    const saveBill = calls.find((c) => c.cmd === "save_bill");
    const input = (saveBill as Extract<IpcCall, { cmd: "save_bill" }>).args.input;
    expect(input.customerId).toBe("c_sneha");
    expect(input.rxId).toBeTruthy();
    const createdRx = calls.find((c) => c.cmd === "create_prescription");
    expect(createdRx).toBeDefined();
    const upsertDoc = calls.find((c) => c.cmd === "upsert_doctor");
    expect(upsertDoc).toBeDefined();
  });
});

describe("SupplierTemplateScreen · F6", () => {
  beforeEach(() => { installMock(); });

  it("F6 opens templates screen and shows seeded template", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "6", altKey: true });
    await waitFor(() => expect(screen.getByTestId("current-mode")).toHaveTextContent("templates"));
    await waitFor(() => expect(screen.getByTestId("tpl-row-stpl_seed")).toBeInTheDocument());
  });

  it("selecting a template loads the editor", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "6", altKey: true });
    const row = await screen.findByTestId("tpl-row-stpl_seed");
    fireEvent.click(row);
    await waitFor(() => expect((screen.getByTestId("tpl-name") as HTMLInputElement).value).toBe("GSK v1"));
  });

  it("saving a new template calls upsert and refreshes list", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(baseHandler(calls));
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "6", altKey: true });
    await screen.findByTestId("tpl-new");
    await user.click(screen.getByTestId("tpl-new"));
    await user.type(screen.getByTestId("tpl-name"), "Cipla v1");
    fireEvent.change(screen.getByTestId("tpl-supplier"), { target: { value: "sup_cipla" } });
    await user.click(screen.getByTestId("tpl-save"));
    await waitFor(() => expect(calls.some((c) => c.cmd === "upsert_supplier_template")).toBe(true));
  });

  it("test button renders parsed header + lines", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "6", altKey: true });
    const row = await screen.findByTestId("tpl-row-stpl_seed");
    fireEvent.click(row);
    await user.click(screen.getByTestId("tpl-test"));
    await waitFor(() => expect(screen.getByTestId("tpl-result")).toBeInTheDocument());
    expect(screen.getByTestId("tpl-result-invno")).toHaveTextContent("—");
    expect(screen.getByTestId("tpl-result-line-0")).toBeInTheDocument();
  });

  it("filtering by supplier limits the list", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "6", altKey: true });
    const filter = await screen.findByTestId("tpl-supplier-filter");
    fireEvent.change(filter, { target: { value: "sup_cipla" } });
    await waitFor(() => expect(screen.queryByTestId("tpl-row-stpl_seed")).not.toBeInTheDocument());
  });
});

describe("GmailInboxScreen · F7", () => {
  beforeEach(() => { installMock(); });

  it("F7 opens gmail screen showing disconnected state", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "7", altKey: true });
    await waitFor(() => expect(screen.getByTestId("current-mode")).toHaveTextContent("gmail"));
    await waitFor(() => expect(screen.getByTestId("gmail-status-disconnected")).toBeInTheDocument());
    expect(screen.getByTestId("gmail-connect")).toBeInTheDocument();
  });

  it("Connect flips state and shows account email", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "7", altKey: true });
    await user.click(await screen.findByTestId("gmail-connect"));
    await waitFor(() => expect(screen.getByTestId("gmail-status-connected")).toHaveTextContent("owner@example.com"));
  });

  it("Disconnect returns to disconnected state", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "7", altKey: true });
    await user.click(await screen.findByTestId("gmail-connect"));
    await user.click(await screen.findByTestId("gmail-disconnect"));
    await waitFor(() => expect(screen.getByTestId("gmail-status-disconnected")).toBeInTheDocument());
  });

  it("Manual parse uses selected template and renders parsed output", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "7", altKey: true });
    const tpl = await screen.findByTestId("gmail-template");
    await waitFor(() => expect(tpl.querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(tpl, { target: { value: "stpl_seed" } });
    await user.type(screen.getByTestId("gmail-sample"), "Inv XYZ Date 01/04/2026");
    await user.click(screen.getByTestId("gmail-parse"));
    await waitFor(() => expect(screen.getByTestId("gmail-parsed")).toBeInTheDocument());
  });

  it("After connecting, Fetch lists messages and click populates sample text from attachment", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "7", altKey: true });
    await user.click(await screen.findByTestId("gmail-connect"));
    await user.click(await screen.findByTestId("gmail-list"));
    await waitFor(() => expect(screen.getByTestId("gmail-msg-mid_1")).toBeInTheDocument());
    expect(screen.getByTestId("gmail-msg-mid_2")).toBeInTheDocument();
    await user.click(screen.getByTestId("gmail-msg-mid_1"));
    await waitFor(() =>
      expect((screen.getByTestId("gmail-sample") as HTMLTextAreaElement).value).toMatch(/CIPLA-101/),
    );
  });

  it("Send to GRN handoff prefills invoice header and shows imported banner on F4", async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.keyDown(window, { key: "7", altKey: true });
    await user.click(await screen.findByTestId("gmail-connect"));
    await user.click(await screen.findByTestId("gmail-list"));
    await waitFor(() => expect(screen.getByTestId("gmail-msg-mid_1")).toBeInTheDocument());
    await user.click(screen.getByTestId("gmail-msg-mid_1"));
    const tpl = await screen.findByTestId("gmail-template");
    fireEvent.change(tpl, { target: { value: "stpl_seed" } });
    await user.click(screen.getByTestId("gmail-parse"));
    await waitFor(() => expect(screen.getByTestId("gmail-parsed")).toBeInTheDocument());
    await user.click(screen.getByTestId("gmail-send-grn"));
    await waitFor(() => expect(screen.getByTestId("current-mode")).toHaveTextContent("grn"));
    expect(screen.getByTestId("grn-imported-banner")).toBeInTheDocument();
    expect(screen.getByTestId("grn-imported-banner")).toHaveTextContent("Imported from Gmail");
  });
});
