// Direct tests for the pendingGrnDraft module bus (S05 hardening).
import { afterEach, describe, expect, it } from "vitest";
import {
  setPendingGrnDraft,
  peekPendingGrnDraft,
  dismissPendingGrnDraft,
  takePendingGrnDraft,
  _resetPendingGrnDraftForTests,
  type PendingGrnDraft,
} from "./pendingGrnDraft.js";

function draft(overrides: Partial<PendingGrnDraft> = {}): PendingGrnDraft {
  return {
    invoiceNo: "INV-1",
    invoiceDate: "2026-04-20",
    supplierHint: "Cipla",
    sourceMessageId: "m_001",
    parsedLines: [],
    ...overrides,
  };
}

describe("pendingGrnDraft module bus", () => {
  afterEach(() => { _resetPendingGrnDraftForTests(); });

  it("peek on a fresh store returns null", () => {
    expect(peekPendingGrnDraft()).toBeNull();
  });

  it("set then peek returns the draft non-destructively", () => {
    const d = draft();
    setPendingGrnDraft(d);
    expect(peekPendingGrnDraft()).toEqual(d);
    // peek again — still there
    expect(peekPendingGrnDraft()).toEqual(d);
  });

  it("set then dismiss clears the draft; subsequent peek returns null", () => {
    setPendingGrnDraft(draft());
    dismissPendingGrnDraft();
    expect(peekPendingGrnDraft()).toBeNull();
  });

  it("dismiss is idempotent — safe to call when store is already empty", () => {
    expect(() => {
      dismissPendingGrnDraft();
      dismissPendingGrnDraft();
    }).not.toThrow();
  });

  it("takePendingGrnDraft is destructive — peek returns null after take", () => {
    const d = draft();
    setPendingGrnDraft(d);
    expect(takePendingGrnDraft()).toEqual(d);
    expect(peekPendingGrnDraft()).toBeNull();
    // And take on empty returns null
    expect(takePendingGrnDraft()).toBeNull();
  });

  it("two distinct sourceMessageIds: latest set wins for peek", () => {
    setPendingGrnDraft(draft({ invoiceNo: "INV-A", sourceMessageId: "m_a" }));
    setPendingGrnDraft(draft({ invoiceNo: "INV-B", sourceMessageId: "m_b" }));
    expect(peekPendingGrnDraft()?.invoiceNo).toBe("INV-B");
  });

  it("dismiss after multiple sets only clears the latest, leaves prior keyed entry orphaned but unreachable via peek", () => {
    setPendingGrnDraft(draft({ invoiceNo: "INV-A", sourceMessageId: "m_a" }));
    setPendingGrnDraft(draft({ invoiceNo: "INV-B", sourceMessageId: "m_b" }));
    dismissPendingGrnDraft();
    expect(peekPendingGrnDraft()).toBeNull();
  });

  it("unkeyed draft (sourceMessageId === null) goes to the sentinel slot", () => {
    setPendingGrnDraft(draft({ sourceMessageId: null, invoiceNo: "INV-X" }));
    expect(peekPendingGrnDraft()?.invoiceNo).toBe("INV-X");
    dismissPendingGrnDraft();
    expect(peekPendingGrnDraft()).toBeNull();
  });

  it("StrictMode-safe: peek twice between mount + remount returns same draft", () => {
    setPendingGrnDraft(draft());
    const a = peekPendingGrnDraft();
    const b = peekPendingGrnDraft();
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it("_resetPendingGrnDraftForTests wipes everything", () => {
    setPendingGrnDraft(draft({ sourceMessageId: "m_a" }));
    setPendingGrnDraft(draft({ sourceMessageId: "m_b" }));
    _resetPendingGrnDraftForTests();
    expect(peekPendingGrnDraft()).toBeNull();
  });
});
