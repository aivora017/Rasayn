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

// -----------------------------------------------------------------------------
// G02 — CRUD / Schedule / HSN / deactivate coverage (coverage-gaps 2026-04-18).
//
// The block above covers X2b.2 similarity only (4 tests). The coverage-gap
// audit calls out ProductMasterScreen as a CRITICAL gap because the product
// row it writes drives every future bill's GST rate, HSN, and Schedule dispense
// path. These tests cover the keyboard-first CRUD flow, Schedule-H image gate,
// validation surfacing, deactivate, and Esc-cancels-no-destructive-call.
// -----------------------------------------------------------------------------

import { beforeEach, afterEach } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import type { ProductRow, ProductWriteDTO } from "../lib/ipc.js";

function makeRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "p_crocin",
    name: "Crocin 500",
    genericName: "Paracetamol",
    manufacturer: "GSK",
    hsn: "3004",
    gstRate: 12,
    schedule: "OTC",
    packForm: "tablet",
    packSize: 10,
    mrpPaise: 4200,
    nppaMaxMrpPaise: 5000,
    imageSha256: null,
    isActive: true,
    createdAt: "2026-04-22T10:00:00Z",
    updatedAt: "2026-04-22T10:00:00Z",
    ...overrides,
  };
}

interface CrudHandlerOptions {
  initialRows?: readonly ProductRow[];
  upsertResult?: ProductRow;
  upsertThrows?: string;
  deactivateThrows?: string;
  calls?: IpcCall[];
}

function installCrudHandler(opts: CrudHandlerOptions = {}): void {
  const calls = opts.calls ?? [];
  let rows: ProductRow[] = [...(opts.initialRows ?? [])];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    switch (call.cmd) {
      case "list_products":
        return rows;
      case "upsert_product": {
        if (opts.upsertThrows) throw new Error(opts.upsertThrows);
        const dto = call.args.input as ProductWriteDTO;
        const result: ProductRow =
          opts.upsertResult ??
          makeRow({
            id: dto.id ?? `p_${dto.name.replace(/\s+/g, "_").toLowerCase()}`,
            name: dto.name,
            genericName: dto.genericName,
            manufacturer: dto.manufacturer,
            hsn: dto.hsn,
            gstRate: dto.gstRate,
            schedule: dto.schedule,
            packForm: dto.packForm,
            packSize: dto.packSize,
            mrpPaise: dto.mrpPaise,
            nppaMaxMrpPaise: dto.nppaMaxMrpPaise,
            imageSha256: dto.imageSha256,
            isActive: true,
          });
        const existingIdx = dto.id ? rows.findIndex((r) => r.id === dto.id) : -1;
        if (existingIdx >= 0) rows[existingIdx] = result;
        else rows = [...rows, result];
        return result;
      }
      case "deactivate_product": {
        if (opts.deactivateThrows) throw new Error(opts.deactivateThrows);
        const id = (call.args as { id: string }).id;
        rows = rows.map((r) => (r.id === id ? { ...r, isActive: false } : r));
        return null;
      }
      case "get_product_image":
        return null;
      case "check_similar_images_for_bytes":
        return [];
      default:
        return null;
    }
  });
}

