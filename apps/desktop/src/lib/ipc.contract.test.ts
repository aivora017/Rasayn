// G01 IPC contract tests — docs/reviews/coverage-gaps-2026-04-18.md.
//
// `lib/ipc.ts` is load-bearing for every screen: the single abstraction
// between React and Tauri/Rust. Each *Rpc wrapper carries two invariants
// that silent drift would break:
//
//   (a) the Rust `#[tauri::command]` name it invokes must stay stable
//       (rename on the Rust side without updating the TS wrapper = the
//       UI shows "save failed" with no logs);
//   (b) every outbound arg key must be camelCase to match
//       `#[serde(rename_all = "camelCase")]` on the Rust DTOs (a snake_case
//       drift produces a "missing field" validation error on the Rust
//       side that surfaces to the user as an opaque string).
//
// This suite installs a recording handler, exercises every wrapper with
// representative input, asserts the emitted `IpcCall` shape exactly,
// and runs a recursive camelCase check over the arg tree. It also
// covers the exported constants (`TENDER_TOLERANCE_PAISE`) and the
// default-handler error message.

import { beforeEach, describe, expect, it } from "vitest";

import {
  TENDER_TOLERANCE_PAISE,
  setIpcHandler,
  type IpcCall,
  // core
  healthCheckRpc,
  dbVersionRpc,
  // billing
  searchProductsRpc,
  pickFefoBatchRpc,
  listFefoCandidatesRpc,
  listPaymentsByBillRpc,
  saveBillRpc,
  listStockRpc,
  // GRN
  saveGrnRpc,
  // reports
  dayBookRpc,
  gstr1SummaryRpc,
  topMoversRpc,
  // directory
  searchCustomersRpc,
  upsertCustomerRpc,
  searchDoctorsRpc,
  upsertDoctorRpc,
  createPrescriptionRpc,
  listPrescriptionsRpc,
  // supplier templates
  listSupplierTemplatesRpc,
  upsertSupplierTemplateRpc,
  deleteSupplierTemplateRpc,
  listSuppliersRpc,
  // gmail
  gmailConnectRpc,
  gmailStatusRpc,
  gmailDisconnectRpc,
  gmailListMessagesRpc,
  gmailFetchAttachmentRpc,
  // shop + backup
  shopGetRpc,
  shopUpdateRpc,
  dbBackupRpc,
  dbRestoreRpc,
  // A1 product master
  upsertProductRpc,
  getProductRpc,
  listProductsRpc,
  deactivateProductRpc,
  // A13 expiry guard
  userGetRpc,
  getNearestExpiryRpc,
  recordExpiryOverrideRpc,
  // X2 / X2b images
  attachProductImageRpc,
  getProductImageRpc,
  deleteProductImageRpc,
  listProductsMissingImageRpc,
  findSimilarImagesRpc,
  getDuplicateSuspectsRpc,
  checkSimilarImagesForBytesRpc,
} from "./ipc.js";

// ----------------------------------------------------------------------------
// Test helpers

interface Recorded {
  call: IpcCall | null;
}

function recorder(result: unknown = null): { rec: Recorded; setup: () => void } {
  const rec: Recorded = { call: null };
  const setup = (): void => {
    setIpcHandler(async (call) => {
      rec.call = call;
      return result;
    });
  };
  return { rec, setup };
}

/**
 * Walk an object, return every leaf key. Used to assert no snake_case
 * slipped into outbound arg payloads.
 */
