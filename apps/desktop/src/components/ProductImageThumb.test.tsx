import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProductImageThumb } from "./ProductImageThumb.js";
import { setIpcHandler, type IpcCall, type ProductImageRowDTO } from "../lib/ipc.js";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const ROW: ProductImageRowDTO = {
  productId: "prod_1",
  sha256: "a".repeat(64),
  mime: "image/png",
  sizeBytes: 70,
  bytesB64: PNG_B64,
  uploadedBy: "user_1",
  uploadedAt: "2026-04-17T00:00:00.000Z",
};

describe("ProductImageThumb (X2a)", () => {
  beforeEach(() => {
    setIpcHandler(async () => { throw new Error("handler not installed"); });
  });

  it("renders loading placeholder on first tick", () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "get_product_image") return new Promise(() => {});
      throw new Error(`unexpected ${call.cmd}`);
    });
    render(<ProductImageThumb productId="prod_1" />);
    expect(screen.getByTestId("pit-loading")).toBeTruthy();
  });

  it("renders image with correct data URL when RPC returns a row", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "get_product_image") return ROW;
      throw new Error(`unexpected ${call.cmd}`);
    });
    render(<ProductImageThumb productId="prod_1" alt="Paracetamol 500" />);
    const img = (await screen.findByTestId("pit-image")) as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(img.alt).toBe("Paracetamol 500");
  });

  it("renders missing placeholder and calls onMissing when RPC returns null", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "get_product_image") return null;
      throw new Error(`unexpected ${call.cmd}`);
    });
    const onMissing = vi.fn();
    render(<ProductImageThumb productId="prod_missing" onMissing={onMissing} />);
    const el = await screen.findByTestId("pit-missing");
    expect(el.textContent).toMatch(/no image/i);
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
  });

  it("renders error placeholder with message in title when RPC throws", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "get_product_image") throw new Error("disk unavailable");
      throw new Error(`unexpected ${call.cmd}`);
    });
    render(<ProductImageThumb productId="prod_err" />);
    const el = await screen.findByTestId("pit-error");
    expect(el.getAttribute("title")).toBe("disk unavailable");
  });

  it("respects size prop on width/height style", async () => {
    setIpcHandler(async (call: IpcCall) => {
      if (call.cmd === "get_product_image") return ROW;
      throw new Error(`unexpected ${call.cmd}`);
    });
    render(<ProductImageThumb productId="prod_1" size={96} />);
    const img = (await screen.findByTestId("pit-image")) as HTMLImageElement;
    expect(img.style.width).toBe("96px");
    expect(img.style.height).toBe("96px");
  });
});
