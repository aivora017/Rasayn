import { describe, it, expect, vi } from "vitest";
import {
  IDLE_STATE, addItem, applyTax, applyDiscount, enterPayment, thankCustomer, reset,
  CfdProtocol,
  type CfdMessage, type CfdItem, type CfdChannel,
} from "./index.js";
import { paise } from "@pharmacare/shared-types";

describe("State updaters", () => {
  it("idle state has empty basket and zero totals", () => {
    const s = IDLE_STATE("Jagannath Pharmacy");
    expect(s.mode).toBe("idle");
    expect(s.basket).toHaveLength(0);
    expect(s.subtotalPaise).toBe(paise(0));
    expect(s.totalPaise).toBe(paise(0));
  });

  it("addItem appends + recomputes subtotal", () => {
    const s0 = IDLE_STATE("Test");
    const item1: CfdItem = { name: "Crocin", qty: 1, mrpPaise: paise(4500), totalPaise: paise(4500) };
    const s1 = addItem(s0, item1);
    expect(s1.mode).toBe("billing");
    expect(s1.basket).toHaveLength(1);
    expect(s1.subtotalPaise).toBe(paise(4500));
    expect(s1.itemCount).toBe(1);
    expect(s1.currentItem).toBe(item1);
  });

  it("two items sum subtotal", () => {
    let s = IDLE_STATE("Test");
    s = addItem(s, { name: "A", qty: 1, mrpPaise: paise(100), totalPaise: paise(100) });
    s = addItem(s, { name: "B", qty: 2, mrpPaise: paise(200), totalPaise: paise(400) });
    expect(s.subtotalPaise).toBe(paise(500));
    expect(s.itemCount).toBe(2);
  });

  it("applyTax recomputes total", () => {
    const s0 = addItem(IDLE_STATE("Test"), { name: "A", qty: 1, mrpPaise: paise(1000), totalPaise: paise(1000) });
    const s1 = applyTax(s0, paise(50));
    expect(s1.totalPaise).toBe(paise(1050));
  });

  it("applyDiscount subtracts from total", () => {
    let s = addItem(IDLE_STATE("Test"), { name: "A", qty: 1, mrpPaise: paise(1000), totalPaise: paise(1000) });
    s = applyTax(s, paise(50));
    s = applyDiscount(s, paise(100));
    expect(s.totalPaise).toBe(paise(950));
  });

  it("enterPayment moves to payment mode + sets billNo", () => {
    const s = enterPayment(IDLE_STATE("Test"), "B-001");
    expect(s.mode).toBe("payment");
    expect(s.billNo).toBe("B-001");
  });

  it("thankCustomer ends in thankyou mode", () => {
    const s = thankCustomer(IDLE_STATE("Test"));
    expect(s.mode).toBe("thankyou");
  });

  it("reset clears basket but keeps shop name + ticker", () => {
    let s = addItem(IDLE_STATE("Jagannath"), { name: "A", qty: 1, mrpPaise: paise(100), totalPaise: paise(100) });
    s = { ...s, tickerLines: ["Take with food"] };
    const r = reset(s);
    expect(r.mode).toBe("idle");
    expect(r.shopName).toBe("Jagannath");
    expect(r.tickerLines).toEqual(["Take with food"]);
    expect(r.basket).toHaveLength(0);
  });
});

describe("CfdProtocol — sequencing", () => {
  function setupChannel(): { proto: CfdProtocol; sent: CfdMessage[] } {
    const sent: CfdMessage[] = [];
    const channel: CfdChannel = { send: (m) => { sent.push(m); } };
    return { proto: new CfdProtocol(channel), sent };
  }

  it("broadcast sends state_update with monotonic seq", () => {
    const { proto, sent } = setupChannel();
    const s = IDLE_STATE("Test");
    proto.broadcast(s);
    proto.broadcast(s);
    proto.broadcast(s);
    expect(sent).toHaveLength(3);
    expect(sent[0]?.seq).toBe(1);
    expect(sent[1]?.seq).toBe(2);
    expect(sent[2]?.seq).toBe(3);
  });

  it("ping has incrementing seq", () => {
    const { proto, sent } = setupChannel();
    proto.ping();
    proto.ping();
    expect(sent[1]!.seq).toBeGreaterThan(sent[0]!.seq);
  });

  it("receive accepts in-order messages", () => {
    const { proto } = setupChannel();
    expect(proto.receive({ kind: "ack", seq: 1, timestamp: "" }).ok).toBe(true);
    expect(proto.receive({ kind: "ack", seq: 2, timestamp: "" }).ok).toBe(true);
  });

  it("receive rejects stale messages", () => {
    const { proto } = setupChannel();
    proto.receive({ kind: "ack", seq: 5, timestamp: "" });
    const r = proto.receive({ kind: "ack", seq: 3, timestamp: "" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("STALE_MESSAGE");
  });

  it("getDrift = sent - last-acked", () => {
    const { proto } = setupChannel();
    const s = IDLE_STATE("Test");
    proto.broadcast(s);
    proto.broadcast(s);
    proto.broadcast(s);
    expect(proto.getDrift()).toBeGreaterThan(0);
    proto.receive({ kind: "ack", seq: 3, timestamp: "" });
    expect(proto.getDrift()).toBe(0);
  });

  it("reset clears all counters", () => {
    const { proto } = setupChannel();
    proto.broadcast(IDLE_STATE("X"));
    proto.broadcast(IDLE_STATE("X"));
    proto.reset();
    proto.broadcast(IDLE_STATE("X"));
    // Internal state can't be inspected directly but seq should restart
    const next = proto.broadcast(IDLE_STATE("X"));
    expect(next.seq).toBe(2);   // 1 was the post-reset broadcast above
  });
});
