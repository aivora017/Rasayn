// PrescriptionScreen — Drag-drop Rx photo → OCR → validate → dispense (S12).
//
// Uses @pharmacare/ocr-rx with a mock transport for now. The transport can be
// swapped at runtime to: TrOCR sidecar / Gemini Vision / Claude Sonnet 4.6.

import { useCallback, useState } from "react";
import {
  ScrollText, Upload, AlertTriangle, CheckCircle2, Loader2, Trash2,
} from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  validateRxScan, isAcceptable, normalizeDrugName, parseDoseInstruction,
  matchToFormulary, setRxScanTransport, scanRx,
  type RxScanResult, type RxLineValidation, type FormularyEntry, type MatchResult,
} from "@pharmacare/ocr-rx";

// Tiny inline formulary for demo — replace with IPC fetch in S13.
const FORMULARY: FormularyEntry[] = [
  { id: "p1", genericName: "Paracetamol", aliases: ["Crocin", "Calpol", "Dolo"] },
  { id: "p2", genericName: "Amoxicillin", aliases: ["Mox", "Novamox"] },
  { id: "p3", genericName: "Cetirizine",  aliases: ["Cetzine", "Alerid"] },
  { id: "p4", genericName: "Pantoprazole", aliases: ["Pan-D", "Pantop"] },
];

// Mock OCR transport: parses common test fixtures so the screen is testable.
setRxScanTransport({
  scan: async (_bytes: Uint8Array): Promise<RxScanResult> => ({
    lines: [
      { drugName: "Tab. Crocin Advance 500mg", strength: "500mg", form: "tab", qty: 10, doseInstructions: "1-0-1 after food", confidence: 0.92 },
      { drugName: "Cap Pan-D 40mg",            strength: "40mg",  form: "cap", qty: 14, doseInstructions: "BD before food", confidence: 0.88 },
      { drugName: "Cetzine 10mg",              strength: "10mg",  form: "tab", qty: 10, doseInstructions: "HS",             confidence: 0.61 },
    ],
    doctor: { name: "Dr. R. Mehta", regNo: "MMC-12345", clinic: "Apollo Clinic, Kalyan", date: "2026-04-29" },
    overallConfidence: 0.83,
    modelUsed: "trocr-printed",
  }),
});

interface EnrichedLine {
  raw: { drugName: string; qty: number; doseInstructions?: string; confidence: number };
  normalized: string;
  match: MatchResult;
  validation: RxLineValidation;
  doseSummary: string;
}

export function PrescriptionScreen(): JSX.Element {
  const [scan, setScan] = useState<RxScanResult | null>(null);
  const [enriched, setEnriched] = useState<EnrichedLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const buf = await file.arrayBuffer();
      const result = await scanRx(new Uint8Array(buf));
      setScan(result);
      const valids = validateRxScan(result);
      const out: EnrichedLine[] = result.lines.map((l, i) => {
        const dose = l.doseInstructions ? parseDoseInstruction(l.doseInstructions) : null;
        const summary = dose
          ? `${dose.perDay}x/day · ${dose.slots.join("/")} · ${dose.mealRelation}`
          : "—";
        return {
          raw: {
            drugName: l.drugName,
            qty: l.qty,
            ...(l.doseInstructions !== undefined ? { doseInstructions: l.doseInstructions } : {}),
            confidence: l.confidence,
          },
          normalized: normalizeDrugName(l.drugName),
          match: matchToFormulary(l.drugName, FORMULARY),
          validation: valids[i]!,
          doseSummary: summary,
        };
      });
      setEnriched(out);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) void handleFile(f);
  }, [handleFile]);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  }, [handleFile]);

  const overallOk = scan ? isAcceptable(enriched.map((e) => e.validation)) : false;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <ScrollText size={28} /> Prescription Capture
        </h1>
        <p style={{ margin: "4px 0 0", color: "var(--text-muted)" }}>
          Drag a prescription photo or PDF here. We&apos;ll OCR it, validate against the formulary, and pre-fill a bill draft.
        </p>
      </header>

      {!scan && (
        <Glass>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            style={{
              border: "2px dashed var(--border)",
              borderRadius: 16,
              padding: 48,
              textAlign: "center",
              transition: "all 0.2s",
            }}
          >
            <Upload size={48} style={{ opacity: 0.4 }} />
            <p>Drop Rx image here, or pick:</p>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={onPick}
              disabled={busy}
            />
            {busy && (
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Loader2 className="animate-spin" size={16} /> Scanning…
              </div>
            )}
          </div>
        </Glass>
      )}

      {err && (
        <Glass>
          <span style={{ color: "var(--text-danger)" }}>
            <AlertTriangle size={16} /> {err}
          </span>
        </Glass>
      )}

      {scan && (
        <>
          <Glass>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <strong>Doctor:</strong> {scan.doctor?.name ?? "—"}
                {scan.doctor?.regNo && <span style={{ marginLeft: 8 }}>(reg #{scan.doctor.regNo})</span>}
                <br />
                <span style={{ color: "var(--text-muted)" }}>{scan.doctor?.clinic ?? ""}</span>
              </div>
              <div>
                <Badge variant="info">{scan.modelUsed}</Badge>
                <span style={{ marginLeft: 8 }}>
                  Confidence: {(scan.overallConfidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </Glass>

          {enriched.map((e, i) => (
            <Glass key={i}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <SeverityBadge severity={e.validation.severity} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {e.raw.drugName} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>× {e.raw.qty}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                    Normalized: <code>{e.normalized}</code>
                    {e.raw.doseInstructions && ` · Dose: ${e.raw.doseInstructions} → ${e.doseSummary}`}
                  </div>
                  {e.match.matched ? (
                    <div style={{ marginTop: 8 }}>
                      <Badge variant="success">
                        Matched: {e.match.matched.genericName} (score {(e.match.score * 100).toFixed(0)}%)
                      </Badge>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      <Badge variant="warning">Not in formulary — manual entry needed</Badge>
                    </div>
                  )}
                  {e.validation.reasons.length > 0 && (
                    <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 13, color: "var(--text-muted)" }}>
                      {e.validation.reasons.map((r, j) => <li key={j}>{r}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </Glass>
          ))}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <Button variant="ghost" onClick={() => { setScan(null); setEnriched([]); }}>
              <Trash2 size={16} /> Discard
            </Button>
            <Button disabled={!overallOk}>
              <CheckCircle2 size={16} /> Approve &amp; create bill draft
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: RxLineValidation["severity"] }): JSX.Element {
  if (severity === "ok") return <Badge variant="success"><CheckCircle2 size={12} /> OK</Badge>;
  if (severity === "warn") return <Badge variant="warning"><AlertTriangle size={12} /> Review</Badge>;
  return <Badge variant="danger"><AlertTriangle size={12} /> Reject</Badge>;
}
