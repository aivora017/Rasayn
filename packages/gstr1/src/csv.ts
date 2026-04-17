/**
 * CSV generators — Tally-parity column order for CA hand-off workflows.
 * Each generator returns a CSV string (LF line endings, RFC 4180 escaped).
 */
import type {
  B2BBuyerBlock,
  B2CLStateBlock,
  B2CSRow,
  HsnRow,
  ExempRow,
  DocBlock,
} from "./types.js";
import { escapeCsv } from "./format.js";

function row(values: readonly (string | number)[]): string {
  return values.map((v) => escapeCsv(v)).join(",");
}

export function csvB2B(blocks: readonly B2BBuyerBlock[]): string {
  const header = [
    "GSTIN/UIN of Recipient",
    "Invoice Number",
    "Invoice date",
    "Invoice Value",
    "Place Of Supply",
    "Reverse Charge",
    "Applicable % of Tax Rate",
    "Invoice Type",
    "E-Commerce GSTIN",
    "Rate",
    "Taxable Value",
    "Cess Amount",
  ];
  const lines: string[] = [row(header)];
  for (const block of blocks) {
    for (const inv of block.inv) {
      for (const item of inv.itms) {
        lines.push(row([
          block.ctin,
          inv.inum,
          inv.idt,
          inv.val.toFixed(2),
          inv.pos,
          inv.rchrg,
          "",                 // Applicable % (not used v1)
          "Regular",
          "",                 // E-commerce GSTIN
          item.itm_det.rt.toString(),
          item.itm_det.txval.toFixed(2),
          item.itm_det.csamt.toFixed(2),
        ]));
      }
    }
  }
  return lines.join("\n") + "\n";
}

export function csvB2CL(blocks: readonly B2CLStateBlock[]): string {
  const header = [
    "Invoice Number",
    "Invoice date",
    "Invoice Value",
    "Place Of Supply",
    "Applicable % of Tax Rate",
    "Rate",
    "Taxable Value",
    "Cess Amount",
    "E-Commerce GSTIN",
  ];
  const lines: string[] = [row(header)];
  for (const block of blocks) {
    for (const inv of block.inv) {
      for (const item of inv.itms) {
        lines.push(row([
          inv.inum,
          inv.idt,
          inv.val.toFixed(2),
          block.pos,
          "",
          item.itm_det.rt.toString(),
          item.itm_det.txval.toFixed(2),
          item.itm_det.csamt.toFixed(2),
          "",
        ]));
      }
    }
  }
  return lines.join("\n") + "\n";
}

export function csvB2CS(rows: readonly B2CSRow[]): string {
  const header = [
    "Type",
    "Place Of Supply",
    "Applicable % of Tax Rate",
    "Rate",
    "Taxable Value",
    "Cess Amount",
    "E-Commerce GSTIN",
  ];
  const lines: string[] = [row(header)];
  for (const r of rows) {
    lines.push(row([
      r.typ === "OE" ? "OE" : r.typ,
      r.pos,
      "",
      r.rt.toString(),
      r.txval.toFixed(2),
      r.csamt.toFixed(2),
      "",
    ]));
  }
  return lines.join("\n") + "\n";
}

export function csvHsn(rows: readonly HsnRow[]): string {
  const header = [
    "HSN",
    "Description",
    "UQC",
    "Total Quantity",
    "Total Value",
    "Rate",
    "Taxable Value",
    "Integrated Tax Amount",
    "Central Tax Amount",
    "State/UT Tax Amount",
    "Cess Amount",
  ];
  const lines: string[] = [row(header)];
  for (const r of rows) {
    const totalValue = r.txval + r.iamt + r.camt + r.samt + r.csamt;
    lines.push(row([
      r.hsn_sc,
      r.desc ?? "",
      r.uqc,
      r.qty.toString(),
      totalValue.toFixed(2),
      r.rt.toString(),
      r.txval.toFixed(2),
      r.iamt.toFixed(2),
      r.camt.toFixed(2),
      r.samt.toFixed(2),
      r.csamt.toFixed(2),
    ]));
  }
  return lines.join("\n") + "\n";
}

export function csvExemp(rows: readonly ExempRow[]): string {
  const header = [
    "Description",
    "Nil Rated Supplies",
    "Exempted (other than nil rated/non GST supply)",
    "Non-GST Supplies",
  ];
  const lines: string[] = [row(header)];
  const labels: Record<ExempRow["sply_ty"], string> = {
    INTRAB2B: "Intra-State supplies to registered persons",
    INTRAB2C: "Intra-State supplies to unregistered persons",
    INTRB2B:  "Inter-State supplies to registered persons",
    INTRB2C:  "Inter-State supplies to unregistered persons",
  };
  for (const r of rows) {
    lines.push(row([
      labels[r.sply_ty],
      r.nil_amt.toFixed(2),
      r.expt_amt.toFixed(2),
      r.ngsup_amt.toFixed(2),
    ]));
  }
  return lines.join("\n") + "\n";
}

export function csvDoc(block: DocBlock): string {
  const header = [
    "Nature of Document",
    "Sr. No. From",
    "Sr. No. To",
    "Total Number",
    "Cancelled",
    "Net Issued",
  ];
  const lines: string[] = [row(header)];
  for (const d of block.docs) {
    lines.push(row([
      block.doc_typ,
      d.from,
      d.to,
      d.totnum.toString(),
      d.cancel.toString(),
      d.net_issue.toString(),
    ]));
  }
  return lines.join("\n") + "\n";
}
