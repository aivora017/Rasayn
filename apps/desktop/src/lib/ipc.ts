// IPC abstraction. In production, calls Tauri's invoke(); in tests/dev
// without Tauri, calls a configurable mock handler.
//
// Contract: JS sends camelCase arg names; Rust commands use serde
// rename_all = "camelCase" on any input struct so field names match.

export interface ProductHit {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly manufacturer: string;
  readonly gstRate: 0 | 5 | 12 | 18 | 28;
  readonly schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
  readonly mrpPaise: number;
}

export interface BatchPick {
  readonly id: string;
  readonly batchNo: string;
  readonly expiryDate: string;
  readonly qtyOnHand: number;
  readonly mrpPaise: number;
}

export interface SaveBillLine {
  readonly productId: string;
  readonly batchId: string;
  readonly mrpPaise: number;
  readonly qty: number;
  readonly gstRate: 0 | 5 | 12 | 18 | 28;
  readonly discountPct?: number;
}

export type TenderMode = "cash" | "upi" | "card" | "credit" | "wallet";

export interface Tender {
  readonly mode: TenderMode;
  readonly amountPaise: number;
  readonly refNo?: string | null;
}

export interface PaymentRowDTO {
  readonly id: string;
  readonly billId: string;
  readonly mode: TenderMode;
  readonly amountPaise: number;
  readonly refNo: string | null;
  readonly createdAt: string;
}

export const TENDER_TOLERANCE_PAISE = 50 as const;

export interface SaveBillInput {
  readonly shopId: string;
  readonly billNo: string;
  readonly cashierId: string;
  readonly customerId?: string | null;
  readonly doctorId?: string | null;
  readonly rxId?: string | null;
  readonly paymentMode: "cash" | "upi" | "card" | "credit" | "wallet" | "split";
  readonly customerStateCode?: string | null;
  readonly lines: readonly SaveBillLine[];
  /** A8 (ADR 0012). Optional; see @pharmacare/bill-repo for semantics. */
  readonly tenders?: readonly Tender[];
}

export interface SaveBillResult {
  readonly billId: string;
  readonly grandTotalPaise: number;
  readonly linesInserted: number;
}

export interface Health { readonly ok: boolean; readonly version: string }

export type IpcCall =
  | { cmd: "health_check"; args: Record<string, never> }
  | { cmd: "db_version"; args: Record<string, never> }
  | { cmd: "search_products"; args: { q: string; limit?: number } }
  | { cmd: "pick_fefo_batch"; args: { productId: string } }
  | { cmd: "list_fefo_candidates"; args: { productId: string } }
  | { cmd: "save_bill"; args: { billId: string; input: SaveBillInput } }
  | { cmd: "list_payments_by_bill"; args: { billId: string } }
  | { cmd: "list_stock"; args: { opts?: ListStockOpts } }
  | { cmd: "save_grn"; args: { grnId: string; input: SaveGrnInput } }
  | { cmd: "day_book"; args: { shopId: string; date: string } }
  | { cmd: "gstr1_summary"; args: { shopId: string; from: string; to: string } }
  | { cmd: "top_movers"; args: { shopId: string; from: string; to: string; limit: number } }
  | { cmd: "search_customers"; args: { shopId: string; q: string; limit: number } }
  | { cmd: "upsert_customer"; args: { input: UpsertCustomerInput } }
  | { cmd: "search_doctors"; args: { q: string; limit: number } }
  | { cmd: "upsert_doctor"; args: { input: UpsertDoctorInput } }
  | { cmd: "create_prescription"; args: { input: CreateRxInput } }
  | { cmd: "list_prescriptions"; args: { customerId: string } }
  | { cmd: "list_supplier_templates"; args: { shopId: string; supplierId?: string } }
  | { cmd: "upsert_supplier_template"; args: { input: UpsertSupplierTemplateInput } }
  | { cmd: "delete_supplier_template"; args: { id: string } }
  | { cmd: "test_supplier_template"; args: { template: SupplierTemplateDTO; sampleText: string } }
  | { cmd: "list_suppliers"; args: { shopId: string } }
  | { cmd: "gmail_connect"; args: { shopId: string } }
  | { cmd: "gmail_status"; args: { shopId: string } }
  | { cmd: "gmail_disconnect"; args: { shopId: string } }
  | { cmd: "gmail_list_messages"; args: { shopId: string; query: string; max: number } }
  | { cmd: "gmail_fetch_attachment"; args: { shopId: string; messageId: string; attachmentId: string; filename: string; mimeType: string } }
  | { cmd: "shop_get"; args: { id: string } }
  | { cmd: "shop_update"; args: { input: ShopUpdateInput } }
  | { cmd: "db_backup"; args: { destPath: string } }
  | { cmd: "db_restore"; args: { sourcePath: string } }
  | { cmd: "upsert_product"; args: { input: ProductWriteDTO } }
  | { cmd: "get_product"; args: { id: string } }
  | { cmd: "list_products"; args: { args?: ListProductsArgs } }
  | { cmd: "deactivate_product"; args: { id: string } };