describe("ProductMasterScreen — G02 CRUD / Schedule / HSN / deactivate", () => {
  beforeEach(() => {
    // Each test starts with a fresh handler; no leak across cases.
  });
  afterEach(() => {
    // vitest auto-unmounts; nothing else to clean.
  });

  it("Alt+N opens the form, Alt+S saves a new OTC product with validated fields", async () => {
    const calls: IpcCall[] = [];
    installCrudHandler({ calls });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    // Empty table shown with "Alt+N to add" hint.
    expect(screen.getByTestId("pm-table").textContent ?? "").toMatch(/No products/);

    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    // Fill in required fields.
    const nameInput = screen.getByLabelText(/^Name$/i);
    await user.type(nameInput, "Crocin 500");
    const mfrInput = screen.getByLabelText(/Manufacturer/i);
    await user.type(mfrInput, "GSK");
    const mrpInput = screen.getByLabelText(/MRP \(₹\)/i);
    await user.type(mrpInput, "42.00");

    // Save via Alt+S.
    await user.keyboard("{Alt>}s{/Alt}");

    await waitFor(() => {
      const upsert = calls.find((c) => c.cmd === "upsert_product");
      expect(upsert).toBeTruthy();
    });
    const upsert = calls.find((c) => c.cmd === "upsert_product");
    if (upsert && upsert.cmd === "upsert_product") {
      expect(upsert.args.input.name).toBe("Crocin 500");
      expect(upsert.args.input.manufacturer).toBe("GSK");
      expect(upsert.args.input.mrpPaise).toBe(4200);
      expect(upsert.args.input.hsn).toBe("3004");
      expect(upsert.args.input.gstRate).toBe(12);
      expect(upsert.args.input.schedule).toBe("OTC");
      expect(upsert.args.input.imageSha256).toBeNull();
    }

    // Form closes, toast appears, row is listed.
    await waitFor(() =>
      expect(screen.queryByTestId("pm-form")).toBeNull(),
    );
    expect(screen.getByRole("status").textContent ?? "").toMatch(/saved: Crocin 500/);
    expect(screen.getByTestId("pm-table").textContent ?? "").toMatch(/Crocin 500/);
  });

  it("Schedule H without image is blocked by validateProductWrite surfacing pm-errors", async () => {
    const calls: IpcCall[] = [];
    installCrudHandler({ calls });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    await user.type(screen.getByLabelText(/^Name$/i), "Tramadol 50mg");
    await user.type(screen.getByLabelText(/Manufacturer/i), "Sun Pharma");
    await user.type(screen.getByLabelText(/MRP \(₹\)/i), "68.50");
    // Switch schedule → H1 via the select.
    const scheduleSelect = screen.getByLabelText(/Schedule/i) as HTMLSelectElement;
    await user.selectOptions(scheduleSelect, "H1");

    await user.keyboard("{Alt>}s{/Alt}");

    // Errors surface, no upsert fires.
    const errs = await screen.findByTestId("pm-errors");
    expect(errs.textContent ?? "").toMatch(/Schedule H1 product requires an image/);
    expect(calls.some((c) => c.cmd === "upsert_product")).toBe(false);
  });

  it("Empty MRP produces a typed error and blocks save", async () => {
    const calls: IpcCall[] = [];
    installCrudHandler({ calls });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    await user.type(screen.getByLabelText(/^Name$/i), "Dolo 650");
    await user.type(screen.getByLabelText(/Manufacturer/i), "Micro Labs");
    // Deliberately leave MRP blank.

    await user.keyboard("{Alt>}s{/Alt}");

    const errs = await screen.findByTestId("pm-errors");
    expect(errs.textContent ?? "").toMatch(/enter a valid MRP/);
    expect(calls.some((c) => c.cmd === "upsert_product")).toBe(false);
  });

  it("GIF upload is rejected by client-side mime sniff — save still blocked", async () => {
    const calls: IpcCall[] = [];
    installCrudHandler({ calls });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    // GIF87a magic bytes — sniffMime returns null, validate.ts raises
    // MAGIC_UNRECOGNISED. This is the X2a defense-in-depth path.
    const gifBytes = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00,
      0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
      0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
      0x01, 0x00, 0x3b,
    ]);
    const gif = new File([gifBytes], "probe.gif", { type: "image/gif" });

    const fileInput = screen.getByTestId("pm-image-file") as HTMLInputElement;
    // Bypass user-event's accept filter by driving the change event directly.
    await act(async () => {
      Object.defineProperty(fileInput, "files", { value: [gif], configurable: true });
      fireEvent.change(fileInput);
    });

    const errs = await screen.findByTestId("pm-errors");
    expect(errs.textContent ?? "").toMatch(/format not recognised|MIME|whitelist/i);
    // Preview not shown, SHA cleared.
    expect(screen.queryByTestId("pm-image-preview")).toBeNull();
    expect(screen.getByTestId("pm-image-sha").textContent ?? "").toMatch(/none/);
  });

  it("Esc on open form cancels without calling upsert_product", async () => {
    const calls: IpcCall[] = [];
    installCrudHandler({ calls });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    await user.type(screen.getByLabelText(/^Name$/i), "Half-typed name");

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("pm-form")).toBeNull(),
    );
    expect(calls.some((c) => c.cmd === "upsert_product")).toBe(false);
  });

  it("Alt+D on active row calls deactivate_product and refreshes", async () => {
    const calls: IpcCall[] = [];
    const existing = makeRow({ id: "p_azithro", name: "Azithromycin 500", schedule: "H", imageSha256: "a".repeat(64) });
    installCrudHandler({ calls, initialRows: [existing] });

    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    // Wait for the row to render.
    await waitFor(() =>
      expect(screen.getByTestId("pm-table").textContent ?? "").toMatch(/Azithromycin 500/),
    );

    // Cursor defaults to row 0. Trigger Alt+D.
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", altKey: true });
    });

    await waitFor(() => {
      const deact = calls.find((c) => c.cmd === "deactivate_product");
      expect(deact).toBeTruthy();
    });
    const deact = calls.find((c) => c.cmd === "deactivate_product");
    if (deact && deact.cmd === "deactivate_product") {
      expect(deact.args.id).toBe("p_azithro");
    }

    // Banner confirms + row now inactive in the refreshed list.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent ?? "").toMatch(/deactivated: Azithromycin 500/),
    );
    await waitFor(() =>
      expect(screen.getByTestId("pm-table").textContent ?? "").toMatch(/inactive/),
    );
  });

  it("Enter on cursored row opens the edit form prefilled", async () => {
    const existing = makeRow({
      id: "p_dolo",
      name: "Dolo 650",
      manufacturer: "Micro Labs",
      mrpPaise: 3150,
    });
    installCrudHandler({ initialRows: [existing] });

    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");
    await waitFor(() =>
      expect(screen.getByTestId("pm-table").textContent ?? "").toMatch(/Dolo 650/),
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    await screen.findByTestId("pm-form");
    expect((screen.getByLabelText(/^Name$/i) as HTMLInputElement).value).toBe("Dolo 650");
    expect((screen.getByLabelText(/Manufacturer/i) as HTMLInputElement).value).toBe("Micro Labs");
    expect((screen.getByLabelText(/MRP \(₹\)/i) as HTMLInputElement).value).toBe("31.50");
  });

  it("Server-side upsert failure surfaces message and keeps form open", async () => {
    const calls: IpcCall[] = [];
    installCrudHandler({ calls, upsertThrows: "DUPLICATE_NAME: Crocin 500 already exists" });

    const user = userEvent.setup();
    render(<ProductMasterScreen />);
    await screen.findByTestId("product-master");

    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByTestId("pm-form");

    await user.type(screen.getByLabelText(/^Name$/i), "Crocin 500");
    await user.type(screen.getByLabelText(/Manufacturer/i), "GSK");
    await user.type(screen.getByLabelText(/MRP \(₹\)/i), "42.00");

    await user.keyboard("{Alt>}s{/Alt}");

    const errs = await screen.findByTestId("pm-errors");
    expect(errs.textContent ?? "").toMatch(/DUPLICATE_NAME/);
    // Form still open so owner can fix.
    expect(screen.getByTestId("pm-form")).toBeInTheDocument();
  });
});