function leafKeys(obj: unknown, acc: string[] = []): string[] {
  if (obj === null || typeof obj !== "object") return acc;
  if (Array.isArray(obj)) {
    for (const item of obj) leafKeys(item, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    acc.push(k);
    if (v !== null && typeof v === "object") leafKeys(v, acc);
  }
  return acc;
}

function expectCamelCaseArgs(call: IpcCall): void {
  const keys = leafKeys(call.args);
  for (const k of keys) {
    expect(k, `arg key "${k}" must not contain "_" (must be camelCase)`).not.toMatch(/_/);
  }
}

beforeEach(() => {
  // Reset handler between tests so a leaked stub from one test can't bleed
  // into another. Also ensures the "default handler throws" check below
  // sees a deterministic baseline before it flips it back.
  setIpcHandler(async () => {
    throw new Error("ipc: no handler installed (call setIpcHandler during bootstrap)");
  });
});

// ----------------------------------------------------------------------------

describe("ipc.ts · exported constants", () => {
  it("TENDER_TOLERANCE_PAISE is 50 paise (ADR 0012 rounding tolerance)", () => {
    expect(TENDER_TOLERANCE_PAISE).toBe(50);
  });
});

describe("ipc.ts · default handler", () => {
  it("throws a named error when no handler is installed", async () => {
    // beforeEach already reset to the "no handler installed" default.
    await expect(healthCheckRpc()).rejects.toThrow(/no handler installed/);
  });

  it("handler rejections propagate their message unchanged", async () => {
    setIpcHandler(async () => {
      throw new Error("rust side: database is locked");
    });
    await expect(dbVersionRpc()).rejects.toThrow(/database is locked/);
  });
});

// ----------------------------------------------------------------------------

describe("ipc.ts · command name + arg shape · core", () => {
  it("health_check — no args", async () => {
    const { rec, setup } = recorder({ ok: true, version: "0.1.0" });
    setup();
    await healthCheckRpc();
    expect(rec.call).toEqual({ cmd: "health_check", args: {} });
  });

  it("db_version — no args", async () => {
    const { rec, setup } = recorder(19);
    setup();
    await dbVersionRpc();
    expect(rec.call).toEqual({ cmd: "db_version", args: {} });
  });
});

describe("ipc.ts · command name + arg shape · billing", () => {
  it("search_products — whitespace-only query short-circuits without IPC", async () => {
    const { rec, setup } = recorder([]);
    setup();
    const out = await searchProductsRpc("   ", 5);
    expect(out).toEqual([]);
    expect(rec.call).toBeNull();
  });

  it("search_products — emits camelCase q + limit", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await searchProductsRpc("crocin", 7);
    expect(rec.call).toEqual({
      cmd: "search_products",
      args: { q: "crocin", limit: 7 },
    });
    expectCamelCaseArgs(rec.call!);
  });

  it("pick_fefo_batch — productId camelCase", async () => {
    const { rec, setup } = recorder(null);
    setup();
    await pickFefoBatchRpc("prod_1");
    expect(rec.call).toEqual({ cmd: "pick_fefo_batch", args: { productId: "prod_1" } });
    expectCamelCaseArgs(rec.call!);
  });

  it("list_fefo_candidates — productId camelCase", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listFefoCandidatesRpc("prod_1");
    expect(rec.call).toEqual({
      cmd: "list_fefo_candidates",
      args: { productId: "prod_1" },
    });
  });

  it("list_payments_by_bill — billId camelCase", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listPaymentsByBillRpc("bill_1");
    expect(rec.call).toEqual({
      cmd: "list_payments_by_bill",
      args: { billId: "bill_1" },
    });
  });

  it("save_bill — nested input keys are all camelCase (incl. tenders)", async () => {
    const { rec, setup } = recorder({
      billId: "bill_1",
      grandTotalPaise: 1000,
      linesInserted: 1,
    });
    setup();
    await saveBillRpc("bill_1", {
      shopId: "shop_local",
      billNo: "B-1",
      cashierId: "user_sourav_owner",
      paymentMode: "cash",
      lines: [
        { productId: "p1", batchId: "b1", mrpPaise: 1000, qty: 1, gstRate: 12 },
      ],
      tenders: [{ mode: "cash", amountPaise: 1000 }],
    });
    expect(rec.call!.cmd).toBe("save_bill");
    expect(rec.call!.args).toMatchObject({
      billId: "bill_1",
      input: {
        shopId: "shop_local",
        billNo: "B-1",
        cashierId: "user_sourav_owner",
        paymentMode: "cash",
      },
    });
    expectCamelCaseArgs(rec.call!);
  });

  it("list_stock — no opts serialises as empty args", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listStockRpc();
    expect(rec.call).toEqual({ cmd: "list_stock", args: {} });
  });

  it("list_stock — opts wrapped as { opts: ... } (matches Rust marker)", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listStockRpc({ q: "crocin", lowStockUnder: 5 });
    expect(rec.call).toEqual({
      cmd: "list_stock",
      args: { opts: { q: "crocin", lowStockUnder: 5 } },
    });
    expectCamelCaseArgs(rec.call!);
  });
});

