// AppShell + scaffold-gating tests (S26.G).
//
// Verifies the PILOT_BUILD gate in featureFlags.ts hides the four
// scaffold-only screens (RxScanModal, ARShelfOverlay, CounselingScreen,
// ABHAVerifyModal) from the sidebar / command palette in pilot builds,
// and that deep-link navigation to a hidden mode renders the shared
// <UpcomingFeature /> card rather than the literal scaffold "coming
// online" placeholder text.
//
// Why this lives here: the gate is enforced in two places — the sidebar
// nav rendered by AppShell, and the route table inside App.tsx. The
// tests below exercise both via the App.tsx entrypoint so we don't
// fragment coverage.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { IpcCall } from "../lib/ipc.js";

const trivialHandler = async (call: IpcCall) => {
  if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
  if (call.cmd === "db_version") return 2;
  if (call.cmd === "list_stock") return [];
  if (call.cmd === "search_products") return [];
  if (call.cmd === "list_suppliers") return [];
  if (call.cmd === "list_supplier_templates") return [];
  if (call.cmd === "search_customers") return [];
  if (call.cmd === "search_doctors") return [];
  // Catch-all: any unknown cmd (incl. user/auth/print bootstrap calls
  // BillingScreen makes on mount) returns null so the screen renders.
  return null;
};

// vi.resetModules() inside each test re-imports lib/ipc.js with a fresh
// (handler-less) state. The setIpcHandler we'd statically import here would
// target the OLD ipc module — useless. Instead, import setIpcHandler from
// the freshly-reset module after resetModules() and before App is imported.
async function installFreshHandler() {
  const ipc = await import("../lib/ipc.js");
  ipc.setIpcHandler(trivialHandler);
}

afterEach(() => {
  vi.resetModules();
});

describe("AppShell · S26.G scaffold-only gating", () => {
  it("PILOT_BUILD=true: ARShelf / RxScan / ABHA are NOT in the sidebar (Counseling graduated S28-D1)", async () => {
    vi.resetModules();
    vi.doMock("../featureFlags.js", async () => {
      const actual = await vi.importActual<typeof import("../featureFlags.js")>(
        "../featureFlags.js",
      );
      // Force flags ON so absence in sidebar is provably the PILOT_BUILD
      // gate's doing, not the underlying feature flag being false.
      return {
        ...actual,
        PILOT_BUILD: true,
        FEATURE_FLAGS: {
          ...actual.FEATURE_FLAGS,
          counseling: true,
          arShelf: true,
        },
        isScaffoldHidden: (mode: string): boolean =>
          (actual.SCAFFOLD_ONLY_MODES as readonly string[]).includes(mode),
      };
    });
    await installFreshHandler();
    const { App } = await import("../App.js");
    await act(async () => {
      render(<App />);
    });
    const nav = screen.getByRole("navigation", { name: /primary/i });
    // S28-D1: Counseling is now a real screen — present in sidebar.
    expect(nav.textContent ?? "").toMatch(/Counseling/i);
    expect(nav.textContent ?? "").not.toMatch(/AR Shelf/i);
    expect(nav.textContent ?? "").not.toMatch(/Rx Scan/i);
    expect(nav.textContent ?? "").not.toMatch(/ABHA/i);
  });

  it("PILOT_BUILD=false (dev): scaffold routes ARE present in the sidebar", async () => {
    vi.resetModules();
    vi.doMock("../featureFlags.js", async () => {
      const actual = await vi.importActual<typeof import("../featureFlags.js")>(
        "../featureFlags.js",
      );
      return {
        ...actual,
        PILOT_BUILD: false,
        FEATURE_FLAGS: {
          ...actual.FEATURE_FLAGS,
          counseling: true,
          arShelf: true,
        },
        isScaffoldHidden: (_mode: string): boolean => false,
      };
    });
    await installFreshHandler();
    const { App } = await import("../App.js");
    await act(async () => {
      render(<App />);
    });
    const nav = screen.getByRole("navigation", { name: /primary/i });
    // Counseling + AR Shelf are sidebar-routed; their preview labels
    // should render now that PILOT_BUILD is off.
    expect(nav.textContent ?? "").toMatch(/Counseling/i);
    expect(nav.textContent ?? "").toMatch(/AR Shelf/i);
  });

  it("PILOT_BUILD=true: deep-link to counseling renders the real CounselingScreen (S28-D1)", async () => {
    vi.resetModules();
    vi.doMock("../featureFlags.js", async () => {
      const actual = await vi.importActual<typeof import("../featureFlags.js")>(
        "../featureFlags.js",
      );
      return {
        ...actual,
        PILOT_BUILD: true,
        FEATURE_FLAGS: {
          ...actual.FEATURE_FLAGS,
          counseling: true,
          arShelf: true,
        },
        isScaffoldHidden: (mode: string): boolean =>
          (actual.SCAFFOLD_ONLY_MODES as readonly string[]).includes(mode),
      };
    });
    await installFreshHandler();
    const { App } = await import("../App.js");
    await act(async () => {
      render(<App initialMode="counseling" />);
    });
    // S28-D1: counseling is real — must NOT render the UpcomingFeature
    // placeholder; the actual CounselingScreen mounts (without billId
    // it shows the "no active bill" empty state).
    expect(screen.queryByTestId("upcoming-feature-card")).toBeNull();
    expect(screen.queryByTestId("counseling-screen")).toBeInTheDocument();
  });
});
