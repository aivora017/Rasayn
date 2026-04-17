// Invoice renderer — produces self-contained HTML strings for print.
// Two layouts: thermal 80mm (B2C, compact) and A5 GST (B2B tax invoice).
// Auto-selects A5 if customer has GSTIN (B2B) else thermal.
//
// Output is a complete HTML document — host passes to a hidden iframe /
// webview and invokes window.print(). All CSS is inlined; no external fonts
// or scripts (LAN-first: must print offline).

import type {
  BillFull,
  BillHeader,
  BillLineFull,
  CustomerFull,
  HsnSummary,
  InvoiceLayout,
  PaymentRow,
  PrescriptionFull,
  PrintReceipt,
  RenderInvoiceInput,
  ShopFull,
} from "./types.js";
import { amountInWords, escapeHtml, formatDate, formatDateTime, formatQty, formatRupees } from "./format.js";

export * from "./types.js";

/** B2B if customer has a GSTIN; used to auto-pick A5-GST layout. */
export function isB2B(customer: CustomerFull | null): boolean {
  return !!customer?.gstin && customer.gstin.trim().length > 0;
}

export function resolveLayout(bill: BillFull, override?: InvoiceLayout): InvoiceLayout {
  if (override) return override;
  if (isB2B(bill.customer)) return "a5_gst";
  return bill.shop.defaultInvoiceLayout;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function renderInvoiceHtml(input: RenderInvoiceInput): string {
  const layout = resolveLayout(input.bill, input.layout);
  if (layout === "a5_gst") return renderA5(input, layout);
  return renderThermal(input, layout);
}

// ---------------------------------------------------------------------------
// Thermal 80mm (B2C compact)
// ---------------------------------------------------------------------------
function renderThermal(input: RenderInvoiceInput, layout: InvoiceLayout): string {
  const { bill } = input;
  const s = bill.shop;
  const b = bill.bill;
  const dup = input.printReceipt && input.printReceipt.isDuplicate === 1;
  const banner = dup
    ? `<div class="dup">DUPLICATE — REPRINT (#${input.printReceipt?.printCount ?? 2})</div>`
    : "";
  const rxLine = bill.prescription ? renderRxLine(bill.prescription) : "";
  const custLine = bill.customer
    ? `<div class="cust">${escapeHtml(bill.customer.name)}${bill.customer.phone ? " · " + escapeHtml(bill.customer.phone) : ""}</div>`
    : "";
  const linesHtml = bill.lines.map(renderThermalLine).join("");
  const paymentsHtml = renderThermalPayments(bill.payments);

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(b.billNo)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { font-family: "Consolas", "Courier New", monospace; font-size: 11px; width: 74mm; margin: 0; padding: 0; color: #000; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 2px; font-weight: 700; }
  .muted { color: #333; }
  .center { text-align: center; }
  .right { text-align: right; }
  .sep { border-top: 1px dashed #000; margin: 2px 0; }
  .row { display: flex; justify-content: space-between; }
  .cust { margin-top: 2px; font-weight: 600; }
  .ln { margin-top: 2px; }
  .ln .title { font-weight: 600; }
  .ln .meta { font-size: 10px; color: #444; }
  .dup { text-align: center; border: 1.5px solid #000; padding: 2px; font-weight: 700; margin: 2px 0; letter-spacing: 1px; }
  .grand { font-size: 13px; font-weight: 700; }
  .pay { margin-top: 2px; font-size: 10px; }
  .words { margin-top: 2px; font-size: 10px; font-style: italic; }
  .foot { margin-top: 4px; font-size: 9px; text-align: center; color: #333; line-height: 1.25; }
</style></head><body>
  ${banner}
  <h1>${escapeHtml(s.name)}</h1>
  <div class="center muted">${escapeHtml(s.address)}</div>
  <div class="center muted">GSTIN ${escapeHtml(s.gstin)} · DL ${escapeHtml(s.retailLicense)}</div>
  <div class="sep"></div>
  <div class="row"><span>Bill: <b>${escapeHtml(b.billNo)}</b></span><span>${escapeHtml(formatDateTime(b.billedAt))}</span></div>
  ${custLine}
  ${rxLine}
  <div class="sep"></div>
  ${linesHtml}
  <div class="sep"></div>
  <div class="row"><span>Sub-total</span><span>${formatRupees(b.subtotalPaise)}</span></div>
  ${b.totalDiscountPaise > 0 ? `<div class="row"><span>Discount</span><span>-${formatRupees(b.totalDiscountPaise)}</span></div>` : ""}
  <div class="row"><span>CGST</span><span>${formatRupees(b.totalCgstPaise)}</span></div>
  <div class="row"><span>SGST</span><span>${formatRupees(b.totalSgstPaise)}</span></div>
  ${b.totalIgstPaise > 0 ? `<div class="row"><span>IGST</span><span>${formatRupees(b.totalIgstPaise)}</span></div>` : ""}
  ${b.totalCessPaise > 0 ? `<div class="row"><span>Cess</span><span>${formatRupees(b.totalCessPaise)}</span></div>` : ""}
  ${b.roundOffPaise !== 0 ? `<div class="row"><span>Round off</span><span>${formatRupees(b.roundOffPaise)}</span></div>` : ""}
  <div class="row grand"><span>TOTAL</span><span>₹ ${formatRupees(b.grandTotalPaise)}</span></div>
  <div class="words">${escapeHtml(amountInWords(b.grandTotalPaise))}</div>
  ${paymentsHtml}
  <div class="sep"></div>
  <div class="foot">
    ${s.pharmacistName ? escapeHtml(`Dispensed under ${s.pharmacistName}, Reg ${s.pharmacistRegNo ?? "—"}`) + "<br/>" : ""}
    Goods once sold are non-returnable.<br/>
    Schedule H / H1 / X drugs to be sold against a valid prescription only.<br/>
    Thank you · Visit again
  </div>
  <script>window.onload=function(){try{window.focus();window.print();}catch(e){}};</script>
</body></html>`;
}

function renderThermalLine(l: BillLineFull): string {
  const batchMeta =
    [l.batchNo ? `Batch ${l.batchNo}` : null, l.expiryDate ? `Exp ${formatDate(l.expiryDate)}` : null]
      .filter(Boolean)
      .join(" · ");
  const scheduleTag = (l.schedule === "H" || l.schedule === "H1" || l.schedule === "X" || l.schedule === "NDPS")
    ? ` [${l.schedule}]`
    : "";
  return `<div class="ln">
    <div class="title">${escapeHtml(l.productName)}${scheduleTag}</div>
    <div class="meta">HSN ${escapeHtml(l.hsn)} · ${formatQty(l.qty)} × ${formatRupees(l.mrpPaise)}${batchMeta ? " · " + escapeHtml(batchMeta) : ""}</div>
    <div class="row"><span>GST ${l.gstRate}%</span><span>${formatRupees(l.lineTotalPaise)}</span></div>
  </div>`;
}

function renderThermalPayments(payments: readonly PaymentRow[]): string {
  if (payments.length === 0) return "";
  const rows = payments
    .map((p) => `<div class="row"><span>${escapeHtml(p.mode.toUpperCase())}${p.refNo ? " · " + escapeHtml(p.refNo) : ""}</span><span>${formatRupees(p.amountPaise)}</span></div>`)
    .join("");
  return `<div class="pay"><div class="sep"></div>${rows}</div>`;
}

// ---------------------------------------------------------------------------
// A5 GST tax invoice (B2B)
// ---------------------------------------------------------------------------
function renderA5(input: RenderInvoiceInput, layout: InvoiceLayout): string {
  const { bill } = input;
  const s = bill.shop;
  const b = bill.bill;
  const dup = input.printReceipt && input.printReceipt.isDuplicate === 1;
  const banner = dup
    ? `<div class="dup">DUPLICATE — REPRINT (#${input.printReceipt?.printCount ?? 2})</div>`
    : "";
  const rxBlock = bill.prescription ? renderRxBlockA5(bill.prescription) : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Tax Invoice ${escapeHtml(b.billNo)}</title>
<style>
  @page { size: A5 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Segoe UI", Arial, sans-serif; font-size: 10px; color: #111; margin: 0; }
  h1 { font-size: 14px; margin: 0; }
  h2 { font-size: 11px; margin: 6px 0 3px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .title { text-align: center; font-size: 12px; font-weight: 700; letter-spacing: 2px; margin-bottom: 4px; }
  .hdr { border: 1px solid #000; padding: 6px; display: flex; justify-content: space-between; }
  .hdr .r { text-align: right; }
  .muted { color: #555; font-size: 9px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #333; padding: 3px 4px; font-size: 9px; vertical-align: top; }
  th { background: #eee; text-align: center; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.c, th.c { text-align: center; }
  .two { display: flex; gap: 8px; margin-top: 6px; }
  .two > div { flex: 1; border: 1px solid #333; padding: 4px; }
  .tot { width: 50%; margin-left: auto; margin-top: 6px; }
  .tot td { padding: 2px 4px; }
  .grand td { font-weight: 700; font-size: 11px; background: #eef; }
  .dup { text-align: center; border: 2px solid #000; padding: 3px; font-weight: 700; letter-spacing: 3px; margin-bottom: 4px; }
  .words { margin-top: 4px; font-style: italic; }
  .foot { margin-top: 10px; font-size: 9px; color: #444; line-height: 1.4; }
  .sig { margin-top: 20px; display: flex; justify-content: flex-end; }
  .sig .box { text-align: center; border-top: 1px solid #333; padding-top: 2px; width: 40%; }
</style></head><body>
  ${banner}
  <div class="title">TAX INVOICE</div>
  <div class="hdr">
    <div>
      <h1>${escapeHtml(s.name)}</h1>
      <div class="muted">${escapeHtml(s.address)}</div>
      <div class="muted">GSTIN: <b>${escapeHtml(s.gstin)}</b> · State: ${escapeHtml(s.stateCode)}</div>
      <div class="muted">DL: ${escapeHtml(s.retailLicense)}${s.fssaiNo ? " · FSSAI: " + escapeHtml(s.fssaiNo) : ""}</div>
      ${s.pharmacistName ? `<div class="muted">Pharmacist: ${escapeHtml(s.pharmacistName)} (Reg ${escapeHtml(s.pharmacistRegNo ?? "—")})</div>` : ""}
    </div>
    <div class="r">
      <div><b>Invoice No:</b> ${escapeHtml(b.billNo)}</div>
      <div><b>Date:</b> ${escapeHtml(formatDateTime(b.billedAt))}</div>
      <div><b>Treatment:</b> ${escapeHtml(b.gstTreatment.toUpperCase())}</div>
    </div>
  </div>
  ${renderA5PartyBlock(bill.customer)}
  ${rxBlock}
  ${renderA5LinesTable(bill.lines)}
  ${renderA5HsnTable(bill.hsnTaxSummary)}
  ${renderA5TotalsTable(b)}
  ${renderA5Payments(bill.payments)}
  <div class="words"><b>In words:</b> ${escapeHtml(amountInWords(b.grandTotalPaise))}</div>
  <div class="foot">
    Schedule H / H1 / X drugs to be sold against a valid prescription only. Goods once sold are non-returnable.<br/>
    Subject to ${escapeHtml(resolveJurisdiction(s))} jurisdiction. E.&O.E.
  </div>
  <div class="sig"><div class="box">For ${escapeHtml(s.name)}<br/>Authorised Signatory</div></div>
  <script>window.onload=function(){try{window.focus();window.print();}catch(e){}};</script>
</body></html>`;
}

function renderA5PartyBlock(c: CustomerFull | null): string {
  if (!c) {
    return `<div class="two"><div><h2>Billed to</h2><div>Walk-in customer</div></div><div><h2>Delivery</h2><div>Over the counter</div></div></div>`;
  }
  return `<div class="two">
    <div>
      <h2>Billed to</h2>
      <div><b>${escapeHtml(c.name)}</b></div>
      ${c.phone ? `<div>Ph: ${escapeHtml(c.phone)}</div>` : ""}
      ${c.address ? `<div>${escapeHtml(c.address)}</div>` : ""}
      ${c.gstin ? `<div>GSTIN: <b>${escapeHtml(c.gstin)}</b></div>` : ""}
    </div>
    <div>
      <h2>Ship to</h2>
      <div>Same as billing</div>
    </div>
  </div>`;
}

function renderA5LinesTable(lines: readonly BillLineFull[]): string {
  const rows = lines
    .map((l, i) => {
      const scheduleTag = l.schedule === "H" || l.schedule === "H1" || l.schedule === "X" || l.schedule === "NDPS"
        ? ` <b>[${l.schedule}]</b>` : "";
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${escapeHtml(l.productName)}${scheduleTag}</td>
        <td class="c">${escapeHtml(l.hsn)}</td>
        <td class="c">${escapeHtml(l.batchNo ?? "—")}</td>
        <td class="c">${l.expiryDate ? escapeHtml(formatDate(l.expiryDate)) : "—"}</td>
        <td class="num">${formatQty(l.qty)}</td>
        <td class="num">${formatRupees(l.mrpPaise)}</td>
        <td class="num">${formatRupees(l.discountPaise)}</td>
        <td class="num">${formatRupees(l.taxableValuePaise)}</td>
        <td class="c">${l.gstRate}%</td>
        <td class="num">${formatRupees(l.cgstPaise + l.sgstPaise + l.igstPaise)}</td>
        <td class="num">${formatRupees(l.lineTotalPaise)}</td>
      </tr>`;
    })
    .join("");
  return `<table>
    <thead><tr>
      <th>#</th><th>Item</th><th>HSN</th><th>Batch</th><th>Exp</th>
      <th class="num">Qty</th><th class="num">MRP</th><th class="num">Disc</th>
      <th class="num">Taxable</th><th>GST%</th><th class="num">GST</th><th class="num">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderA5HsnTable(rows: readonly HsnSummary[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map((r) => `<tr>
      <td class="c">${escapeHtml(r.hsn)}</td>
      <td class="c">${r.gstRate}%</td>
      <td class="num">${formatRupees(r.taxableValuePaise)}</td>
      <td class="num">${formatRupees(r.cgstPaise)}</td>
      <td class="num">${formatRupees(r.sgstPaise)}</td>
      <td class="num">${formatRupees(r.igstPaise)}</td>
      <td class="num">${formatRupees(r.cessPaise)}</td>
    </tr>`)
    .join("");
  return `<h2>HSN-wise tax summary</h2>
  <table>
    <thead><tr>
      <th>HSN</th><th>GST%</th><th class="num">Taxable</th>
      <th class="num">CGST</th><th class="num">SGST</th><th class="num">IGST</th><th class="num">Cess</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderA5TotalsTable(b: BillHeader): string {
  const row = (label: string, p: number, grand = false) =>
    `<tr class="${grand ? "grand" : ""}"><td>${escapeHtml(label)}</td><td class="num">${formatRupees(p)}</td></tr>`;
  return `<table class="tot">
    <tbody>
      ${row("Sub-total", b.subtotalPaise)}
      ${b.totalDiscountPaise > 0 ? row("Discount", -b.totalDiscountPaise) : ""}
      ${row("CGST", b.totalCgstPaise)}
      ${row("SGST", b.totalSgstPaise)}
      ${b.totalIgstPaise > 0 ? row("IGST", b.totalIgstPaise) : ""}
      ${b.totalCessPaise > 0 ? row("Cess", b.totalCessPaise) : ""}
      ${b.roundOffPaise !== 0 ? row("Round off", b.roundOffPaise) : ""}
      ${row("GRAND TOTAL (₹)", b.grandTotalPaise, true)}
    </tbody>
  </table>`;
}

function renderA5Payments(payments: readonly PaymentRow[]): string {
  if (payments.length === 0) return "";
  const rows = payments
    .map((p) => `<tr><td>${escapeHtml(p.mode.toUpperCase())}</td><td>${escapeHtml(p.refNo ?? "—")}</td><td class="num">${formatRupees(p.amountPaise)}</td></tr>`)
    .join("");
  return `<h2>Payments</h2>
  <table>
    <thead><tr><th>Mode</th><th>Reference</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRxLine(rx: PrescriptionFull): string {
  const dr = rx.doctorName
    ? `Dr ${rx.doctorName}${rx.doctorRegNo ? " (Reg " + rx.doctorRegNo + ")" : ""}`
    : "Self-declared";
  return `<div class="muted">Rx: ${escapeHtml(dr)} · ${escapeHtml(rx.kind)} · ${escapeHtml(formatDate(rx.issuedDate))}</div>`;
}

function renderRxBlockA5(rx: PrescriptionFull): string {
  const dr = rx.doctorName
    ? `Dr ${rx.doctorName}${rx.doctorRegNo ? " (Reg " + rx.doctorRegNo + ")" : ""}`
    : "Self-declared";
  return `<div class="two"><div>
    <h2>Prescription</h2>
    <div><b>${escapeHtml(dr)}</b></div>
    <div>${escapeHtml(rx.kind.toUpperCase())} · issued ${escapeHtml(formatDate(rx.issuedDate))}</div>
    ${rx.notes ? `<div class="muted">${escapeHtml(rx.notes)}</div>` : ""}
  </div><div>
    <h2>Retention</h2>
    <div class="muted">Rx ID ${escapeHtml(rx.id)}. Retained on file ≥ 2 years per D&amp;C Rule 65(9).</div>
  </div></div>`;
}

function resolveJurisdiction(s: ShopFull): string {
  // Best-effort: use state code → state name map for common IN codes.
  const map: Record<string, string> = {
    "27": "Maharashtra", "29": "Karnataka", "07": "Delhi", "24": "Gujarat",
    "33": "Tamil Nadu", "19": "West Bengal", "06": "Haryana", "09": "Uttar Pradesh",
    "36": "Telangana", "23": "Madhya Pradesh", "03": "Punjab",
  };
  return map[s.stateCode] ?? "local";
}

// Export a tiny test-helper convenient for fixtures.
export function renderInvoice(bill: BillFull, opts?: { layout?: InvoiceLayout; printReceipt?: PrintReceipt }): string {
  const input: RenderInvoiceInput = {
    bill,
    ...(opts?.layout !== undefined ? { layout: opts.layout } : {}),
    ...(opts?.printReceipt !== undefined ? { printReceipt: opts.printReceipt } : {}),
  };
  return renderInvoiceHtml(input);
}
