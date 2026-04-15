// Module-level bus for handing a parsed Gmail bill over to the GRN (F4)
// screen. Kept tiny and dependency-free so unit tests can import and reset it.
//
// Flow: GmailInboxScreen.setPendingGrnDraft(d) + onNavigate("grn") →
// GrnScreen on mount calls takePendingGrnDraft() → prefills invoice header
// and shows an "imported" banner listing the parsed lines for manual match.

import type { TemplateTestResult } from "./ipc.js";

export interface PendingGrnDraft {
  readonly invoiceNo: string | null;
  readonly invoiceDate: string | null;
  readonly supplierHint: string | null;
  readonly sourceMessageId: string | null;
  readonly parsedLines: TemplateTestResult["lines"];
}

let pending: PendingGrnDraft | null = null;

export function setPendingGrnDraft(d: PendingGrnDraft): void { pending = d; }

/// Destructively read the current draft (returns null if none). Consuming
/// side reads once on screen-mount.
export function takePendingGrnDraft(): PendingGrnDraft | null {
  const d = pending; pending = null; return d;
}

export function peekPendingGrnDraft(): PendingGrnDraft | null { return pending; }

export function _resetPendingGrnDraftForTests(): void { pending = null; }
