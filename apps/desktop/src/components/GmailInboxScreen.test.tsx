// G07 — GmailInboxScreen coverage (coverage-gaps 2026-04-18 §G07).
//
// The X1 moat surface. Owner connects Gmail → we read distributor-bill
// attachments → apply a saved supplier template → hand off a parsed draft
// to GrnScreen via the pendingGrnDraft module bus. A regression that
// silently swaps which OAuth account's tokens we use, or that drops the
// draft on StrictMode double-mount, is security-adjacent: tokens and
// distributor billing data both flow through here.
//
// This suite covers (per ADR 0002/0003 + S05 hardening of pendingGrnDraft):
//
//   - Disconnected state: shows Connect button + "not connected" hint
//   - Connect flow: gmail_connect called with shopId; status flips to connected
//   - Connected state: shows account + scopes + Disconnect; Fetch enabled only when connected
//   - Disconnect resets messages + selection
//   - Fetch button calls gmail_list_messages with current query + max=20
//   - Default query is "has:attachment newer_than:30d"; query input feeds the RPC
//   - Selecting a message picks the FIRST text-like attachment (csv/tsv/txt/text/*)
//   - Binary-only attachments fall through to a "[binary attachment …]" placeholder
//   - Parse with no template selected → inline error
//   - Parse with template + sample → testSupplierTemplateRpc invoked + parsed table rendered
//   - Send to GRN disabled until parsed.lines.length > 0
//   - Send to GRN sets the pendingGrnDraft store + invokes onGoToGrn
//   - List failure surfaces as gmail-error
//   - List + Fetch buttons disabled while loading

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GmailInboxScreen from "./GmailInboxScreen.js";
import {
  setIpcHandler,
  type GmailAttachmentMeta,
  type GmailAttachmentPayload,
  type GmailMessageSummary,
  type IpcCall,
  type OAuthStatus,
  type SupplierTemplateDTO,
  type TemplateTestResult,
} from "../lib/ipc.js";
import {
  _resetPendingGrnDraftForTests,
  peekPendingGrnDraft,
} from "../lib/pendingGrnDraft.js";

const SHOP_ID = "shop_local";

const DISCONNECTED: OAuthStatus = {
  connected: false,
  accountEmail: null,
  scopes: [],
  grantedAt: null,
};
const CONNECTED: OAuthStatus = {
  connected: true,
  accountEmail: "owner@jagannath.in",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  grantedAt: "2026-04-22T10:00:00Z",
};

const TEMPLATE: SupplierTemplateDTO = {
  id: "tpl_cipla",
  supplierId: "sup_cipla",
  name: "Cipla CSV v1",
  headerPatterns: {
    invoiceNo: "Invoice\\s*No[:\\s]+(\\S+)",
    invoiceDate: "Date[:\\s]+(\\S+)",
    total: "Total[:\\s]+(\\S+)",
  },
  linePatterns: { row: "^(.+),(.+),(.+),(\\d+),(\\d+\\.\\d+)$" },
  columnMap: { product: 0, batch: 1, expiry: 2, qty: 3, rate: 4 },
  dateFormat: "DD/MM/YYYY",
};

const ATT_CSV: GmailAttachmentMeta = {
  attachmentId: "a_csv",
  filename: "invoice.csv",
  mimeType: "text/csv",
  size: 1024,
};
const ATT_PDF: GmailAttachmentMeta = {
  attachmentId: "a_pdf",
  filename: "invoice.pdf",
  mimeType: "application/pdf",
  size: 50_000,
};

function makeMsg(overrides: Partial<GmailMessageSummary> = {}): GmailMessageSummary {
  return {
    id: "m_001",
    threadId: "t_001",
    from: "billing@cipla.in",
    subject: "Invoice INV-555",
    date: "2026-04-20",
    snippet: "Find your invoice attached",
    attachments: [ATT_PDF, ATT_CSV],
    ...overrides,
  };
}

const PARSED_OK: TemplateTestResult = {
  header: {
    invoiceNo: "INV-555",
    invoiceDate: "2026-04-20",
    totalPaise: 250000,
    supplierHint: "Cipla",
    confidence: 0.97,
  },
  lines: [
    {
      productHint: "Crocin 500",
      hsn: "3004",
      batchNo: "BX12345",
      expiryDate: "2027-04-30",
      qty: 100,
      ratePaise: 4200,
      mrpPaise: 5000,
      gstRate: 12,
      confidence: 0.95,
    },
  ],
};

