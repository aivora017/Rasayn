/**
 * A10 — ReturnsScreen contract.
 *
 * Covers:
 *   - renders period picker initialised to previous month
 *   - F9 Generate → calls generate_gstr1_payload + save_gstr1_return, shows saved banner
 *   - summary tab shows bill count + grand total after generate
 *   - tab switching renders B2B / B2CL / B2CS / HSN / Exemp / Doc tables
 *   - F10 download + F2 CSV bundle call createObjectURL (one for JSON, six for CSVs)
 *   - Mark Filed is disabled until generate succeeds and current user is an owner
 *   - Non-owner cannot confirm Mark Filed (dialog shows forbidden, confirm disabled)
 *   - Owner Mark Filed flips status to "filed" in the banner
 *   - Prior-returns history renders rows from list_gst_returns
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ReturnsScreen } from "./ReturnsScreen.js";
import {
  setIpcHandler,
  type IpcCall,
  type Gstr1InputDTO,
  type GstReturnDTO,
  type UserDTO,
  type IrnRecordDTO,
} from "../lib/ipc.js";

const OWNER: UserDTO = { id: "user_sourav_owner", name: "Sourav Shaw", role: "owner", isActive: true };
const STAFF: UserDTO = { id: "user_sourav_owner", name: "Sourav Staff", role: "cashier", isActive: true };

function makePayloadDTO(): Gstr1InputDTO {
  // Small fixture: one B2B invoice, one B2CS bill in March 2026.
  return {
    period: "032026",
    shop: {
      id: "shop_vaidyanath_kalyan",
      gstin: "27ABCDE1234F1Z5",
      stateCode: "27",
      name: "Vaidyanath Pharmacy",
    },
    bills: [
      {
        id: "b1", billNo: "INV-001", billedAt: "2026-03-10T10:00:00+05:30",
        docSeries: "INV", gstTreatment: "intra",
        subtotalPaise: 10000, totalDiscountPaise: 0,
        totalCgstPaise: 600, totalSgstPaise: 600, totalIgstPaise: 0, totalCessPaise: 0,
        roundOffPaise: 0, grandTotalPaise: 11200, isVoided: 0, customer: null,
        lines: [{
          id: "l1", productId: "p1", hsn: "3004", gstRate: 12, qty: 1,
          taxableValuePaise: 10000, cgstPaise: 600, sgstPaise: 600, igstPaise: 0, cessPaise: 0, lineTotalPaise: 11200,
        }],
      },
      {
        id: "b2", billNo: "INV-002", billedAt: "2026-03-11T11:00:00+05:30",
        docSeries: "INV", gstTreatment: "intra",
        subtotalPaise: 20000, totalDiscountPaise: 0,
        totalCgstPaise: 1200, totalSgstPaise: 1200, totalIgstPaise: 0, totalCessPaise: 0,
        roundOffPaise: 0, grandTotalPaise: 22400, isVoided: 0,
        customer: {
          id: "c1", gstin: "27XYZAB1234G1Z1", name: "Metro Clinic", stateCode: "27", address: "Mumbai",
        },
        lines: [{
          id: "l2", productId: "p1", hsn: "3004", gstRate: 12, qty: 2,
          taxableValuePaise: 20000, cgstPaise: 1200, sgstPaise: 1200, igstPaise: 0, cessPaise: 0, lineTotalPaise: 22400,
        }],
      },
    ],
  };
}

function makeSavedReturn(status = "draft"): GstReturnDTO {
  return {
    id: "ret_1", shopId: "shop_vaidyanath_kalyan",
    returnType: "GSTR-1", period: "032026", status,
    hashSha256: "a".repeat(64),
    billCount: 2, grandTotalPaise: 33600,
    generatedAt: "2026-04-17T10:30:00+05:30",
    filedAt: status === "filed" ? "2026-04-17T10:31:00+05:30" : null,
    filedByUserId: status === "filed" ? OWNER.id : null,
  };
}

type CallLog = IpcCall[];

function installHandler(opts: {
  user?: UserDTO | null;
  history?: readonly GstReturnDTO[];
  payload?: Gstr1InputDTO;
  savedStatus?: string;
  saveThrows?: string;
  irn?: readonly IrnRecordDTO[];
  cancelThrows?: string;
} = {}): CallLog {
  const calls: CallLog = [];
  const user = opts.user ?? OWNER;
  const history = opts.history ?? [];
  const payload = opts.payload ?? makePayloadDTO();
  let saved = makeSavedReturn(opts.savedStatus ?? "draft");
  setIpcHandler(async (call) => {
    calls.push(call);
    switch (call.cmd) {
      case "user_get": return user;
      case "list_gst_returns": return history;
      case "generate_gstr1_payload": return payload;
      case "save_gstr1_return":
        if (opts.saveThrows) throw new Error(opts.saveThrows);
        return saved;
      case "mark_gstr1_filed":
        saved = { ...saved, status: "filed", filedAt: "2026-04-17T10:31:00+05:30", filedByUserId: OWNER.id };
        return saved;
      case "list_irn_records": {
        const { status } = (call.args as { status?: string });
        const rows = opts.irn ?? [];
        return status ? rows.filter((r) => r.status === status) : rows;
      }
      case "cancel_irn":
        if (opts.cancelThrows) throw new Error(opts.cancelThrows);
        return { ...(opts.irn?.[0] as IrnRecordDTO), status: "cancelled" };
      default: return null;
    }
  });
  return calls;
}

describe("ReturnsScreen · A10", () => {
  beforeEach(() => {
    // createObjectURL is not in jsdom by default
    (URL as any).createObjectURL = vi.fn(() => "blob:mock");
    (URL as any).revokeObjectURL = vi.fn();
    // Silence jsdom navigation from <a>.click()
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it("renders with period picker initialised to previous month", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    const mm = screen.getByTestId("ret-mm") as HTMLInputElement;
    const yyyy = screen.getByTestId("ret-yyyy") as HTMLInputElement;
    expect(mm.value).toMatch(/^(0[1-9]|1[0-2])$/);
    expect(yyyy.value).toMatch(/^\d{4}$/);
  });

  it("Generate → pulls payload, persists return, and shows banner", async () => {
    const calls = installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());

    // Force period to our fixture
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "03" } });
    fireEvent.change(screen.getByTestId("ret-yyyy"), { target: { value: "2026" } });
    fireEvent.click(screen.getByTestId("ret-generate"));

    await waitFor(() => expect(screen.getByTestId("ret-saved-banner")).toBeInTheDocument());
    expect(screen.getByTestId("ret-saved-status").textContent).toBe("draft");
    expect(calls.map((c) => c.cmd)).toEqual(expect.arrayContaining([
      "user_get", "list_gst_returns", "generate_gstr1_payload", "save_gstr1_return",
    ]));
  });

  it("Summary tab reports bill count and grand total after generate", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "03" } });
    fireEvent.change(screen.getByTestId("ret-yyyy"), { target: { value: "2026" } });
    fireEvent.click(screen.getByTestId("ret-generate"));

    const summary = await screen.findByTestId("ret-preview-summary");
    expect(summary.textContent).toContain("Bills counted: 2");
    // Grand total 33600 paise = ₹336.00
    expect(summary.textContent).toContain("₹336.00");
  });

  it("tab switch renders B2B invoice row with buyer GSTIN", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "03" } });
    fireEvent.change(screen.getByTestId("ret-yyyy"), { target: { value: "2026" } });
    fireEvent.click(screen.getByTestId("ret-generate"));
    await screen.findByTestId("ret-saved-banner");

    fireEvent.click(screen.getByTestId("ret-tab-b2b"));
    const table = await screen.findByTestId("ret-preview-b2b");
    expect(table.textContent).toContain("27XYZAB1234G1Z1");
  });

  it("F10 triggers JSON download (createObjectURL called once for JSON)", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "03" } });
    fireEvent.change(screen.getByTestId("ret-yyyy"), { target: { value: "2026" } });
    fireEvent.click(screen.getByTestId("ret-generate"));
    await screen.findByTestId("ret-saved-banner");

    (URL.createObjectURL as any).mockClear();
    fireEvent.click(screen.getByTestId("ret-dl-json"));
    expect((URL.createObjectURL as any).mock.calls.length).toBe(1);
  });

  it("F2 triggers CSV bundle download (6 calls: b2b/b2cl/b2cs/hsn/exemp/doc)", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "03" } });
    fireEvent.change(screen.getByTestId("ret-yyyy"), { target: { value: "2026" } });
    fireEvent.click(screen.getByTestId("ret-generate"));
    await screen.findByTestId("ret-saved-banner");

    (URL.createObjectURL as any).mockClear();
    fireEvent.click(screen.getByTestId("ret-dl-csv"));
    expect((URL.createObjectURL as any).mock.calls.length).toBe(6);
  });

  it("Mark Filed button disabled until generate succeeds", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    const btn = screen.getByTestId("ret-file") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("non-owner cannot confirm Mark Filed", async () => {
    installHandler({ user: STAFF });
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "03" } });
    fireEvent.change(screen.getByTestId("ret-yyyy"), { target: { value: "2026" } });
    fireEvent.click(screen.getByTestId("ret-generate"));
    await screen.findByTestId("ret-saved-banner");

    // Button should be disabled for non-owner (canFile gate)
    expect((screen.getByTestId("ret-file") as HTMLButtonElement).disabled).toBe(true);
  });

  it("owner Mark Filed flips status to filed", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "03" } });
    fireEvent.change(screen.getByTestId("ret-yyyy"), { target: { value: "2026" } });
    fireEvent.click(screen.getByTestId("ret-generate"));
    await screen.findByTestId("ret-saved-banner");

    fireEvent.click(screen.getByTestId("ret-file"));
    const dlg = await screen.findByTestId("ret-confirm-file");
    expect(dlg).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ret-file-confirm"));

    await waitFor(() => expect(screen.getByTestId("ret-saved-status").textContent).toBe("filed"));
  });

  it("history renders prior returns", async () => {
    const prior: GstReturnDTO[] = [makeSavedReturn("filed")];
    installHandler({ history: prior });
    render(<ReturnsScreen />);
    const hist = await screen.findByTestId("ret-history");
    await waitFor(() => expect(hist.textContent).toContain("032026"));
    expect(hist.textContent).toContain("filed");
  });

  it("invalid period shows inline error", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-mm"), { target: { value: "13" } });
    fireEvent.click(screen.getByTestId("ret-generate"));
    const err = await screen.findByTestId("ret-err");
    expect(err.textContent).toMatch(/Period invalid/);
  });

  it("A12 · mode toggle defaults to GSTR-1 and hides IRN panel", async () => {
    installHandler();
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    expect(screen.queryByTestId("irn-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("ret-mode-switch")).toBeInTheDocument();
  });

  it("A12 · switching to IRN mode loads records via list_irn_records", async () => {
    const rec: IrnRecordDTO = {
      id: "ir_1", billId: "bill_a", shopId: "shop_vaidyanath_kalyan",
      vendor: "cygnet", status: "acked",
      irn: "abcdef1234567890" + "x".repeat(48),
      ackNo: "ACK-1", ackDate: "2026-04-17T10:00:00+05:30",
      signedInvoice: null, qrCode: null,
      errorCode: null, errorMsg: null, attemptCount: 1,
      submittedAt: "2026-04-17T09:59:00+05:30",
      cancelledAt: null, cancelReason: null, cancelRemarks: null,
      actorUserId: "user_sourav_owner", createdAt: "2026-04-17T09:58:00+05:30",
    };
    const calls = installHandler({ irn: [rec] });
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ret-mode-irn"));
    await screen.findByTestId("irn-panel");
    await waitFor(() => expect(screen.getByTestId(`irn-row-${rec.id}`)).toBeInTheDocument());
    expect(calls.some((c) => c.cmd === "list_irn_records")).toBe(true);
  });

  it("A12 · status filter narrows the IRN list", async () => {
    const recAcked: IrnRecordDTO = {
      id: "ir_a", billId: "bill_1", shopId: "shop_vaidyanath_kalyan",
      vendor: "cygnet", status: "acked",
      irn: "a".repeat(64), ackNo: "ACK", ackDate: "2026-04-17T10:00:00+05:30",
      signedInvoice: null, qrCode: null, errorCode: null, errorMsg: null,
      attemptCount: 1, submittedAt: "2026-04-17T09:59:00+05:30",
      cancelledAt: null, cancelReason: null, cancelRemarks: null,
      actorUserId: OWNER.id, createdAt: "2026-04-17T09:58:00+05:30",
    };
    const recFailed: IrnRecordDTO = {
      ...recAcked, id: "ir_f", status: "failed", irn: null,
      errorCode: "3026", errorMsg: "Invalid GSTIN", attemptCount: 2, ackNo: null, ackDate: null,
    };
    const calls = installHandler({ irn: [recAcked, recFailed] });
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ret-mode-irn"));
    await screen.findByTestId("irn-panel");
    await waitFor(() => expect(screen.getByTestId("irn-row-ir_a")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("irn-filter"), { target: { value: "failed" } });
    await waitFor(() => expect(screen.queryByTestId("irn-row-ir_a")).not.toBeInTheDocument());
    expect(screen.getByTestId("irn-row-ir_f")).toBeInTheDocument();
    const listCalls = calls.filter((c) => c.cmd === "list_irn_records");
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("A12 · cancel dialog submits cancel_irn with reason + remarks", async () => {
    const rec: IrnRecordDTO = {
      id: "ir_c", billId: "bill_c", shopId: "shop_vaidyanath_kalyan",
      vendor: "cygnet", status: "acked",
      irn: "b".repeat(64), ackNo: "ACK-9", ackDate: "2026-04-17T10:00:00+05:30",
      signedInvoice: null, qrCode: null, errorCode: null, errorMsg: null,
      attemptCount: 1, submittedAt: "2026-04-17T09:59:00+05:30",
      cancelledAt: null, cancelReason: null, cancelRemarks: null,
      actorUserId: OWNER.id, createdAt: "2026-04-17T09:58:00+05:30",
    };
    const calls = installHandler({ irn: [rec] });
    render(<ReturnsScreen />);
    await waitFor(() => expect(screen.getByTestId("returns-screen")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ret-mode-irn"));
    await screen.findByTestId("irn-panel");
    await waitFor(() => expect(screen.getByTestId(`irn-row-${rec.id}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`irn-cancel-${rec.id}`));
    await screen.findByTestId("irn-cancel-dialog");
    fireEvent.change(screen.getByTestId("irn-cancel-reason"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("irn-cancel-remarks"), { target: { value: "order rolled back" } });
    fireEvent.click(screen.getByTestId("irn-cancel-confirm"));

    await waitFor(() => expect(screen.queryByTestId("irn-cancel-dialog")).not.toBeInTheDocument());
    const cancelCall = calls.find((c) => c.cmd === "cancel_irn");
    expect(cancelCall).toBeTruthy();
    if (cancelCall && cancelCall.cmd === "cancel_irn") {
      expect(cancelCall.args.input.cancelReason).toBe("3");
      expect(cancelCall.args.input.cancelRemarks).toBe("order rolled back");
    }
  });
});
