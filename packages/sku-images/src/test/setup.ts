// WebCrypto polyfill for test runtime.
//
// We install Node's built-in `webcrypto` onto `globalThis.crypto` so code
// that calls `crypto.subtle.digest(...)` works regardless of runtime quirks:
//
//  - Node 18 WSL           → `globalThis.crypto` is undefined.
//  - Node 20+              → native webcrypto; polyfill is a no-op.
//  - vitest + jsdom        → jsdom publishes a partial `crypto` stub that
//                            lacks `subtle`, so we must *overwrite* it.
//
// jsdom's stub is a non-configurable getter, so direct assignment is
// silently ignored. Use `Object.defineProperty` with `writable: true` and
// `configurable: true` to force the overwrite.

import { webcrypto } from "node:crypto";

const existing = (globalThis as { crypto?: { subtle?: unknown } }).crypto;
if (typeof existing?.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
