// ShiftHandoverPreview — modal preview after closing a cash shift (S12).
//
// Composes a handover note via @pharmacare/shift-handover, shows a 3-tab
// preview (Body / WhatsApp / Receipt), and exposes Print / Share / Save PDF
// actions.

import { useMemo, useState } from "react";
import { X, Printer, Share2, FileDown, Receipt, MessageSquare, ScrollText } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  buildHandover,
  type ShiftHandoverInput, type ShiftHandoverNote,
} from "@pharmacare/shift-handover";

export interface ShiftHandoverPreviewProps {
  readonly input: ShiftHandoverInput;
  readonly onClose: () => void;
  readonly onPrint?: (note: ShiftHandoverNote) => void;
  readonly onShareWhatsApp?: (note: ShiftHandoverNote) => void;
  readonly onSavePdf?: (note: ShiftHandoverNote) => void;
}

type TabKey = "body" | "whatsapp" | "receipt";

export function ShiftHandoverPreview(props: ShiftHandoverPreviewProps): JSX.Element {
  const note = useMemo(() => buildHandover(props.input), [props.input]);
  const [tab, setTab] = useState<TabKey>("body");

  const content =
    tab === "body" ? note.body :
    tab === "whatsapp" ? note.whatsappBody :
    note.receiptBytes;

  return (
    <div style={overlayStyle} role="dialog" aria-label="Shift handover preview">
      <Glass style={{ width: 720, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: 16, borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
              <ScrollText size={20} /> Shift Handover
            </h2>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              {note.headline}
            </p>
          </div>
          <button onClick={props.onClose} aria-label="Close" style={iconBtn}>
            <X size={20} />
          </button>
        </header>

        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          <TabButton active={tab === "body"} onClick={() => setTab("body")}>
            <ScrollText size={14} /> Full
          </TabButton>
          <TabButton active={tab === "whatsapp"} onClick={() => setTab("whatsapp")}>
            <MessageSquare size={14} /> WhatsApp
          </TabButton>
          <TabButton active={tab === "receipt"} onClick={() => setTab("receipt")}>
            <Receipt size={14} /> Receipt
          </TabButton>
        </div>

        <div style={{
          flex: 1, overflow: "auto", padding: 16,
          fontFamily: tab === "receipt" ? "monospace" : "inherit",
          background: "var(--surface-subtle)",
          whiteSpace: "pre-wrap",
        }}>
          {content}
        </div>

        <footer style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          padding: 16, borderTop: "1px solid var(--border)",
        }}>
          <Button variant="ghost" onClick={props.onClose}>Done</Button>
          {props.onPrint && (
            <Button variant="ghost" onClick={() => props.onPrint!(note)}>
              <Printer size={14} /> Print
            </Button>
          )}
          {props.onSavePdf && (
            <Button variant="ghost" onClick={() => props.onSavePdf!(note)}>
              <FileDown size={14} /> Save PDF
            </Button>
          )}
          {props.onShareWhatsApp && (
            <Button onClick={() => props.onShareWhatsApp!(note)}>
              <Share2 size={14} /> Share via WhatsApp
            </Button>
          )}
        </footer>
      </Glass>
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 16px",
        border: "none",
        background: active ? "var(--brand-primary-soft)" : "transparent",
        cursor: "pointer",
        borderBottom: active ? "2px solid var(--brand-primary)" : "2px solid transparent",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const iconBtn: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 4,
};
