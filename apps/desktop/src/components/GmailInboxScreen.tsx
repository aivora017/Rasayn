// GmailInboxScreen — X1 moat surface. Owner connects Gmail, we read
// distributor-bill attachments into GRN drafts. See ADR 0002 / 0003.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Search, FileText, Sparkles, ArrowRight, Plug, AlertCircle } from "lucide-react";
import {
  Glass, Badge, Button, Input, Skeleton, Illustration,
} from "@pharmacare/design-system";
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

  const selectedMsg = useMemo(() => messages.find((m) => m.id === selectedId) ?? null, [messages, selectedId]);

  const refresh = useCallback(async () => {
    try { setStatus(await gmailStatusRpc(SHOP_ID)); } catch (e) { setErr(String(e)); }
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
      const p = await gmailFetchAttachmentRpc(SHOP_ID, m.id, att.attachmentId, att.filename, att.mimeType);
      if (p.text && p.text.trim().length > 0) setSample(p.text);
      else setSample(`[binary attachment saved at ${p.path} — paste invoice text below]`);
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

  // Confidence proxy: parsed-lines count vs sample line count.
  const confidencePct = useMemo(() => {
    if (!parsed) return null;
    const sampleLines = sample.split("\n").filter((l) => l.trim()).length || 1;
    return Math.min(100, Math.round((parsed.lines.length / sampleLines) * 100));
  }, [parsed, sample]);

  return (
    <div className="mx-auto max-w-[1280px] p-4 lg:p-6 text-[var(--pc-text-primary)]">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight inline-flex items-center gap-2">
          <Badge variant="brand">X1</Badge>
          Distributor inbox
        </h1>
        <p className="text-[12px] text-[var(--pc-text-secondary)]">
          Gmail bills → parsed GRN draft in one click
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* ── Left: connection + inbox ─────────────────────── */}
        <Glass depth={1} className="p-4 flex flex-col" data-testid="gmail-connection">
          <div className="mb-3">
            <h3 className="text-[14px] font-medium inline-flex items-center gap-2">
              <Plug size={14} aria-hidden /> Gmail connection
            </h3>
            {status?.connected ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                <Badge variant="success">connected</Badge>
                <span data-testid="gmail-status-connected" className="text-[var(--pc-text-secondary)]">
                  as <strong className="text-[var(--pc-text-primary)]">{status.accountEmail ?? "unknown"}</strong>
                </span>
                <Button variant="ghost" size="sm" data-testid="gmail-disconnect" onClick={doDisconnect} disabled={loading}>
                  Disconnect
                </Button>
                {status.scopes.length > 0 ? (
                  <span className="basis-full mt-0.5 inline-flex flex-wrap items-center gap-1 text-[10px] text-[var(--pc-text-tertiary)]">
                    <span className="uppercase tracking-[0.5px]">scopes</span>
                    {status.scopes.map((sc) => (
                      <span key={sc} className="font-mono rounded-[var(--pc-radius-sm)] bg-[var(--pc-bg-surface-2)] px-1.5 py-0.5">{sc}</span>
                    ))}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <span data-testid="gmail-status-disconnected" className="text-[12px] text-[var(--pc-text-secondary)]">
                  Not connected
                </span>
                <Button size="sm" data-testid="gmail-connect" onClick={doConnect} disabled={loading} leadingIcon={<Mail size={14} />}>
                  {loading ? "Opening browser…" : "Connect Gmail"}
                </Button>
              </div>
            )}
          </div>

          {err && (
            <div data-testid="gmail-error" className="mb-2 inline-flex items-center gap-2 rounded-[var(--pc-radius-md)] border border-[var(--pc-state-danger)] bg-[var(--pc-state-danger-bg)] px-2 py-1 text-[12px] text-[var(--pc-state-danger)]">
              <AlertCircle size={12} /> {err}
            </div>
          )}

          <div className="mt-2 mb-2 flex items-center gap-2">
            <Input
              data-testid="gmail-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Gmail search query"
              leading={<Search size={14} />}
              className="flex-1"
            />
            <Button size="sm" variant="secondary" data-testid="gmail-list" onClick={doListInbox} disabled={loading || !status?.connected}>
              {loading ? "…" : "Fetch"}
            </Button>
          </div>

          <ul data-testid="gmail-messages" className="flex-1 overflow-y-auto rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] divide-y divide-[var(--pc-border-subtle)]" style={{ maxHeight: 420 }}>
            {messages.length === 0 && (
              <li className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[12px] text-[var(--pc-text-tertiary)]">
                <Illustration name="x1-gmail" size={64} />
                No messages. Connect Gmail and click Fetch.
              </li>
            )}
            {messages.map((m) => {
              const active = selectedId === m.id;
              return (
                <li
                  key={m.id}
                  data-testid={`gmail-msg-${m.id}`}
                  onClick={() => void doSelectMessage(m)}
                  className={
                    "cursor-pointer p-3 transition-colors " +
                    (active ? "bg-[var(--pc-state-info-bg)]" : "hover:bg-[var(--pc-bg-surface-2)]")
                  }
                >
                  <div className="text-[12px] font-medium leading-tight">{m.subject || "(no subject)"}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--pc-text-secondary)]">{m.from} · {m.date}</div>
                  <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--pc-text-tertiary)]">
                    <FileText size={11} /> {m.attachments.length} att{m.attachments.length === 1 ? "" : "s"}
                  </div>
                </li>
              );
            })}
          </ul>
          {fetchBusy && <div className="mt-2 text-[11px] text-[var(--pc-text-secondary)]">Fetching attachment…</div>}
        </Glass>

        {/* ── Right: parse + draft + parsed result ──────────────── */}
        <Glass depth={1} className="p-4 flex flex-col" data-testid="gmail-manual">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[14px] font-medium inline-flex items-center gap-2">
              <Sparkles size={14} aria-hidden style={{ color: "var(--pc-accent-saffron)" }} />
              Parse &amp; draft
            </h3>
            {selectedMsg && (
              <span className="text-[11px] text-[var(--pc-text-secondary)] truncate max-w-[60%]">
                from <strong className="text-[var(--pc-text-primary)]">{selectedMsg.subject}</strong>
              </span>
            )}
          </div>

          <label className="block text-[11px] text-[var(--pc-text-secondary)] mb-1">Template</label>
          <select
            data-testid="gmail-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mb-2 w-full h-9 rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] px-2 text-[13px]"
          >
            <option value="">— select —</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <label className="block text-[11px] text-[var(--pc-text-secondary)] mb-1">Invoice text</label>
          <textarea
            data-testid="gmail-sample"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            rows={8}
            className="mb-2 w-full rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)] p-2 font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-[var(--pc-brand-primary)]"
          />

          <div className="flex gap-2 mb-3">
            <Button size="sm" variant="secondary" data-testid="gmail-parse" onClick={doParse}>Parse</Button>
            <Button
              size="sm"
              variant="saffron"
              data-testid="gmail-send-grn"
              onClick={doSendToGrn}
              disabled={!canSendToGrn}
              title={canSendToGrn ? "Hand off to GRN (F4)" : "Parse a non-empty result first"}
              trailingIcon={<ArrowRight size={14} />}
            >
              Send to GRN (F4)
            </Button>
          </div>

          {parsed && (
            <div data-testid="gmail-parsed" className="flex-1 overflow-auto rounded-[var(--pc-radius-md)] border border-[var(--pc-border-subtle)] bg-[var(--pc-bg-surface)]">
              {/* Confidence ribbon */}
              <div className="flex items-center gap-3 border-b border-[var(--pc-border-subtle)] px-3 py-2 bg-[var(--pc-bg-surface-2)]">
                <span className="text-[11px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">parsed</span>
                <span className="pc-tabular text-[14px] font-medium">{parsed.lines.length} lines</span>
                {confidencePct !== null && (
                  <Badge variant={confidencePct >= 90 ? "success" : confidencePct >= 70 ? "warning" : "danger"}>
                    {confidencePct}% confidence
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-[var(--pc-text-secondary)]">
                  inv #{parsed.header.invoiceNo ?? "—"} · {parsed.header.invoiceDate ?? "—"}
                </span>
              </div>
              {parsed.lines.length > 0 ? (
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-[0.5px] text-[var(--pc-text-secondary)]">
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">Product</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">Batch</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium">Expiry</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Qty</th>
                      <th className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-medium text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.lines.map((l, i) => (
                      <tr key={i} className="hover:bg-[var(--pc-bg-surface-2)]">
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2">{l.productHint}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 font-mono text-[var(--pc-text-secondary)]">{l.batchNo ?? "—"}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 pc-tabular text-[var(--pc-text-secondary)]">{l.expiryDate ?? "—"}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular">{l.qty}</td>
                        <td className="border-b border-[var(--pc-border-subtle)] px-2 py-2 text-right pc-tabular">{(l.ratePaise / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-4 py-8 text-center text-[12px] text-[var(--pc-text-tertiary)]">
                  Template did not extract any lines. Adjust template or paste cleaner text.
                </div>
              )}
            </div>
          )}

          {!parsed && !sample && !selectedMsg && (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-[12px] text-[var(--pc-text-tertiary)] py-6">
              <Illustration name="x1-gmail" size={96} />
              <p className="mt-2 max-w-[260px]">Connect Gmail, fetch your inbox, and click a distributor bill to parse it into a GRN draft.</p>
            </div>
          )}
        </Glass>
      </div>
    </div>
  );
}