export type IpcHandler = (call: IpcCall) => Promise<unknown>;

let handler: IpcHandler = async () => {
  throw new Error("ipc: no handler installed (call setIpcHandler during bootstrap)");
};

export function setIpcHandler(h: IpcHandler): void { handler = h; }

export async function healthCheckRpc(): Promise<Health> {
  return (await handler({ cmd: "health_check", args: {} })) as Health;
}

export async function dbVersionRpc(): Promise<number> {
  return (await handler({ cmd: "db_version", args: {} })) as number;
}

export async function searchProductsRpc(q: string, limit = 10): Promise<readonly ProductHit[]> {
  if (!q.trim()) return [];
  return (await handler({ cmd: "search_products", args: { q, limit } })) as ProductHit[];
}

export async function pickFefoBatchRpc(productId: string): Promise<BatchPick | null> {
  return (await handler({ cmd: "pick_fefo_batch", args: { productId } })) as BatchPick | null;
}

export async function listFefoCandidatesRpc(productId: string): Promise<readonly BatchPick[]> {
  return (await handler({ cmd: "list_fefo_candidates", args: { productId } })) as BatchPick[];
}

export async function listPaymentsByBillRpc(billId: string): Promise<readonly PaymentRowDTO[]> {
  return (await handler({ cmd: "list_payments_by_bill", args: { billId } })) as readonly PaymentRowDTO[];
}

export async function saveBillRpc(billId: string, input: SaveBillInput): Promise<SaveBillResult> {
  return (await handler({ cmd: "save_bill", args: { billId, input } })) as SaveBillResult;
}

export interface StockRow {
  readonly productId: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly manufacturer: string;
  readonly schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
  readonly gstRate: 0 | 5 | 12 | 18 | 28;
  readonly mrpPaise: number;
  readonly totalQty: number;
  readonly batchCount: number;
  readonly nearestExpiry: string | null;
  readonly daysToExpiry: number | null;
  readonly hasExpiredStock: number;
}

export interface ListStockOpts {
  readonly q?: string;
  readonly lowStockUnder?: number;
  readonly nearExpiryDays?: number;
  readonly limit?: number;
}

export async function listStockRpc(opts?: ListStockOpts): Promise<readonly StockRow[]> {
  const args = opts === undefined ? {} : { opts };
  return (await handler({ cmd: "list_stock", args })) as StockRow[];
}

// --- A1 Product master -----------------------------------------------------

