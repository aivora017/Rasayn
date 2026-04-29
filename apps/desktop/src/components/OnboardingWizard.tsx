// OnboardingWizard — first-run flow for new pharmacy installs.
//
// Step 1: pick entity type (8 options)
// Step 2: business details form (driven by ENTITY_TYPES[type].requiresFields)
// Step 3: optional — import existing data from competitor (Marg/Tally/Vyapar/Medeil)
// Step 4: confirmation + jump into BillingScreen

import { useCallback, useMemo, useState } from "react";
import { Building2, ArrowRight, CheckCircle2, AlertTriangle, ChevronLeft, Upload } from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  ENTITY_TYPES, ALL_ENTITY_TYPES, validateRegistration, isAuditRequired,
  annualFilingsFor,
  type EntityType, type RegistrationForm,
} from "@pharmacare/entity-types";

interface Props { onComplete?: (form: RegistrationForm) => void }

export default function OnboardingWizard({ onComplete }: Props = {}): React.ReactElement {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [form, setForm] = useState<RegistrationForm>({ entityType: "sole_proprietor" });
  const [busy, setBusy] = useState(false);

  const meta = entityType ? ENTITY_TYPES[entityType] : null;
  const validation = useMemo(() => validateRegistration(form), [form]);

  const updateField = useCallback(<K extends keyof RegistrationForm>(key: K, val: RegistrationForm[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
  }, []);

  const finish = useCallback(() => {
    setBusy(true);
    try {
      onComplete?.(form);
      setStep(4);
    } finally { setBusy(false); }
  }, [form, onComplete]);

  return (
    <div className="screen-shell flex flex-col gap-4 p-6 max-w-4xl mx-auto" data-screen="onboarding">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={24} className="text-[var(--pc-brand-primary)]" />
          <div>
            <h1 className="text-[20px] font-semibold leading-tight">Welcome to PharmaCare</h1>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">First-time setup · takes 2 minutes</p>
          </div>
        </div>
        <Badge variant="info">Step {step} of 4</Badge>
      </header>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-[12px]">
        {[
          { n: 1, label: "Entity type" },
          { n: 2, label: "Business details" },
          { n: 3, label: "Migrate (optional)" },
          { n: 4, label: "Done" },
        ].map((s, i, arr) => (
          <div key={s.n} className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-medium ${
              s.n < step ? "bg-[var(--pc-state-success)] text-white"
              : s.n === step ? "bg-[var(--pc-brand-primary)] text-white"
              : "bg-[var(--pc-bg-surface)] text-[var(--pc-text-tertiary)]"
            }`}>{s.n < step ? "✓" : s.n}</span>
            <span className={s.n === step ? "font-medium" : "text-[var(--pc-text-tertiary)]"}>{s.label}</span>
            {i < arr.length - 1 && <ArrowRight size={12} className="text-[var(--pc-text-tertiary)]" />}
          </div>
        ))}
      </div>

      {/* Step 1: Entity type picker */}
      {step === 1 && (
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="step-entity">
            <h2 className="font-medium">What kind of business is your pharmacy registered as?</h2>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              This drives which compliance reports we generate (LLP Form 8 vs Pvt Ltd AOC-4 etc.)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              {ALL_ENTITY_TYPES.map((t) => {
                const m = ENTITY_TYPES[t];
                const selected = entityType === t;
                return (
                  <button
                    key={t}
                    onClick={() => { setEntityType(t); setForm({ entityType: t }); }}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      selected
                        ? "border-[var(--pc-brand-primary)] bg-[var(--pc-bg-hover)]"
                        : "border-[var(--pc-border-subtle)] hover:bg-[var(--pc-bg-hover)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-[14px]">{m.displayName}</h3>
                      {m.hasRoc && <Badge variant="warning">ROC filings</Badge>}
                      {!m.hasRoc && <Badge variant="success">No ROC</Badge>}
                    </div>
                    <p className="text-[12px] text-[var(--pc-text-secondary)] mt-1">{m.tagline}</p>
                    <div className="text-[11px] text-[var(--pc-text-tertiary)] mt-1">
                      {m.defaultItrForm} · {m.limitedLiability ? "Limited liability" : "Personal liability"} · {m.minPartnersOrDirectors}
                      {m.maxPartnersOrDirectors ? `–${m.maxPartnersOrDirectors}` : "+"} partners/directors
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-2">
              <Button onClick={() => setStep(2)} disabled={!entityType}>
                Next: Business details <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </Glass>
      )}

      {/* Step 2: Business details */}
      {step === 2 && meta && (
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="step-details">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{meta.displayName} · business details</h2>
              <Badge variant="info">{meta.requiresFields.length} required fields</Badge>
            </div>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              We'll generate {annualFilingsFor(entityType!).length} filings annually for you. Fields below match what your CA needs.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              {meta.requiresFields.includes("shopName") && (
                <Field label="Shop name *">
                  <Input value={form.shopName ?? ""} onChange={(e) => updateField("shopName", e.target.value)} placeholder="e.g. Jagannath Pharmacy" />
                </Field>
              )}
              {meta.requiresFields.includes("panNumber") && (
                <Field label="PAN number * (10 chars: AAAAA9999A)">
                  <Input value={form.panNumber ?? ""} onChange={(e) => updateField("panNumber", e.target.value.toUpperCase())} maxLength={10} placeholder="AAAAA0000A" />
                </Field>
              )}
              {meta.requiresFields.includes("gstin") && (
                <Field label="GSTIN * (15 chars)">
                  <Input value={form.gstin ?? ""} onChange={(e) => updateField("gstin", e.target.value.toUpperCase())} maxLength={15} placeholder="27AAAAA0000A1Z5" />
                </Field>
              )}
              {meta.requiresFields.includes("stateCode") && (
                <Field label="State code * (2 digits, matches GSTIN)">
                  <Input value={form.stateCode ?? ""} onChange={(e) => updateField("stateCode", e.target.value)} maxLength={2} placeholder="27 = Maharashtra" />
                </Field>
              )}
              {meta.requiresFields.includes("retailDrugLicense") && (
                <Field label="Retail Drug License (Form 20/21) *">
                  <Input value={form.retailDrugLicense ?? ""} onChange={(e) => updateField("retailDrugLicense", e.target.value)} placeholder="MH-FORM20-12345" />
                </Field>
              )}
              {meta.requiresFields.includes("ownerName") && (
                <Field label="Owner / proprietor name *">
                  <Input value={form.ownerName ?? ""} onChange={(e) => updateField("ownerName", e.target.value)} placeholder="Sourav Shaw" />
                </Field>
              )}
              {meta.requiresFields.includes("llpinNumber") && (
                <Field label="LLPIN * (AAA-9999)">
                  <Input value={form.llpinNumber ?? ""} onChange={(e) => updateField("llpinNumber", e.target.value.toUpperCase())} placeholder="AAB-1234" />
                </Field>
              )}
              {meta.requiresFields.includes("cinNumber") && (
                <Field label="CIN * (21 chars)">
                  <Input value={form.cinNumber ?? ""} onChange={(e) => updateField("cinNumber", e.target.value.toUpperCase())} maxLength={21} placeholder="U24230MH2020PTC123456" />
                </Field>
              )}
              {meta.requiresFields.includes("shopAddress") && (
                <Field label="Shop address *" wide>
                  <Input value={form.shopAddress ?? ""} onChange={(e) => updateField("shopAddress", e.target.value)} placeholder="123 Main St, Kalyan, Maharashtra 421301" />
                </Field>
              )}
            </div>

            {/* Partners (LLP / Partnership) */}
            {(meta.requiresFields.includes("partners") || meta.requiresFields.includes("designatedPartners") || meta.requiresFields.includes("directors")) && (
              <div className="mt-3 p-3 border border-[var(--pc-border-subtle)] rounded-lg">
                <h3 className="font-medium text-[13px] mb-2">
                  {meta.requiresFields.includes("directors") ? "Directors" : "Partners"} (minimum {meta.minPartnersOrDirectors})
                </h3>
                <p className="text-[11px] text-[var(--pc-text-secondary)] mb-2">
                  This list flows into Form 11 / MGT-7 / DIR-3 KYC each year. You can add more later in Settings.
                </p>
                <textarea
                  className="w-full text-[12px] p-2 rounded border border-[var(--pc-border-subtle)] bg-transparent font-mono"
                  rows={4}
                  placeholder={`Sourav Shaw, AAAAA0000A, 50000\nCo-Partner, BBBBB1111B, 50000`}
                  onBlur={(e) => {
                    const lines = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
                    const partners = lines.map((l) => {
                      const parts = l.split(",").map((p) => p.trim());
                      return {
                        name: parts[0] ?? "",
                        panNumber: parts[1] ?? "",
                        contributionPaise: parseInt((parts[2] ?? "0").replace(/[^0-9]/g, ""), 10) * 100,
                      };
                    });
                    updateField("partners", partners);
                    if (meta.requiresFields.includes("directors")) {
                      updateField("directors", partners.map((p, i) => ({ name: p.name, dinNumber: `DIN-${i + 1}` })));
                    }
                    if (meta.requiresFields.includes("designatedPartners")) {
                      updateField("designatedPartners", partners.map((p, i) => ({ name: p.name, dpinNumber: `DPIN-${i + 1}` })));
                    }
                  }}
                />
                <p className="text-[10px] text-[var(--pc-text-tertiary)] mt-1">
                  Format: <code>Name, PAN, Contribution-in-rupees</code> · one per line
                </p>
              </div>
            )}

            {/* Validation summary */}
            {!validation.valid && (validation.missing.length > 0 || validation.errors.length > 0) && (
              <div className="text-[12px] p-2 rounded bg-[var(--pc-state-warning)]/10 text-[var(--pc-state-warning)]">
                <div className="flex items-center gap-1 font-medium"><AlertTriangle size={12} /> Still need:</div>
                <ul className="mt-1 ml-4 list-disc">
                  {validation.missing.map((m) => <li key={m}>{m}</li>)}
                  {validation.errors.map((e, i) => <li key={i}>{e.field}: {e.message}</li>)}
                </ul>
              </div>
            )}

            <div className="flex justify-between mt-2">
              <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft size={14} /> Back</Button>
              <Button onClick={() => setStep(3)} disabled={!validation.valid}>
                Next: Migrate or skip <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </Glass>
      )}

      {/* Step 3: Migration (optional) */}
      {step === 3 && (
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="step-migrate">
            <h2 className="font-medium">Migrate from existing software (optional)</h2>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              We can import your customer master, product list, and bills from any of these. Skip if you're starting fresh.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {["Marg ERP", "Tally Prime", "Vyapar", "Medeil", "GoFrugal", "Generic CSV"].map((vendor) => (
                <Button key={vendor} variant="ghost"><Upload size={14} /> Import from {vendor}</Button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--pc-text-tertiary)] mt-2">
              You can also do this later from Settings → Migration. <strong>You can also export everything anytime</strong> — no vendor lock-in.
            </p>
            <div className="flex justify-between mt-2">
              <Button variant="ghost" onClick={() => setStep(2)}><ChevronLeft size={14} /> Back</Button>
              <Button onClick={finish} disabled={busy}>Skip & finish <ArrowRight size={14} /></Button>
            </div>
          </div>
        </Glass>
      )}

      {/* Step 4: Done */}
      {step === 4 && entityType && (
        <Glass>
          <div className="p-6 flex flex-col items-center gap-3 text-center" data-testid="step-done">
            <CheckCircle2 size={48} className="text-[var(--pc-state-success)]" />
            <h2 className="font-semibold text-[18px]">Setup complete</h2>
            <p className="text-[13px] text-[var(--pc-text-secondary)] max-w-md">
              Registered as <strong>{ENTITY_TYPES[entityType].displayName}</strong>.
              Annual compliance bundle will include {annualFilingsFor(entityType).length} filings.
              {isAuditRequired({ entityType, turnoverPaise: 0 }).required && " Statutory audit applies — please brief your CA."}
            </p>
            <Badge variant="success">Ready to bill</Badge>
          </div>
        </Glass>
      )}
    </div>
  );
}

interface FieldProps { label: string; children: React.ReactNode; wide?: boolean }
function Field({ label, children, wide = false }: FieldProps): React.ReactElement {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-[11px] text-[var(--pc-text-secondary)] font-medium">{label}</span>
      {children}
    </label>
  );
}
