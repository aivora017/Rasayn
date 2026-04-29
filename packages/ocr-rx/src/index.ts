// @pharmacare/ocr-rx
// Pure prescription validation + dose-instruction parsing + drug-name
// normalization. The actual OCR (TrOCR / Donut / vision LLM) is injected
// as a transport so this package has zero runtime deps.
//
// Pipeline:
//   1. Caller invokes transport.scan(imageBytes) → raw RxScanResult
//   2. validate(result) — sanity-check confidences + dose strings
//   3. normalizeDrugName(line) — strip "Tab.", "Cap.", brackets etc.
//   4. parseDoseInstruction(text) — "1-0-1" / "BD" / "TID" → structured
//   5. matchToFormulary(name, formulary) — fuzzy lookup against curated list
//
// All outputs are deterministic and fully testable.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface RxLine {
  readonly drugName: string;
  readonly strength?: string;
  readonly form?: string;
  readonly qty: number;
  readonly doseInstructions?: string;
  readonly confidence: number;
}

export interface RxScanResult {
  readonly lines: readonly RxLine[];
  readonly doctor?: { name?: string; regNo?: string; clinic?: string; date?: string };
  readonly patientHints?: { name?: string; ageYears?: number };
  readonly overallConfidence: number;
  readonly modelUsed: "trocr-printed" | "gemini-2.5-vision" | "claude-sonnet-4.6" | "manual" | "unknown";
}

export type RxLineSeverity = "ok" | "warn" | "reject";

export interface RxLineValidation {
  readonly line: RxLine;
  readonly severity: RxLineSeverity;
  readonly reasons: readonly string[];
}

