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
  | { cmd: "deactivate_product"; args: { id: string } }
  | { cmd: "user_get"; args: { id: string } }
  | { cmd: "record_expiry_override"; args: { input: ExpiryOverrideInputDTO } }
  | { cmd: "get_nearest_expiry"; args: { productId: string } }
  | { cmd: "get_bill_full"; args: { billId: string } }
  | { cmd: "record_print"; args: { input: RecordPrintInputDTO } }
  | { cmd: "generate_gstr1_payload"; args: { shopId: string; period: string } }
  | { cmd: "save_gstr1_return"; args: { input: SaveGstr1ReturnInputDTO } }
  | { cmd: "list_gst_returns"; args: { shopId: string } }
  | { cmd: "mark_gstr1_filed"; args: { input: MarkGstr1FiledInputDTO } }
  | { cmd: "open_count_session"; args: { input: OpenCountSessionInputDTO } }
  | { cmd: "record_count_line"; args: { input: RecordCountLineInputDTO } }
  | { cmd: "get_count_session"; args: { sessionId: string } }
  | { cmd: "finalize_count"; args: { input: FinalizeCountInputDTO } }
  | { cmd: "cancel_count_session"; args: { sessionId: string; actorUserId: string } }
  | { cmd: "list_count_sessions"; args: { shopId: string; limit?: number } }
  | { cmd: "generate_irn_payload"; args: { billId: string } }
  | { cmd: "submit_irn"; args: { input: SubmitIrnInputDTO } }
  | { cmd: "retry_irn"; args: { billId: string; actorUserId: string } }
  | { cmd: "cancel_irn"; args: { input: CancelIrnInputDTO } }
  | { cmd: "list_irn_records"; args: { shopId: string; status?: string; limit?: number } }
  | { cmd: "get_irn_for_bill"; args: { billId: string } }
  | { cmd: "attach_product_image"; args: { input: AttachImageInputDTO } }
  | { cmd: "get_product_image"; args: { productId: string } }
  | { cmd: "delete_product_image"; args: { productId: string; actorUserId: string } }
  | { cmd: "list_products_missing_image"; args: Record<string, never> }
  | { cmd: "find_similar_images"; args: { productId: string; maxDistance: number } }
  | { cmd: "get_duplicate_suspects"; args: { maxDistance: number } };

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

// ---------------------------------------------------------------------------
// A13 (ADR 0013) · Expiry guard IPC surface
// ---------------------------------------------------------------------------
// Thin wrappers used by BillingScreen + OwnerOverrideModal.
//   * userGetRpc        — fetch active user for role gating
//   * getNearestExpiryRpc — fetch the FEFO batch for a product so the UI can
//                           render the red/amber chip without pre-allocating.
//   * recordExpiryOverrideRpc — persist an owner override so save_bill
//                               will accept a near-expiry line.
// ---------------------------------------------------------------------------

export type UserRole = "owner" | "pharmacist" | "cashier" | "viewer";

export interface UserDTO {
  readonly id: string;
  readonly name: string;
  readonly role: UserRole;
  readonly isActive: boolean;
}

export interface ExpiryStatusDTO {
  readonly batchId: string;
  readonly batchNo: string;
  readonly expiryDate: string;
  readonly qtyOnHand: number;
  readonly daysToExpiry: number;
}

export interface ExpiryOverrideInputDTO {
  readonly batchId: string;
  readonly actorUserId: string;
  readonly reason: string;
}

export interface ExpiryOverrideResultDTO {
  readonly auditId: string;
  readonly daysPastExpiry: number;
}

export async function userGetRpc(id: string): Promise<UserDTO | null> {
  return (await handler({ cmd: "user_get", args: { id } })) as UserDTO | null;
}

export async function getNearestExpiryRpc(productId: string): Promise<ExpiryStatusDTO | null> {
  return (await handler({
    cmd: "get_nearest_expiry",
    args: { productId },
  })) as ExpiryStatusDTO | null;
}

export async function recordExpiryOverrideRpc(
  input: ExpiryOverrideInputDTO,
): Promise<ExpiryOverrideResultDTO> {
  return (await handler({
    cmd: "record_expiry_override",
    args: { input },
  })) as ExpiryOverrideResultDTO;
}

