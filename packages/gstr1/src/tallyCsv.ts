// Tally-Prime-format CSV emitters — pilot CA hand-off lever.
//
// Tally Prime's "GSTR-1 import" feature accepts CSV with column names that
// differ from NIC's offline-tool format. Pharmacies in our ICP work with CAs
// who prefer Tally — Day-30 NPS feedback in March was the trigger for this.
//
// Same data, different column order + a few label changes. Emits the same
// rows-per-rate-bucket shape NIC csvB2B uses; only the column headers and a
// couple of derived fields (Place Of Supply as state name vs code) differ.

import type {
  B2BBuyerBlock,
  B2CLStateBlock,
  B2CSRow,
  CdnrBuyerBlock,
  CdnurNote,
  HsnRow,
} from "./types.js";
import { escapeCsv } from "./format.js";

function row(values: readonly (string | number)[]): string {
  return values.map((v) => escapeCsv(v)).join(",");
}

/** State-code → Tally-friendly state name. Tally prefers full names. */
const STATE_NAME: Readonly<Record<string, string>> = {
  "01": "Jammu And Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Daman And Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman And Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Other Country",
};

function stateName(code: string): string {
  return STATE_NAME[code] ?? code;
}

/** Tally B2B import format. Column order matches Tally Prime 3.x.x's
 * "Sales — GSTR-1 import" template. */
export function csvTallyB2B(blocks: readonly B2BBuyerBlock[]): string {
  const header = [
    "Voucher Date",
    "Voucher No",
    "Party GSTIN",
    "Place of Supply",
    "Reverse Charge",
    "Invoice Type",
    "Rate",
    "Taxable Value",
    "Integrated Tax Amount",
    "Central Tax Amount",
    "State Tax Amount",
    "Cess Amount",
    "Invoice Value",
  ];
  const lines: string[] = [row(header)];
  for (const blk of blocks) {
    for (const inv of blk.inv) {
      for (const it of inv.itms) {
        lines.push(
          row([
            inv.idt,
            inv.inum,
            blk.ctin,
            stateName(inv.pos),
            inv.rchrg === "Y" ? "Yes" : "No",
            inv.inv_typ === "R" ? "Regular" : inv.inv_typ,
            it.itm_det.rt,
            it.itm_det.txval,
            it.itm_det.iamt,
            it.itm_det.camt,
            it.itm_det.samt,
            it.itm_det.csamt,
            inv.val,
          ]),
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}

/** Tally B2CL — interstate, unregistered, > ₹2.5L invoice value. */
export function csvTallyB2CL(blocks: readonly B2CLStateBlock[]): string {
  const header = [
    "Voucher Date",
    "Voucher No",
    "Place of Supply",
    "Rate",
    "Taxable Value",
    "Integrated Tax Amount",
    "Cess Amount",
    "Invoice Value",
  ];
  const lines: string[] = [row(header)];
  for (const blk of blocks) {
    for (const inv of blk.inv) {
      for (const it of inv.itms) {
        lines.push(
          row([
            inv.idt,
            inv.inum,
            stateName(blk.pos),
            it.itm_det.rt,
            it.itm_det.txval,
            it.itm_det.iamt,
            it.itm_det.csamt,
            inv.val,
          ]),
        );
      }
    }
  }
  return lines.join("\n") + "\n";
}

/** Tally B2CS — aggregated by (state, rate). */
export function csvTallyB2CS(rows: readonly B2CSRow[]): string {
  const header = [
    "Type",
    "Place of Supply",
    "Rate",
    "Taxable Value",
    "Integrated Tax Amount",
    "Central Tax Amount",
    "State Tax Amount",
    "Cess Amount",
  ];
  const out: string[] = [row(header)];
  for (const r of rows) {
    out.push(
      row([
        r.sply_ty === "INTRA" ? "Intra-State" : "Inter-State",
        stateName(r.pos),
        r.rt,
        r.txval,
        r.iamt,
        r.camt,
        r.samt,
        r.csamt,
      ]),
    );
  }
  return out.join("\n") + "\n";
}

/** Tally HSN summary. */
export function csvTallyHsn(rows: readonly HsnRow[]): string {
  const header = [
    "HSN/SAC",
    "Description",
    "UQC",
    "Total Quantity",
    "Rate",
    "Total Taxable Value",
    "Integrated Tax",
    "Central Tax",
    "State Tax",
    "Cess",
  ];
  const out: string[] = [row(header)];
  for (const r of rows) {
    out.push(
      row([
        r.hsn_sc,
        r.desc ?? "",
        r.uqc,
        r.qty,
        r.rt,
        r.txval,
        r.iamt,
        r.camt,
        r.samt,
        r.csamt,
      ]),
    );
  }
  return out.join("\n") + "\n";
}

/** Tally CDNR — credit notes to registered buyers. */
export function csvTallyCdnr(blocks: readonly CdnrBuyerBlock[]): string {
  const header = [
    "Voucher Date",
    "Voucher No",
    "Note Type",
    "Party GSTIN",
    "Original Invoice No",
    "Original Invoice Date",
    "Rate",
    "Taxable Value",
    "Integrated Tax Amount",
    "Central Tax Amount",
    "State Tax Amount",
    "Cess Amount",
    "Note Value",
  ];
  const out: string[] = [row(header)];
  for (const blk of blocks) {
    for (const n of blk.nt) {
      for (const it of n.itms) {
        out.push(
          row([
            n.nt_dt,
            n.nt_num,
            n.ntty === "C" ? "Credit Note" : "Debit Note",
            blk.ctin,
            n.inum,
            n.idt,
            it.itm_det.rt,
            it.itm_det.txval,
            it.itm_det.iamt,
            it.itm_det.camt,
            it.itm_det.samt,
            it.itm_det.csamt,
            n.val,
          ]),
        );
      }
    }
  }
  return out.join("\n") + "\n";
}

/** Tally CDNUR — credit notes to unregistered (B2CL credit). */
export function csvTallyCdnur(notes: readonly CdnurNote[]): string {
  const header = [
    "Voucher Date",
    "Voucher No",
    "Note Type",
    "Original Type",
    "Place of Supply",
    "Original Invoice No",
    "Original Invoice Date",
    "Rate",
    "Taxable Value",
    "Integrated Tax Amount",
    "Cess Amount",
    "Note Value",
  ];
  const out: string[] = [row(header)];
  for (const n of notes) {
    for (const it of n.itms) {
      out.push(
        row([
          n.nt_dt,
          n.nt_num,
          n.ntty === "C" ? "Credit Note" : "Debit Note",
          n.typ,
          stateName(n.pos),
          n.inum,
          n.idt,
          it.itm_det.rt,
          it.itm_det.txval,
          it.itm_det.iamt,
          it.itm_det.csamt,
          n.val,
        ]),
      );
    }
  }
  return out.join("\n") + "\n";
}

export { stateName };
