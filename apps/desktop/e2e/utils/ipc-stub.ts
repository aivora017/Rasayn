// Deterministic in-page IPC stub for browser-mode E2E.
//
// apps/desktop/src/main.tsx attempts `import("@tauri-apps/api/core")`,
// which throws under vite (no Tauri runtime). The catch-block then
// installs a no-op handler returning null. That makes the React app
// usable but every saveBillRpc / list_stock / health_check call returns
// null, which most screens render as "loading…" forever.
//
// This stub replaces both: it intercepts `@tauri-apps/api/core` import
// (by attaching a global the React app reads first) AND directly
// overrides `setIpcHandler` once the bundle has loaded.
//
// Strategy:
//   1. Before any app JS runs, define `window.__PHARMACARE_E2E_IPC__`
//      as a Map of cmd → handler with sensible defaults from
//      fixtures/seed.ts.
//   2. After the main module installs its real handler (a microtask
//      later), we monkey-patch `window.__PHARMACARE_E2E_INVOKE__` so
//      calls route through our stub even if the Tauri import path
//      somehow worked.
//   3. We also patch `window.__TAURI_INTERNALS__.invoke` so any direct
//      `@tauri-apps/api/core` call also routes here.
//
// This file runs inside the page (via page.addInitScript), so it must
// be self-contained — no node imports.

import {
  SEED_SHOP,
  SEED_USER,
  SEED_DRUG,
  SEED_BATCH,
  SEED_BILL,
} from "../fixtures/seed.js";

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

declare global {
  interface Window {
    __PHARMACARE_E2E_IPC__?: Map<string, Handler>;
    __PHARMACARE_E2E_CALLS__?: Array<{ cmd: string; args: unknown }>;
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  }
}

export function buildHandlerMap(): Map<string, Handler> {
  const m = new Map<string, Handler>();

  // ----- bootstrap -----
  m.set("health_check", () => ({ ok: true, version: "e2e-0.0.1" }));
  m.set("db_version", () => 49);
  m.set("shop_get", () => ({ ...SEED_SHOP }));
  m.set("shops_list", () => [{ ...SEED_SHOP }]);
  m.set("shops_inventory_summary", () => [
    { shopId: SEED_SHOP.id, productCount: 1, totalQty: SEED_BATCH.qtyOnHand },
  ]);
  m.set("get_current_user", () => ({ ...SEED_USER }));
  m.set("list_users", () => [{ ...SEED_USER }]);

  // ----- products / batches -----
  m.set("search_products", (args) => {
    const q = String((args as { q?: string }).q ?? "").toLowerCase();
    if (!q) return [];
    if (
      SEED_DRUG.name.toLowerCase().includes(q) ||
      SEED_DRUG.genericName.toLowerCase().includes(q)
    ) {
      return [{ ...SEED_DRUG }];
    }
    return [];
  });
  m.set("pick_fefo_batch", () => ({ ...SEED_BATCH }));
  m.set("list_fefo_candidates", () => [{ ...SEED_BATCH }]);
  m.set("list_stock", () => [
    {
      productId: SEED_DRUG.id,
      name: SEED_DRUG.name,
      genericName: SEED_DRUG.genericName,
      manufacturer: SEED_DRUG.manufacturer,
      schedule: SEED_DRUG.schedule,
      gstRate: SEED_DRUG.gstRate,
      mrpPaise: SEED_DRUG.mrpPaise,
      totalQty: SEED_BATCH.qtyOnHand,
      batchCount: 1,
      nearestExpiry: SEED_BATCH.expiryDate,
      daysToExpiry: 365,
      hasExpiredStock: 0,
    },
  ]);
  m.set("batches_list_by_shop", () => [{ ...SEED_BATCH }]);

  // ----- billing -----
  m.set("save_bill", (args) => {
    const a = args as { billId?: string; input?: { lines?: unknown[] } };
    const linesInserted = a.input?.lines?.length ?? 0;
    return {
      billId: a.billId ?? SEED_BILL.id,
      grandTotalPaise: SEED_BILL.grandTotalPaise,
      linesInserted,
    };
  });
  m.set("get_bill_full", () => ({
    bill: { ...SEED_BILL },
    lines: SEED_BILL.lines,
    payments: [
      {
        id: "pay_e2e_001",
        billId: SEED_BILL.id,
        mode: "cash",
        amountPaise: SEED_BILL.grandTotalPaise,
        refNo: null,
        createdAt: "2026-05-08T00:00:00Z",
      },
    ],
  }));
  m.set("get_refundable_qty", () => 2);
  m.set("list_payments_by_bill", () => []);
  m.set("list_pending_rx", () => []);
  m.set("list_customer_allergies", () => []);
  m.set("list_dose_ranges", () => []);
  m.set("list_ddi_pairs", () => []);

  // ----- GRN -----
  m.set("grn_save", (args) => {
    const a = args as { lines?: unknown[] };
    return { grnId: "grn_e2e_001", linesInserted: a.lines?.length ?? 1 };
  });
  m.set("grn_list_recent", () => []);
  m.set("grn_parse_csv", () => ({ rows: [], errors: [] }));

  // ----- returns -----
  m.set("create_partial_return", () => ({
    returnId: "ret_e2e_001",
    refundPaise: 2_800,
  }));
  m.set("save_partial_return", () => ({
    returnId: "ret_e2e_001",
    refundPaise: 2_800,
  }));

  // ----- GSTR-3B / reports -----
  m.set("generate_gstr3b_payload", () => ({
    period: "052026",
    outwardTaxableSupplies: { taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0, cessPaise: 0 },
    inwardSuppliesReverseCharge: { taxablePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0, cessPaise: 0 },
    nonGstOutward: 0,
  }));
  m.set("generate_gstr1_payload", () => ({ bills: [] }));
  m.set("save_gstr1_return", () => ({ id: "gstr1_e2e_001", status: "draft" }));
  m.set("list_gst_returns", () => []);
  m.set("export_gstr3b_pdf", () => "/tmp/e2e_gstr3b.pdf");
  m.set("export_gstr3b_json", () => "/tmp/e2e_gstr3b.json");

  // ----- compliance / dpdp / scheduling -----
  m.set("list_schedule_register", () => []);
  m.set("schedule_register_pdf_path", () => "/tmp/e2e_sched.pdf");
  m.set("dpdp_list_consents", () => []);
  m.set("dpdp_check_billing_consent", () => ({ ok: true, consentId: null }));
  m.set("dpdp_list_dsr", () => []);

  // ----- reorder / forecast -----
  m.set("list_reorder_suggestions", () => []);
  m.set("list_demand_forecast", () => []);

  // ----- printer / settings -----
  m.set("printer_get_config", () => ({
    model: "epson_tm_t82",
    width: 80,
    drawerKick: true,
  }));
  m.set("printer_save_config", () => ({ ok: true }));
  m.set("printer_test_print", () => ({ ok: true }));

  // ----- license / update -----
  m.set("license_get", () => ({ status: "trial", daysLeft: 30 }));
  m.set("license_activate", () => ({ ok: true }));
  m.set("update_check", () => ({ available: false, version: "e2e-0.0.1" }));

  // ----- crypto / shop dpo -----
  m.set("crypto_get_or_create_dek", () => ({ ok: true }));
  m.set("shops_get_dpo", () => ({ name: null, email: null, phone: null }));
  m.set("shops_set_dpo", () => ({ ok: true }));

  // ----- abdm / cold chain (stubs) -----
  m.set("cold_chain_list_excursions", () => []);
  m.set("abdm_list_consents", () => []);

  return m;
}

