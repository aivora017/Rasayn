// GmailInboxScreen — X1 moat surface. Owner connects Gmail, we read
// distributor-bill attachments into GRN drafts. See ADR 0002 / 0003.
//
// Covered here:
//   - Connect / disconnect / status
//   - List messages matching a saved query (default: has:attachment newer_than:30d)
//   - On click → fetch first text-like attachment → apply selected supplier
//     template → preview draft → "Send to GRN (F4)" hand-off
//   - Manual paste fallback (dev loop + any attachment that won't decode as text)

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type OAuthStatus, type SupplierTemplateDTO, type TemplateTestResult,
  type GmailMessageSummary, type GmailAttachmentMeta,
  gmailConnectRpc, gmailStatusRpc, gmailDisconnectRpc,
  gmailListMessagesRpc, gmailFetchAttachmentRpc,
  listSupplierTemplatesRpc, testSupplierTemplateRpc,
} from "../lib/ipc";
import { setPendingGrnDraft } from "../lib/pendingGrnDraft";

const SHOP_ID = "shop_local";
const DEFAULT_QUERY = "has:attachment newer_than:30d";

export interface GmailInboxScreenProps {
  readonly onGoToGrn?: () => void;
}

function firstTextAttachment(atts: readonly GmailAttachmentMeta[]): GmailAttachmentMeta | null {
  const textLike = atts.find((a) => {
    const n = a.filename.toLowerCase();
    const m = a.mimeType.toLowerCase();
    return m.startsWith("text/") || n.endsWith(".csv") || n.endsWith(".tsv") || n.endsWith(".txt");
  });
  return textLike ?? atts[0] ?? null;
}