describe("ipc.ts · command name + arg shape · GRN + reports", () => {
  it("save_grn — input keys camelCase + nested line keys camelCase", async () => {
    const { rec, setup } = recorder({ grnId: "g1", linesInserted: 1, batchIds: ["b1"] });
    setup();
    await saveGrnRpc("g1", {
      supplierId: "sup_1",
      invoiceNo: "INV-1",
      invoiceDate: "2026-04-18",
      lines: [
        {
          productId: "p1",
          batchNo: "B-1",
          mfgDate: "2026-01-01",
          expiryDate: "2027-12-31",
          qty: 10,
          purchasePricePaise: 500,
          mrpPaise: 1000,
        },
      ],
    });
    expect(rec.call!.cmd).toBe("save_grn");
    expect(rec.call!.args).toMatchObject({
      grnId: "g1",
      input: { supplierId: "sup_1", invoiceNo: "INV-1", invoiceDate: "2026-04-18" },
    });
    expectCamelCaseArgs(rec.call!);
  });

  it("day_book — shopId + date", async () => {
    const { rec, setup } = recorder({
      date: "2026-04-18",
      rows: [],
      summary: {
        billCount: 0,
        grossPaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        byPayment: {},
      },
    });
    setup();
    await dayBookRpc("shop_local", "2026-04-18");
    expect(rec.call).toEqual({
      cmd: "day_book",
      args: { shopId: "shop_local", date: "2026-04-18" },
    });
  });

  it("gstr1_summary — shopId + from + to", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await gstr1SummaryRpc("shop_local", "2026-04-01", "2026-04-30");
    expect(rec.call).toEqual({
      cmd: "gstr1_summary",
      args: { shopId: "shop_local", from: "2026-04-01", to: "2026-04-30" },
    });
  });

  it("top_movers — includes limit default applied at wrapper", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await topMoversRpc("shop_local", "2026-04-01", "2026-04-30");
    expect(rec.call).toEqual({
      cmd: "top_movers",
      args: { shopId: "shop_local", from: "2026-04-01", to: "2026-04-30", limit: 10 },
    });
  });
});

describe("ipc.ts · command name + arg shape · directory", () => {
  it("search_customers", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await searchCustomersRpc("shop_local", "raj", 10);
    expect(rec.call).toEqual({
      cmd: "search_customers",
      args: { shopId: "shop_local", q: "raj", limit: 10 },
    });
  });

  it("upsert_customer — input nested, all keys camelCase", async () => {
    const { rec, setup } = recorder("c_1");
    setup();
    await upsertCustomerRpc({
      shopId: "shop_local",
      name: "Raj",
      phone: "9000000000",
      consentAbdm: false,
      consentMarketing: false,
    });
    expect(rec.call!.cmd).toBe("upsert_customer");
    expect(rec.call!.args).toMatchObject({ input: { shopId: "shop_local", name: "Raj" } });
    expectCamelCaseArgs(rec.call!);
  });

  it("search_doctors", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await searchDoctorsRpc("sharma", 5);
    expect(rec.call).toEqual({
      cmd: "search_doctors",
      args: { q: "sharma", limit: 5 },
    });
  });

  it("upsert_doctor — regNo preserved camelCase", async () => {
    const { rec, setup } = recorder("d_1");
    setup();
    await upsertDoctorRpc({ regNo: "MH-1", name: "Dr Sharma" });
    expect(rec.call).toEqual({
      cmd: "upsert_doctor",
      args: { input: { regNo: "MH-1", name: "Dr Sharma" } },
    });
    expectCamelCaseArgs(rec.call!);
  });

  it("create_prescription — customerId + doctorId + issuedDate", async () => {
    const { rec, setup } = recorder("rx_1");
    setup();
    await createPrescriptionRpc({
      shopId: "shop_local",
      customerId: "c_1",
      kind: "paper",
      issuedDate: "2026-04-18",
    });
    expect(rec.call!.cmd).toBe("create_prescription");
    expect(rec.call!.args).toMatchObject({
      input: {
        shopId: "shop_local",
        customerId: "c_1",
        kind: "paper",
        issuedDate: "2026-04-18",
      },
    });
    expectCamelCaseArgs(rec.call!);
  });

  it("list_prescriptions — customerId camelCase", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listPrescriptionsRpc("c_1");
    expect(rec.call).toEqual({
      cmd: "list_prescriptions",
      args: { customerId: "c_1" },
    });
  });
});