// ---------------------------------------------------------------------------
// A9 (ADR 0014) · Invoice print IPC surface
// ---------------------------------------------------------------------------
// getBillFullRpc : single read surface returning header + shop + customer +
//                  prescription + lines + payments + HSN summary. Consumed by
//                  packages/invoice-print's renderInvoiceHtml.
// recordPrintRpc : writes print_audit row; returns printCount + isDuplicate
//                  so the UI can stamp "DUPLICATE — REPRINT" on repeats.
// ---------------------------------------------------------------------------

export type InvoiceLayout = "thermal_80mm" | "a5_gst";

export interface ShopFullDTO {
  readonly id: string;
  readonly name: string;
  readonly gstin: string;
  readonly stateCode: string;
  readonly retailLicense: string;
  readonly address: string;
  readonly pharmacistName: string | null;
  readonly pharmacistRegNo: string | null;
  readonly fssaiNo: string | null;
  readonly defaultInvoiceLayout: InvoiceLayout;
}

export interface BillHeaderDTO {
  readonly id: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly customerId: string | null;
  readonly rxId: string | null;
  readonly cashierId: string;
  readonly gstTreatment: string;
  readonly subtotalPaise: number;
  readonly totalDiscountPaise: number;
  readonly totalCgstPaise: number;
  readonly totalSgstPaise: number;
  readonly totalIgstPaise: number;
  readonly totalCessPaise: number;
  readonly roundOffPaise: number;
  readonly grandTotalPaise: number;
  readonly paymentMode: string;
  readonly isVoided: number;
}

export interface CustomerFullDTO {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly gstin: string | null;
  readonly address: string | null;
}

export interface PrescriptionFullDTO {
  readonly id: string;
  readonly doctorName: string | null;
  readonly doctorRegNo: string | null;
  readonly kind: string;
  readonly issuedDate: string;
  readonly notes: string | null;
}

export interface BillLineFullDTO {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly hsn: string;
  readonly batchId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly qty: number;
  readonly mrpPaise: number;
  readonly discountPct: number;
  readonly discountPaise: number;
  readonly taxableValuePaise: number;
  readonly gstRate: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly cessPaise: number;
  readonly lineTotalPaise: number;
  readonly schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
}

export interface HsnSummaryDTO {
  readonly hsn: string;
  readonly gstRate: number;
  readonly taxableValuePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly cessPaise: number;
}

export interface BillFullDTO {
  readonly shop: ShopFullDTO;
  readonly bill: BillHeaderDTO;
  readonly customer: CustomerFullDTO | null;
  readonly prescription: PrescriptionFullDTO | null;
  readonly lines: readonly BillLineFullDTO[];
  readonly payments: readonly PaymentRowDTO[];
  readonly hsnTaxSummary: readonly HsnSummaryDTO[];
}

export interface RecordPrintInputDTO {
  readonly billId: string;
  readonly layout: InvoiceLayout;
  readonly actorUserId: string;
}

export interface PrintReceiptDTO {
  readonly id: string;
  readonly billId: string;
  readonly layout: InvoiceLayout;
  readonly isDuplicate: number;
  readonly printCount: number;
  readonly stampedAt: string;
}

export async function getBillFullRpc(billId: string): Promise<BillFullDTO> {
  return (await handler({ cmd: "get_bill_full", args: { billId } })) as BillFullDTO;
}

export async function recordPrintRpc(input: RecordPrintInputDTO): Promise<PrintReceiptDTO> {
  return (await handler({ cmd: "record_print", args: { input } })) as PrintReceiptDTO;
}

// ───────────────────────────── A10: GSTR-1 export ─────────────────────────────

export interface ShopForGstr1DTO {
  readonly id: string;
  readonly gstin: string;
  readonly stateCode: string;
  readonly name: string;
}

export interface CustomerForGstr1DTO {
  readonly id: string;
  readonly gstin: string | null;
  readonly name: string;
  readonly stateCode: string | null;
  readonly address: string | null;
}

export interface BillLineForGstr1DTO {
  readonly id: string;
  readonly productId: string;
  readonly hsn: string;
  readonly gstRate: number;
  readonly qty: number;
  readonly taxableValuePaise: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly cessPaise: number;
  readonly lineTotalPaise: number;
}

