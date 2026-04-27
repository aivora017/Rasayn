// A8 / ADR 0021 step 5 — Credit-note layouts (thermal 80mm + A5 GST).
//
// Mirrors index.ts's invoice renderer style — single self-contained HTML
// document, all CSS inlined (LAN-first: must print offline). Auto-picks
// A5 GST when the customer has a GSTIN; thermal otherwise.

import type {
  CreditNoteFull,
  CreditNoteHeader,
  CreditNoteLine,
  CustomerFull,
  HsnSummary,
  InvoiceLayout,
  OriginalBillSummary,
  RenderCreditNoteInput,
  ShopFull,
} from "./types.js";
import {
  amountInWords,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatQty,
  formatRupees,
} from "./format.js";

function isB2BCust(customer: CustomerFull | null): boolean {
  return !!customer?.gstin && customer.gstin.trim().length > 0;
}

export function resolveCreditNoteLayout(
  cn: CreditNoteFull,
  override?: InvoiceLayout,
): InvoiceLayout {
  if (override) return override;
  if (isB2BCust(cn.customer)) return "a5_gst";
  return cn.shop.defaultInvoiceLayout;
}

/** Entry point — picks layout (override > B2B auto > shop default). */
export function renderCreditNoteHtml(input: RenderCreditNoteInput): string {
  const layout = resolveCreditNoteLayout(input.creditNote, input.layout);
  if (layout === "a5_gst") return renderA5CreditNote(input, layout);
  return renderThermalCreditNote(input, layout);
}

// ─── Thermal 80mm ────────────────────────────────────────────────────────

