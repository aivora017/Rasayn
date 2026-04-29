// CopilotPanel — natural-language Q&A side panel.
// Uses MockLlmGateway + MockSemanticLayer for sandbox / pilot Day-1.
// Production wires LiteLLM + Cube.dev semantic layer through Tauri command.

import { useCallback, useState } from "react";
import { Bot, SendHorizontal, Sparkles, Loader2 } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  ask, MockLlmGateway, MockSemanticLayer,
  type CopilotAnswer, type CopilotQuery, type Locale,
} from "@pharmacare/ai-copilot";

const SUGGESTED: readonly string[] = [
  "show me sales today",
  "how much did I sell last month",
  "draft counseling for Crocin",
  "this month vs last month",
  "why is paracetamol stock low",
];

interface ConversationTurn {
  readonly id: string;
  readonly question: string;
  readonly answer?: CopilotAnswer;
  readonly pending: boolean;
  readonly errorMsg?: string;
}

export default function CopilotPanel(): React.ReactElement {
  const [draft, setDraft] = useState("");
  const [locale, setLocale] = useState<Locale>("en-IN");
  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const id = `turn-${Date.now()}`;
    setTurns((t) => [...t, { id, question: text, pending: true }]);
    setDraft("");
    setBusy(true);
    try {
      const q: CopilotQuery = { userText: text, shopId: "shop_local", userRole: "owner", locale };
      const r = await ask(q, { llm: new MockLlmGateway(), semantic: new MockSemanticLayer() });
      setTurns((t) => t.map((x) => x.id === id ? { ...x, answer: r, pending: false } : x));
    } catch (e) {
      setTurns((t) => t.map((x) => x.id === id ? { ...x, pending: false, errorMsg: String(e) } : x));
    } finally {
      setBusy(false);
    }
  }, [locale]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6 max-w-3xl mx-auto" data-screen="copilot">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">AI Copilot</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Ask anything about sales, stock, expiry, compliance — in English, Hindi, Marathi, Gujarati or Tamil.
            </p>
          </div>
        </div>
        <Badge variant="warning"><Sparkles size={10} /> MOCK MODEL · LiteLLM gateway pending</Badge>
      </header>

      {/* Conversation */}
      <div className="flex flex-col gap-3" data-testid="conversation">
        {turns.length === 0 && (
          <Glass>
            <div className="p-6 flex flex-col gap-2 text-center">
              <Sparkles size={28} className="mx-auto text-[var(--pc-brand-primary)]" />
              <p className="font-medium">Try one of these:</p>
              <div className="flex flex-wrap justify-center gap-2 mt-2">
                {SUGGESTED.map((s) => (
                  <button key={s}
                    onClick={() => void submit(s)}
                    className="px-3 py-1.5 text-[12px] rounded-full bg-[var(--pc-bg-surface)] border border-[var(--pc-border-subtle)] hover:bg-[var(--pc-bg-hover)]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </Glass>
        )}
        {turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-2">
            <Glass>
              <div className="p-3 text-[13px]">
                <span className="text-[11px] text-[var(--pc-text-tertiary)] uppercase">You</span>
                <div className="font-mono mt-1">{t.question}</div>
              </div>
            </Glass>
            <Glass>
              <div className="p-3 text-[13px]" data-testid="copilot-answer">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-[var(--pc-text-tertiary)] uppercase">Copilot</span>
                  {t.answer && (
                    <Badge variant="neutral">
                      conf {Math.round(t.answer.confidence * 100)}% · {t.answer.modelUsed}
                    </Badge>
                  )}
                </div>
                {t.pending && (
                  <div className="flex items-center gap-2 text-[var(--pc-text-secondary)]">
                    <Loader2 size={14} className="animate-spin" /> Thinking…
                  </div>
                )}
                {t.errorMsg && (
                  <div className="text-[var(--pc-state-danger)]">{t.errorMsg}</div>
                )}
                {t.answer && (
                  <>
                    <div className="whitespace-pre-wrap">{t.answer.narrative}</div>
                    {t.answer.chart && (
                      <div className="mt-3 border-t border-[var(--pc-border-subtle)] pt-2">
                        <div className="text-[11px] text-[var(--pc-text-tertiary)] uppercase mb-1">
                          Chart ({t.answer.chart.kind})
                        </div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {t.answer.chart.data.slice(0, 10).map((d) => (
                              <tr key={d.label}>
                                <td className="text-[var(--pc-text-secondary)]">{d.label}</td>
                                <td className="font-mono tabular-nums text-right">
                                  {(t.answer?.chart?.yAxis ?? "")}{d.value.toLocaleString("en-IN")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {t.answer.suggestedActions && t.answer.suggestedActions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.answer.suggestedActions.map((a) => (
                          <Button key={a.cmd} variant="ghost">{a.label}</Button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Glass>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-[var(--pc-bg-canvas)] pt-2">
        <Glass>
          <div className="p-3 flex items-end gap-2">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="bg-transparent border border-[var(--pc-border-subtle)] rounded px-2 py-2 text-[12px]"
            >
              <option value="en-IN">English</option>
              <option value="hi-IN">हिंदी</option>
              <option value="mr-IN">मराठी</option>
              <option value="gu-IN">ગુજરાતી</option>
              <option value="ta-IN">தமிழ்</option>
            </select>
            <div className="flex-1">
              <Input
                type="text"
                placeholder="Ask anything…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(draft); } }}
                disabled={busy}
              />
            </div>
            <Button onClick={() => void submit(draft)} disabled={busy || !draft.trim()}>
              <SendHorizontal size={14} /> Ask
            </Button>
          </div>
        </Glass>
      </div>
    </div>
  );
}