export const IPC_STUB_INSTALL_SCRIPT = String.raw`
(() => {
  if (window.__PHARMACARE_E2E_IPC__) return; // idempotent
  const calls = [];
  window.__PHARMACARE_E2E_CALLS__ = calls;

  // The full handler map is rebuilt server-side and serialised; the
  // page receives it via a JSON blob attached at page.addInitScript
  // time. See e2e/utils/install-stub.ts.
  const map = (window.__PHARMACARE_E2E_IPC_RAW__ || {});
  window.__PHARMACARE_E2E_IPC__ = new Map(Object.entries(map));

  async function dispatch(cmd, args) {
    calls.push({ cmd, args: args ?? null });
    const fn = window.__PHARMACARE_E2E_IPC__.get(cmd);
    if (!fn) {
      // Unknown commands return null — permissive by design so the app
      // mounts and renders rather than throwing.
      console.warn("[e2e ipc-stub] no handler for", cmd);
      return null;
    }
    try {
      const v = fn(args ?? {});
      return await Promise.resolve(v);
    } catch (e) {
      console.error("[e2e ipc-stub] handler threw for", cmd, e);
      throw e;
    }
  }

  // Tauri 2.x uses window.__TAURI_INTERNALS__.invoke — patch it so the
  // app's main.tsx try/catch picks the Tauri path instead of falling
  // through to the no-op stub.
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI_INTERNALS__.invoke = dispatch;

  // Some versions look for window.__TAURI_IPC__ — patch as well.
  window.__TAURI_IPC__ = (msg) => {
    // best-effort shape match; the modern API uses __TAURI_INTERNALS__
    if (msg && msg.cmd) return dispatch(msg.cmd, msg.payload);
    return null;
  };

  // Direct accessors for tests.
  window.__PHARMACARE_E2E_DISPATCH__ = dispatch;
})();
`;

// ----------------------------------------------------------------------
// Page-level install helpers (used by spec files).
// Importing @playwright/test types only — no runtime cost.
// ----------------------------------------------------------------------

import type { Page } from "@playwright/test";

export async function installIpcStub(
  page: Page,
  overrides: Record<string, (args: Record<string, unknown>) => unknown> = {},
): Promise<void> {
  const map = buildHandlerMap();
  for (const [k, v] of Object.entries(overrides)) map.set(k, v);

  const serialised: Record<string, string> = {};
  for (const [k, fn] of map.entries()) {
    serialised[k] = `(${fn.toString()})`;
  }

  const bootstrap = `
    (() => {
      const raw = ${JSON.stringify(serialised)};
      const reattached = {};
      for (const k in raw) {
        // eslint-disable-next-line no-eval
        reattached[k] = eval(raw[k]);
      }
      window.__PHARMACARE_E2E_IPC_RAW__ = reattached;
    })();
    ${IPC_STUB_INSTALL_SCRIPT}
  `;

  await page.addInitScript({ content: bootstrap });
}

export async function getIpcCalls(
  page: Page,
): Promise<Array<{ cmd: string; args: unknown }>> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __PHARMACARE_E2E_CALLS__?: Array<{ cmd: string; args: unknown }>;
    };
    return w.__PHARMACARE_E2E_CALLS__ ?? [];
  });
}

export async function expectCmdCalled(
  page: Page,
  cmd: string,
): Promise<boolean> {
  const calls = await getIpcCalls(page);
  return calls.some((c) => c.cmd === cmd);
}