export interface BillForGstr1DTO {
  readonly id: string;
  readonly billNo: string;
  readonly billedAt: string;
  readonly docSeries: string;
  readonly gstTreatment: string;
  readonly subtotalPaise: number;
  readonly totalDiscountPaise: number;
  readonly totalCgstPaise: number;
  readonly totalSgstPaise: number;
  readonly totalIgstPaise: number;
  readonly totalCessPaise: number;
  readonly roundOffPaise: number;
  readonly grandTotalPaise: number;
  readonly isVoided: number;
  readonly customer: CustomerForGstr1DTO | null;
  readonly lines: readonly BillLineForGstr1DTO[];
}

export interface Gstr1InputDTO {
  readonly shop: ShopForGstr1DTO;
  readonly bills: readonly BillForGstr1DTO[];
  readonly period: string;
}

export interface SaveGstr1ReturnInputDTO {
  readonly shopId: string;
  readonly period: string;
  readonly jsonBlob: string;
  readonly csvB2b: string;
  readonly csvB2cl: string;
  readonly csvB2cs: string;
  readonly csvHsn: string;
  readonly csvExemp: string;
  readonly csvDoc: string;
  readonly hashSha256: string;
  readonly billCount: number;
  readonly grandTotalPaise: number;
}

export interface MarkGstr1FiledInputDTO {
  readonly returnId: string;
  readonly actorUserId: string;
}

export interface GstReturnDTO {
  readonly id: string;
  readonly shopId: string;
  readonly returnType: string;
  readonly period: string;
  readonly status: string;
  readonly hashSha256: string;
  readonly billCount: number;
  readonly grandTotalPaise: number;
  readonly generatedAt: string;
  readonly filedAt: string | null;
  readonly filedByUserId: string | null;
}

export async function generateGstr1PayloadRpc(
  shopId: string,
  period: string,
): Promise<Gstr1InputDTO> {
  return (await handler({ cmd: "generate_gstr1_payload", args: { shopId, period } })) as Gstr1InputDTO;
}

export async function saveGstr1ReturnRpc(
  input: SaveGstr1ReturnInputDTO,
): Promise<GstReturnDTO> {
  return (await handler({ cmd: "save_gstr1_return", args: { input } })) as GstReturnDTO;
}

export async function listGstReturnsRpc(shopId: string): Promise<readonly GstReturnDTO[]> {
  return (await handler({ cmd: "list_gst_returns", args: { shopId } })) as readonly GstReturnDTO[];
}

export async function markGstr1FiledRpc(
  input: MarkGstr1FiledInputDTO,
): Promise<GstReturnDTO> {
  return (await handler({ cmd: "mark_gstr1_filed", args: { input } })) as GstReturnDTO;
}


// =============================================================================
// A11 · Stock reconcile (ADR 0016)
// =============================================================================

export type ReasonCodeDTO =
  | "shrinkage"
  | "damage"
  | "expiry_dump"
  | "data_entry_error"
  | "theft"
  | "transfer_out"
  | "other";

export interface OpenCountSessionInputDTO {
  shopId: string;
  title: string;
  openedByUserId: string;
}

export interface RecordCountLineInputDTO {
  sessionId: string;
  batchId: string;
  countedQty: number;
  countedByUserId: string;
  notes?: string | null;
}

export interface FinalizeDecisionDTO {
  batchId: string;
  countedQty: number;
  reasonCode: ReasonCodeDTO;
  reasonNotes?: string | null;
}

export interface FinalizeCountInputDTO {
  sessionId: string;
  actorUserId: string;
  decisions: ReadonlyArray<FinalizeDecisionDTO>;
}

export interface CountSessionDTO {
  id: string;
  shopId: string;
  title: string;
  status: "open" | "finalized" | "cancelled";
  openedBy: string;
  openedAt: string;
  finalizedBy: string | null;
  finalizedAt: string | null;
  lineCount: number;
  adjustmentCount: number;
}

export interface BatchStateDTO {
  batchId: string;
  productId: string;
  productName: string;
  batchNo: string;
  expiryDate: string;
  systemQty: number;
}

export interface CountLineDTO {
  batchId: string;
  productId: string;
  countedQty: number;
  countedBy: string;
  countedAt: string;
  notes: string | null;
}

export interface CountSessionSnapshotDTO {
  session: CountSessionDTO;
  system: ReadonlyArray<BatchStateDTO>;
  lines: ReadonlyArray<CountLineDTO>;
}

export interface FinalizeCountOutDTO {
  sessionId: string;
  adjustmentsWritten: number;
  netDelta: number;
  finalizedAt: string;
}

