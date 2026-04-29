// @pharmacare/shift-handover
// Shift-handover note composer. Pure transformation: takes counter snapshot
// + closing inputs and produces a structured handover doc that prints on
// the receipt printer AND can be shared as a WhatsApp message.

export interface TopSeller {
  readonly productName: string;
  readonly qty: number;
  readonly revenuePaise: number;
}

export interface ExpiredItem {
  readonly productName: string;
  readonly batchNo: string;
  readonly qty: number;
  readonly lossPaise: number;
}

export interface ComplaintEntry {
  readonly customerName?: string;
  readonly summary: string;
  readonly resolved: boolean;
}

export interface ReorderHint {
  readonly productName: string;
  readonly daysOfStockLeft: number;
}

export interface ShiftHandoverInput {
  readonly shiftId: string;
  readonly shopName: string;
  readonly cashierName: string;
  readonly nextCashierName?: string;
  readonly openedAtIso: string;
  readonly closedAtIso: string;
  readonly billCount: number;
  readonly totalSalesPaise: number;
  readonly totalReturnsPaise: number;
  readonly variancePaise: number;
  readonly varianceApproved: boolean;
  readonly topSellers: readonly TopSeller[];
  readonly expiredDiscarded: readonly ExpiredItem[];
  readonly complaints: readonly ComplaintEntry[];
  readonly reorderHints: readonly ReorderHint[];
  readonly note?: string | undefined;
}

export interface ShiftHandoverNote {
  readonly headline: string;
  readonly body: string;          // human-readable, fits 80 columns
  readonly whatsappBody: string;  // emoji-decorated short version for chat
  readonly receiptBytes: string;  // 32/48-col plain text for thermal printer
}

export function buildHandover(input: ShiftHandoverInput): ShiftHandoverNote {
  const headline = composeHeadline(input);
  const body = composeBody(input);
  const whatsappBody = composeWhatsApp(input);
  const receiptBytes = composeReceipt(input);
  return { headline, body, whatsappBody, receiptBytes };
}

function composeHeadline(i: ShiftHandoverInput): string {
  const sales = rupees(i.totalSalesPaise);
  const variance =
    i.variancePaise === 0 ? "exact"
    : i.variancePaise > 0 ? `+${rupees(i.variancePaise)} overage`
    : `${rupees(i.variancePaise)} shortage`;
  return `Shift closed by ${i.cashierName} — ${i.billCount} bills, ${sales} sold, ${variance}.`;
}

function composeBody(i: ShiftHandoverInput): string {
  const sep = "─".repeat(60);
  const lines: string[] = [];
  lines.push(`Shift Handover — ${i.shopName}`);
  lines.push(`Opened: ${fmt(i.openedAtIso)}  ·  Closed: ${fmt(i.closedAtIso)}`);
  lines.push(`Cashier: ${i.cashierName}${i.nextCashierName ? ` → ${i.nextCashierName}` : ""}`);
  lines.push(sep);
  lines.push("Sales");
  lines.push(`  Bills        : ${i.billCount}`);
  lines.push(`  Total sales  : ${rupees(i.totalSalesPaise)}`);
  lines.push(`  Returns      : ${rupees(i.totalReturnsPaise)}`);
  lines.push(`  Variance     : ${signedRupees(i.variancePaise)}${i.varianceApproved ? " (approved)" : ""}`);
  lines.push(sep);
  if (i.topSellers.length > 0) {
    lines.push("Top sellers");
    for (const t of i.topSellers) {
      lines.push(`  • ${t.productName} — ${t.qty} units, ${rupees(t.revenuePaise)}`);
    }
    lines.push(sep);
  }
  if (i.expiredDiscarded.length > 0) {
    lines.push("Expired discarded");
    for (const e of i.expiredDiscarded) {
      lines.push(`  • ${e.productName} (batch ${e.batchNo}) — ${e.qty} units, loss ${rupees(e.lossPaise)}`);
    }
    lines.push(sep);
  }
  if (i.complaints.length > 0) {
    lines.push("Complaints");
    for (const c of i.complaints) {
      const status = c.resolved ? "✔ resolved" : "✗ open";
      lines.push(`  [${status}] ${c.customerName ?? "Anon"}: ${c.summary}`);
    }
    lines.push(sep);
  }
  if (i.reorderHints.length > 0) {
    lines.push("Reorder before next shift");
    for (const r of i.reorderHints) {
      lines.push(`  • ${r.productName} — ${r.daysOfStockLeft} day(s) left`);
    }
    lines.push(sep);
  }
  if (i.note) {
    lines.push(`Note: ${i.note}`);
    lines.push(sep);
  }
  return lines.join("\n");
}

