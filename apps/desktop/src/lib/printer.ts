// printer.ts — thin glue between @pharmacare/printer-escpos (pure byte-builder)
// and the Tauri printer commands (printer_list / printer_write_bytes / printer_test).
//
// In dev / test the Tauri RPC is mocked; in production the bytes flow over IPC
// to printer.rs which shells out to the OS spooler.

import { printerListRpc, printerWriteBytesRpc, printerTestRpc, type DiscoveredPrinterDTO } from "./ipc.js";

const STORAGE_KEY_THERMAL = "pharmacare:default-thermal-printer";
const STORAGE_KEY_LABEL = "pharmacare:default-label-printer";

/** Convert a Uint8Array to base64. Works in browser + Node + jsdom. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** Read default thermal printer name from localStorage; returns null if unset. */
export function getDefaultThermalPrinter(): string | null {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY_THERMAL) ?? null; } catch { return null; }
}

export function setDefaultThermalPrinter(name: string): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY_THERMAL, name); } catch { /* ignore */ }
}

export function getDefaultLabelPrinter(): string | null {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY_LABEL) ?? null; } catch { return null; }
}

export function setDefaultLabelPrinter(name: string): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY_LABEL, name); } catch { /* ignore */ }
}

/** List installed printers via Tauri command. */
export async function listInstalledPrinters(): Promise<readonly DiscoveredPrinterDTO[]> {
  return printerListRpc();
}

/** Write raw ESC/POS bytes to a named printer. */
export async function printRawBytes(printerName: string, bytes: Uint8Array): Promise<void> {
  await printerWriteBytesRpc({ printerName, bytesB64: bytesToBase64(bytes) });
}

/** Auto-pick: explicit name > default thermal > first kind=thermal > first printer. */
export async function resolveThermalPrinter(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const def = getDefaultThermalPrinter();
  if (def) return def;
  let list: readonly DiscoveredPrinterDTO[] = [];
  try {
    const r = await listInstalledPrinters();
    list = Array.isArray(r) ? r : [];
  } catch {
    return null;
  }
  if (list.length === 0) return null;
  const thermal = list.find((p) => p.kind === "thermal");
  if (thermal) return thermal.name;
  return list[0]?.name ?? null;
}

/** Print bytes on the resolved thermal printer. Returns the printer name used. */
export async function printOnThermal(bytes: Uint8Array, explicit?: string | null): Promise<string> {
  const name = await resolveThermalPrinter(explicit);
  if (!name) throw new Error("No thermal printer found — run Settings → Printers");
  await printRawBytes(name, bytes);
  return name;
}

/** Send the printer's test pulse. */
export async function printerTestFire(printerName: string): Promise<void> {
  await printerTestRpc(printerName);
}
