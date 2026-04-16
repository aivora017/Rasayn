import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsScreen } from "./SettingsScreen.js";
import { setIpcHandler, type IpcCall, type Shop } from "../lib/ipc.js";

function buildHandler(seed: Shop) {
  let current = { ...seed };
  return {
    get handler() {
      return async (call: IpcCall): Promise<unknown> => {
        if (call.cmd === "shop_get") return { ...current };
        if (call.cmd === "shop_update") {
          const i = call.args.input;
          current = {
            ...current,
            name: i.name,
            gstin: i.gstin,
            stateCode: i.stateCode,
            retailLicense: i.retailLicense,
            address: i.address,
          };
          return { ...current };
        }
        throw new Error(`unexpected ${call.cmd}`);
      };
    },
    current: () => current,
  };
}

const PLACEHOLDER: Shop = {
  id: "shop_local",
  name: "My Pharmacy",
  gstin: "00AAAAA0000A0Z0",
  stateCode: "00",
  retailLicense: "PENDING",
  address: "Please set address in Settings",
  createdAt: "2026-04-15T00:00:00.000Z",
};

// Helper: retype a controlled input and wait for React to commit the value
// before proceeding. Prevents a race between user-event's synthetic keystrokes
// and the next user.click on a Save button that is `disabled={!dirty}`.
async function retype(
  user: ReturnType<typeof userEvent.setup>,
  el: HTMLElement,
  value: string,
): Promise<void> {
  await user.clear(el);
  if (value.length > 0) await user.type(el, value);
  await waitFor(() => expect((el as HTMLInputElement).value).toBe(value));
}

// Click a test-id only after the button is enabled. Required because the
// Save button is `disabled={busy || !dirty}` and userEvent.click is a no-op
// on disabled buttons, which otherwise surfaces as a flaky findByTestId
// timeout on the error banner.
async function clickWhenEnabled(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
): Promise<void> {
  const btn = await screen.findByTestId(testId);
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  await user.click(btn);
}

describe("SettingsScreen (F5b)", () => {
  beforeEach(() => {
    setIpcHandler(async () => {
      throw new Error("handler not installed");
    });
  });

  it("loads shop_local and shows placeholder warning on fresh install", async () => {
    const h = buildHandler(PLACEHOLDER);
    setIpcHandler(h.handler);
    render(<SettingsScreen />);
    expect(await screen.findByTestId("placeholder-warn")).toBeTruthy();
    expect((screen.getByTestId("f-gstin") as HTMLInputElement).value).toBe("00AAAAA0000A0Z0");
  });

  it("rejects malformed GSTIN without hitting backend", async () => {
    const h = buildHandler(PLACEHOLDER);
    setIpcHandler(h.handler);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await screen.findByTestId("settings-screen");
    // Wait for load to hydrate the form from shop_get.
    await waitFor(() =>
      expect((screen.getByTestId("f-gstin") as HTMLInputElement).value).toBe(
        "00AAAAA0000A0Z0",
      ),
    );
    await retype(user, screen.getByTestId("f-gstin"), "INVALIDGSTIN123");
    await clickWhenEnabled(user, "f-save");
    expect((await screen.findByTestId("settings-err")).textContent).toMatch(/GSTIN/);
    // unchanged on backend
    expect(h.current().gstin).toBe("00AAAAA0000A0Z0");
  });

  it("requires state_code to match first 2 chars of GSTIN", async () => {
    const h = buildHandler(PLACEHOLDER);
    setIpcHandler(h.handler);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await screen.findByTestId("settings-screen");
    await waitFor(() =>
      expect((screen.getByTestId("f-name") as HTMLInputElement).value).toBe("My Pharmacy"),
    );

    await retype(user, screen.getByTestId("f-name"), "Vaidyanath Pharmacy");
    await retype(user, screen.getByTestId("f-gstin"), "27ABCDE1234F1Z5");
    await retype(user, screen.getByTestId("f-state"), "29");
    await retype(user, screen.getByTestId("f-license"), "21B/MH/KL/999");
    await retype(user, screen.getByTestId("f-address"), "1st Floor, Kalyan");

    await clickWhenEnabled(user, "f-save");
    expect((await screen.findByTestId("settings-err")).textContent).toMatch(/state code must match/i);
  });

  it("saves valid input and clears placeholder banner", async () => {
    const h = buildHandler(PLACEHOLDER);
    setIpcHandler(h.handler);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await screen.findByTestId("settings-screen");
    await waitFor(() =>
      expect((screen.getByTestId("f-name") as HTMLInputElement).value).toBe("My Pharmacy"),
    );

    await retype(user, screen.getByTestId("f-name"), "Vaidyanath Pharmacy");
    await retype(user, screen.getByTestId("f-gstin"), "27ABCDE1234F1Z5");
    await retype(user, screen.getByTestId("f-state"), "27");
    await retype(user, screen.getByTestId("f-license"), "21B/MH/KL/999");
    await retype(user, screen.getByTestId("f-address"), "1st Floor, Kalyan");

    await clickWhenEnabled(user, "f-save");

    await waitFor(() => expect(screen.queryByTestId("placeholder-warn")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("settings-saved")).toBeTruthy());
    expect(h.current().gstin).toBe("27ABCDE1234F1Z5");
    expect(h.current().stateCode).toBe("27");
    expect(h.current().name).toBe("Vaidyanath Pharmacy");
  });

  it("upper-cases GSTIN input automatically", async () => {
    const h = buildHandler(PLACEHOLDER);
    setIpcHandler(h.handler);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await screen.findByTestId("settings-screen");
    const gstin = screen.getByTestId("f-gstin") as HTMLInputElement;
    await user.clear(gstin);
    await user.type(gstin, "27abcde1234f1z5");
    await waitFor(() => expect(gstin.value).toBe("27ABCDE1234F1Z5"));
  });

  it("state_code input strips non-digits", async () => {
    const h = buildHandler(PLACEHOLDER);
    setIpcHandler(h.handler);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await screen.findByTestId("settings-screen");
    const st = screen.getByTestId("f-state") as HTMLInputElement;
    await user.clear(st);
    await user.type(st, "M2H7");
    await waitFor(() => expect(st.value).toBe("27"));
  });

  it("Reset button reverts dirty edits to loaded values", async () => {
    const good: Shop = { ...PLACEHOLDER, gstin: "27ABCDE1234F1Z5", stateCode: "27",
      retailLicense: "21B/MH/KL/1", address: "Kalyan", name: "Good Shop" };
    const h = buildHandler(good);
    setIpcHandler(h.handler);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await screen.findByTestId("settings-screen");
    await waitFor(() =>
      expect((screen.getByTestId("f-name") as HTMLInputElement).value).toBe("Good Shop"),
    );
    await retype(user, screen.getByTestId("f-name"), "Messed Up");
    await user.click(screen.getByTestId("f-reset"));
    await waitFor(() =>
      expect((screen.getByTestId("f-name") as HTMLInputElement).value).toBe("Good Shop"),
    );
  });
});
