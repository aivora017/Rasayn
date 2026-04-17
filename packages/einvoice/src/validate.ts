import type {
  BillForIrn,
  IrnValidationError,
  IrnValidationResult,
  ShopForIrn,
} from "./types.js";
import { TURNOVER_THRESHOLD_PAISE } from "./types.js";
import {
  isValidGstinShape,
  isValidHsn,
  isValidInvoiceNo,
  isValidPin,
  isValidStateCode,
} from "./format.js";

interface ValidateInput {
  shop: ShopForIrn;
  bill: BillForIrn;
}

/**
 * Returns `{ok: true}` when the bill + shop are eligible for IRN submission.
 * All errors are collected (no short-circuit) so the UI can show everything at once.
 */
export function validateBillForIrn(input: ValidateInput): IrnValidationResult {
  const errs: IrnValidationError[] = [];
  const { shop, bill } = input;

  if (!shop.einvoiceEnabled) {
    errs.push({
      code: "EINVOICE_DISABLED",
      message: "E-invoice feature is disabled for this shop",
    });
  }

  if (shop.annualTurnoverPaise <= TURNOVER_THRESHOLD_PAISE) {
    errs.push({
      code: "TURNOVER_BELOW_THRESHOLD",
      message: `Shop turnover ${shop.annualTurnoverPaise} paise is not above ₹5Cr threshold (${TURNOVER_THRESHOLD_PAISE} paise)`,
    });
  }

  // Must be B2B: buyer GSTIN present + valid, intra/inter state.
  const buyerGstin = bill.buyer.gstin?.trim() ?? "";
  if (buyerGstin.length === 0) {
    errs.push({
      code: "NOT_B2B",
      message: "Buyer GSTIN is required for e-invoice (B2B only)",
      field: "buyer.gstin",
    });
  } else if (!isValidGstinShape(buyerGstin)) {
    errs.push({
      code: "BUYER_GSTIN_INVALID",
      message: `Buyer GSTIN shape invalid: ${buyerGstin}`,
      field: "buyer.gstin",
    });
  }

  if (!isValidGstinShape(bill.seller.gstin)) {
    errs.push({
      code: "SELLER_GSTIN_INVALID",
      message: `Seller GSTIN shape invalid: ${bill.seller.gstin}`,
      field: "seller.gstin",
    });
  }

  if (!isValidInvoiceNo(bill.billNo)) {
    const tooLong = bill.billNo.length > 16;
    errs.push({
      code: tooLong ? "INVOICE_NO_TOO_LONG" : "INVOICE_NO_EMPTY",
      message: `Invoice no invalid: "${bill.billNo}"`,
      field: "billNo",
    });
  }

  if (!isValidPin(bill.seller.pincode)) {
    errs.push({
      code: "PIN_INVALID",
      message: `Seller PIN invalid: ${bill.seller.pincode}`,
      field: "seller.pincode",
    });
  }
  if (!isValidPin(bill.buyer.pincode)) {
    errs.push({
      code: "PIN_INVALID",
      message: `Buyer PIN invalid: ${bill.buyer.pincode}`,
      field: "buyer.pincode",
    });
  }
  if (!isValidStateCode(bill.seller.stateCode)) {
    errs.push({
      code: "STATECODE_INVALID",
      message: `Seller state code invalid: ${bill.seller.stateCode}`,
      field: "seller.stateCode",
    });
  }
  if (!isValidStateCode(bill.buyer.stateCode)) {
    errs.push({
      code: "STATECODE_INVALID",
      message: `Buyer state code invalid: ${bill.buyer.stateCode}`,
      field: "buyer.stateCode",
    });
  }

  if (bill.lines.length === 0) {
    errs.push({
      code: "EMPTY_LINES",
      message: "Bill has no lines",
    });
  }

  for (const line of bill.lines) {
    if (!isValidHsn(line.hsn)) {
      errs.push({
        code: "HSN_INVALID",
        message: `HSN invalid on line ${line.slNo}: "${line.hsn}"`,
        lineSlNo: line.slNo,
      });
    }
    if (line.qty <= 0) {
      errs.push({
        code: "QTY_NON_POSITIVE",
        message: `Qty must be > 0 on line ${line.slNo}`,
        lineSlNo: line.slNo,
      });
    }

    // intra_state: cgst+sgst, no igst. inter_state: igst only.
    if (bill.gstTreatment === "intra_state" && line.igstPaise !== 0) {
      errs.push({
        code: "INTRA_HAS_IGST",
        message: `Line ${line.slNo} has IGST in intra-state bill`,
        lineSlNo: line.slNo,
      });
    }
    if (
      bill.gstTreatment === "inter_state" &&
      (line.cgstPaise !== 0 || line.sgstPaise !== 0)
    ) {
      errs.push({
        code: "INTER_HAS_CGST",
        message: `Line ${line.slNo} has CGST/SGST in inter-state bill`,
        lineSlNo: line.slNo,
      });
    }
  }

  // Totals cross-check (sum of line totals + round_off == grand_total)
  if (bill.lines.length > 0) {
    const linesSum = bill.lines.reduce((a, l) => a + l.lineTotalPaise, 0);
    const computed = linesSum + bill.roundOffPaise;
    if (computed !== bill.grandTotalPaise) {
      errs.push({
        code: "TOTALS_MISMATCH",
        message: `Totals mismatch: lines+round=${computed} vs grand=${bill.grandTotalPaise}`,
      });
    }
  }

  return { ok: errs.length === 0, errors: errs };
}
