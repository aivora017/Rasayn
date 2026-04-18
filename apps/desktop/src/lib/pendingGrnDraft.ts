// Module-level bus for handing a parsed Gmail bill over to the GRN (F4) screen.
//
// Flow: GmailInboxScreen.setPendingGrnDraft(d) + onNavigate("grn") →
// GrnScreen on mount calls peekPendingGrnDraft() → prefills invoice header and
// shows an "imported" banner listing the parsed lines for manual match. The
// draft is only released via dismissPendingGrnDraft() (banner dismiss, save
// complete, or _resetPendingGrnDraftForTests).
//
// Hardening (S05 — docs/reviews/security-2026-04-18.md): originally a
// module-level `let pending` with a destructive `take` on mount. Under React
// StrictMode dev double-mount, the second mount read `null` mid-auto-match;
// worse, two concurrent producers could clobber each other silently. Moved to
// a keyed store (Map<sourceMessageId, draft>) with non-destructive peek +
// explicit dismiss. The active consumer (GrnScreen) also guards with a
// useRef against re-running its import effect inside StrictMode — peek
// stays stable across both mounts so no draft is lost.

import type { TemplateTestResult } from "./ipc.js";

export interface PendingGrnDraft {
  readonly invoiceNo: string | null;
  readonly invoiceDate: string | null;
  readonly supplierHint: string | null;
  readonly sourceMessageId: string | null;
  readonly parsedLines: TemplateTestResult["lines"];
}

// One entry per distinct sourceMessageId (falls back to a sentinel key for
// unkeyed drafts — e.g. a hand-authored template test that never went through
// Gmail). In practice the store has 0 or 1 entries at any time; the Map is
// defensive against future "two inbox tabs in flight" flows.
const UNKEYED_KEY = "__unkeyed__";
const store = new Map<string, PendingGrnDraft>();
let latestKey: string | null = null;

function keyOf(d: PendingGrnDraft): string {
  return d.sourceMessageId ?? UNKEYED_KEY;
}

/** Producer (GmailInboxScreen) drops a draft. Keyed by sourceMessageId. */
export function setPendingGrnDraft(d: PendingGrnDraft): void {
  const k = keyOf(d);
  store.set(k, d);
  latestKey = k;
}

/**
 * Non-destructive read. Returns the most-recently-set draft still in the
 * store, or null. Safe to call from React effects that may run twice under
 * StrictMode — consumer must call dismissPendingGrnDraft() to release.
 */
export function peekPendingGrnDraft(): PendingGrnDraft | null {
  if (latestKey === null) return null;
  return store.get(latestKey) ?? null;
}

/**
 * Explicit release — call after the banner dismiss button or once the GRN
 * has been saved. Idempotent.
 */
export function dismissPendingGrnDraft(): void {
  if (latestKey !== null) store.delete(latestKey);
  latestKey = null;
}

/**
 * Back-compat destructive read (peek + dismiss). Retained so callers that
 * pre-date the S05 hardening keep compiling; new code should prefer
 * peek + dismiss so StrictMode double-mount doesn't silently drop a draft.
 *
 * @deprecated Use `peekPendingGrnDraft` + `dismissPendingGrnDraft`.
 */
export function takePendingGrnDraft(): PendingGrnDraft | null {
  const d = peekPendingGrnDraft();
  if (d) dismissPendingGrnDraft();
  return d;
}

/** Test helper — wipes the whole store. */
export function _resetPendingGrnDraftForTests(): void {
  store.clear();
  latestKey = null;
}
