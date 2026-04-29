// CFDDisplay — primary controller + simulated secondary-window preview.
import { useCallback, useMemo, useState, useRef } from "react";
import { Monitor, Plus, CreditCard, CheckCircle2, RotateCcw } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import { paise, formatINR } from "@pharmacare/shared-types";
import {
  IDLE_STATE, addItem, applyTax, applyDiscount, enterPayment, thankCustomer, reset,
  CfdProtocol, type CfdState, type CfdMessage, type CfdChannel,
} from "@pharmacare/cfd-display";

const SHOP_NAME = "Jagannath Pharmacy LLP";

export default function CFDDisplay(): React.ReactElement {
  const [state, setState] = useState<CfdState>(() => IDLE_STATE(SHOP_NAME));
  const [messages, setMessages] = useState<readonly CfdMessage[]>([]);
  const protoRef = useRef<CfdProtocol | null>(null);

  if (!protoRef.current) {
    const channel: CfdChannel = { send: (m) => setMessages((ms) => [...ms, m].slice(-10)) };
    protoRef.current = new CfdProtocol(channel);
  }

  const broadcast = useCallback((next: CfdState) => {
    setState(next);
    protoRef.current?.broadcast(next);
  }, []);

  const onAddCrocin = () => broadcast(addItem(state, { name: "Crocin 500mg", qty: 1, mrpPaise: paise(4500), totalPaise: paise(4500) }));
  const onAddAmox = () => broadcast(addItem(state, { name: "Amoxicillin 500mg", qty: 2, mrpPaise: paise(12000), totalPaise: paise(24000) }));
  const onApplyTax = () => broadcast(applyTax(state, paise(Math.round((state.subtotalPaise as number) * 0.05))));
  const onDiscount = () => broadcast(applyDiscount(state, paise(Math.round((state.subtotalPaise as number) * 0.05))));
  const onPay = () => broadcast(enterPayment(state, "B-DEMO-001"));
  const onThank = () => broadcast(thankCustomer(state));
  const onReset = () => { broadcast(reset(state)); protoRef.current?.reset(); setMessages([]); };

  return (
    <div className="screen-shell flex flex-col gap-4 p-6" data-screen="cfd-display">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Monitor size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Customer-Facing Display</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Secondary HDMI monitor preview · postMessage protocol · drift {protoRef.current?.getDrift() ?? 0}
            </p>
          </div>
        </div>
        <Badge variant={state.mode === "idle" ? "neutral" : state.mode === "thankyou" ? "success" : "info"}>
          {state.mode.toUpperCase()}
        </Badge>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Primary controls */}
        <Glass>
          <div className="p-4 flex flex-col gap-3">
            <h2 className="font-medium">Primary controls (cashier side)</h2>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={onAddCrocin}><Plus size={14} /> Add Crocin</Button>
              <Button onClick={onAddAmox}><Plus size={14} /> Add Amoxicillin × 2</Button>
              <Button variant="ghost" onClick={onApplyTax}>Apply 5% GST</Button>
              <Button variant="ghost" onClick={onDiscount}>Apply 5% discount</Button>
              <Button onClick={onPay}><CreditCard size={14} /> Enter payment</Button>
              <Button onClick={onThank}><CheckCircle2 size={14} /> Thank customer</Button>
            </div>
            <Button variant="ghost" onClick={onReset}><RotateCcw size={14} /> Reset to idle</Button>

            <div className="border-t border-[var(--pc-border-subtle)] pt-2">
              <h3 className="text-[12px] font-medium mb-1">Recent protocol messages ({messages.length})</h3>
              <div className="text-[10px] font-mono max-h-32 overflow-y-auto">
                {messages.slice(-5).map((m) => (
                  <div key={m.seq} className="py-0.5 text-[var(--pc-text-secondary)]">
                    seq={m.seq} · {m.kind} · {m.timestamp.slice(11, 19)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Glass>

        {/* Secondary preview */}
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="cfd-preview">
            <h2 className="font-medium text-[12px] uppercase text-[var(--pc-text-tertiary)]">
              ▼ Secondary HDMI window ▼ (this is what your customer sees)
            </h2>
            <div
              className="relative aspect-video rounded-lg p-6 flex flex-col justify-between"
              style={{ background: "linear-gradient(135deg, #0A4338 0%, #0E5142 100%)", color: "white" }}
            >
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-medium">{state.shopName}</div>
                {state.billNo && <div className="text-[11px] opacity-80">Bill {state.billNo}</div>}
              </div>

              {state.mode === "idle" && (
                <div className="text-center">
                  <div className="text-[20px] font-semibold">Welcome</div>
                  <div className="text-[12px] opacity-70 mt-1">Please wait for the next available counter</div>
                </div>
              )}
              {state.mode === "billing" && (
                <div className="flex flex-col gap-2 text-[13px]">
                  {state.currentItem && (
                    <div className="flex justify-between border-b border-white/20 pb-1">
                      <span>{state.currentItem.qty} × {state.currentItem.name}</span>
                      <span className="font-mono">{formatINR(state.currentItem.totalPaise)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[11px] opacity-80">
                    <span>Items in basket</span><span>{state.itemCount}</span>
                  </div>
                </div>
              )}
              {state.mode === "payment" && (
                <div className="text-center">
                  <div className="text-[12px] opacity-70 uppercase">Pay</div>
                  <div className="text-[36px] font-mono font-bold">{formatINR(state.totalPaise)}</div>
                  <div className="text-[11px] opacity-70 mt-1">Scan UPI QR or hand cash</div>
                </div>
              )}
              {state.mode === "thankyou" && (
                <div className="text-center">
                  <div className="text-[24px] font-semibold">धन्यवाद · Thank you 🙏</div>
                  <div className="text-[12px] opacity-70 mt-1">Take care · come back soon</div>
                </div>
              )}

              {state.mode !== "idle" && (
                <div className="flex justify-between items-end text-[12px]">
                  <div className="opacity-80">
                    {state.itemCount} item{state.itemCount === 1 ? "" : "s"}
                    {state.discountPaise > 0 && ` · ${formatINR(state.discountPaise)} off`}
                  </div>
                  <div className="font-mono text-[18px] font-bold">{formatINR(state.totalPaise)}</div>
                </div>
              )}
            </div>
          </div>
        </Glass>
      </div>
    </div>
  );
}
