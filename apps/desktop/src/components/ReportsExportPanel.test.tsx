// S26 Wave 2 Agent B — GSTR-3B button now calls generate_gstr3b_payload IPC
// (was buildGstr3b over SAMPLE_BILLS).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ToasterProvider } from "@pharmacare/design-system";
import ReportsExportPanel from "./ReportsExportPanel.js";
import {
  setIpcHandler,
  type IpcCall,
  type Gstr3bPayloadDTO,
} from "../lib/ipc.js";

const PAYLOAD: Gstr3bPayloadDTO = {
  period: "2026-04",
  shopId: "shop_local",
  outwardSupplies: { taxablePaise: 150_000, igstPaise: 0, cgstPaise: 3_750, sgstPaise: 3_750, cessPaise: 0 },
  eligibleItc:    { taxablePaise:  50_000, igstPaise: 0, cgstPaise: 1_250, sgstPaise: 1_250, cessPaise: 0 },
  taxPayable:     { taxablePaise: 100_000, igstPaise: 0, cgstPaise: 2_500, sgstPaise: 2_500, cessPaise: 0 },
  zeroRatedTaxablePaise: 0,
  nilRatedTaxablePaise: 0,
};

describe("ReportsExportPanel (S26 Wave 2 Agent B)", () => {
  beforeEach(() => {
    setIpcHandler(async () => null);
  });

  it("calls generate_gstr3b_payload with the current period and shopId when the GSTR-3B button is clicked", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(async (call: IpcCall) => {
      calls.push(call);
      if (call.cmd === "generate_gstr3b_payload") return PAYLOAD;
      return null;
    });
    // jsdom does NOT define URL.createObjectURL — vi.spyOn fails on a missing prop.
    // Assign first, then spy. Restore at test end via mockRestore (assignment).
    const origCreate = (URL as any).createObjectURL;
    const origRevoke = (URL as any).revokeObjectURL;
    const createSpy = vi.fn().mockReturnValue("blob:fake");
    const revokeSpy = vi.fn();
    (URL as any).createObjectURL = createSpy;
    (URL as any).revokeObjectURL = revokeSpy;
    render(
      <ToasterProvider>
        <ReportsExportPanel period="2026-04" shopId="shop_local" />
      </ToasterProvider>,
    );

    fireEvent.click(screen.getByTestId("export-3b"));

    await waitFor(() => {
      const c = calls.find((c) => c.cmd === "generate_gstr3b_payload");
      expect(c).toBeDefined();
      expect(c!.args).toMatchObject({ periodYyyymm: "2026-04", shopId: "shop_local" });
    });
    expect(createSpy).toHaveBeenCalled();
    (URL as any).createObjectURL = origCreate;
    (URL as any).revokeObjectURL = origRevoke;
  });

  it("downloads a JSON Blob whose body parses to the Gstr3bPayloadDTO returned by IPC", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "generate_gstr3b_payload") return PAYLOAD;
      return null;
    });
    let captured: Blob | null = null;
    const origCreate2 = (URL as any).createObjectURL;
    const origRevoke2 = (URL as any).revokeObjectURL;
    const createSpy = vi.fn((b: unknown) => {
      captured = b as Blob;
      return "blob:fake";
    });
    const revokeSpy = vi.fn();
    (URL as any).createObjectURL = createSpy;
    (URL as any).revokeObjectURL = revokeSpy;
    render(
      <ToasterProvider>
        <ReportsExportPanel period="2026-04" shopId="shop_local" />
      </ToasterProvider>,
    );

    fireEvent.click(screen.getByTestId("export-3b"));

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    // jsdom's Blob lacks .text() AND .stream(); use arrayBuffer + TextDecoder.
    const buf = await captured!.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({
      period: "2026-04",
      shopId: "shop_local",
      outwardSupplies: { taxablePaise: 150_000, cgstPaise: 3_750, sgstPaise: 3_750 },
      eligibleItc:    { taxablePaise:  50_000, cgstPaise: 1_250, sgstPaise: 1_250 },
      taxPayable:     { taxablePaise: 100_000, cgstPaise: 2_500, sgstPaise: 2_500 },
    });
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});
