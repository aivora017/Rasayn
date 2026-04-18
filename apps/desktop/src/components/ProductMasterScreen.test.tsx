// X2b.2 inline similar-suspects tests — ADR 0022.
//
// Exercises the pre-save similarity banner in ProductMasterScreen:
//  - RPC is fired when the operator picks an image (happy path).
//  - The banner renders with the right severity buckets (near-dup / suspicious).
//  - Clearing the image hides the banner.
//  - RPC failure is soft-failed (no errors surface; save still allowed).
//  - Edit-existing flow passes excludeProductId.
//
// Uses a record-and-respond IPC handler so we can assert both the arg
// shape and the rendered output without booting the full App.

import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductMasterScreen } from "./ProductMasterScreen.js";
import {
  setIpcHandler,
  type IpcCall,
  type SimilarImageRowDTO,
} from "../lib/ipc.js";

// Minimal 1×1 PNG (valid header → sniff passes client-side validator).
const PNG_1X1_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // "IHDR"
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
  0x08, 0x06, 0x00, 0x00, 0x00, // bit-depth 8, RGBA, no interlace
  0x1f, 0x15, 0xc4, 0x89, // CRC
  0x00, 0x00, 0x00, 0x0a, // IDAT length=10
  0x49, 0x44, 0x41, 0x54, // "IDAT"
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // data
  0x0d, 0x0a, 0x2d, 0xb4, // CRC
  0x00, 0x00, 0x00, 0x00, // IEND length
  0x49, 0x45, 0x4e, 0x44, // "IEND"
  0xae, 0x42, 0x60, 0x82, // CRC
]);

function makePngFile(name = "probe.png"): File {
  // File constructor copies the buffer, so we're safe.
  return new File([PNG_1X1_BYTES], name, { type: "image/png" });
}

const NEAR_DUP: SimilarImageRowDTO = {
  productId: "p_existing_near",
  name: "Crocin 500 (old label)",
  schedule: "OTC",
  manufacturer: "GSK",
  phash: "aaaaaaaaaaaaaaaa",
  distance: 4,
};
const SUSPICIOUS: SimilarImageRowDTO = {
  productId: "p_existing_sus",
  name: "Dolo 650",
  schedule: "OTC",
  manufacturer: "Micro Labs",
  phash: "bbbbbbbbbbbbbbbb",
  distance: 9,
};

interface HandlerOptions {
  /** What the similarity RPC returns (defaults to []). */
  similar?: readonly SimilarImageRowDTO[];
  /** If true, similarity RPC rejects — asserts the soft-fail path. */
  similarReject?: boolean;
  /** Capture every outbound IpcCall in the order they were invoked. */
  calls?: IpcCall[];
}

function installHandler(opts: HandlerOptions = {}): void {
  const calls = opts.calls ?? [];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    switch (call.cmd) {
      case "list_products":
        return [];
      case "check_similar_images_for_bytes":
        if (opts.similarReject) throw new Error("rpc offline");
        return opts.similar ?? [];
      default:
        return null;
    }
  });
}

describe("ProductMasterScreen — X2b.2 pre-save similarity (ADR 0022)", () => {
  it("fires check_similar_images_for_bytes on image select + shows banner", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, similar: [NEAR_DUP, SUSPICIOUS] });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);

    // Wait for initial load.
    await screen.findByTestId("product-master");

    // Start new product (Alt+N).
    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    // Pick image.
    const fileInput = screen.getByTestId("pm-image-file") as HTMLInputElement;
    await user.upload(fileInput, makePngFile());

    // Banner appears with one near-dup + one suspicious.
    const banner = await screen.findByTestId("pm-similar-banner");
    expect(banner).toBeInTheDocument();

    const summary = screen.getByTestId("pm-similar-summary");
    expect(summary.textContent ?? "").toMatch(/1 near-duplicate/);
    expect(summary.textContent ?? "").toMatch(/1 suspicious match/);

    // Severity cells correct.
    expect(
      screen.getByTestId("pm-similar-sev-p_existing_near").textContent,
    ).toBe("near-duplicate");
    expect(
      screen.getByTestId("pm-similar-sev-p_existing_sus").textContent,
    ).toBe("suspicious");

    // Hint text confirms save is still allowed.
    expect(screen.getByTestId("pm-similar-hint").textContent ?? "").toMatch(
      /Save is still allowed/,
    );

    // Check the RPC was called with the right envelope.
    const checkCall = calls.find(
      (c) => c.cmd === "check_similar_images_for_bytes",
    );
    expect(checkCall).toBeTruthy();
    if (checkCall && checkCall.cmd === "check_similar_images_for_bytes") {
      expect(checkCall.args.input.reportedMime).toBe("image/png");
      expect(checkCall.args.input.maxDistance).toBe(12);
      expect(checkCall.args.input.excludeProductId).toBeUndefined();
      expect(typeof checkCall.args.input.bytesB64).toBe("string");
      expect(checkCall.args.input.bytesB64.length).toBeGreaterThan(0);
    }
  });

  it("empty RPC result → no banner rendered (save unimpeded)", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls, similar: [] });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    const fileInput = screen.getByTestId("pm-image-file") as HTMLInputElement;
    await user.upload(fileInput, makePngFile());

    // Wait for the RPC to have fired at least once.
    await waitFor(() =>
      expect(
        calls.some((c) => c.cmd === "check_similar_images_for_bytes"),
      ).toBe(true),
    );

    // Banner should NOT be in the DOM.
    expect(screen.queryByTestId("pm-similar-banner")).toBeNull();
  });

  it("clearing the image hides the banner", async () => {
    installHandler({ similar: [NEAR_DUP] });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    const fileInput = screen.getByTestId("pm-image-file") as HTMLInputElement;
    await user.upload(fileInput, makePngFile());

    await screen.findByTestId("pm-similar-banner");

    const clearBtn = screen.getByTestId("pm-image-clear");
    await user.click(clearBtn);

    await waitFor(() =>
      expect(screen.queryByTestId("pm-similar-banner")).toBeNull(),
    );
  });

  it("RPC rejection is soft-failed (no banner, no error surfaced)", async () => {
    installHandler({ similarReject: true });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    const fileInput = screen.getByTestId("pm-image-file") as HTMLInputElement;
    await user.upload(fileInput, makePngFile());

    // Give any pending state transitions a tick.
    await waitFor(() => {
      expect(screen.queryByTestId("pm-similar-checking")).toBeNull();
    });

    // Banner absent — soft-fail.
    expect(screen.queryByTestId("pm-similar-banner")).toBeNull();
    // No image errors either (validator ok'd the PNG, RPC failure is silent).
    expect(screen.queryByTestId("pm-errors")).toBeNull();
    // Image preview IS present → save path intact.
    expect(screen.getByTestId("pm-image-preview")).toBeInTheDocument();
  });
});
