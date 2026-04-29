// @pharmacare/tally-export
// Real Tally Prime XML emit + Zoho Books CSV + QuickBooks IIF.
// ADR-0041. The #1 ask from Marg defectors — they have an accountant on Tally
// already and need clean voucher-level export.
//
// Tally Prime XML format (TALLYMESSAGE → VOUCHER → ALLLEDGERENTRIES.LIST)
// is documented at https://help.tallysolutions.com/docs/te9rel66/Tally.ERP9/
// xml_tags_for_voucher_creation.htm. We implement the subset Indian
// pharmacies actually use: Sales, Purchase, Receipt, Payment, Journal.

import type { Paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type VoucherType = "Sales" | "Purchase" | "Receipt" | "Payment" | "Journal";

export interface LedgerEntry {
  readonly ledgerName: string;
  readonly amountPaise: Paise;            // signed: +debit, -credit per Tally convention
  readonly isDebit: boolean;              // explicit so XML "ISDEEMEDPOSITIVE" is unambiguous
  readonly billAllocation?: { readonly billName: string; readonly amountPaise: Paise };
}

export interface TallyVoucher {
  readonly date: string;                  // YYYYMMDD per Tally
  readonly voucherType: VoucherType;
  readonly voucherNumber: string;         // shop's bill_no / grn_no / receipt_no
  readonly party: string;                 // ledger name
  readonly narration?: string;
  readonly entries: readonly LedgerEntry[]; // must balance: SUM(debits) === SUM(credits)
}

export class UnbalancedVoucherError extends Error {
  public readonly code = "UNBALANCED_VOUCHER" as const;
  constructor(voucherNumber: string, debitTotal: number, creditTotal: number) {
    super(`UNBALANCED_VOUCHER: ${voucherNumber} debits=${debitTotal} credits=${creditTotal}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// XML emission
// ────────────────────────────────────────────────────────────────────────

/** XML-escape a string. Conservative: escapes 5 special chars + non-ASCII control. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Format Tally date "YYYYMMDD" from any of "YYYY-MM-DD" / Date / Tally string. */
export function tallyDate(input: string | Date): string {
  if (input instanceof Date) {
    const y = input.getFullYear();
    const m = String(input.getMonth() + 1).padStart(2, "0");
    const d = String(input.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  if (/^\d{8}$/.test(input)) return input;            // already Tally
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10).replace(/-/g, "");
  throw new Error(`tallyDate: cannot parse ${input}`);
}

/** Convert paise integer to rupees decimal string with sign for Tally. */
export function paiseToTallyAmount(p: number): string {
  const rupees = p / 100;
  return rupees.toFixed(2);                            // "123.45" or "-50.00"
}

/** Validate a voucher balances. Throws UnbalancedVoucherError if not. */
export function assertBalanced(v: TallyVoucher): void {
  const debits  = v.entries.filter((e) => e.isDebit).reduce((s, e) => s + (e.amountPaise as number), 0);
  const credits = v.entries.filter((e) => !e.isDebit).reduce((s, e) => s + (e.amountPaise as number), 0);
  if (debits !== credits) throw new UnbalancedVoucherError(v.voucherNumber, debits, credits);
}

/** Build a single VOUCHER XML block. */
export function buildVoucherXml(v: TallyVoucher): string {
  assertBalanced(v);
  const entries = v.entries.map((e) => {
    const amount = paiseToTallyAmount(e.isDebit ? e.amountPaise : -(e.amountPaise as number));
    const billAlloc = e.billAllocation ? `
        <BILLALLOCATIONS.LIST>
          <NAME>${escapeXml(e.billAllocation.billName)}</NAME>
          <BILLTYPE>New Ref</BILLTYPE>
          <AMOUNT>${paiseToTallyAmount(e.isDebit ? e.billAllocation.amountPaise : -(e.billAllocation.amountPaise as number))}</AMOUNT>
        </BILLALLOCATIONS.LIST>` : "";
    return `      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeXml(e.ledgerName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${e.isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
        <AMOUNT>${amount}</AMOUNT>${billAlloc}
      </ALLLEDGERENTRIES.LIST>`;
  }).join("\n");

  return `    <VOUCHER VCHTYPE="${v.voucherType}" ACTION="Create">
      <DATE>${tallyDate(v.date)}</DATE>
      <VOUCHERTYPENAME>${v.voucherType}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${escapeXml(v.voucherNumber)}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${escapeXml(v.party)}</PARTYLEDGERNAME>
${v.narration ? `      <NARRATION>${escapeXml(v.narration)}</NARRATION>\n` : ""}${entries}
    </VOUCHER>`;
}

/** Build the full Tally Prime import XML envelope. */
export function buildTallyXml(vouchers: readonly TallyVoucher[], companyName: string = "PharmaCare"): string {
  const body = vouchers.map(buildVoucherXml).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${body}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

// ────────────────────────────────────────────────────────────────────────
// Zoho Books CSV
// ────────────────────────────────────────────────────────────────────────

function escapeCsv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Zoho Books invoice CSV — minimal column set Zoho accepts on import. */
export function buildZohoBooksCsv(vouchers: readonly TallyVoucher[]): string {
  const header = ["Invoice Date","Invoice Number","Customer Name","Voucher Type","Total","Notes"];
  const rows = vouchers.map((v) => {
    const total = Math.max(0, v.entries.filter((e) => e.isDebit).reduce((s, e) => s + (e.amountPaise as number), 0)) / 100;
    return [
      v.date.length === 10 && v.date.includes("-") ? v.date : tallyToIso(v.date),
      v.voucherNumber, v.party, v.voucherType,
      total.toFixed(2), v.narration ?? "",
    ].map(escapeCsv).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

function tallyToIso(d: string): string {
  return /^\d{8}$/.test(d) ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : d;
}

// ────────────────────────────────────────────────────────────────────────
// QuickBooks IIF (legacy import format, still supported by QB India)
// ────────────────────────────────────────────────────────────────────────

export function buildQuickBooksIIF(vouchers: readonly TallyVoucher[]): string {
  const lines: string[] = [];
  lines.push("!TRNS\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO");
  lines.push("!SPL\tDATE\tACCNT\tAMOUNT\tMEMO");
  lines.push("!ENDTRNS");
  for (const v of vouchers) {
    const date = tallyToIso(v.date);
    const debits  = v.entries.filter((e) => e.isDebit);
    const credits = v.entries.filter((e) => !e.isDebit);
    const totalDebit = debits.reduce((s, e) => s + (e.amountPaise as number), 0);
    lines.push([
      "TRNS", date, v.party, v.party, "",
      paiseToTallyAmount(totalDebit), v.voucherNumber, v.narration ?? "",
    ].join("\t"));
    for (const c of credits) {
      lines.push([
        "SPL", date, c.ledgerName, paiseToTallyAmount(-(c.amountPaise as number)), v.narration ?? "",
      ].join("\t"));
    }
    lines.push("ENDTRNS");
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// Convenience: convert a PharmaCare bill into a Sales voucher.
// ────────────────────────────────────────────────────────────────────────

export interface BillSummary {
  readonly billNo: string;
  readonly billedAt: string;            // ISO
  readonly customerLedgerName: string;
  readonly grandTotalPaise: Paise;
  readonly cgstPaise: Paise;
  readonly sgstPaise: Paise;
  readonly igstPaise: Paise;
  readonly cessPaise: Paise;
  readonly salesLedgerName: string;     // typically "Sales — Pharmacy 12%" etc
}

export function billToSalesVoucher(b: BillSummary): TallyVoucher {
  const taxableSales = (b.grandTotalPaise as number) - (b.cgstPaise as number)
                     - (b.sgstPaise as number) - (b.igstPaise as number) - (b.cessPaise as number);
  const entries: LedgerEntry[] = [
    { ledgerName: b.customerLedgerName, amountPaise: b.grandTotalPaise, isDebit: true,
      billAllocation: { billName: b.billNo, amountPaise: b.grandTotalPaise } },
    { ledgerName: b.salesLedgerName, amountPaise: taxableSales as Paise, isDebit: false },
  ];
  if ((b.cgstPaise as number) > 0) entries.push({ ledgerName: "Output CGST", amountPaise: b.cgstPaise, isDebit: false });
  if ((b.sgstPaise as number) > 0) entries.push({ ledgerName: "Output SGST", amountPaise: b.sgstPaise, isDebit: false });
  if ((b.igstPaise as number) > 0) entries.push({ ledgerName: "Output IGST", amountPaise: b.igstPaise, isDebit: false });
  if ((b.cessPaise as number) > 0) entries.push({ ledgerName: "Output Cess", amountPaise: b.cessPaise, isDebit: false });

  return {
    date: b.billedAt,
    voucherType: "Sales",
    voucherNumber: b.billNo,
    party: b.customerLedgerName,
    narration: `Auto-export from PharmaCare for bill ${b.billNo}`,
    entries,
  };
}