describe("ipc.ts · command name + arg shape · supplier templates + suppliers", () => {
  it("list_supplier_templates — shopId only when no supplierId", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listSupplierTemplatesRpc("shop_local");
    expect(rec.call).toEqual({
      cmd: "list_supplier_templates",
      args: { shopId: "shop_local" },
    });
  });

  it("list_supplier_templates — shopId + supplierId when supplied", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listSupplierTemplatesRpc("shop_local", "sup_1");
    expect(rec.call).toEqual({
      cmd: "list_supplier_templates",
      args: { shopId: "shop_local", supplierId: "sup_1" },
    });
  });

  it("upsert_supplier_template — nested headerPatterns + columnMap camelCase", async () => {
    const { rec, setup } = recorder("t_1");
    setup();
    await upsertSupplierTemplateRpc({
      shopId: "shop_local",
      supplierId: "sup_1",
      name: "Cipla",
      headerPatterns: { invoiceNo: "INV", invoiceDate: "DT", total: "T" },
      linePatterns: { row: ".+" },
      columnMap: { productName: 0, qty: 1, mrp: 2 },
    });
    expect(rec.call!.cmd).toBe("upsert_supplier_template");
    expectCamelCaseArgs(rec.call!);
  });

  it("delete_supplier_template — id only", async () => {
    const { rec, setup } = recorder(undefined);
    setup();
    await deleteSupplierTemplateRpc("t_1");
    expect(rec.call).toEqual({ cmd: "delete_supplier_template", args: { id: "t_1" } });
  });

  it("list_suppliers — shopId camelCase (D03 contract)", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await listSuppliersRpc("shop_local");
    expect(rec.call).toEqual({ cmd: "list_suppliers", args: { shopId: "shop_local" } });
  });
});

describe("ipc.ts · command name + arg shape · gmail (X1)", () => {
  it("gmail_connect / gmail_status / gmail_disconnect all take { shopId }", async () => {
    const { rec: r1, setup: s1 } = recorder({
      connected: true,
      accountEmail: null,
      scopes: [],
      grantedAt: null,
    });
    s1();
    await gmailConnectRpc("shop_local");
    expect(r1.call).toEqual({ cmd: "gmail_connect", args: { shopId: "shop_local" } });

    const { rec: r2, setup: s2 } = recorder({
      connected: false,
      accountEmail: null,
      scopes: [],
      grantedAt: null,
    });
    s2();
    await gmailStatusRpc("shop_local");
    expect(r2.call).toEqual({ cmd: "gmail_status", args: { shopId: "shop_local" } });

    const { rec: r3, setup: s3 } = recorder(undefined);
    s3();
    await gmailDisconnectRpc("shop_local");
    expect(r3.call).toEqual({ cmd: "gmail_disconnect", args: { shopId: "shop_local" } });
  });

  it("gmail_list_messages — shopId + query + max", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await gmailListMessagesRpc("shop_local", "label:distributor-bills", 15);
    expect(rec.call).toEqual({
      cmd: "gmail_list_messages",
      args: { shopId: "shop_local", query: "label:distributor-bills", max: 15 },
    });
  });

  it("gmail_fetch_attachment — shopId + messageId + attachmentId + filename + mimeType", async () => {
    const { rec, setup } = recorder({
      path: "/tmp/a.csv",
      size: 10,
      mimeType: "text/csv",
      filename: "a.csv",
      text: null,
    });
    setup();
    await gmailFetchAttachmentRpc("shop_local", "m1", "a1", "a.csv", "text/csv");
    expect(rec.call).toEqual({
      cmd: "gmail_fetch_attachment",
      args: {
        shopId: "shop_local",
        messageId: "m1",
        attachmentId: "a1",
        filename: "a.csv",
        mimeType: "text/csv",
      },
    });
    expectCamelCaseArgs(rec.call!);
  });
});

