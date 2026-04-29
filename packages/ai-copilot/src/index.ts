// @pharmacare/ai-copilot
// Natural-language Q&A + counseling drafts + HSN classifier + DPDP DSR
// drafts + Inspector Mode narration. ADR-0048.
//
// Architecture:
//   client → CopilotPanel
//          → ai-copilot.ask(query, context, llmGateway)
//          → llmGateway (LiteLLM in prod, MOCK in dev/sandbox)
//          → semanticLayer.parse(natural-language) → CubeQuery
//          → semanticLayer.run(CubeQuery)        → tabular result
//          → llmGateway narrates result          → text + chart hints
//
// This package ships:
//   * Type contracts (LlmGateway, SemanticLayer, CopilotQuery, CopilotAnswer)
//   * Real query classifier (intent + entity extraction via heuristics)
//   * Counseling-script template engine (per drug class, multi-lingual)
//   * HSN classifier (rule-based fallback when no LLM)
//   * MockLlmGateway + MockSemanticLayer for dev/test
//
// Real LiteLLM gateway connection deferred — the contract is locked so it
// drops in without touching downstream callers.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type Locale = "en-IN" | "hi-IN" | "mr-IN" | "gu-IN" | "ta-IN";

export interface CopilotQuery {
  readonly userText: string;
  readonly shopId: string;
  readonly userRole: string;
  readonly locale: Locale;
}

export interface CopilotChart {
  readonly kind: "line" | "bar" | "pie";
  readonly data: ReadonlyArray<{ label: string; value: number }>;
  readonly xAxis?: string;
  readonly yAxis?: string;
}

export interface CopilotAction {
  readonly label: string;
  readonly cmd: string;             // e.g. "navigate:reports?period=2026-04"
}

export interface CopilotAnswer {
  readonly narrative: string;
  readonly chart?: CopilotChart;
  readonly suggestedActions?: readonly CopilotAction[];
  readonly modelUsed: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly confidence: number;       // 0..1
}

