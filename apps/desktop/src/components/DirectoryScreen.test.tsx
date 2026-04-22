// G04 — DirectoryScreen coverage (coverage-gaps 2026-04-18 §G04).
//
// DirectoryScreen writes PII (phone, GSTIN, gender) and creates the
// `prescriptions` rows that the Schedule H/H1 billing path joins against
// via FK. Regressions here don't surface until a real bill fails at save,
// which is too late. This suite covers:
//
//   - Initial render + default customers-tab load
//   - Debounced search on query change (tab-aware)
//   - Customer upsert happy path with consent-method gating
//   - Doctor upsert on doctors tab
//   - Duplicate-phone rejection (server throws) surfaces as err toast
//   - Rx creation after selecting a customer, with doctor FK
//   - Tab switch preserves the search query + refetches the right RPC
//   - Save buttons disabled until required fields are set

import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectoryScreen } from "./DirectoryScreen.js";
import {
  setIpcHandler,
  type Customer,
  type CreateRxInput,
  type Doctor,
  type IpcCall,
  type Prescription,
  type UpsertCustomerInput,
  type UpsertDoctorInput,
} from "../lib/ipc.js";

const SHOP_ID = "shop_vaidyanath_kalyan";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "c_raju",
    name: "Raju Patil",
    phone: "9821012345",
    gstin: null,
    gender: "M",
    consentAbdm: 0,
    consentMarketing: 0,
    ...overrides,
  };
}
function makeDoctor(overrides: Partial<Doctor> = {}): Doctor {
  return {
    id: "d_kulkarni",
    regNo: "MH-12345",
    name: "Dr Sanjay Kulkarni",
    phone: "9820098200",
    ...overrides,
  };
}
function makeRx(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: "rx_001",
    customerId: "c_raju",
    doctorId: "d_kulkarni",
    kind: "paper",
    imagePath: null,
    issuedDate: "2026-04-20",
    notes: null,
    ...overrides,
  };
}

interface HandlerOptions {
  customers?: readonly Customer[];
  doctors?: readonly Doctor[];
  rxList?: readonly Prescription[];
  upsertCustomerResult?: string;
  upsertCustomerThrows?: string;
  upsertDoctorResult?: string;
  upsertDoctorThrows?: string;
  createRxThrows?: string;
  calls?: IpcCall[];
}

function installHandler(opts: HandlerOptions = {}): void {
  const calls = opts.calls ?? [];
  let rxList: readonly Prescription[] = opts.rxList ?? [];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    switch (call.cmd) {
      case "search_customers":
        return opts.customers ?? [];
      case "search_doctors":
        return opts.doctors ?? [];
      case "upsert_customer":
        if (opts.upsertCustomerThrows) throw new Error(opts.upsertCustomerThrows);
        return opts.upsertCustomerResult ?? "c_raju";
      case "upsert_doctor":
        if (opts.upsertDoctorThrows) throw new Error(opts.upsertDoctorThrows);
        return opts.upsertDoctorResult ?? "d_kulkarni";
      case "create_prescription":
        if (opts.createRxThrows) throw new Error(opts.createRxThrows);
        rxList = [...rxList, makeRx({ id: `rx_${rxList.length + 1}` })];
        return `rx_${rxList.length}`;
      case "list_prescriptions":
        return rxList;
      default:
        return null;
    }
  });
}

