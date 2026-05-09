import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen.js";
import { setIpcHandler, type IpcCall, type Shop } from "../lib/ipc.js";

interface Calls {
  getLocaleArgs: unknown[];
  setLocaleArgs: unknown[];
  currentLocale: string;
}

function buildHandler(seed: Shop, locale = "mr"): { handler: (c: IpcCall) => Promise<unknown>; calls: Calls } {
  const calls: Calls = { getLocaleArgs: [], setLocaleArgs: [], currentLocale: locale };
  const current: Shop = { ...seed };
  return {
    handler: async (call: IpcCall): Promise<unknown> => {
      if (call.cmd === "shop_get") return { ...current };
      if (call.cmd === "shop_update") return { ...current };
      if (call.cmd === "get_locale") {
        calls.getLocaleArgs.push(call.args);
        return { locale: calls.currentLocale };
      }
      if (call.cmd === "set_locale") {
        calls.setLocaleArgs.push(call.args);
        const a = (call.args as { input: { locale: string } }).input;
        calls.currentLocale = a.locale;
        return { locale: a.locale };
      }
      throw new Error(`unexpected ${call.cmd}`);
    },
    calls,
  };
}

const SEED: Shop = {
  id: "shop_local",
  name: "Test Pharmacy",
  gstin: "27ABCDE1234F1Z5",
  stateCode: "27",
  retailLicense: "21B/MH/KL/123",
  address: "Kalyan",
  createdAt: "2026-04-15T00:00:00.000Z",
};

describe("SettingsScreen — locale dropdown (S28-B2)", () => {
  beforeEach(() => {
    setIpcHandler(async () => { throw new Error("handler not installed"); });
  });

  it("renders the locale dropdown with English/Hindi/Marathi options", async () => {
    const { handler } = buildHandler(SEED);
    setIpcHandler(handler);
    render(<SettingsScreen />);
    const select = (await screen.findByTestId("f-locale")) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(3);
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["en", "hi", "mr"]);
  });

  it("calls set_locale RPC when the dropdown value changes", async () => {
    const { handler, calls } = buildHandler(SEED, "mr");
    setIpcHandler(handler);
    render(<SettingsScreen />);
    const select = (await screen.findByTestId("f-locale")) as HTMLSelectElement;
    await waitFor(() => expect(calls.getLocaleArgs.length).toBeGreaterThan(0));
    fireEvent.change(select, { target: { value: "hi" } });
    await waitFor(() => expect(calls.setLocaleArgs.length).toBe(1));
    const arg = calls.setLocaleArgs[0] as { input: { shopId: string; locale: string } };
    expect(arg.input.shopId).toBe("shop_local");
    expect(arg.input.locale).toBe("hi");
  });

  it("reads the persisted locale from get_locale on mount and selects it", async () => {
    const { handler } = buildHandler(SEED, "hi");
    setIpcHandler(handler);
    render(<SettingsScreen />);
    const select = (await screen.findByTestId("f-locale")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("hi"));
  });
});
