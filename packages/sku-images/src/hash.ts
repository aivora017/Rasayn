// SHA-256 hashing via WebCrypto (browser/Deno/modern Node).
// Used in the ProductMaster upload flow to compute the canonical product
// image hash before the bytes go over IPC. Rust side re-hashes on receive
// (never trust client-supplied hash).

export async function hashImage(bytes: Uint8Array): Promise<string> {
  // Copy to a plain ArrayBuffer to satisfy WebCrypto's BufferSource type
  // under strict TS settings (SharedArrayBuffer is not accepted).
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Sync hex helper for tests that already have a digest.
 * Do not use for unhashed payloads.
 */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}
