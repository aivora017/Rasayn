import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";

// WebCrypto polyfill (force replace).
//
//  - Node 18 WSL          → `globalThis.crypto` undefined.
//  - Node 20+             → native webcrypto available.
//  - vitest + jsdom 25    → jsdom ships its OWN SubtleCrypto (a WebIDL
//                           wrapper around Node webcrypto). Its type
//                           validator rejects jsdom-realm ArrayBuffer
//                           with "Failed to execute 'digest' on
//                           'SubtleCrypto': 2nd argument is not instance
//                           of ArrayBuffer, Buffer, TypedArray, or
//                           DataView." We bypass jsdom's wrapper entirely
//                           by force-replacing globalThis.crypto with the
//                           Node webcrypto object; production code that
//                           resolves `crypto.subtle.digest` at runtime
//                           then hits Node directly, and the digest shim
//                           below coerces the BufferSource to a Node
//                           Buffer to sidestep any remaining realm skew.
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
  writable: true,
});

// subtle.digest cross-realm shim.
//
// vitest+jsdom swaps `globalThis` to the jsdom window, so any ArrayBuffer
// allocated via `new ArrayBuffer(...)` inside production code running under
// jsdom is bound to the jsdom realm. Node's webcrypto (which we injected
// above) uses strict Node-realm `instanceof ArrayBuffer` brand checks and
// rejects jsdom-realm buffers with:
//     "2nd argument is not instance of ArrayBuffer, Buffer, TypedArray, ..."
//
// Fix: wrap digest to coerce any BufferSource into a Node-realm `Buffer`
// (which webcrypto accepts natively) before delegating. Buffer lives in
// the Node realm by construction regardless of where the caller is.
type DigestFn = typeof webcrypto.subtle.digest;
const origDigest: DigestFn = webcrypto.subtle.digest.bind(webcrypto.subtle);
const wrappedDigest: DigestFn = (async (algo, data) => {
  let bytes: Uint8Array;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    bytes = new Uint8Array(
      view.buffer as ArrayBuffer,
      view.byteOffset,
      view.byteLength,
    );
  } else {
    bytes = new Uint8Array(data as ArrayBuffer);
  }
  return origDigest(algo, Buffer.from(bytes));
}) as DigestFn;
Object.defineProperty(webcrypto.subtle, "digest", {
  value: wrappedDigest,
  configurable: true,
  writable: true,
});

// Blob.arrayBuffer polyfill.
//
// jsdom 25 ships a Blob/File constructor but `arrayBuffer()` is not
// reliably present on the prototype across Node 18/20 pairings. The
// ProductMaster image-upload flow calls `file.arrayBuffer()` immediately
// after the operator picks a file, so without this polyfill the onChange
// throws before the pre-save similarity RPC fires. Implemented via the
// jsdom-provided FileReader; realm concerns are handled in the digest
// shim above.
type BlobProto = { arrayBuffer?: () => Promise<ArrayBuffer> };
const blobProto = (typeof Blob !== "undefined"
  ? (Blob.prototype as unknown as BlobProto)
  : undefined);
if (blobProto && typeof blobProto.arrayBuffer !== "function") {
  blobProto.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// ─── i18n bootstrap for tests ────────────────────────────
// react-i18next's useTranslation returns the key when no instance is
// initialized — that breaks every test that asserts on translated text.
// Initialize i18n synchronously before any test imports run.
import { initI18n } from "@pharmacare/design-system";
initI18n("en");

// ─── ResizeObserver polyfill (Recharts ResponsiveContainer) ──
if (typeof globalThis.ResizeObserver === "undefined") {
  class ROStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ROStub;
}

// ─── HTMLCanvasElement.getContext stub (AmbientMesh canvas) ──
// jsdom doesn't implement canvas; stub the methods AmbientMesh actually
// calls so the effect runs without throwing.
if (typeof HTMLCanvasElement !== "undefined") {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown;
  };
  proto.getContext = (() => ({
    clearRect: () => {},
    arc: () => {},
    beginPath: () => {},
    fill: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    globalAlpha: 1,
    fillStyle: "",
  })) as unknown as typeof proto.getContext;
}
