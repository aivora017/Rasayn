// A8 / ADR 0021 step 6 — Cygnet CRN-IRN payload builder.
//
// Mirrors build.ts (forward INV path) but emits a Credit-Note IRN payload
// per GSTN NIC v1.1 spec:
//
//   * DocDtls.Typ = "CRN"
//   * RefDtls.PrecDocDtls = [{ InvNo, InvDt }] referencing the original invoice.
//   * ValDtls / ItemList monetary fields are the *refund* amounts (positive),
//     not the original sale amounts. NIC interprets a CRN with positive
//     values as "this much was credited back to the buyer".
//
// Validation extends validateBillForIrn with three credit-note-specific
// checks: original invoice number required, original invoice date required,
// and refund total must be positive.

import type {
  CreditNoteForIrn,
  CreditNoteLineForIrn,
  CrnValidationError,
  CrnValidationResult,
  IrnItem,
  IrnPayload,
  ShopForIrn,
} from "./types.js";
import { isoToIstDdMmYyyy, paiseToRupees } from "./format.js";
import { validateBillForIrn } from "./validate.js";

export interface BuildCrnInput {
  shop: ShopForIrn;
  creditNote: CreditNoteForIrn;
}

export interface BuildCrnOk {
  ok: true;
  payload: IrnPayload;
}
export interface BuildCrnErr {
  ok: false;
  errors: CrnValidationError[];
}
export type BuildCrnResult = BuildCrnOk | BuildCrnErr;

/** Validate a credit note for CRN emission. Reuses validateBillForIrn by
 * shimming a virtual bill from the credit note (refund amounts as positive
 * monetary fields), and adds three CRN-specific checks. */
export function validateCreditNoteForIrn(
  input: BuildCrnInput,
): CrnValidationResult {
  const errs: CrnValidationError[] = [];
  const cn = input.creditNote;

  if (!cn.originalBillNo || cn.originalBillNo.trim().length === 0) {
    errs.push({
      code: "ORIG_INVOICE_NO_EMPTY",
      message: "credit note must reference an original invoice number",
      field: "originalBillNo",
    });
  }
  if (!cn.originalBilledAtIso || cn.originalBilledAtIso.trim().length === 0) {
    errs.push({
      code: "ORIG_INVOICE_DATE_EMPTY",
      message: "credit note must reference an original invoice date",
      field: "originalBilledAtIso",
    });
  }
  if (cn.refundTotalPaise <= 0) {
    errs.push({
      code: "REFUND_AMOUNT_NON_POSITIVE",
      message: "refundTotalPaise must be > 0",
      field: "refundTotalPaise",
    });
  }

  // Reuse the forward-path validator via a virtual bill — it covers
  // GSTIN shapes, party fields, totals consistency, intra/inter mismatch.
  const virtualBillResult = validateBillForIrn({
    shop: input.shop,
    bill: {
      billId: cn.returnId,
      billNo: cn.returnNo,
      billedAtIso: cn.createdAtIso,
      gstTreatment: cn.gstTreatment,
      subtotalPaise: cn.refundSubtotalPaise,
      cgstPaise: cn.refundCgstPaise,
      sgstPaise: cn.refundSgstPaise,
      igstPaise: cn.refundIgstPaise,
      roundOffPaise: cn.refundRoundOffPaise,
      grandTotalPaise: cn.refundTotalPaise,
      lines: cn.lines.map((l) => ({
        slNo: l.slNo,
        productName: l.productName,
        hsn: l.hsn,
        qty: l.qtyReturned,
        ...(l.unit !== undefined ? { unit: l.unit } : {}),
        mrpPaise: l.mrpPaise,
        discountPaise: l.refundDiscountPaise,
        taxableValuePaise: l.refundTaxablePaise,
        gstRate: l.gstRate,
        cgstPaise: l.refundCgstPaise,
        sgstPaise: l.refundSgstPaise,
        igstPaise: l.refundIgstPaise,
        lineTotalPaise: l.refundLineTotalPaise,
      })),
      seller: cn.seller,
      buyer: cn.buyer,
    },
  });

  // Forward errors verbatim — codes are a superset of CrnValidationErrorCode.
  for (const e of virtualBillResult.errors) {
    errs.push(e as CrnValidationError);
  }

  return { ok: errs.length === 0, errors: errs };
}

/** Build the CRN payload. Returns ok=false on any validation failure. */
export function buildCrnPayload(input: BuildCrnInput): BuildCrnResult {
  const v = validateCreditNoteForIrn(input);
  if (!v.ok) return { ok: false, errors: v.errors };

  const cn = input.creditNote;
  const items: IrnItem[] = cn.lines.map(buildCrnItem);

  const payload: IrnPayload = {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: "N",
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: "CRN",
      No: cn.returnNo,
      Dt: isoToIstDdMmYyyy(cn.createdAtIso),
    },
    RefDtls: {
      PrecDocDtls: [
        {
          InvNo: cn.originalBillNo,
          InvDt: isoToIstDdMmYyyy(cn.originalBilledAtIso),
        },
      ],
    },
    SellerDtls: {
      Gstin: cn.seller.gstin,
      LglNm: cn.seller.legalName,
      Addr1: cn.seller.address1,
      Loc: cn.seller.location,
      Pin: cn.seller.pincode,
      Stcd: cn.seller.stateCode,
    },
    BuyerDtls: {
      Gstin: cn.buyer.gstin,
      LglNm: cn.buyer.legalName,
      Addr1: cn.buyer.address1,
      Loc: cn.buyer.location,
      Pin: cn.buyer.pincode,
      Stcd: cn.buyer.stateCode,
    },
    ItemList: items,
    ValDtls: {
      AssVal: paiseToRupees(cn.refundSubtotalPaise),
      CgstVal: paiseToRupees(cn.refundCgstPaise),
      SgstVal: paiseToRupees(cn.refundSgstPaise),
      IgstVal: paiseToRupees(cn.refundIgstPaise),
      TotInvVal: paiseToRupees(cn.refundTotalPaise),
      RndOffAmt: paiseToRupees(cn.refundRoundOffPaise),
    },
  };

  return { ok: true, payload };
}

function buildCrnItem(l: CreditNoteLineForIrn): IrnItem {
  const unit = l.unit ?? "NOS";
  return {
    SlNo: String(l.slNo),
    PrdDesc: l.productName,
    IsServc: "N",
    HsnCd: l.hsn,
    Qty: l.qtyReturned,
    Unit: unit,
    UnitPrice: paiseToRupees(l.mrpPaise),
    TotAmt: paiseToRupees(l.mrpPaise * l.qtyReturned),
    Discount: paiseToRupees(l.refundDiscountPaise),
    AssAmt: paiseToRupees(l.refundTaxablePaise),
    GstRt: l.gstRate,
    IgstAmt: paiseToRupees(l.refundIgstPaise),
    CgstAmt: paiseToRupees(l.refundCgstPaise),
    SgstAmt: paiseToRupees(l.refundSgstPaise),
    TotItemVal: paiseToRupees(l.refundLineTotalPaise),
  };
}

/** Cygnet primary vendor: same payload shape as the forward IRN call.
 * The wire-level vendor adapter (HTTP, signing, retries) lives in Rust;
 * this TS surface only ensures the payload is well-formed before it
 * leaves the desktop. Returned object is the JSON body to POST. */
export function serialiseCrnPayload(payload: IrnPayload): string {
  return JSON.stringify(payload);
}