export interface DoseSchedule {
  readonly perDay: number;
  readonly mealRelation: "before" | "after" | "with" | "any";
  readonly slots: readonly ("morning" | "noon" | "evening" | "night")[];
  readonly raw: string;
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

const MIN_CONFIDENCE_OK = 0.85;
const MIN_CONFIDENCE_WARN = 0.55;

export function validateRxLine(line: RxLine): RxLineValidation {
  const reasons: string[] = [];
  let severity: RxLineSeverity = "ok";

  if (!line.drugName || line.drugName.trim().length < 2) {
    reasons.push("drug-name too short or empty");
    severity = "reject";
  }
  if (!Number.isInteger(line.qty) || line.qty <= 0) {
    reasons.push(`invalid qty: ${line.qty}`);
    severity = "reject";
  }
  if (line.qty > 200) {
    reasons.push(`qty unusually high: ${line.qty}`);
    if (severity !== "reject") severity = "warn";
  }
  if (line.confidence < MIN_CONFIDENCE_WARN) {
    reasons.push(`OCR confidence ${line.confidence.toFixed(2)} < 0.55`);
    severity = "reject";
  } else if (line.confidence < MIN_CONFIDENCE_OK) {
    reasons.push(`OCR confidence ${line.confidence.toFixed(2)} < 0.85 — pharmacist review`);
    if (severity === "ok") severity = "warn";
  }
  return { line, severity, reasons };
}

export function validateRxScan(scan: RxScanResult): readonly RxLineValidation[] {
  return scan.lines.map(validateRxLine);
}

export function isAcceptable(validations: readonly RxLineValidation[]): boolean {
  return validations.length > 0 && validations.every((v) => v.severity !== "reject");
}

// ────────────────────────────────────────────────────────────────────────
// Drug name normalization
// ────────────────────────────────────────────────────────────────────────

const NOISE_PREFIXES = ["tab.", "cap.", "syr.", "inj.", "oint.", "tab", "cap", "syr", "inj", "oint"];

export function normalizeDrugName(raw: string): string {
  let s = raw.trim().toLowerCase();
  // Strip common prefixes (Tab. / Cap. / Syr. etc.)
  for (const p of NOISE_PREFIXES) {
    if (s.startsWith(p + " ") || s.startsWith(p)) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  // Drop trailing strength fragments like "500 mg" or "(500mg)"
  s = s.replace(/\s*\(?\d+\s*(mg|mcg|g|ml|iu|%)\)?$/i, "").trim();
  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, " ");
  return s;
}

// ────────────────────────────────────────────────────────────────────────
// Dose-instruction parser
// ────────────────────────────────────────────────────────────────────────

const SLOT_KEYWORDS: Record<string, ("morning" | "noon" | "evening" | "night")[]> = {
  od: ["morning"],
  bd: ["morning", "night"],
  bid: ["morning", "night"],
  tds: ["morning", "noon", "night"],
  tid: ["morning", "noon", "night"],
  qid: ["morning", "noon", "evening", "night"],
  qds: ["morning", "noon", "evening", "night"],
  hs: ["night"],
  qhs: ["night"],
  sos: ["any"] as never,
};

/** Parse Indian prescription dose strings.
 *  Supports: "BD" / "1-0-1" / "TDS after meals" / "1 tablet thrice daily" */
export function parseDoseInstruction(raw: string): DoseSchedule {
  const lower = raw.toLowerCase().trim();

  // Pattern 1: numeric grid "1-0-1" or "1-1-1-1"
  const gridMatch = lower.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (gridMatch) {
    const m = parseInt(gridMatch[1] ?? "0", 10);
    const n = parseInt(gridMatch[2] ?? "0", 10);
    const e = parseInt(gridMatch[3] ?? "0", 10);
    const ng = gridMatch[4] !== undefined ? parseInt(gridMatch[4], 10) : 0;
    const slots: ("morning" | "noon" | "evening" | "night")[] = [];
    if (m > 0) slots.push("morning");
    if (n > 0) slots.push("noon");
    if (e > 0) slots.push(gridMatch[4] !== undefined ? "evening" : "night");
    if (ng > 0) slots.push("night");
    return {
      perDay: m + n + e + ng,
      mealRelation: parseMealRelation(lower),
      slots,
      raw,
    };
  }

  // Pattern 2: keyword "BD"/"TDS"/"OD"/...
  for (const [kw, slots] of Object.entries(SLOT_KEYWORDS)) {
    if (new RegExp(`\\b${kw}\\b`).test(lower)) {
      const slotsClean = slots.filter((s) => s !== ("any" as never)) as readonly ("morning" | "noon" | "evening" | "night")[];
      return {
        perDay: slotsClean.length || (kw === "sos" ? 0 : 1),
        mealRelation: parseMealRelation(lower),
        slots: slotsClean,
        raw,
      };
    }
  }

  // Pattern 3: "twice daily" / "thrice daily" / "once a day"
  const wordCounts: Record<string, number> = {
    once: 1, twice: 2, thrice: 3, "four times": 4,
  };
  for (const [w, n] of Object.entries(wordCounts)) {
    if (lower.includes(w)) {
      const slots: ("morning" | "noon" | "evening" | "night")[] =
        n === 1 ? ["morning"] :
        n === 2 ? ["morning", "night"] :
        n === 3 ? ["morning", "noon", "night"] :
        ["morning", "noon", "evening", "night"];
      return { perDay: n, mealRelation: parseMealRelation(lower), slots, raw };
    }
  }

  // Fallback — unknown
  return { perDay: 1, mealRelation: "any", slots: ["morning"], raw };
}

function parseMealRelation(lower: string): "before" | "after" | "with" | "any" {
  if (/before\s+(food|meal)|empty stomach|\bac\b/.test(lower)) return "before";
  if (/after\s+(food|meal)|\bpc\b/.test(lower)) return "after";
  if (/with\s+(food|meal)/.test(lower)) return "with";
  return "any";
}

// ────────────────────────────────────────────────────────────────────────
// Formulary fuzzy match (Levenshtein, capped — drugs are short tokens)
// ────────────────────────────────────────────────────────────────────────

export interface FormularyEntry {
  readonly id: string;
  readonly genericName: string;
  readonly aliases: readonly string[];
}

export interface MatchResult {
  readonly matched: FormularyEntry | null;
  readonly distance: number;
  readonly score: number;             // 0..1, higher = better
}

export function matchToFormulary(
  drugName: string,
  formulary: readonly FormularyEntry[],
): MatchResult {
  const target = normalizeDrugName(drugName);
  let best: { entry: FormularyEntry; candidate: string; distance: number } | null = null;
  for (const entry of formulary) {
    const candidates = [entry.genericName, ...entry.aliases].map(normalizeDrugName);
    for (const c of candidates) {
      const d = levenshtein(target, c);
      if (best === null || d < best.distance) {
        best = { entry, candidate: c, distance: d };
      }
    }
  }
  if (!best) return { matched: null, distance: Infinity, score: 0 };
  // Score relative to the candidate that actually matched (not genericName,
  // which may be longer than the alias the user typed).
  const denom = Math.max(target.length, best.candidate.length);
  const score = denom === 0 ? 0 : Math.max(0, 1 - best.distance / denom);
  // Below 0.6 = too noisy.
  if (score < 0.6) return { matched: null, distance: best.distance, score };
  return { matched: best.entry, distance: best.distance, score };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j]! + 1,
        dp[j - 1]! + 1,
        prev + cost,
      );
      prev = tmp;
    }
  }
  return dp[n]!;
}

// ────────────────────────────────────────────────────────────────────────
// I/O port — caller injects the actual OCR transport
// ────────────────────────────────────────────────────────────────────────

export interface RxScanTransport {
  scan(imageBytes: Uint8Array): Promise<RxScanResult>;
}

let transport: RxScanTransport | null = null;

export function setRxScanTransport(t: RxScanTransport): void {
  transport = t;
}

export async function scanRx(imageBytes: Uint8Array): Promise<RxScanResult> {
  if (!transport) throw new Error("RX_SCAN_TRANSPORT_NOT_SET");
  return transport.scan(imageBytes);
}

/** Convenience: scan + validate + match against formulary in one call. */
export async function scanAndEnrich(
  imageBytes: Uint8Array,
  formulary: readonly FormularyEntry[],
): Promise<{
  readonly scan: RxScanResult;
  readonly validations: readonly RxLineValidation[];
  readonly matches: readonly MatchResult[];
  readonly acceptable: boolean;
}> {
  const scan = await scanRx(imageBytes);
  const validations = validateRxScan(scan);
  const matches = scan.lines.map((l) => matchToFormulary(l.drugName, formulary));
  return {
    scan,
    validations,
    matches,
    acceptable: isAcceptable(validations),
  };
}