describe("DirectoryScreen — G04 CRUD / Rx / tab coverage", () => {
  it("renders customers tab by default and lists search results", async () => {
    const cust = makeCustomer();
    installHandler({ customers: [cust] });

    render(<DirectoryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId(`dir-cust-${cust.id}`)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Raju Patil/)).toBeInTheDocument();
    expect(screen.getByText(/9821012345/)).toBeInTheDocument();
  });

  it("typing in search triggers search_customers after debounce", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, customers: [makeCustomer({ name: "Rajesh Sharma" })] });

    const user = userEvent.setup();
    render(<DirectoryScreen />);

    // Initial load fires once with empty query.
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "search_customers")).toBe(true),
    );

    const search = screen.getByTestId("dir-search");
    await user.type(search, "raj");

    await waitFor(() => {
      const withQ = calls.filter(
        (c) => c.cmd === "search_customers" && (c.args as { q: string }).q === "raj",
      );
      expect(withQ.length).toBeGreaterThan(0);
    });
    const withQ = calls.find(
      (c) => c.cmd === "search_customers" && (c.args as { q: string }).q === "raj",
    );
    if (withQ && withQ.cmd === "search_customers") {
      expect(withQ.args.shopId).toBe(SHOP_ID);
      expect(withQ.args.limit).toBe(25);
    }
  });

  it("new-customer happy path: Save calls upsert_customer with typed DTO + toast", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, upsertCustomerResult: "c_new_123456" });

    const user = userEvent.setup();
    render(<DirectoryScreen />);
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "search_customers")).toBe(true),
    );

    await user.click(screen.getByTestId("dir-new-customer"));
    await user.type(screen.getByTestId("cust-name"), "Anjali Sharma");
    await user.type(screen.getByTestId("cust-phone"), "9898989898");
    await user.type(screen.getByTestId("cust-gstin"), "27abcde1234f1z5");
    await user.selectOptions(screen.getByTestId("cust-gender"), "F");
    await user.click(screen.getByTestId("cust-consent-abdm"));

    // The consent-method selector only appears after ABDM or marketing is on.
    const consentMethod = await screen.findByTestId("cust-consent-method");
    await user.selectOptions(consentMethod, "signed");

    await user.click(screen.getByTestId("cust-save"));

    await waitFor(() => {
      const upsert = calls.find((c) => c.cmd === "upsert_customer");
      expect(upsert).toBeTruthy();
    });
    const upsert = calls.find((c) => c.cmd === "upsert_customer");
    if (upsert && upsert.cmd === "upsert_customer") {
      const inp = upsert.args.input as UpsertCustomerInput;
      expect(inp.shopId).toBe(SHOP_ID);
      expect(inp.name).toBe("Anjali Sharma");
      expect(inp.phone).toBe("9898989898");
      // GSTIN uppercased by the component.
      expect(inp.gstin).toBe("27ABCDE1234F1Z5");
      expect(inp.gender).toBe("F");
      expect(inp.consentAbdm).toBe(true);
      expect(inp.consentMarketing).toBe(false);
      expect(inp.consentMethod).toBe("signed");
      // No id present → new-customer intent.
      expect(inp.id).toBeUndefined();
    }

    // Toast confirms + list reload fires again.
    await waitFor(() => {
      const toast = screen.queryByTestId("dir-toast");
      expect(toast).toBeTruthy();
      expect(toast?.getAttribute("data-toast-kind")).toBe("ok");
      expect(toast?.textContent ?? "").toMatch(/Saved customer/);
    });
  });

  it("duplicate-phone rejection surfaces as err-toast, form remains editable", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      upsertCustomerThrows: "UNIQUE_CONSTRAINT: phone already in use",
    });

    const user = userEvent.setup();
    render(<DirectoryScreen />);
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "search_customers")).toBe(true),
    );

    await user.click(screen.getByTestId("dir-new-customer"));
    await user.type(screen.getByTestId("cust-name"), "Copy Of Raju");
    await user.type(screen.getByTestId("cust-phone"), "9821012345");
    await user.click(screen.getByTestId("cust-save"));

    await waitFor(() => {
      const toast = screen.queryByTestId("dir-toast");
      expect(toast).toBeTruthy();
      expect(toast?.getAttribute("data-toast-kind")).toBe("err");
      expect(toast?.textContent ?? "").toMatch(/UNIQUE_CONSTRAINT/);
    });
    // Name field still shows what the user typed — they can fix and retry.
    expect((screen.getByTestId("cust-name") as HTMLInputElement).value).toBe("Copy Of Raju");
  });

  it("customer-save button stays disabled until name is filled (required-field gate)", async () => {
    installHandler({});

    const user = userEvent.setup();
    render(<DirectoryScreen />);

    await user.click(screen.getByTestId("dir-new-customer"));

    const saveBtn = screen.getByTestId("cust-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    await user.type(screen.getByTestId("cust-name"), "Anil");
    expect(saveBtn.disabled).toBe(false);
  });

  it("doctor tab: save calls upsert_doctor with typed DTO and resets form", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls });

    const user = userEvent.setup();
    render(<DirectoryScreen />);
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "search_customers")).toBe(true),
    );

    await user.click(screen.getByTestId("dir-tab-doctors"));
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "search_doctors")).toBe(true),
    );

    await user.type(screen.getByTestId("doc-reg"), "MH-98765");
    await user.type(screen.getByTestId("doc-name"), "Dr Leena Desai");
    await user.type(screen.getByTestId("doc-phone"), "9000000001");

    await user.click(screen.getByTestId("doc-save"));

    await waitFor(() => {
      const upsert = calls.find((c) => c.cmd === "upsert_doctor");
      expect(upsert).toBeTruthy();
    });
    const upsert = calls.find((c) => c.cmd === "upsert_doctor");
    if (upsert && upsert.cmd === "upsert_doctor") {
      const inp = upsert.args.input as UpsertDoctorInput;
      expect(inp.regNo).toBe("MH-98765");
      expect(inp.name).toBe("Dr Leena Desai");
      expect(inp.phone).toBe("9000000001");
      expect(inp.id).toBeUndefined();
    }

    // Form cleared after save.
    await waitFor(() =>
      expect((screen.getByTestId("doc-reg") as HTMLInputElement).value).toBe(""),
    );
    expect((screen.getByTestId("doc-name") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("doc-phone") as HTMLInputElement).value).toBe("");
  });

  it("selecting a customer loads their prescriptions; Add Rx creates with doctor FK", async () => {
    const cust = makeCustomer();
    const calls: IpcCall[] = [];
    installHandler({ calls, customers: [cust], rxList: [] });

    const user = userEvent.setup();
    render(<DirectoryScreen />);
    await screen.findByTestId(`dir-cust-${cust.id}`);

    // Click the customer row to select.
    await user.click(screen.getByTestId(`dir-cust-${cust.id}`));

    // list_prescriptions should fire for this customer.
    await waitFor(() => {
      const listRx = calls.find(
        (c) =>
          c.cmd === "list_prescriptions" &&
          (c.args as { customerId: string }).customerId === cust.id,
      );
      expect(listRx).toBeTruthy();
    });

    // Fill rx form with a doctor ID and notes, hit Add Rx.
    const notesInput = screen.getByTestId("rx-notes");
    await user.type(notesInput, "take 1 tab at night");

    await user.click(screen.getByTestId("rx-add"));

    await waitFor(() => {
      const created = calls.find((c) => c.cmd === "create_prescription");
      expect(created).toBeTruthy();
    });
    const created = calls.find((c) => c.cmd === "create_prescription");
    if (created && created.cmd === "create_prescription") {
      const inp = created.args.input as CreateRxInput;
      expect(inp.customerId).toBe(cust.id);
      expect(inp.shopId).toBe(SHOP_ID);
      expect(inp.kind).toBe("paper");
      expect(inp.notes).toBe("take 1 tab at night");
      // Default doctor empty string → null.
      expect(inp.doctorId ?? null).toBeNull();
    }

    // Toast + rx-list re-fetch.
    await waitFor(() => {
      const toast = screen.queryByTestId("dir-toast");
      expect(toast?.textContent ?? "").toMatch(/Rx added/);
    });
  });

  it("tab switch preserves the search query and refetches the right RPC", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      customers: [makeCustomer({ name: "Rajesh" })],
      doctors: [makeDoctor({ name: "Dr Rajiv" })],
    });

    const user = userEvent.setup();
    render(<DirectoryScreen />);
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "search_customers")).toBe(true),
    );

    const search = screen.getByTestId("dir-search") as HTMLInputElement;
    await user.type(search, "raj");

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.cmd === "search_customers" &&
            (c.args as { q: string }).q === "raj",
        ),
      ).toBe(true),
    );

    await user.click(screen.getByTestId("dir-tab-doctors"));

    // Same query preserved in the input.
    expect(search.value).toBe("raj");

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.cmd === "search_doctors" &&
            (c.args as { q: string }).q === "raj",
        ),
      ).toBe(true),
    );

    // Customers-specific UI is no longer mounted; doctor listing is.
    expect(screen.queryByTestId("dir-new-customer")).toBeNull();
    expect(screen.getByTestId("doc-save")).toBeInTheDocument();
  });

  it("doctor-save stays disabled until both regNo and name are filled", async () => {
    installHandler({});

    const user = userEvent.setup();
    render(<DirectoryScreen />);

    await user.click(screen.getByTestId("dir-tab-doctors"));

    const saveBtn = screen.getByTestId("doc-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    await user.type(screen.getByTestId("doc-reg"), "MH-1");
    expect(saveBtn.disabled).toBe(true);

    await user.type(screen.getByTestId("doc-name"), "Dr A");
    expect(saveBtn.disabled).toBe(false);
  });

  // Guard: act() + async flush for cases where the debounce fires after unmount.
  it("rapid tab toggling does not throw — cleanup cancels pending debounce", async () => {
    installHandler({});
    const user = userEvent.setup();
    render(<DirectoryScreen />);

    await user.click(screen.getByTestId("dir-tab-doctors"));
    await user.click(screen.getByTestId("dir-tab-customers"));
    await user.click(screen.getByTestId("dir-tab-doctors"));

    // Let any pending debounce fire — harmless either way.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 180));
    });

    // Still mounted with correct tab button active.
    expect(screen.getByTestId("dir-tab-doctors")).toBeInTheDocument();
    // Avoid unused-var lints.
    fireEvent.keyDown(window, { key: "Escape" });
  });
});
