import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToasterProvider } from "@pharmacare/design-system";
import { DashboardScreen } from "./DashboardScreen.js";
import {
  setIpcHandler,
  type IpcCall,
  type Shop,
} from "../lib/ipc.js";

const SHOP: Shop = {
  id: "shop_local",
  name: "Jagannath Pharmacy",
  address: "Kalyan",
  gstin: "27AAAAA0000A1Z5",
  retailLicense: "MH-12345",
  stateCode: "27",
  createdAt: "2026-04-27T00:00:00Z",
};

function withIpc(map: Partial<Record<string, (args: unknown) => unknown>>) {
  setIpcHandler(async (call: IpcCall) => {
    const fn = map[call.cmd];
    return fn ? fn(call.args) : null;
  });
}

const noopProps = {
  onGoBilling: () => {},
  onGoGmail: () => {},
  onGoMasters: () => {},
  onGoGrn: () => {},
  onGoReports: () => {},
};

describe("DashboardScreen", () => {
  beforeEach(() => {
    setIpcHandler(async () => null);
  });

  it("renders shop name in header", async () => {
    render(
      <ToasterProvider>
        <DashboardScreen shop={SHOP} {...noopProps} />
      </ToasterProvider>,
    );
    expect(screen.getByText("Jagannath Pharmacy")).toBeInTheDocument();
  });

  it("renders all four KPI cards with testids", () => {
    render(
      <ToasterProvider>
        <DashboardScreen shop={SHOP} {...noopProps} />
      </ToasterProvider>,
    );
    expect(screen.getByTestId("kpi-sales")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-bills")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-margin")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-cash")).toBeInTheDocument();
  });

  it("renders three moat panels (X1/X2/X3)", () => {
    render(
      <ToasterProvider>
        <DashboardScreen shop={SHOP} {...noopProps} />
      </ToasterProvider>,
    );
    expect(screen.getByTestId("moat-x1")).toBeInTheDocument();
    expect(screen.getByTestId("moat-x2")).toBeInTheDocument();
    expect(screen.getByTestId("moat-x3")).toBeInTheDocument();
  });

  it("hydrates KPIs from dayBookRpc", async () => {
    withIpc({
      day_book: () => ({
        date: "2026-04-27",
        rows: [],
        summary: {
          billCount: 7,
          grossPaise: 47_82_000, // ₹47,820
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          byPayment: { cash: 25_00_000, upi: 20_00_000, card: 2_82_000 },
        },
      }),
    });

    render(
      <ToasterProvider>
        <DashboardScreen shop={SHOP} {...noopProps} />
      </ToasterProvider>,
    );

    await waitFor(() => {
      const billsCard = screen.getByTestId("kpi-bills");
      // 7 bills appears
      expect(billsCard.textContent ?? "").toContain("7");
    });
  });

  it("flags missing-license compliance row when shop has placeholder GSTIN", () => {
    const fresh: Shop = { ...SHOP, gstin: "00AAAAA0000A0Z0" };
    render(
      <ToasterProvider>
        <DashboardScreen shop={fresh} {...noopProps} />
      </ToasterProvider>,
    );
    expect(screen.getByText(/Shop license \+ GSTIN missing/i)).toBeInTheDocument();
  });
});
