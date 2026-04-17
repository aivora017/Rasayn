import type { BillForIrn, IrnItem, IrnPayload, ShopForIrn } from "./types.js";
import { isoToIstDdMmYyyy, paiseToRupees } from "./format.js";
import { validateBillForIrn } from "./validate.js";

export interface BuildIrnInput {
  shop: ShopForIrn;
  bill: BillForIrn;
}

export interface BuildIrnOk {
  ok: true;
  payload: IrnPayload;
}

export interface BuildIrnErr {
  ok: false;
  errors: ReturnType<typeof validateBillForIrn>["errors"];
}

export type BuildIrnResult = BuildIrnOk | BuildIrnErr;

/**
 * Runs validation and, on success, builds the GSTN e-invoice v1.1 payload.
 * Conversions (paise → rupees, ISO → IST date) happen exactly here — nowhere else.
 */
export function buildIrnPayload(input: BuildIrnInput): BuildIrnResult {
  const v = validateBillForIrn(input);
  if (!v.ok) return { ok: false, errors: v.errors };

  const { bill } = input;

  const items: IrnItem[] = bill.lines.map((l) => {
    const unit = l.unit ?? "NOS";
    return {
      SlNo: String(l.slNo),
      PrdDesc: l.productName,
      IsServc: "N",
      HsnCd: l.hsn,
      Qty: l.qty,
      Unit: unit,
      UnitPrice: paiseToRupees(l.mrpPaise),
      TotAmt: paiseToRupees(l.mrpPaise * l.qty),
      Discount: paiseToRupees(l.discountPaise),
      AssAmt: paiseToRupees(l.taxableValuePaise),
      GstRt: l.gstRate,
      IgstAmt: paiseToRupees(l.igstPaise),
      CgstAmt: paiseToRupees(l.cgstPaise),
      SgstAmt: paiseToRupees(l.sgstPaise),
      TotItemVal: paiseToRupees(l.lineTotalPaise),
    };
  });

  const payload: IrnPayload = {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: "N",
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: "INV",
      No: bill.billNo,
      Dt: isoToIstDdMmYyyy(bill.billedAtIso),
    },
    SellerDtls: {
      Gstin: bill.seller.gstin,
      LglNm: bill.seller.legalName,
      Addr1: bill.seller.address1,
      Loc: bill.seller.location,
      Pin: bill.seller.pincode,
      Stcd: bill.seller.stateCode,
    },
    BuyerDtls: {
      Gstin: bill.buyer.gstin,
      LglNm: bill.buyer.legalName,
      Addr1: bill.buyer.address1,
      Loc: bill.buyer.location,
      Pin: bill.buyer.pincode,
      Stcd: bill.buyer.stateCode,
    },
    ItemList: items,
    ValDtls: {
      AssVal: paiseToRupees(bill.subtotalPaise),
      CgstVal: paiseToRupees(bill.cgstPaise),
      SgstVal: paiseToRupees(bill.sgstPaise),
      IgstVal: paiseToRupees(bill.igstPaise),
      TotInvVal: paiseToRupees(bill.grandTotalPaise),
      RndOffAmt: paiseToRupees(bill.roundOffPaise),
    },
  };

  return { ok: true, payload };
}

/**
 * Serialises the payload deterministically (stable key order).
 * Used for the idempotency hash + wire transfer.
 */
export function serialiseIrnPayload(payload: IrnPayload): string {
  return JSON.stringify(payload);
}