describe("ipc.ts · command name + arg shape · shop + backup + A1 products", () => {
  it("shop_get / shop_update — nested input camelCase", async () => {
    const { rec: r1, setup: s1 } = recorder(null);
    s1();
    await shopGetRpc("shop_local");
    expect(r1.call).toEqual({ cmd: "shop_get", args: { id: "shop_local" } });

    const { rec: r2, setup: s2 } = recorder({
      id: "shop_local",
      name: "X",
      gstin: "27AAAAA0000A1Z5",
      stateCode: "27",
      retailLicense: "L",
      address: "A",
      createdAt: "2026-04-18T00:00:00Z",
    });
    s2();
    await shopUpdateRpc({
      id: "shop_local",
      name: "X",
      gstin: "27AAAAA0000A1Z5",
      stateCode: "27",
      retailLicense: "L",
      address: "A",
    });
    expect(r2.call!.cmd).toBe("shop_update");
    expectCamelCaseArgs(r2.call!);
  });

  it("db_backup / db_restore — destPath / sourcePath camelCase", async () => {
    const { rec: r1, setup: s1 } = recorder({ path: "/tmp/b", sizeBytes: 1, integrity: "ok" });
    s1();
    await dbBackupRpc("/tmp/b");
    expect(r1.call).toEqual({ cmd: "db_backup", args: { destPath: "/tmp/b" } });

    const { rec: r2, setup: s2 } = recorder({
      restoredFrom: "/tmp/b",
      preRestoreBackup: null,
      integrity: "ok",
    });
    s2();
    await dbRestoreRpc("/tmp/b");
    expect(r2.call).toEqual({ cmd: "db_restore", args: { sourcePath: "/tmp/b" } });
  });

  it("upsert_product — every ProductWriteDTO field camelCase", async () => {
    const { rec, setup } = recorder({
      id: "p1",
      name: "X",
      genericName: null,
      manufacturer: "ACME",
      hsn: "3004",
      gstRate: 12,
      schedule: "OTC",
      packForm: "tablet",
      packSize: 10,
      mrpPaise: 100,
      nppaMaxMrpPaise: null,
      imageSha256: null,
      isActive: true,
      createdAt: "2026-04-18T00:00:00Z",
      updatedAt: "2026-04-18T00:00:00Z",
    });
    setup();
    await upsertProductRpc({
      name: "X",
      genericName: null,
      manufacturer: "ACME",
      hsn: "3004",
      gstRate: 12,
      schedule: "OTC",
      packForm: "tablet",
      packSize: 10,
      mrpPaise: 100,
      nppaMaxMrpPaise: null,
      imageSha256: null,
    });
    expect(rec.call!.cmd).toBe("upsert_product");
    expectCamelCaseArgs(rec.call!);
  });

  it("get_product / list_products / deactivate_product", async () => {
    const { rec: r1, setup: s1 } = recorder(null);
    s1();
    await getProductRpc("p1");
    expect(r1.call).toEqual({ cmd: "get_product", args: { id: "p1" } });

    const { rec: r2, setup: s2 } = recorder([]);
    s2();
    await listProductsRpc();
    expect(r2.call).toEqual({ cmd: "list_products", args: {} });

    const { rec: r3, setup: s3 } = recorder([]);
    s3();
    await listProductsRpc({ q: "x", activeOnly: true, limit: 10, offset: 0 });
    expect(r3.call).toEqual({
      cmd: "list_products",
      args: { args: { q: "x", activeOnly: true, limit: 10, offset: 0 } },
    });
    expectCamelCaseArgs(r3.call!);

    const { rec: r4, setup: s4 } = recorder(undefined);
    s4();
    await deactivateProductRpc("p1");
    expect(r4.call).toEqual({ cmd: "deactivate_product", args: { id: "p1" } });
  });
});