export interface LlmGateway {
  readonly id: string;
  generate(prompt: string, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<string>;
}

export interface CubeQuery {
  readonly measures: readonly string[];
  readonly dimensions?: readonly string[];
  readonly timeDimensions?: ReadonlyArray<{ dimension: string; granularity?: "day" | "month" | "year" }>;
  readonly filters?: ReadonlyArray<{ member: string; operator: string; values: readonly string[] }>;
  readonly limit?: number;
}

export interface CubeResult {
  readonly rows: ReadonlyArray<Record<string, string | number>>;
  readonly took_ms: number;
}

export interface SemanticLayer {
  parse(natural: string, locale: Locale): Promise<CubeQuery | null>;
  run(query: CubeQuery): Promise<CubeResult>;
}

// ────────────────────────────────────────────────────────────────────────
// Intent classification — local heuristics on top of the LLM
// ────────────────────────────────────────────────────────────────────────

export type CopilotIntent =
  | "report"               // "show me sales last month"
  | "trend"                // "are sched-h sales going up?"
  | "compare"              // "this month vs last month"
  | "explain"              // "why is X down?"
  | "action"               // "open settings"
  | "counseling"           // "draft counseling for Crocin"
  | "unknown";

const INTENT_PATTERNS: ReadonlyArray<{ kind: CopilotIntent; re: RegExp }> = [
  { kind: "trend",       re: /\b(trend|going up|going down|increasing|decreasing|over time)\b/i },
  { kind: "compare",     re: /\b(vs|versus|compare|compared to|month on month|year on year)\b/i },
  { kind: "explain",     re: /\b(why|how come|reason|explain)\b/i },
  { kind: "counseling",  re: /\b(counseling|counselling|side effect|advice|drug counseling)\b/i },
  { kind: "action",      re: /\b(open|navigate|go to|show me settings|configure)\b/i },
  { kind: "report",      re: /\b(show|list|what are|how many|how much|sales|revenue|stock|expir)/i },
];

export function classifyIntent(text: string): CopilotIntent {
  for (const p of INTENT_PATTERNS) if (p.re.test(text)) return p.kind;
  return "unknown";
}

// Period detection — last month / this month / today / week / Q1 / fy
export interface DetectedPeriod {
  readonly kind: "today" | "yesterday" | "this_week" | "last_week"
              | "this_month" | "last_month" | "this_quarter" | "this_year";
  readonly fromIso: string;
  readonly toIso: string;
}

export function detectPeriod(text: string, now: Date = new Date()): DetectedPeriod | null {
  const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n).toISOString();
  if (/\btoday\b/i.test(text)) {
    return { kind: "today", fromIso: day(0), toIso: now.toISOString() };
  }
  if (/\byesterday\b/i.test(text)) {
    return { kind: "yesterday", fromIso: day(1), toIso: day(0) };
  }
  if (/\blast week\b/i.test(text)) {
    return { kind: "last_week", fromIso: day(14), toIso: day(7) };
  }
  if (/\bthis week\b/i.test(text)) {
    return { kind: "this_week", fromIso: day(7), toIso: now.toISOString() };
  }
  if (/\blast month\b/i.test(text)) {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const last = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();
    return { kind: "last_month", fromIso: first, toIso: last };
  }
  if (/\bthis month\b/i.test(text)) {
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return { kind: "this_month", fromIso: first, toIso: now.toISOString() };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// HSN classifier (rule-based fallback)
// ────────────────────────────────────────────────────────────────────────

interface HsnRule { readonly hsn: string; readonly keywords: readonly string[] }

const HSN_RULES: readonly HsnRule[] = [
  // Order matters — most specific first; "tablet/capsule" generic catch-all is last.
  { hsn: "30021400", keywords: ["vaccine","antisera","biotech"] },
  { hsn: "30032000", keywords: ["antibiotic","amoxicillin","azithromycin","ciprofloxacin"] },
  { hsn: "30049011", keywords: ["ayurved","unani","homoeopath","siddha"] },
  { hsn: "30062000", keywords: ["surgical","catgut","suture","bandage","gauze"] },
  { hsn: "30049099", keywords: ["medicament","prepared medicine"] },
  { hsn: "30049099", keywords: ["tablet","capsule","syrup","drops","ointment","cream","injection"] },
];

export function classifyHsnFallback(productName: string): { hsn: string; confidence: number } {
  const lower = productName.toLowerCase();
  for (const rule of HSN_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return { hsn: rule.hsn, confidence: 0.7 };
    }
  }
  return { hsn: "30049099", confidence: 0.3 };
}

// ────────────────────────────────────────────────────────────────────────
// Counseling script generator — per-class templates × locale
// ────────────────────────────────────────────────────────────────────────

export interface CounselingArgs {
  readonly drugName: string;
  readonly drugClass?: "antibiotic" | "antihypertensive" | "antidiabetic" | "analgesic" | "psychotropic" | "other";
  readonly locale: Locale;
  readonly patientAge?: number;
}

const CLASS_GUIDANCE: Record<string, Record<Locale, string>> = {
  antibiotic: {
    "en-IN": "Complete the FULL course even if you feel better. Take with food. If diarrhea persists 48h, contact your doctor.",
    "hi-IN": "पूरा कोर्स पूरा करें भले ही आप बेहतर महसूस करें। खाने के साथ लें। यदि 48 घंटे तक दस्त बने रहें, तो डॉक्टर से संपर्क करें।",
    "mr-IN": "बरे वाटले तरी संपूर्ण कोर्स पूर्ण करा. जेवणासोबत घ्या. 48 तासांपेक्षा जास्त जुलाब असल्यास डॉक्टरांशी संपर्क साधा.",
    "gu-IN": "સારું લાગે તો પણ સંપૂર્ણ કોર્સ પૂરો કરો. જમવા સાથે લો. 48 કલાકથી વધુ ઝાડા થાય તો ડૉક્ટરનો સંપર્ક કરો.",
    "ta-IN": "நலமாக உணர்ந்தாலும் முழு கோர்ஸையும் முடிக்கவும். உணவுடன் எடுத்துக்கொள்ளவும். 48 மணி நேரத்திற்கு மேல் வயிற்றுப்போக்கு தொடர்ந்தால் மருத்துவரை அணுகவும்.",
  },
  antihypertensive: {
    "en-IN": "Take at the same time daily. Do NOT stop suddenly even if BP feels normal. Avoid grapefruit. Stand up slowly to avoid dizziness.",
    "hi-IN": "रोज एक ही समय पर लें। बीपी सामान्य लगने पर भी अचानक बंद न करें। ग्रेपफ्रूट से बचें। चक्कर से बचने के लिए धीरे से उठें।",
    "mr-IN": "दररोज एकाच वेळी घ्या. बीपी सामान्य वाटले तरी अचानक थांबवू नका. द्राक्षफळ टाळा. चक्कर येऊ नये म्हणून हळू उठा.",
    "gu-IN": "દરરોજ એક જ સમયે લો. બીપી સામાન્ય લાગે તો પણ અચાનક બંધ ન કરો. દ્રાક્ષફળ ટાળો. ચક્કર આવે નહીં તે માટે ધીમે ઊભા થાઓ.",
    "ta-IN": "தினமும் ஒரே நேரத்தில் எடுத்துக்கொள்ளவும். BP சாதாரணமாக இருந்தாலும் திடீரென நிறுத்த வேண்டாம். திராட்சைப்பழம் தவிர்க்கவும்.",
  },
  antidiabetic: {
    "en-IN": "Take with first bite of meal. Carry sugar/glucose in case of low blood sugar. Test blood sugar as advised. Avoid skipping meals.",
    "hi-IN": "खाने के पहले निवाले के साथ लें। ब्लड शुगर कम होने पर शक्कर/ग्लूकोज पास रखें। सलाह अनुसार ब्लड शुगर टेस्ट करें। भोजन न छोड़ें।",
    "mr-IN": "जेवणाच्या पहिल्या घासासोबत घ्या. साखर कमी झाल्यास साखर/ग्लुकोज जवळ ठेवा. सल्ल्यानुसार साखर तपासा.",
    "gu-IN": "જમવાના પહેલા કોળિયા સાથે લો. શુગર ઓછી થાય તો ખાંડ/ગ્લુકોઝ સાથે રાખો.",
    "ta-IN": "உணவின் முதல் கவளத்துடன் எடுக்கவும். ரத்தச் சர்க்கரை குறைந்தால் சர்க்கரை/குளுக்கோஸ் வைத்திருக்கவும்.",
  },
  analgesic: {
    "en-IN": "Take with food. Do not exceed 4 doses in 24h. If pain persists > 3 days, see your doctor. Avoid alcohol.",
    "hi-IN": "खाने के साथ लें। 24 घंटे में 4 खुराक से अधिक न लें। 3 दिन से अधिक दर्द रहे तो डॉक्टर से मिलें। शराब से बचें।",
    "mr-IN": "जेवणासोबत घ्या. 24 तासांत 4 डोसपेक्षा जास्त घेऊ नका. 3 दिवसांपेक्षा जास्त दुखत असल्यास डॉक्टरांना भेटा.",
    "gu-IN": "જમવા સાથે લો. 24 કલાકમાં 4 ડોઝથી વધુ ન લો. 3 દિવસથી વધુ દુખાવો રહે તો ડૉક્ટરને મળો.",
    "ta-IN": "உணவுடன் எடுக்கவும். 24 மணி நேரத்தில் 4 டோஸுக்கு மேல் எடுக்க வேண்டாம்.",
  },
};

export function draftCounselingScript(a: CounselingArgs): string {
  const cls = a.drugClass ?? "other";
  const guidance = CLASS_GUIDANCE[cls]?.[a.locale];
  if (guidance) {
    return `Counselling for ${a.drugName}:\n${guidance}`;
  }
  // Generic fallback
  const fallback: Record<Locale, string> = {
    "en-IN": "Take as directed by your doctor. Read the leaflet. Report any unusual side effects.",
    "hi-IN": "डॉक्टर के निर्देशानुसार लें। पर्चा पढ़ें। किसी भी असामान्य दुष्प्रभाव की सूचना दें।",
    "mr-IN": "डॉक्टरांच्या सूचनेनुसार घ्या. पत्रक वाचा. कोणतेही असामान्य दुष्परिणाम कळवा.",
    "gu-IN": "ડૉક્ટરની સૂચના મુજબ લો. પત્રક વાંચો. કોઈ અસામાન્ય આડઅસર જણાવો.",
    "ta-IN": "மருத்துவர் அறிவுறுத்தியபடி எடுக்கவும். துண்டுப்பிரசுரத்தைப் படிக்கவும்.",
  };
  return `Counselling for ${a.drugName}:\n${fallback[a.locale]}`;
}

// ────────────────────────────────────────────────────────────────────────
// Mock implementations — used in dev/sandbox until LiteLLM lands
// ────────────────────────────────────────────────────────────────────────

export class MockLlmGateway implements LlmGateway {
  public readonly id = "mock-llm";
  async generate(prompt: string, opts?: { jsonMode?: boolean }): Promise<string> {
    if (opts?.jsonMode) {
      return JSON.stringify({ ok: true, mock: true, prompt: prompt.slice(0, 50) });
    }
    return `(mock LLM response for prompt: "${prompt.slice(0, 80)}")`;
  }
}

export class MockSemanticLayer implements SemanticLayer {
  async parse(natural: string, _locale: Locale): Promise<CubeQuery | null> {
    if (/sales/i.test(natural)) {
      return {
        measures: ["bills.total_paise"],
        timeDimensions: [{ dimension: "bills.billed_at", granularity: "day" }],
        limit: 30,
      };
    }
    return null;
  }
  async run(_query: CubeQuery): Promise<CubeResult> {
    // Simulated sales last 7 days
    const rows = Array.from({ length: 7 }, (_, i) => ({
      day: `2026-04-${22 + i}`,
      bills_total_paise: 100000 + Math.floor(Math.random() * 50000),
    }));
    return { rows, took_ms: 4 };
  }
}

// ────────────────────────────────────────────────────────────────────────
// The orchestration: ask()
// ────────────────────────────────────────────────────────────────────────

export interface AskDeps {
  readonly llm: LlmGateway;
  readonly semantic: SemanticLayer;
}

export async function ask(q: CopilotQuery, deps: AskDeps): Promise<CopilotAnswer> {
  const intent = classifyIntent(q.userText);
  const period = detectPeriod(q.userText);
  const cubeQ = await deps.semantic.parse(q.userText, q.locale);

  if (intent === "counseling") {
    const drug = q.userText.replace(/.*for\s+/i, "").replace(/.*counseling\s*/i, "").trim();
    const script = draftCounselingScript({ drugName: drug, locale: q.locale });
    return {
      narrative: script,
      modelUsed: deps.llm.id,
      confidence: 0.85,
    };
  }

  if (cubeQ) {
    const data = await deps.semantic.run(cubeQ);
    const llmPrompt =
      `User asked: "${q.userText}"\n` +
      `Period detected: ${period?.kind ?? "n/a"}\n` +
      `Intent: ${intent}\n` +
      `Result rows: ${data.rows.length}\n` +
      `Narrate the answer in ${q.locale} for the pharmacy ${q.userRole}.`;
    const narrative = await deps.llm.generate(llmPrompt);
    const chart: CopilotChart | undefined = data.rows.length > 0 ? {
      kind: "line",
      data: data.rows.map((r) => ({
        label: String(r["day"] ?? Object.values(r)[0]),
        value: Number(Object.values(r)[1] ?? 0),
      })),
      yAxis: "₹",
    } : undefined;

    return {
      narrative,
      ...(chart !== undefined ? { chart } : {}),
      modelUsed: deps.llm.id,
      confidence: 0.7,
    };
  }

  return {
    narrative: `I'm not sure how to answer "${q.userText}" yet — try asking for sales, stock, expiry, or compliance reports.`,
    modelUsed: deps.llm.id,
    confidence: 0.2,
  };
}
