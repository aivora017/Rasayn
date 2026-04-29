// @pharmacare/cfd-display
// Customer-Facing Display state machine + secondary-window protocol.
// ADR-0058. The Tauri multi-window opening is in src-tauri (cfd_display::open_secondary).
// This package owns the message protocol + state shape so primary and secondary windows
// stay in sync.

import type { Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Display state — what the secondary window renders
// ────────────────────────────────────────────────────────────────────────

export interface CfdItem {
  readonly name: string;
  readonly qty: number;
  readonly mrpPaise: Paise;
  readonly totalPaise: Paise;
}

export interface CfdState {
  /** Empty / between-customer state */
  readonly mode: "idle" | "billing" | "payment" | "thankyou";
  readonly shopName: string;
  readonly shopGstin?: string;
  readonly billNo?: string;
  readonly currentItem?: CfdItem;
  readonly basket: readonly CfdItem[];
  readonly subtotalPaise: Paise;
  readonly discountPaise: Paise;
  readonly taxPaise: Paise;
  readonly totalPaise: Paise;
  readonly itemCount: number;
  readonly tickerLines?: readonly string[];      // side-effect ticker for dispensed drugs
  /** Last update timestamp for stale-state detection on the secondary window. */
  readonly updatedAt: string;
}

export const IDLE_STATE = (shopName: string): CfdState => ({
  mode: "idle", shopName,
  basket: [],
  subtotalPaise: paise(0), discountPaise: paise(0), taxPaise: paise(0), totalPaise: paise(0),
  itemCount: 0, updatedAt: new Date().toISOString(),
});

// ────────────────────────────────────────────────────────────────────────
// postMessage protocol
// ────────────────────────────────────────────────────────────────────────

export type CfdMessageKind =
  | "state_update"     // primary → secondary, full state replacement
  | "ping"             // either direction, heartbeat
  | "pong"             // reply to ping
  | "ack"              // secondary acks state_update
  | "error";           // secondary reports rendering error

export interface CfdMessage {
  readonly kind: CfdMessageKind;
  /** Monotonically-increasing sequence number per session. */
  readonly seq: number;
  readonly state?: CfdState;
  readonly error?: string;
  readonly timestamp: string;
}

export class StaleMessageError extends Error {
  public readonly code = "STALE_MESSAGE" as const;
  constructor(public readonly received: number, public readonly current: number) {
    super(`STALE_MESSAGE: seq ${received} < current ${current}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Sequence + heartbeat manager (pure logic; caller wires postMessage)
// ────────────────────────────────────────────────────────────────────────

export interface CfdChannel {
  /** Caller posts to underlying window. */
  send(msg: CfdMessage): void;
}

export class CfdProtocol {
  private seq = 0;
  private lastAckSeq = -1;
  private lastReceivedSeq = -1;
  private readonly channel: CfdChannel;

  constructor(channel: CfdChannel) { this.channel = channel; }

  broadcast(state: CfdState): CfdMessage {
    const msg: CfdMessage = {
      kind: "state_update", seq: ++this.seq, state,
      timestamp: new Date().toISOString(),
    };
    this.channel.send(msg);
    return msg;
  }

  ping(): CfdMessage {
    const msg: CfdMessage = { kind: "ping", seq: ++this.seq, timestamp: new Date().toISOString() };
    this.channel.send(msg);
    return msg;
  }

  /** Called by caller when an inbound message arrives. */
  receive(msg: CfdMessage): { ok: boolean; reason?: string } {
    if (msg.seq < this.lastReceivedSeq) {
      return { ok: false, reason: `STALE_MESSAGE seq ${msg.seq} < ${this.lastReceivedSeq}` };
    }
    this.lastReceivedSeq = msg.seq;
    if (msg.kind === "ack") this.lastAckSeq = msg.seq;
    return { ok: true };
  }

  /** Drift between sent and acked — high drift = secondary window stuck. */
  getDrift(): number {
    return this.seq - this.lastAckSeq;
  }

  reset(): void {
    this.seq = 0;
    this.lastAckSeq = -1;
    this.lastReceivedSeq = -1;
  }
}

// ────────────────────────────────────────────────────────────────────────
// State updaters (pure; caller threads them into BillingScreen)
// ────────────────────────────────────────────────────────────────────────

export function addItem(state: CfdState, item: CfdItem): CfdState {
  const basket = [...state.basket, item];
  const subtotal = paise(basket.reduce((s, i) => s + (i.totalPaise as number), 0));
  return {
    ...state,
    mode: "billing",
    basket,
    currentItem: item,
    subtotalPaise: subtotal,
    itemCount: basket.length,
    totalPaise: paise((subtotal as number) + (state.taxPaise as number) - (state.discountPaise as number)),
    updatedAt: new Date().toISOString(),
  };
}

export function applyTax(state: CfdState, taxPaise: Paise): CfdState {
  return {
    ...state,
    taxPaise,
    totalPaise: paise((state.subtotalPaise as number) + (taxPaise as number) - (state.discountPaise as number)),
    updatedAt: new Date().toISOString(),
  };
}

export function applyDiscount(state: CfdState, discountPaise: Paise): CfdState {
  return {
    ...state,
    discountPaise,
    totalPaise: paise((state.subtotalPaise as number) + (state.taxPaise as number) - (discountPaise as number)),
    updatedAt: new Date().toISOString(),
  };
}

export function enterPayment(state: CfdState, billNo: string): CfdState {
  return { ...state, mode: "payment", billNo, updatedAt: new Date().toISOString() };
}

export function thankCustomer(state: CfdState): CfdState {
  return { ...state, mode: "thankyou", updatedAt: new Date().toISOString() };
}

export function reset(state: CfdState): CfdState {
  const base = IDLE_STATE(state.shopName);
  return state.tickerLines ? { ...base, tickerLines: state.tickerLines } : base;
}