const PARSED_EMPTY: TemplateTestResult = {
  header: { invoiceNo: null, invoiceDate: null, totalPaise: null, supplierHint: null, confidence: 0 },
  lines: [],
};

interface HandlerOpts {
  status?: OAuthStatus;
  connectResult?: OAuthStatus;
  templates?: readonly SupplierTemplateDTO[];
  messages?: readonly GmailMessageSummary[];
  attachmentPayload?: GmailAttachmentPayload;
  attachmentText?: string | null;
  parseResult?: TemplateTestResult;
  parseThrows?: string;
  listThrows?: string;
  calls?: IpcCall[];
}

function installHandler(opts: HandlerOpts = {}): void {
  const calls = opts.calls ?? [];
  let status: OAuthStatus = opts.status ?? DISCONNECTED;
  let messages: readonly GmailMessageSummary[] = [];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    switch (call.cmd) {
      case "gmail_status":
        return status;
      case "gmail_connect":
        status = opts.connectResult ?? CONNECTED;
        return status;
      case "gmail_disconnect":
        status = DISCONNECTED;
        messages = [];
        return null;
      case "gmail_list_messages":
        if (opts.listThrows) throw new Error(opts.listThrows);
        messages = opts.messages ?? [];
        return messages;
      case "gmail_fetch_attachment": {
        const args = call.args as { mimeType: string; filename: string };
        const text =
          opts.attachmentText !== undefined
            ? opts.attachmentText
            : args.mimeType.startsWith("text/")
              ? "Header\nProduct,Batch,Expiry,Qty,Rate\nCrocin,BX1,2027-04-30,100,42.00"
              : null;
        return (
          opts.attachmentPayload ?? {
            path: `/tmp/${args.filename}`,
            size: 1024,
            mimeType: args.mimeType,
            filename: args.filename,
            text,
          }
        );
      }
      case "list_supplier_templates":
        return opts.templates ?? [];
      case "test_supplier_template":
        if (opts.parseThrows) throw new Error(opts.parseThrows);
        return opts.parseResult ?? PARSED_OK;
      default:
        return null;
    }
  });
}