export interface ProductRow {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly manufacturer: string;
  readonly hsn: string;
  readonly gstRate: 0 | 5 | 12 | 18 | 28;
  readonly schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
  readonly packForm: string;
  readonly packSize: number;
  readonly mrpPaise: number;
  readonly nppaMaxMrpPaise: number | null;
  readonly imageSha256: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductWriteDTO {
  readonly id?: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly manufacturer: string;
  readonly hsn: string;
  readonly gstRate: 0 | 5 | 12 | 18 | 28;
  readonly schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
  readonly packForm: string;
  readonly packSize: number;
  readonly mrpPaise: number;
  readonly nppaMaxMrpPaise: number | null;
  readonly imageSha256: string | null;
}

export interface ListProductsArgs {
  readonly q?: string;
  readonly activeOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export async function upsertProductRpc(input: ProductWriteDTO): Promise<ProductRow> {
  return (await handler({ cmd: "upsert_product", args: { input } })) as ProductRow;
}

export async function getProductRpc(id: string): Promise<ProductRow | null> {
  return (await handler({ cmd: "get_product", args: { id } })) as ProductRow | null;
}

export async function listProductsRpc(args?: ListProductsArgs): Promise<readonly ProductRow[]> {
  const payload = args === undefined ? {} : { args };
  return (await handler({ cmd: "list_products", args: payload })) as ProductRow[];
}

export async function deactivateProductRpc(id: string): Promise<void> {
  await handler({ cmd: "deactivate_product", args: { id } });
}

// --- GRN (goods receipt) -------------------------------------------------

export interface SaveGrnLine {
  readonly productId: string;
  readonly batchNo: string;
  readonly mfgDate: string;
  readonly expiryDate: string;
  readonly qty: number;
  readonly purchasePricePaise: number;
  readonly mrpPaise: number;
}

export interface SaveGrnInput {
  readonly supplierId: string;
  readonly invoiceNo: string;
  readonly invoiceDate: string;
  readonly lines: readonly SaveGrnLine[];
}

export interface SaveGrnResult {
  readonly grnId: string;
  readonly linesInserted: number;
  readonly batchIds: readonly string[];
}

export async function saveGrnRpc(grnId: string, input: SaveGrnInput): Promise<SaveGrnResult> {
  return (await handler({ cmd: "save_grn", args: { grnId, input } })) as SaveGrnResult;
}

// --- Reports -------------------------------------------------------------

export interface DayBookRow {
  readonly billId: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly paymentMode: string;
  readonly grandTotalPaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly isVoided: number;
}

export interface DayBookSummary {
  readonly billCount: number;
  readonly grossPaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly byPayment: Readonly<Record<string, number>>;
}

export interface DayBook {
  readonly date: string;
  readonly rows: readonly DayBookRow[];
  readonly summary: DayBookSummary;
}

export interface GstrBucket {
  readonly gstRate: number;
  readonly taxableValuePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly lineCount: number;
}

export interface TopMoverRow {
  readonly productId: string;
  readonly name: string;
  readonly qtySold: number;
  readonly revenuePaise: number;
  readonly billCount: number;
}

export async function dayBookRpc(shopId: string, date: string): Promise<DayBook> {
  return (await handler({ cmd: "day_book", args: { shopId, date } })) as DayBook;
}
export async function gstr1SummaryRpc(shopId: string, from: string, to: string): Promise<readonly GstrBucket[]> {
  return (await handler({ cmd: "gstr1_summary", args: { shopId, from, to } })) as GstrBucket[];
}
export async function topMoversRpc(shopId: string, from: string, to: string, limit = 10): Promise<readonly TopMoverRow[]> {
  return (await handler({ cmd: "top_movers", args: { shopId, from, to, limit } })) as TopMoverRow[];
}

// --- Directory -----------------------------------------------------------

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly gstin: string | null;
  readonly gender: "M" | "F" | "O" | null;
  readonly consentAbdm: number;
  readonly consentMarketing: number;
}
export interface UpsertCustomerInput {
  readonly id?: string;
  readonly shopId: string;
  readonly name: string;
  readonly phone?: string | null;
  readonly gstin?: string | null;
  readonly gender?: "M" | "F" | "O" | null;
  readonly consentAbdm?: boolean;
  readonly consentMarketing?: boolean;
  readonly consentMethod?: "verbal" | "signed" | "otp" | "app" | null;
}
export interface Doctor {
  readonly id: string;
  readonly regNo: string;
  readonly name: string;
  readonly phone: string | null;
}
export interface UpsertDoctorInput {
  readonly id?: string;
  readonly regNo: string;
  readonly name: string;
  readonly phone?: string | null;
}
export interface Prescription {
  readonly id: string;
  readonly customerId: string;
  readonly doctorId: string | null;
  readonly kind: "paper" | "digital" | "abdm";
  readonly imagePath: string | null;
  readonly issuedDate: string;
  readonly notes: string | null;
}
export interface CreateRxInput {
  readonly shopId: string;
  readonly customerId: string;
  readonly doctorId?: string | null;
  readonly kind: "paper" | "digital" | "abdm";
  readonly imagePath?: string | null;
  readonly issuedDate: string;
  readonly notes?: string | null;
}

export async function searchCustomersRpc(shopId: string, q: string, limit = 20): Promise<readonly Customer[]> {
  return (await handler({ cmd: "search_customers", args: { shopId, q, limit } })) as Customer[];
}
export async function upsertCustomerRpc(input: UpsertCustomerInput): Promise<string> {
  return (await handler({ cmd: "upsert_customer", args: { input } })) as string;
}
export async function searchDoctorsRpc(q: string, limit = 20): Promise<readonly Doctor[]> {
  return (await handler({ cmd: "search_doctors", args: { q, limit } })) as Doctor[];
}
export async function upsertDoctorRpc(input: UpsertDoctorInput): Promise<string> {
  return (await handler({ cmd: "upsert_doctor", args: { input } })) as string;
}
export async function createPrescriptionRpc(input: CreateRxInput): Promise<string> {
  return (await handler({ cmd: "create_prescription", args: { input } })) as string;
}
export async function listPrescriptionsRpc(customerId: string): Promise<readonly Prescription[]> {
  return (await handler({ cmd: "list_prescriptions", args: { customerId } })) as Prescription[];
}

// --- Supplier templates (X1 Tier A config) ------------------------------

export interface SupplierTemplateDTO {
  readonly id: string;
  readonly supplierId: string;
  readonly name: string;
  readonly headerPatterns: {
    readonly invoiceNo: string;
    readonly invoiceDate: string;
    readonly total: string;
    readonly supplier?: string;
  };
  readonly linePatterns: { readonly row: string };
  readonly columnMap: Readonly<Record<string, number | string>>;
  readonly dateFormat: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD-MMM-YYYY";
}

export interface UpsertSupplierTemplateInput {
  readonly id?: string;
  readonly shopId: string;
  readonly supplierId: string;
  readonly name: string;
  readonly headerPatterns: SupplierTemplateDTO["headerPatterns"];
  readonly linePatterns: SupplierTemplateDTO["linePatterns"];
  readonly columnMap: Readonly<Record<string, number | string>>;
  readonly dateFormat?: SupplierTemplateDTO["dateFormat"];
  readonly isActive?: boolean;
}

export interface SupplierRow {
  readonly id: string;
  readonly name: string;
  readonly gstin: string | null;
}

export interface TemplateTestResult {
  readonly header: {
    readonly invoiceNo: string | null;
    readonly invoiceDate: string | null;
    readonly totalPaise: number | null;
    readonly supplierHint: string | null;
    readonly confidence: number;
  };
  readonly lines: readonly {
    readonly productHint: string;
    readonly batchNo: string | null;
    readonly expiryDate: string | null;
    readonly qty: number;
    readonly ratePaise: number;
    readonly mrpPaise: number | null;
    readonly gstRate: number | null;
    readonly confidence: number;
  }[];
}

export async function listSupplierTemplatesRpc(shopId: string, supplierId?: string): Promise<readonly SupplierTemplateDTO[]> {
  const args = supplierId === undefined ? { shopId } : { shopId, supplierId };
  return (await handler({ cmd: "list_supplier_templates", args })) as SupplierTemplateDTO[];
}
export async function upsertSupplierTemplateRpc(input: UpsertSupplierTemplateInput): Promise<string> {
  return (await handler({ cmd: "upsert_supplier_template", args: { input } })) as string;
}
export async function deleteSupplierTemplateRpc(id: string): Promise<void> {
  await handler({ cmd: "delete_supplier_template", args: { id } });
}
export async function testSupplierTemplateRpc(template: SupplierTemplateDTO, sampleText: string): Promise<TemplateTestResult> {
  return (await handler({ cmd: "test_supplier_template", args: { template, sampleText } })) as TemplateTestResult;
}
export async function listSuppliersRpc(shopId: string): Promise<readonly SupplierRow[]> {
  return (await handler({ cmd: "list_suppliers", args: { shopId } })) as SupplierRow[];
}

// --- Gmail OAuth (X1) ---------------------------------------------------

export interface OAuthStatus {
  readonly connected: boolean;
  readonly accountEmail: string | null;
  readonly scopes: readonly string[];
  readonly grantedAt: string | null;
}

export async function gmailConnectRpc(shopId: string): Promise<OAuthStatus> {
  return (await handler({ cmd: "gmail_connect", args: { shopId } })) as OAuthStatus;
}
export async function gmailStatusRpc(shopId: string): Promise<OAuthStatus> {
  return (await handler({ cmd: "gmail_status", args: { shopId } })) as OAuthStatus;
}
export async function gmailDisconnectRpc(shopId: string): Promise<void> {
  await handler({ cmd: "gmail_disconnect", args: { shopId } });
}

// --- Gmail inbox (X1.1) -------------------------------------------------

export interface GmailAttachmentMeta {
  readonly attachmentId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface GmailMessageSummary {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly subject: string;
  readonly date: string;
  readonly snippet: string;
  readonly attachments: readonly GmailAttachmentMeta[];
}

export interface GmailAttachmentPayload {
  readonly path: string;
  readonly size: number;
  readonly mimeType: string;
  readonly filename: string;
  readonly text: string | null;
}

export async function gmailListMessagesRpc(
  shopId: string, query: string, max = 20,
): Promise<readonly GmailMessageSummary[]> {
  return (await handler({ cmd: "gmail_list_messages", args: { shopId, query, max } })) as GmailMessageSummary[];
}

// --- Shop (settings) ----------------------------------------------------

export interface Shop {
  readonly id: string;
  readonly name: string;
  readonly gstin: string;
  readonly stateCode: string;
  readonly retailLicense: string;
  readonly address: string;
  readonly createdAt: string;
}

export interface ShopUpdateInput {
  readonly id: string;
  readonly name: string;
  readonly gstin: string;
  readonly stateCode: string;
  readonly retailLicense: string;
  readonly address: string;
}

export async function shopGetRpc(id: string): Promise<Shop | null> {
  return (await handler({ cmd: "shop_get", args: { id } })) as Shop | null;
}

export async function shopUpdateRpc(input: ShopUpdateInput): Promise<Shop> {
  return (await handler({ cmd: "shop_update", args: { input } })) as Shop;
}

// --- F7 backup / restore ------------------------------------------------

export interface BackupResult {
  readonly path: string;
  readonly sizeBytes: number;
  readonly integrity: string;
}

export interface RestoreResult {
  readonly restoredFrom: string;
  readonly preRestoreBackup: string | null;
  readonly integrity: string;
}

export async function dbBackupRpc(destPath: string): Promise<BackupResult> {
  return (await handler({ cmd: "db_backup", args: { destPath } })) as BackupResult;
}

export async function dbRestoreRpc(sourcePath: string): Promise<RestoreResult> {
  return (await handler({ cmd: "db_restore", args: { sourcePath } })) as RestoreResult;
}

export async function gmailFetchAttachmentRpc(
  shopId: string, messageId: string, attachmentId: string, filename: string, mimeType: string,
): Promise<GmailAttachmentPayload> {
  return (await handler({
    cmd: "gmail_fetch_attachment",
    args: { shopId, messageId, attachmentId, filename, mimeType },
  })) as GmailAttachmentPayload;
}