describe("ipc.ts · command name + arg shape · A13 expiry + X2/X2b images", () => {
  it("user_get / get_nearest_expiry / record_expiry_override", async () => {
    const { rec: r1, setup: s1 } = recorder(null);
    s1();
    await userGetRpc("user_sourav_owner");
    expect(r1.call).toEqual({ cmd: "user_get", args: { id: "user_sourav_owner" } });

    const { rec: r2, setup: s2 } = recorder(null);
    s2();
    await getNearestExpiryRpc("p1");
    expect(r2.call).toEqual({ cmd: "get_nearest_expiry", args: { productId: "p1" } });

    const { rec: r3, setup: s3 } = recorder({ auditId: "a1", daysPastExpiry: 3 });
    s3();
    await recordExpiryOverrideRpc({
      batchId: "b1",
      actorUserId: "user_sourav_owner",
      reason: "customer insists, last strip",
    });
    expect(r3.call!.cmd).toBe("record_expiry_override");
    expect(r3.call!.args).toEqual({
      input: {
        batchId: "b1",
        actorUserId: "user_sourav_owner",
        reason: "customer insists, last strip",
      },
    });
    expectCamelCaseArgs(r3.call!);
  });

  it("attach_product_image — bytesB64 + reportedMime + actorUserId all camelCase", async () => {
    const { rec, setup } = recorder({
      sha256: "",
      mime: "image/png",
      sizeBytes: 5,
      productId: "p1",
      phash: null,
    });
    setup();
    await attachProductImageRpc({
      productId: "p1",
      bytesB64: "aGVsbG8=",
      reportedMime: "image/png",
      actorUserId: "u1",
    });
    expect(rec.call!.cmd).toBe("attach_product_image");
    expect(rec.call!.args).toEqual({
      input: {
        productId: "p1",
        bytesB64: "aGVsbG8=",
        reportedMime: "image/png",
        actorUserId: "u1",
      },
    });
    expectCamelCaseArgs(rec.call!);
  });

  it("get_product_image / delete_product_image / list_products_missing_image", async () => {
    const { rec: r1, setup: s1 } = recorder(null);
    s1();
    await getProductImageRpc("p1");
    expect(r1.call).toEqual({ cmd: "get_product_image", args: { productId: "p1" } });

    const { rec: r2, setup: s2 } = recorder(undefined);
    s2();
    await deleteProductImageRpc("p1", "u1");
    expect(r2.call).toEqual({
      cmd: "delete_product_image",
      args: { productId: "p1", actorUserId: "u1" },
    });
    expectCamelCaseArgs(r2.call!);

    const { rec: r3, setup: s3 } = recorder([]);
    s3();
    await listProductsMissingImageRpc();
    expect(r3.call).toEqual({ cmd: "list_products_missing_image", args: {} });
  });

  it("find_similar_images / get_duplicate_suspects — maxDistance camelCase", async () => {
    const { rec: r1, setup: s1 } = recorder([]);
    s1();
    await findSimilarImagesRpc("p1", 6);
    expect(r1.call).toEqual({
      cmd: "find_similar_images",
      args: { productId: "p1", maxDistance: 6 },
    });
    expectCamelCaseArgs(r1.call!);

    const { rec: r2, setup: s2 } = recorder([]);
    s2();
    await getDuplicateSuspectsRpc(4);
    expect(r2.call).toEqual({
      cmd: "get_duplicate_suspects",
      args: { maxDistance: 4 },
    });
    expectCamelCaseArgs(r2.call!);
  });

  it("check_similar_images_for_bytes — input wrapper + camelCase", async () => {
    const { rec, setup } = recorder([]);
    setup();
    await checkSimilarImagesForBytesRpc({
      bytesB64: "AAAA",
      reportedMime: "image/png",
      excludeProductId: "p_edit",
      maxDistance: 12,
    });
    expect(rec.call).toEqual({
      cmd: "check_similar_images_for_bytes",
      args: {
        input: {
          bytesB64: "AAAA",
          reportedMime: "image/png",
          excludeProductId: "p_edit",
          maxDistance: 12,
        },
      },
    });
    expectCamelCaseArgs(rec.call!);
  });
});