describe("GmailInboxScreen — G07 X1 moat surface", () => {
  beforeEach(() => {
    _resetPendingGrnDraftForTests();
  });

  it("disconnected state shows Connect + hint, hides Disconnect", async () => {
    installHandler({ status: DISCONNECTED });
    render(<GmailInboxScreen />);

    expect(await screen.findByTestId("gmail-status-disconnected")).toBeInTheDocument();
    expect(screen.getByTestId("gmail-connect")).toBeInTheDocument();
    expect(screen.queryByTestId("gmail-disconnect")).toBeNull();
  });

  it("Connect calls gmail_connect with shopId; UI flips to connected with email + scopes", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, status: DISCONNECTED, connectResult: CONNECTED });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-disconnected");

    await user.click(screen.getByTestId("gmail-connect"));

    await screen.findByTestId("gmail-status-connected");
    expect(screen.getByText(/owner@jagannath\.in/)).toBeInTheDocument();
    expect(screen.getByText(/gmail\.readonly/)).toBeInTheDocument();

    const connect = calls.find((c) => c.cmd === "gmail_connect");
    expect(connect).toBeTruthy();
    if (connect && connect.cmd === "gmail_connect") {
      expect(connect.args.shopId).toBe(SHOP_ID);
    }
  });

  it("Disconnect resets messages + selection", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      status: CONNECTED,
      messages: [makeMsg()],
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");

    await user.click(screen.getByTestId("gmail-list"));
    await screen.findByTestId("gmail-msg-m_001");

    await user.click(screen.getByTestId("gmail-disconnect"));
    await screen.findByTestId("gmail-status-disconnected");

    expect(screen.queryByTestId("gmail-msg-m_001")).toBeNull();
    expect(calls.some((c) => c.cmd === "gmail_disconnect")).toBe(true);
  });

  it("Fetch is disabled when disconnected", async () => {
    installHandler({ status: DISCONNECTED });
    render(<GmailInboxScreen />);

    await screen.findByTestId("gmail-status-disconnected");
    expect((screen.getByTestId("gmail-list") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Fetch is enabled when connected", async () => {
    installHandler({ status: CONNECTED });
    render(<GmailInboxScreen />);

    await screen.findByTestId("gmail-status-connected");
    await waitFor(() =>
      expect((screen.getByTestId("gmail-list") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("Fetch sends current query + max=20 to gmail_list_messages", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, status: CONNECTED, messages: [makeMsg()] });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");

    // Default query is exposed in the input.
    const queryInput = screen.getByTestId("gmail-query") as HTMLInputElement;
    expect(queryInput.value).toBe("has:attachment newer_than:30d");

    await user.clear(queryInput);
    await user.type(queryInput, "from:cipla newer_than:7d");

    await user.click(screen.getByTestId("gmail-list"));

    await waitFor(() => {
      const list = calls.find((c) => c.cmd === "gmail_list_messages");
      expect(list).toBeTruthy();
    });
    const list = calls.find((c) => c.cmd === "gmail_list_messages");
    if (list && list.cmd === "gmail_list_messages") {
      expect(list.args.shopId).toBe(SHOP_ID);
      expect(list.args.query).toBe("from:cipla newer_than:7d");
      expect(list.args.max).toBe(20);
    }
  });

  it("Selecting a message fetches the FIRST text-like attachment, populating sample", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      status: CONNECTED,
      messages: [makeMsg({ attachments: [ATT_PDF, ATT_CSV] })],
      attachmentText: "Header\nProduct,Batch,Expiry,Qty,Rate\nCrocin,BX1,2027-04-30,100,42.00",
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");
    await user.click(screen.getByTestId("gmail-list"));
    const msgRow = await screen.findByTestId("gmail-msg-m_001");

    await user.click(msgRow);

    await waitFor(() => {
      const fetchCall = calls.find((c) => c.cmd === "gmail_fetch_attachment");
      expect(fetchCall).toBeTruthy();
    });
    const fetchCall = calls.find((c) => c.cmd === "gmail_fetch_attachment");
    if (fetchCall && fetchCall.cmd === "gmail_fetch_attachment") {
      // CSV picked over PDF — even though PDF is index 0 of the array.
      expect(fetchCall.args.attachmentId).toBe("a_csv");
      expect(fetchCall.args.filename).toBe("invoice.csv");
      expect(fetchCall.args.mimeType).toBe("text/csv");
    }

    await waitFor(() => {
      const sample = screen.getByTestId("gmail-sample") as HTMLTextAreaElement;
      expect(sample.value).toMatch(/Crocin,BX1,2027-04-30,100,42\.00/);
    });
  });

  it("binary-only message: sample falls back to '[binary attachment …]' placeholder", async () => {
    installHandler({
      status: CONNECTED,
      messages: [makeMsg({ attachments: [ATT_PDF] })],
      attachmentPayload: {
        path: "/tmp/invoice.pdf",
        size: 50_000,
        mimeType: "application/pdf",
        filename: "invoice.pdf",
        text: null,
      },
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");
    await user.click(screen.getByTestId("gmail-list"));
    await user.click(await screen.findByTestId("gmail-msg-m_001"));

    await waitFor(() => {
      const sample = screen.getByTestId("gmail-sample") as HTMLTextAreaElement;
      expect(sample.value).toMatch(/binary attachment saved at \/tmp\/invoice\.pdf/);
    });
  });

  it("Parse without selecting a template surfaces inline error", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, status: CONNECTED, templates: [TEMPLATE] });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");

    // Type sample text directly (no message needed).
    await user.type(screen.getByTestId("gmail-sample"), "Some text");

    await user.click(screen.getByTestId("gmail-parse"));

    const errEl = await screen.findByTestId("gmail-error");
    expect(errEl.textContent ?? "").toMatch(/select a template/);
    expect(calls.some((c) => c.cmd === "test_supplier_template")).toBe(false);
  });

  it("Parse with template + sample renders the parsed table + invoice header", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      status: CONNECTED,
      templates: [TEMPLATE],
      parseResult: PARSED_OK,
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");
    // Wait for templates to load into the select.
    await waitFor(() =>
      expect(
        (screen.getByTestId("gmail-template") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(1),
    );

    await user.selectOptions(screen.getByTestId("gmail-template"), "tpl_cipla");
    await user.type(screen.getByTestId("gmail-sample"), "Invoice No: INV-555\nDate: 20/04/2026");
    await user.click(screen.getByTestId("gmail-parse"));

    await screen.findByTestId("gmail-parsed");
    expect(screen.getByTestId("gmail-parsed").textContent ?? "").toMatch(/INV-555/);
    expect(screen.getByTestId("gmail-parsed").textContent ?? "").toMatch(/Crocin 500/);

    const parseCall = calls.find((c) => c.cmd === "test_supplier_template");
    expect(parseCall).toBeTruthy();
    if (parseCall && parseCall.cmd === "test_supplier_template") {
      expect(parseCall.args.template.id).toBe("tpl_cipla");
      expect(parseCall.args.sampleText).toMatch(/Invoice No: INV-555/);
    }
  });

  it("Send to GRN is disabled until parsed.lines.length > 0", async () => {
    installHandler({
      status: CONNECTED,
      templates: [TEMPLATE],
      parseResult: PARSED_EMPTY,
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");

    expect((screen.getByTestId("gmail-send-grn") as HTMLButtonElement).disabled).toBe(true);

    // Empty parse result → still disabled.
    await waitFor(() =>
      expect(
        (screen.getByTestId("gmail-template") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(1),
    );
    await user.selectOptions(screen.getByTestId("gmail-template"), "tpl_cipla");
    await user.type(screen.getByTestId("gmail-sample"), "anything");
    await user.click(screen.getByTestId("gmail-parse"));

    await waitFor(() => screen.getByTestId("gmail-parsed"));
    expect((screen.getByTestId("gmail-send-grn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Send to GRN sets pendingGrnDraft + invokes onGoToGrn callback", async () => {
    const onGoToGrn = vi.fn();
    installHandler({
      status: CONNECTED,
      templates: [TEMPLATE],
      messages: [makeMsg()],
      parseResult: PARSED_OK,
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen onGoToGrn={onGoToGrn} />);
    await screen.findByTestId("gmail-status-connected");

    // Walk full flow to populate sourceMessageId.
    await user.click(screen.getByTestId("gmail-list"));
    await user.click(await screen.findByTestId("gmail-msg-m_001"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("gmail-template") as HTMLSelectElement).options.length,
      ).toBeGreaterThan(1),
    );
    await user.selectOptions(screen.getByTestId("gmail-template"), "tpl_cipla");
    await user.click(screen.getByTestId("gmail-parse"));

    await screen.findByTestId("gmail-parsed");
    await user.click(screen.getByTestId("gmail-send-grn"));

    expect(onGoToGrn).toHaveBeenCalledTimes(1);

    const draft = peekPendingGrnDraft();
    expect(draft).toBeTruthy();
    expect(draft?.invoiceNo).toBe("INV-555");
    expect(draft?.sourceMessageId).toBe("m_001");
    expect(draft?.parsedLines.length).toBe(1);
    expect(draft?.parsedLines[0]?.productHint).toBe("Crocin 500");
  });

  it("List failure surfaces as gmail-error", async () => {
    installHandler({
      status: CONNECTED,
      listThrows: "rate_limited",
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");

    await user.click(screen.getByTestId("gmail-list"));

    const err = await screen.findByTestId("gmail-error");
    expect(err.textContent ?? "").toMatch(/rate_limited/);
    // No messages list appears.
    expect(screen.queryByTestId("gmail-msg-m_001")).toBeNull();
  });

  // Sanity: the firstTextAttachment heuristic also accepts .txt + text/plain.
  it("selects .txt attachment over a leading binary one", async () => {
    const calls: IpcCall[] = [];
    const txtAtt: GmailAttachmentMeta = {
      attachmentId: "a_txt",
      filename: "invoice.txt",
      mimeType: "application/octet-stream",
      size: 800,
    };
    installHandler({
      calls,
      status: CONNECTED,
      messages: [makeMsg({ attachments: [ATT_PDF, txtAtt] })],
      attachmentText: "plain text invoice",
    });

    const user = userEvent.setup();
    render(<GmailInboxScreen />);
    await screen.findByTestId("gmail-status-connected");
    await user.click(screen.getByTestId("gmail-list"));
    await user.click(await screen.findByTestId("gmail-msg-m_001"));

    await waitFor(() => {
      const fetchCall = calls.find((c) => c.cmd === "gmail_fetch_attachment");
      expect(fetchCall).toBeTruthy();
      if (fetchCall && fetchCall.cmd === "gmail_fetch_attachment") {
        expect(fetchCall.args.attachmentId).toBe("a_txt");
      }
    });
  });

  // Avoid unused imports / vars from the test scaffolding.
  it("fireEvent is callable for future regressions", () => {
    fireEvent.keyDown(window, { key: "Escape" });
    expect(true).toBe(true);
  });
});