export async function openCountSessionRpc(
  input: OpenCountSessionInputDTO,
): Promise<CountSessionDTO> {
  return (await handler({ cmd: "open_count_session", args: { input } })) as CountSessionDTO;
}

export async function recordCountLineRpc(
  input: RecordCountLineInputDTO,
): Promise<void> {
  await handler({ cmd: "record_count_line", args: { input } });
}

export async function getCountSessionRpc(
  sessionId: string,
): Promise<CountSessionSnapshotDTO> {
  return (await handler({
    cmd: "get_count_session",
    args: { sessionId },
  })) as CountSessionSnapshotDTO;
}

export async function finalizeCountRpc(
  input: FinalizeCountInputDTO,
): Promise<FinalizeCountOutDTO> {
  return (await handler({ cmd: "finalize_count", args: { input } })) as FinalizeCountOutDTO;
}

export async function cancelCountSessionRpc(
  sessionId: string,
  actorUserId: string,
): Promise<CountSessionDTO> {
  return (await handler({
    cmd: "cancel_count_session",
    args: { sessionId, actorUserId },
  })) as CountSessionDTO;
}

export async function listCountSessionsRpc(
  shopId: string,
  limit = 50,
): Promise<ReadonlyArray<CountSessionDTO>> {
  return (await handler({
    cmd: "list_count_sessions",
    args: { shopId, limit },
  })) as ReadonlyArray<CountSessionDTO>;
}

// ─── A12: e-invoice IRN ────────────────────────────────────────────────
// Mirrors Rust IrnPartyOut / IrnLineOut / IrnBillOut / IrnShopOut / IrnPayloadOut.
// This is the *domain* object returned by generate_irn_payload — the pure-TS
// @pharmacare/einvoice package converts it into the NIC v1.1 schema.
export interface IrnPartyDTO {
  gstin: string;
  legalName: string;
  address1: string;
  location: string;
  pincode: number;
  stateCode: string;
}

export interface IrnLineDTO {
  slNo: number;
  productName: string;
  hsn: string;
  qty: number;
  unit: string | null;
  mrpPaise: number;
  discountPaise: number;
  taxableValuePaise: number;
  gstRate: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  lineTotalPaise: number;
}

export interface IrnBillDTO {
  billId: string;
  billNo: string;
  billedAtIso: string;
  gstTreatment: string;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  seller: IrnPartyDTO;
  buyer: IrnPartyDTO;
  lines: ReadonlyArray<IrnLineDTO>;
}

export interface IrnShopDTO {
  annualTurnoverPaise: number;
  einvoiceEnabled: boolean;
  einvoiceVendor: string;
}

export interface IrnPayloadDTO {
  shop: IrnShopDTO;
  bill: IrnBillDTO;
}