function composeWhatsApp(i: ShiftHandoverInput): string {
  const parts: string[] = [];
  parts.push(`*Shift handover — ${i.shopName}*`);
  parts.push(`Cashier: ${i.cashierName}`);
  parts.push(`📊 ${i.billCount} bills · ${rupees(i.totalSalesPaise)}`);
  if (i.variancePaise === 0) parts.push(`💰 Cash: exact`);
  else if (i.variancePaise > 0) parts.push(`💰 Cash: +${rupees(i.variancePaise)} over`);
  else parts.push(`⚠️ Cash: ${rupees(i.variancePaise)} short`);
  if (i.expiredDiscarded.length > 0) {
    parts.push(`🗑 Expired: ${i.expiredDiscarded.length} batches`);
  }
  if (i.complaints.filter((c) => !c.resolved).length > 0) {
    parts.push(`📞 Open complaints: ${i.complaints.filter((c) => !c.resolved).length}`);
  }
  if (i.reorderHints.length > 0) {
    parts.push(`📦 Reorder: ${i.reorderHints.map((r) => r.productName).slice(0, 3).join(", ")}`);
  }
  return parts.join("\n");
}

function composeReceipt(i: ShiftHandoverInput): string {
  const W = 32;  // 58mm paper
  const sep = "-".repeat(W);
  const lines: string[] = [];
  const center = (s: string) => s.length >= W ? s.slice(0, W) : " ".repeat(Math.floor((W - s.length) / 2)) + s;
  lines.push(center(i.shopName.toUpperCase()));
  lines.push(center("SHIFT HANDOVER"));
  lines.push(sep);
  lines.push(`Cashier: ${i.cashierName}`);
  lines.push(`Open : ${shortFmt(i.openedAtIso)}`);
  lines.push(`Close: ${shortFmt(i.closedAtIso)}`);
  lines.push(sep);
  lines.push(`Bills      : ${i.billCount}`);
  lines.push(`Sales      : ${rupees(i.totalSalesPaise)}`);
  lines.push(`Returns    : ${rupees(i.totalReturnsPaise)}`);
  lines.push(`Variance   : ${signedRupees(i.variancePaise)}`);
  lines.push(sep);
  lines.push(center("Top movers"));
  for (const t of i.topSellers.slice(0, 3)) {
    lines.push(`${trunc(t.productName, 18)} ${t.qty}x`);
  }
  if (i.expiredDiscarded.length > 0) {
    lines.push(sep);
    lines.push(`Expired discards: ${i.expiredDiscarded.length}`);
  }
  if (i.complaints.length > 0) {
    const open = i.complaints.filter((c) => !c.resolved).length;
    lines.push(sep);
    lines.push(`Complaints: ${i.complaints.length} (${open} open)`);
  }
  lines.push(sep);
  lines.push(center("End of handover"));
  return lines.join("\n");
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

function signedRupees(paise: number): string {
  if (paise === 0) return "₹0.00";
  const sign = paise > 0 ? "+" : "-";
  return `${sign}₹${Math.abs(paise / 100).toFixed(2)}`;
}

function fmt(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

function shortFmt(iso: string): string {
  return iso.slice(11, 16);
}

function trunc(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w, " ");
}