function renderThermalCreditNote(
  input: RenderCreditNoteInput,
  _layout: InvoiceLayout,
): string {
  const { creditNote: cn } = input;
  const s = cn.shop;
  const h = cn.creditNote;
  const dup = input.printReceipt && input.printReceipt.isDuplicate === 1;
  const banner = dup
    ? `<div class="dup">DUPLICATE — REPRINT (#${input.printReceipt?.printCount ?? 2})</div>`
    : "";
  const custLine = cn.customer
    ? `<div class="cust">${escapeHtml(cn.customer.name)}${cn.customer.phone ? " · " + escapeHtml(cn.customer.phone) : ""}</div>`
    : "";
  const linesHtml = cn.lines.map(renderThermalCnLine).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(h.returnNo)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { font-family: "Consolas", "Courier New", monospace; font-size: 11px; width: 74mm; margin: 0; padding: 0; color: #000; }
  h1 { font-size: 13px; text-align: center; margin: 0 0 2px; font-weight: 700; }
  .title { text-align: center; font-weight: 700; letter-spacing: 2px; border: 1.5px solid #000; padding: 2px; margin: 2px 0; }
  .muted { color: #333; }
  .center { text-align: center; }
  .sep { border-top: 1px dashed #000; margin: 2px 0; }
  .row { display: flex; justify-content: space-between; }
  .cust { margin-top: 2px; font-weight: 600; }
  .ln { margin-top: 2px; }
  .ln .title-l { font-weight: 600; }
  .ln .meta { font-size: 10px; color: #444; }
  .dup { text-align: center; border: 1.5px solid #000; padding: 2px; font-weight: 700; margin: 2px 0; letter-spacing: 1px; }
  .grand { font-size: 13px; font-weight: 700; }
  .reason { margin-top: 2px; font-size: 10px; font-style: italic; }
  .words { margin-top: 2px; font-size: 10px; font-style: italic; }
  .irn { margin-top: 4px; font-size: 9px; word-break: break-all; }
  .foot { margin-top: 4px; font-size: 9px; text-align: center; color: #333; line-height: 1.25; }
</style></head><body>
  ${banner}
  <h1>${escapeHtml(s.name)}</h1>
  <div class="center muted">${escapeHtml(s.address)}</div>
  <div class="center muted">GSTIN ${escapeHtml(s.gstin)} · DL ${escapeHtml(s.retailLicense)}</div>
  <div class="title">CREDIT NOTE</div>
  <div class="row"><span>CN: <b>${escapeHtml(h.returnNo)}</b></span><span>${escapeHtml(formatDateTime(h.createdAt))}</span></div>
  <div class="row"><span>vs Invoice <b>${escapeHtml(cn.originalBill.billNo)}</b></span><span>${escapeHtml(formatDate(cn.originalBill.billedAt))}</span></div>
  ${custLine}
  <div class="reason">Reason: ${escapeHtml(h.reason)}</div>
  <div class="sep"></div>
  ${linesHtml}
  <div class="sep"></div>
  <div class="row"><span>Refund taxable</span><span>${formatRupees(sumLineTaxable(cn.lines))}</span></div>
  <div class="row"><span>CGST refund</span><span>${formatRupees(h.refundCgstPaise)}</span></div>
  <div class="row"><span>SGST refund</span><span>${formatRupees(h.refundSgstPaise)}</span></div>
  ${h.refundIgstPaise > 0 ? `<div class="row"><span>IGST refund</span><span>${formatRupees(h.refundIgstPaise)}</span></div>` : ""}
  ${h.refundCessPaise > 0 ? `<div class="row"><span>Cess refund</span><span>${formatRupees(h.refundCessPaise)}</span></div>` : ""}
  ${h.refundRoundOffPaise !== 0 ? `<div class="row"><span>Round off</span><span>${formatRupees(h.refundRoundOffPaise)}</span></div>` : ""}
  <div class="row grand"><span>REFUND</span><span>₹ ${formatRupees(h.refundTotalPaise)}</span></div>
  <div class="words">${escapeHtml(amountInWords(h.refundTotalPaise))}</div>
  ${renderThermalIrnBlock(h)}
  <div class="sep"></div>
  <div class="foot">
    Credit note issued under section 34 of the CGST Act 2017.<br/>
    Supersedes the corresponding line(s) on the original invoice.<br/>
    Goods accepted for return only against this credit note.
  </div>
  <script>window.onload=function(){try{window.focus();window.print();}catch(e){}};</script>
</body></html>`;
}

function renderThermalCnLine(l: CreditNoteLine): string {
  const batchMeta =
    [l.batchNo ? `Batch ${l.batchNo}` : null, l.expiryDate ? `Exp ${formatDate(l.expiryDate)}` : null]
      .filter(Boolean)
      .join(" · ");
  const scheduleTag = (l.schedule === "H" || l.schedule === "H1" || l.schedule === "X" || l.schedule === "NDPS")
    ? ` [${l.schedule}]`
    : "";
  return `<div class="ln">
    <div class="title-l">${escapeHtml(l.productName)}${scheduleTag}</div>
    <div class="meta">HSN ${escapeHtml(l.hsn)} · ${formatQty(l.qtyReturned)} × ${formatRupees(l.mrpPaise)}${batchMeta ? " · " + escapeHtml(batchMeta) : ""}</div>
    <div class="row"><span>GST ${l.gstRate}% · ${escapeHtml(l.reasonCode)}</span><span>${formatRupees(l.refundAmountPaise)}</span></div>
  </div>`;
}

function renderThermalIrnBlock(h: CreditNoteHeader): string {
  if (!h.creditNoteIrn) return "";
  const ack = h.creditNoteAckNo
    ? `Ack ${escapeHtml(h.creditNoteAckNo)}${h.creditNoteAckDate ? " · " + escapeHtml(formatDate(h.creditNoteAckDate)) : ""}`
    : "";
  return `<div class="sep"></div>
  <div class="irn">IRN: ${escapeHtml(h.creditNoteIrn)}${ack ? "<br/>" + ack : ""}</div>`;
}

// ─── A5 GST credit note ─────────────────────────────────────────────────

function renderA5CreditNote(
  input: RenderCreditNoteInput,
  _layout: InvoiceLayout,
): string {
  const { creditNote: cn } = input;
  const s = cn.shop;
  const h = cn.creditNote;
  const dup = input.printReceipt && input.printReceipt.isDuplicate === 1;
  const banner = dup
    ? `<div class="dup">DUPLICATE — REPRINT (#${input.printReceipt?.printCount ?? 2})</div>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Credit Note ${escapeHtml(h.returnNo)}</title>
<style>
  @page { size: A5 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Segoe UI", Arial, sans-serif; font-size: 10px; color: #111; margin: 0; }
  h1 { font-size: 14px; margin: 0; }
  .title { text-align: center; font-size: 12px; font-weight: 700; letter-spacing: 2px; margin-bottom: 4px; }
  .hdr { border: 1px solid #000; padding: 6px; display: flex; justify-content: space-between; }
  .hdr .r { text-align: right; }
  .muted { color: #555; font-size: 9px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #333; padding: 3px 4px; font-size: 9px; vertical-align: top; }
  th { background: #fef3c7; text-align: center; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.c, th.c { text-align: center; }
  .two { display: flex; gap: 8px; margin-top: 6px; }
  .two > div { flex: 1; border: 1px solid #333; padding: 4px; }
  .tot { width: 50%; margin-left: auto; margin-top: 6px; }
  .tot td { padding: 2px 4px; }
  .grand td { font-weight: 700; font-size: 11px; background: #fde68a; }
  .dup { text-align: center; border: 2px solid #000; padding: 3px; font-weight: 700; letter-spacing: 3px; margin-bottom: 4px; }
  .reason { margin-top: 4px; font-style: italic; }
  .words { margin-top: 4px; font-style: italic; }
  .irn { margin-top: 6px; padding: 4px; border: 1px solid #999; font-size: 9px; word-break: break-all; }
  .foot { margin-top: 10px; font-size: 9px; color: #444; line-height: 1.4; }
  .sig { margin-top: 20px; display: flex; justify-content: flex-end; }
  .sig .box { text-align: center; border-top: 1px solid #333; padding-top: 2px; width: 40%; }
</style></head><body>
  ${banner}
  <div class="title">CREDIT NOTE</div>
  <div class="hdr">
    <div>
      <h1>${escapeHtml(s.name)}</h1>
      <div class="muted">${escapeHtml(s.address)}</div>
      <div class="muted">GSTIN ${escapeHtml(s.gstin)} · DL ${escapeHtml(s.retailLicense)}</div>
    </div>
    <div class="r">
      <div><b>CN ${escapeHtml(h.returnNo)}</b></div>
      <div class="muted">${escapeHtml(formatDateTime(h.createdAt))}</div>
      <div class="muted">vs Invoice ${escapeHtml(cn.originalBill.billNo)} (${escapeHtml(formatDate(cn.originalBill.billedAt))})</div>
    </div>
  </div>
  ${renderA5BuyerBlock(cn.customer)}
  <div class="reason">Reason for credit note: ${escapeHtml(h.reason)}</div>
  ${renderA5CnLineTable(cn.lines)}
  ${renderA5CnHsnSummary(cn.hsnRefundSummary)}
  ${renderA5CnTotals(h, cn.lines)}
  <div class="words">Total refund: ${escapeHtml(amountInWords(h.refundTotalPaise))}</div>
  ${renderA5IrnBlock(h)}
  <div class="foot">
    Credit note issued under section 34 of the CGST Act 2017 + Rule 53 CGST Rules 2017.
    The corresponding tax will be reduced from output GST liability of the period in
    which this credit note is issued. Goods accepted for return only against this
    credit note. Schedule H / H1 / X drug returns require valid prescription on file.
  </div>
  <div class="sig"><div class="box">Authorised signatory</div></div>
  <script>window.onload=function(){try{window.focus();window.print();}catch(e){}};</script>
</body></html>`;
}

function renderA5BuyerBlock(c: CustomerFull | null): string {
  if (!c) return "";
  const gstinLine = c.gstin ? `<div class="muted">GSTIN ${escapeHtml(c.gstin)}</div>` : "";
  const phoneLine = c.phone ? `<div class="muted">${escapeHtml(c.phone)}</div>` : "";
  const addrLine = c.address ? `<div class="muted">${escapeHtml(c.address)}</div>` : "";
  return `<div class="two"><div>
    <h2 style="font-size:11px;margin:0 0 3px;text-transform:uppercase;letter-spacing:1px;color:#555">Buyer</h2>
    <div><b>${escapeHtml(c.name)}</b></div>
    ${phoneLine}
    ${addrLine}
    ${gstinLine}
  </div></div>`;
}

function renderA5CnLineTable(lines: readonly CreditNoteLine[]): string {
  const rows = lines
    .map((l, i) => {
      const scheduleTag = (l.schedule === "H" || l.schedule === "H1" || l.schedule === "X" || l.schedule === "NDPS")
        ? ` [${l.schedule}]`
        : "";
      const meta =
        [l.batchNo ? `Batch ${l.batchNo}` : null, l.expiryDate ? `Exp ${formatDate(l.expiryDate)}` : null]
          .filter(Boolean)
          .join(" · ");
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${escapeHtml(l.productName)}${scheduleTag}${meta ? `<div class="muted">${escapeHtml(meta)}</div>` : ""}</td>
        <td class="c">${escapeHtml(l.hsn)}</td>
        <td class="num">${formatQty(l.qtyReturned)}</td>
        <td class="num">${formatRupees(l.mrpPaise)}</td>
        <td class="num">${formatRupees(l.refundTaxablePaise)}</td>
        <td class="c">${l.gstRate}%</td>
        <td class="num">${formatRupees(l.refundCgstPaise)}</td>
        <td class="num">${formatRupees(l.refundSgstPaise)}</td>
        <td class="num">${formatRupees(l.refundIgstPaise)}</td>
        <td class="num">${formatRupees(l.refundAmountPaise)}</td>
      </tr>`;
    })
    .join("");
  return `<table>
    <thead><tr>
      <th class="c">#</th><th>Item</th><th class="c">HSN</th><th class="num">Qty</th>
      <th class="num">MRP</th><th class="num">Taxable</th><th class="c">GST%</th>
      <th class="num">CGST</th><th class="num">SGST</th><th class="num">IGST</th>
      <th class="num">Refund</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderA5CnHsnSummary(rows: readonly HsnSummary[]): string {
  if (rows.length === 0) return "";
  const tr = rows
    .map(
      (r) => `<tr>
        <td class="c">${escapeHtml(r.hsn)}</td>
        <td class="c">${r.gstRate}%</td>
        <td class="num">${formatRupees(r.taxableValuePaise)}</td>
        <td class="num">${formatRupees(r.cgstPaise)}</td>
        <td class="num">${formatRupees(r.sgstPaise)}</td>
        <td class="num">${formatRupees(r.igstPaise)}</td>
        <td class="num">${formatRupees(r.cessPaise)}</td>
      </tr>`,
    )
    .join("");
  return `<table style="margin-top:6px">
    <thead><tr>
      <th class="c">HSN</th><th class="c">GST</th><th class="num">Taxable</th>
      <th class="num">CGST</th><th class="num">SGST</th><th class="num">IGST</th><th class="num">Cess</th>
    </tr></thead>
    <tbody>${tr}</tbody>
  </table>`;
}

function renderA5CnTotals(h: CreditNoteHeader, lines: readonly CreditNoteLine[]): string {
  return `<table class="tot">
    <tr><td>Refund taxable</td><td class="num">${formatRupees(sumLineTaxable(lines))}</td></tr>
    <tr><td>CGST refund</td><td class="num">${formatRupees(h.refundCgstPaise)}</td></tr>
    <tr><td>SGST refund</td><td class="num">${formatRupees(h.refundSgstPaise)}</td></tr>
    ${h.refundIgstPaise > 0 ? `<tr><td>IGST refund</td><td class="num">${formatRupees(h.refundIgstPaise)}</td></tr>` : ""}
    ${h.refundCessPaise > 0 ? `<tr><td>Cess refund</td><td class="num">${formatRupees(h.refundCessPaise)}</td></tr>` : ""}
    ${h.refundRoundOffPaise !== 0 ? `<tr><td>Round off</td><td class="num">${formatRupees(h.refundRoundOffPaise)}</td></tr>` : ""}
    <tr class="grand"><td>TOTAL REFUND</td><td class="num">₹ ${formatRupees(h.refundTotalPaise)}</td></tr>
  </table>`;
}

function renderA5IrnBlock(h: CreditNoteHeader): string {
  if (!h.creditNoteIrn) return "";
  const ack = h.creditNoteAckNo ? ` · Ack ${escapeHtml(h.creditNoteAckNo)}` : "";
  const ackDate = h.creditNoteAckDate ? ` (${escapeHtml(formatDate(h.creditNoteAckDate))})` : "";
  return `<div class="irn"><b>IRN:</b> ${escapeHtml(h.creditNoteIrn)}${ack}${ackDate}</div>`;
}

function sumLineTaxable(lines: readonly CreditNoteLine[]): number {
  return lines.reduce((s, l) => s + l.refundTaxablePaise, 0);
}

// Re-export resolveLayout helper for tests / external callers.
export type { OriginalBillSummary };