export interface IrnRecordDTO {
  id: string;
  billId: string;
  shopId: string;
  vendor: string;
  status: string;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  signedInvoice: string | null;
  qrCode: string | null;
  errorCode: string | null;
  errorMsg: string | null;
  attemptCount: number;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelRemarks: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface SubmitIrnInputDTO {
  billId: string;
  actorUserId: string;
  /** Optional: "mock" for tests/demo; otherwise shop default vendor (Cygnet). */
  vendorOverride?: string;
}

export interface CancelIrnInputDTO {
  irnRecordId: string;
  actorUserId: string;
  /** NIC code: "1"=duplicate, "2"=data-entry-mistake, "3"=order-cancelled, "4"=other */
  cancelReason: string;
  cancelRemarks?: string;
}

export async function generateIrnPayloadRpc(billId: string): Promise<IrnPayloadDTO> {
  return (await handler({ cmd: "generate_irn_payload", args: { billId } })) as IrnPayloadDTO;
}

export async function submitIrnRpc(input: SubmitIrnInputDTO): Promise<IrnRecordDTO> {
  return (await handler({ cmd: "submit_irn", args: { input } })) as IrnRecordDTO;
}

export async function retryIrnRpc(billId: string, actorUserId: string): Promise<IrnRecordDTO> {
  return (await handler({
    cmd: "retry_irn",
    args: { billId, actorUserId },
  })) as IrnRecordDTO;
}

export async function cancelIrnRpc(input: CancelIrnInputDTO): Promise<IrnRecordDTO> {
  return (await handler({ cmd: "cancel_irn", args: { input } })) as IrnRecordDTO;
}

export async function listIrnRecordsRpc(
  shopId: string,
  status?: string,
  limit = 50,
): Promise<ReadonlyArray<IrnRecordDTO>> {
  const args: { shopId: string; status?: string; limit: number } = { shopId, limit };
  if (status !== undefined) args.status = status;
  return (await handler({ cmd: "list_irn_records", args })) as ReadonlyArray<IrnRecordDTO>;
}

export async function getIrnForBillRpc(billId: string): Promise<IrnRecordDTO | null> {
  return (await handler({ cmd: "get_irn_for_bill", args: { billId } })) as IrnRecordDTO | null;
}

// --- X2 SKU images -------------------------------------------------------
// ADR: docs/adr/0018-x2-sku-images.md

export interface AttachImageInputDTO {
  readonly productId: string;
  readonly bytesB64: string;
  readonly reportedMime?: string | null;
  readonly actorUserId: string;
}

export interface ImageMetadataDTO {
  readonly sha256: string;
  readonly mime: "image/png" | "image/jpeg" | "image/webp";
  readonly sizeBytes: number;
  readonly productId: string;
  readonly phash: string | null;
}

export interface ProductImageRowDTO {
  readonly productId: string;
  readonly sha256: string;
  readonly mime: "image/png" | "image/jpeg" | "image/webp";
  readonly sizeBytes: number;
  readonly bytesB64: string;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
  readonly phash: string | null;
}

export interface MissingImageRowDTO {
  readonly productId: string;
  readonly name: string;
  readonly schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
  readonly manufacturer: string;
  /** "blocker" for Schedule H/H1/X, "warning" otherwise. */
  readonly severity: "blocker" | "warning";
}

export async function attachProductImageRpc(
  input: AttachImageInputDTO,
): Promise<ImageMetadataDTO> {
  return (await handler({ cmd: "attach_product_image", args: { input } })) as ImageMetadataDTO;
}

export async function getProductImageRpc(
  productId: string,
): Promise<ProductImageRowDTO | null> {
  return (await handler({ cmd: "get_product_image", args: { productId } })) as ProductImageRowDTO | null;
}

export async function deleteProductImageRpc(
  productId: string,
  actorUserId: string,
): Promise<void> {
  await handler({ cmd: "delete_product_image", args: { productId, actorUserId } });
}

export async function listProductsMissingImageRpc(): Promise<readonly MissingImageRowDTO[]> {
  return (await handler({ cmd: "list_products_missing_image", args: {} })) as readonly MissingImageRowDTO[];
}

// ------- X2b (ADR 0019): perceptual-hash similarity ---------------------

export interface SimilarImageRowDTO {
  readonly productId: string;
  readonly name: string;
  readonly schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
  readonly manufacturer: string;
  /** 16-hex-char DCT pHash (see ADR 0019). */
  readonly phash: string;
  /** Hamming distance from the query product's phash (0 = identical, up to 64). */
  readonly distance: number;
}

export interface DuplicateSuspectRowDTO {
  readonly productIdA: string;
  readonly nameA: string;
  readonly productIdB: string;
  readonly nameB: string;
  /** Hamming distance between the two products' phashes. */
  readonly distance: number;
}

/**
 * Find products visually similar to `productId` by Hamming distance on the
 * stored pHash. Returns empty if the query product has no stored image/phash.
 * `maxDistance` is inclusive; per ADR 0019 use 6 for near-duplicates, 12 for
 * "suspicious" band. Results sorted ascending by distance.
 */
export async function findSimilarImagesRpc(
  productId: string,
  maxDistance: number,
): Promise<readonly SimilarImageRowDTO[]> {
  return (await handler({
    cmd: "find_similar_images",
    args: { productId, maxDistance },
  })) as readonly SimilarImageRowDTO[];
}

/**
 * Sweep all active products with a stored pHash for duplicate-suspect pairs
 * whose Hamming distance is <= `maxDistance`. O(N^2) — pilot-scale (<= 5k
 * SKUs) only; see ADR 0019 for index-bucketing plan.
 */
export async function getDuplicateSuspectsRpc(
  maxDistance: number,
): Promise<readonly DuplicateSuspectRowDTO[]> {
  return (await handler({
    cmd: "get_duplicate_suspects",
    args: { maxDistance },
  })) as readonly DuplicateSuspectRowDTO[];
}
