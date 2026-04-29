// MigrationImportScreen — bring data IN from competitor pharmacy software.

import { useCallback, useState } from "react";
import { Upload, ArrowRight, AlertTriangle, CheckCircle2, FileText, ChevronLeft } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import {
  adaptMargItemMasterCsv, adaptMargCustomerCsv,
  adaptVyaparItemCsv, adaptMedeilDrugCsv,
  adaptTallyXml, adaptGenericCsv,
  planImport,
  type ImportSource, type ImportPlan, type SourceVendor,
} from "@pharmacare/migration-import";

type Step = "vendor" | "upload" | "preview";

interface VendorOpt {
  id: SourceVendor;
  label: string;
  description: string;
  formats: readonly string[];
  category: "items" | "customers" | "vouchers" | "any";
  adapter: (text: string) => ImportSource;
}

const VENDORS: readonly VendorOpt[] = [
  { id: "marg",        label: "Marg ERP — Items",        description: "Item Master CSV from Marg",            formats: ["CSV"], category: "items", adapter: adaptMargItemMasterCsv },
  { id: "marg",        label: "Marg ERP — Customers",    description: "Customer Master CSV from Marg",        formats: ["CSV"], category: "customers", adapter: adaptMargCustomerCsv },
  { id: "tally",       label: "Tally Prime",             description: "XML voucher dump (ledgers + vouchers)", formats: ["XML"], category: "vouchers", adapter: adaptTallyXml },
  { id: "vyapar",      label: "Vyapar",                  description: "Item / Sale Item CSV export",          formats: ["CSV"], category: "items", adapter: adaptVyaparItemCsv },
  { id: "medeil",      label: "Medeil",                  description: "Drug master CSV",                      formats: ["CSV"], category: "items", adapter: adaptMedeilDrugCsv },
  { id: "generic_csv", label: "Generic CSV (any source)", description: "Map your columns to our fields",       formats: ["CSV"], category: "any",  adapter: (s: string) => adaptGenericCsv(s, { externalIdColumn: "id", kind: "product", fields: { name: "name" } }) },
];

export default function MigrationImportScreen(): React.ReactElement {
  const [step, setStep] = useState<Step>("vendor");
  const [vendor, setVendor] = useState<VendorOpt | null>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState<ImportSource | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<{ inserts: number; updates: number } | null>(null);

  const onUpload = useCallback(async (file: File) => {
    const t = await file.text();
    setText(t);
  }, []);

  const onParse = useCallback(async () => {
    if (!vendor || !text) return;
    const src = vendor.adapter(text);
    setSource(src);
    const p = await planImport(src);
    setPlan(p);
    setStep("preview");
  }, [vendor, text]);

  const onCommit = useCallback(() => {
    if (!plan) return;
    setCommitting(true);
    // In production: dispatch RPC to write rows in a transaction.
    setTimeout(() => {
      setCommitted({ inserts: plan.insertCount, updates: plan.updateCount });
      setCommitting(false);
    }, 500);
  }, [plan]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6 max-w-4xl mx-auto" data-screen="migration-import">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Upload size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Import data from existing software</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              Marg · Tally · Vyapar · Medeil · GoFrugal · Generic CSV
            </p>
          </div>
        </div>
      </header>

      {/* Vendor picker */}
      {step === "vendor" && (
        <Glass>
          <div className="p-4 flex flex-col gap-3">
            <h2 className="font-medium">Pick the source</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {VENDORS.map((v, i) => (
                <button key={`${v.id}-${i}`}
                  onClick={() => { setVendor(v); setStep("upload"); }}
                  className="text-left p-3 rounded-lg border border-[var(--pc-border-subtle)] hover:bg-[var(--pc-bg-hover)]">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-[14px]">{v.label}</h3>
                    <Badge variant="info">{v.formats.join(", ")}</Badge>
                  </div>
                  <p className="text-[12px] text-[var(--pc-text-secondary)] mt-1">{v.description}</p>
                  <div className="text-[11px] text-[var(--pc-text-tertiary)] mt-1">Imports: {v.category}</div>
                </button>
              ))}
            </div>
          </div>
        </Glass>
      )}

      {/* Upload + parse */}
      {step === "upload" && vendor && (
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="step-upload">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Upload {vendor.label}</h2>
              <Button variant="ghost" onClick={() => setStep("vendor")}><ChevronLeft size={14} /> Change source</Button>
            </div>
            <input type="file" accept=".csv,.xml,.txt"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); }}
              className="text-[13px] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-[var(--pc-border-subtle)]" />
            {text && (
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--pc-text-secondary)]">
                  Loaded {(text.length / 1024).toFixed(1)} KB · ready to parse
                </span>
                <Button onClick={onParse}>Parse & preview <ArrowRight size={14} /></Button>
              </div>
            )}
          </div>
        </Glass>
      )}

      {/* Preview + commit */}
      {step === "preview" && plan && source && (
        <>
          <Glass>
            <div className="p-4 flex flex-col gap-3" data-testid="step-preview">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Preview</h2>
                <div className="flex gap-1">
                  <Badge variant="success">{plan.insertCount} new</Badge>
                  <Badge variant="info">{plan.updateCount} updates</Badge>
                  <Badge variant="warning">{plan.skipCount} skipped</Badge>
                </div>
              </div>

              {/* Per-kind summary */}
              <div className="flex flex-wrap gap-1">
                {Object.entries(plan.summary as Record<string, number>).filter(([, n]) => n > 0).map(([kind, n]) => (
                  <Badge key={kind} variant="neutral">{kind}: {n}</Badge>
                ))}
              </div>

              {source.warnings.length > 0 && (
                <div className="text-[12px] p-2 rounded bg-[var(--pc-state-warning)]/10 text-[var(--pc-state-warning)]">
                  <div className="flex items-center gap-1 font-medium"><AlertTriangle size={12} /> Adapter warnings ({source.warnings.length}):</div>
                  <ul className="mt-1 ml-4 list-disc max-h-40 overflow-y-auto">
                    {source.warnings.slice(0, 20).map((w: string, i: number) => <li key={i}>{w}</li>)}
                    {source.warnings.length > 20 && <li>+{source.warnings.length - 20} more</li>}
                  </ul>
                </div>
              )}

              {/* First 10 rows */}
              <div className="text-[11px] font-mono p-2 rounded border border-[var(--pc-border-subtle)] max-h-64 overflow-auto">
                {source.rows.slice(0, 10).map((r: any, i: number) => (
                  <div key={i} className="border-b border-[var(--pc-border-subtle)] py-0.5">
                    <strong>{r.kind}</strong> · {r.externalId} · {Object.entries(r.fields).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(" ")}
                  </div>
                ))}
                {source.rows.length > 10 && <div className="text-[var(--pc-text-tertiary)] py-1">+{source.rows.length - 10} more rows…</div>}
              </div>
            </div>
          </Glass>

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("upload")}><ChevronLeft size={14} /> Back</Button>
            <Button onClick={onCommit} disabled={committing || committed !== null}>
              {committing ? "Importing…" : committed ? "Done" : `Commit import (${plan.insertCount + plan.updateCount} rows)`}
            </Button>
          </div>

          {committed && (
            <Glass>
              <div className="p-4 flex items-center gap-3">
                <CheckCircle2 size={24} className="text-[var(--pc-state-success)]" />
                <div>
                  <h3 className="font-medium">Import complete</h3>
                  <p className="text-[12px] text-[var(--pc-text-secondary)]">
                    Inserted {committed.inserts} new rows, updated {committed.updates} existing.
                  </p>
                </div>
              </div>
            </Glass>
          )}
        </>
      )}
    </div>
  );
}