export default function GmailInboxScreen({ onGoToGrn }: GmailInboxScreenProps = {}) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [query, setQuery] = useState<string>(DEFAULT_QUERY);
  const [messages, setMessages] = useState<readonly GmailMessageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetchBusy, setFetchBusy] = useState(false);

  const [templates, setTemplates] = useState<readonly SupplierTemplateDTO[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [sample, setSample] = useState<string>("");
  const [parsed, setParsed] = useState<TemplateTestResult | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);

  const selectedMsg = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const refresh = useCallback(async () => {
    try { setStatus(await gmailStatusRpc(SHOP_ID)); }
    catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => {
    void refresh();
    void listSupplierTemplatesRpc(SHOP_ID).then(setTemplates).catch((e) => setErr(String(e)));
  }, [refresh]);

  const doConnect = useCallback(async () => {
    setErr(""); setLoading(true);
    try { setStatus(await gmailConnectRpc(SHOP_ID)); }
    catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, []);

  const doDisconnect = useCallback(async () => {
    setLoading(true);
    try { await gmailDisconnectRpc(SHOP_ID); setMessages([]); setSelectedId(null); await refresh(); }
    catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, [refresh]);

  const doListInbox = useCallback(async () => {
    setErr(""); setLoading(true);
    try { setMessages(await gmailListMessagesRpc(SHOP_ID, query, 20)); }
    catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, [query]);

  const doSelectMessage = useCallback(async (m: GmailMessageSummary) => {
    setSelectedId(m.id); setErr(""); setParsed(null); setSourceMessageId(m.id);
    const att = firstTextAttachment(m.attachments);
    if (!att) { setSample(m.snippet ?? ""); return; }
    setFetchBusy(true);
    try {
      const p = await gmailFetchAttachmentRpc(
        SHOP_ID, m.id, att.attachmentId, att.filename, att.mimeType,
      );
      if (p.text && p.text.trim().length > 0) { setSample(p.text); }
      else { setSample(`[binary attachment saved at ${p.path} — paste invoice text below]`); }
    } catch (e) { setErr(String(e)); }
    finally { setFetchBusy(false); }
  }, []);

  const doParse = useCallback(async () => {
    setErr(""); setParsed(null);
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) { setErr("select a template first"); return; }
    try { setParsed(await testSupplierTemplateRpc(tpl, sample)); }
    catch (e) { setErr(String(e)); }
  }, [templates, templateId, sample]);

  const canSendToGrn = parsed !== null && parsed.lines.length > 0;
  const doSendToGrn = useCallback(() => {
    if (!parsed) return;
    setPendingGrnDraft({
      invoiceNo: parsed.header.invoiceNo,
      invoiceDate: parsed.header.invoiceDate,
      supplierHint: parsed.header.supplierHint,
      sourceMessageId,
      parsedLines: parsed.lines,
    });
    if (onGoToGrn) onGoToGrn();
  }, [parsed, sourceMessageId, onGoToGrn]);

  return (
    <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div data-testid="gmail-connection">
        <h3 style={{ margin: "0 0 8px" }}>Gmail connection</h3>
        {status?.connected ? (
          <div>
            <div data-testid="gmail-status-connected" style={{ color: "var(--pc-state-success)", marginBottom: 8 }}>
              Connected as <strong>{status.accountEmail ?? "unknown"}</strong>
            </div>
            <div style={{ fontSize: 12, color: "var(--pc-text-secondary)", marginBottom: 8 }}>
              Scopes: {status.scopes.join(", ")}
            </div>
            <button data-testid="gmail-disconnect" onClick={doDisconnect} disabled={loading}>
              Disconnect
            </button>
          </div>
        ) : (
          <div>
            <div data-testid="gmail-status-disconnected" style={{ color: "var(--pc-text-secondary)", marginBottom: 8 }}>
              Not connected. Clicking Connect opens your browser to Google consent.
            </div>
            <button data-testid="gmail-connect" onClick={doConnect} disabled={loading}>
              {loading ? "Opening browser…" : "Connect Gmail"}
            </button>
          </div>
        )}
        {err && <div data-testid="gmail-error" style={{ color: "var(--pc-state-danger)", marginTop: 8, fontSize: 12 }}>{err}</div>}

        <h3 style={{ margin: "16px 0 8px" }}>Inbox</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            data-testid="gmail-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
            placeholder="Gmail search query"
          />
          <button data-testid="gmail-list" onClick={doListInbox} disabled={loading || !status?.connected}>
            {loading ? "…" : "Fetch"}
          </button>
        </div>
        <ul data-testid="gmail-messages" style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 300, overflowY: "auto", border: "1px solid #ddd" }}>
          {messages.length === 0 && (
            <li style={{ padding: 8, fontSize: 12, color: "var(--pc-text-tertiary)" }}>No messages. Connect Gmail and click Fetch.</li>
          )}
          {messages.map((m) => (
            <li
              key={m.id}
              data-testid={`gmail-msg-${m.id}`}
              onClick={() => void doSelectMessage(m)}
              style={{
                padding: 8, borderBottom: "1px solid #eee", cursor: "pointer",
                background: selectedId === m.id ? "var(--pc-state-info-bg)" : undefined,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{m.subject || "(no subject)"}</div>
              <div style={{ fontSize: 11, color: "var(--pc-text-secondary)" }}>{m.from} · {m.date}</div>
              <div style={{ fontSize: 11, color: "var(--pc-text-tertiary)" }}>
                {m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"}
                {m.attachments.length > 0 && `: ${m.attachments.map((a) => a.filename).join(", ")}`}
              </div>
            </li>
          ))}
        </ul>
        {fetchBusy && <div style={{ fontSize: 12, color: "var(--pc-text-secondary)", marginTop: 4 }}>Fetching attachment…</div>}
      </div>

      <div data-testid="gmail-manual">
        <h3 style={{ margin: "0 0 8px" }}>Parse & draft</h3>
        {selectedMsg && (
          <div style={{ fontSize: 12, color: "var(--pc-text-secondary)", marginBottom: 6 }}>
            Source: <strong>{selectedMsg.subject}</strong>
          </div>
        )}
        <label style={{ display: "block", fontSize: 12 }}>Template</label>
        <select
          data-testid="gmail-template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          style={{ width: "100%", marginBottom: 8 }}
        >
          <option value="">— select —</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label style={{ display: "block", fontSize: 12 }}>Invoice text</label>
        <textarea
          data-testid="gmail-sample"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          rows={8}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12, marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button data-testid="gmail-parse" onClick={doParse}>Parse</button>
          <button
            data-testid="gmail-send-grn"
            onClick={doSendToGrn}
            disabled={!canSendToGrn}
            title={canSendToGrn ? "Hand off to GRN (F4)" : "Parse a non-empty result first"}
          >
            Send to GRN (F4)
          </button>
        </div>
        {parsed && (
          <div data-testid="gmail-parsed" style={{ marginTop: 8, fontSize: 12 }}>
            <div>Invoice no: <strong>{parsed.header.invoiceNo ?? "—"}</strong></div>
            <div>Invoice date: <strong>{parsed.header.invoiceDate ?? "—"}</strong></div>
            <div>Line count: <strong>{parsed.lines.length}</strong></div>
            {parsed.lines.length > 0 && (
              <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse", fontSize: 11 }}>
                <thead><tr style={{ background: "var(--pc-bg-surface-2)" }}>
                  <th style={{ textAlign: "left", padding: 4 }}>Product</th>
                  <th style={{ textAlign: "left", padding: 4 }}>Batch</th>
                  <th style={{ textAlign: "left", padding: 4 }}>Expiry</th>
                  <th style={{ textAlign: "right", padding: 4 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: 4 }}>Rate</th>
                </tr></thead>
                <tbody>
                  {parsed.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: 4 }}>{l.productHint}</td>
                      <td style={{ padding: 4 }}>{l.batchNo ?? "—"}</td>
                      <td style={{ padding: 4 }}>{l.expiryDate ?? "—"}</td>
                      <td style={{ padding: 4, textAlign: "right" }}>{l.qty}</td>
                      <td style={{ padding: 4, textAlign: "right" }}>{(l.ratePaise / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
