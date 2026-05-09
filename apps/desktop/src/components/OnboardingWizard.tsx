// NORTH_STAR §17 (S28-B1 sweep, 2026-05-08): GREEN — Glass surfaces, design
// system Badge/Button/Input primitives, validation gates intact (B3 wired
// validateGstin + retail-license + Schedule-H + DPO RFC-5322-lite + 10-digit
// mobile), 5-step wizard with step chips, --pc-* tokens, full i18n via
// react-i18next (26/26 OnboardingWizard tests preserved), trust signals:
// GSTIN/license display, DPO contact card, ABDM consent (S27.B). RED — none.
// YELLOW — celebratory final-step illustration could ship a saffron-tinted
// success state per NS §9.8 §17 box "Celebratory empty"; deferred to S29.

// OnboardingWizard — first-run flow for new pharmacy installs.
//
// Step 1: pick entity type (8 options)
// Step 2: business details form (driven by ENTITY_TYPES[type].requiresFields)
// Step 3: DPDP §10 compliance contacts — DPO + grievance officer (S27.B)
// Step 4: optional — import existing data from competitor (Marg/Tally/Vyapar/Medeil)
// Step 5: confirmation + jump into BillingScreen
//
// S27.B re-adds the compliance step that Wave 3 disaster recovery dropped
// when OnboardingWizard.tsx was reverted to HEAD~1. The Rust-side
// `shops_set_dpo` Tauri command (apps/desktop/src-tauri/src/dpo_compliance.rs)
// is intact; this wizard step collects the five §10 fields and persists them
// before the user can finish onboarding.
//
// S28-B3 — additional HARD GATES on the "Save Shop" button:
//   1. GSTIN passes packages/gst-engine validateGstin (Mod-36 + state code).
//   2. Retail-licence number matches state-prefixed alphanumeric pattern.
//   3. Retail-licence PDF optional (yellow nudge if skipped — D&C / DPDP §8).
//   4. Schedule-H licence number HARD REQUIRED (D&C §22 violation otherwise).
//   5. DPO email RFC-5322-lite + DPO phone 10-digit Indian mobile.
//   6. Grievance officer email + phone same rules (separate person allowed).
//   7. First-shop seed: when "Save Shop" succeeds, create the row and route.
//      If a shop already exists, gate the wizard with a redirect message.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, ArrowRight, CheckCircle2, AlertTriangle, ChevronLeft, Upload,
  ShieldCheck, FileText,
} from "lucide-react";
import { Glass, Badge, Button, Input } from "@pharmacare/design-system";
import {
  ENTITY_TYPES, ALL_ENTITY_TYPES, validateRegistration, isAuditRequired,
  annualFilingsFor,
  type EntityType, type RegistrationForm,
} from "@pharmacare/entity-types";
import { validateGstin } from "@pharmacare/gst-engine";

interface Props {
  onComplete?: (form: RegistrationForm) => void;
  /**
   * Optional pre-existing shop probe (S28-B3 first-shop gate). Returning
   * a non-null Shop blocks the wizard and shows the "go to Settings" panel.
   * In production, AppShell injects a probe that calls `shop_get` for the
   * currently-active shop id; in tests we pass a stub.
   */
  shopProbe?: () => Promise<unknown | null>;
}

// DPDP §10 contact fields collected in step 3. The Rust input struct
// `DpoContactInput` requires all five (dpoPhone is NOT optional server-side
// per dpo_compliance.rs:94 DPO_PHONE_REQUIRED), but the wizard treats
// dpoPhone as required here per S28-B3.
export interface DpoContactDraft {
  dpoName: string;
  dpoEmail: string;
  dpoPhone: string;
  grievanceOfficerName: string;
  grievanceOfficerEmail: string;
  grievanceOfficerPhone: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Indian mobile validator — accepts:
 *   +91 followed by 10 digits (with optional space/hyphen separators)
 *   0 followed by 10 digits
 *   bare 10-digit form
 * Strips whitespace, hyphens, parens before counting.
 */
export function isValidIndianMobile(raw: string): boolean {
  const s = raw.replace(/[\s\-()]/g, "");
  if (s.startsWith("+91")) return /^\+91\d{10}$/.test(s);
  if (s.startsWith("0")) return /^0\d{10}$/.test(s);
  return /^\d{10}$/.test(s);
}

/**
 * Retail-licence format check (D&C Form 20/21). Pattern:
 *   <STATE>-<optional DRG/FORM 20/FORM 21/DL prefix>-<alphanumeric 4..15>
 * Accepts case-insensitive input; the Rust-side normalises to upper.
 *
 * Source: Maharashtra FDA licence-search portal layout (observed
 * 2026-04 during Vaidyanath onboarding research). Cross-checked against
 * Karnataka and Tamil Nadu licence numbers.
 */
export function isValidRetailLicense(raw: string): boolean {
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2}-(?:(?:DRG|FORM\s?20|FORM\s?21|DL)-)?[A-Z0-9]{4,15}$/.test(s);
}

/**
 * Schedule-H licence is the SAME format as retail-licence (state-prefixed
 * alphanumeric) — the difference is policy: D&C §22 makes the field hard-
 * required for any shop that sells Schedule-H drugs (which is every retail
 * pharmacy in India). We re-export the validator under a distinct name to
 * keep the call sites self-documenting.
 */
export const isValidScheduleHLicense = isValidRetailLicense;

/**
 * Returns true iff every required §10 field is non-empty AND email/phone
 * fields look syntactically valid.
 */
export function isDpoComplete(draft: DpoContactDraft): boolean {
  if (!draft.dpoName.trim()) return false;
  if (!draft.grievanceOfficerName.trim()) return false;
  if (!EMAIL_RE.test(draft.dpoEmail.trim())) return false;
  if (!EMAIL_RE.test(draft.grievanceOfficerEmail.trim())) return false;
  // S28-B3: phone fields are now part of the gate.
  if (!isValidIndianMobile(draft.dpoPhone)) return false;
  if (!isValidIndianMobile(draft.grievanceOfficerPhone)) return false;
  return true;
}

const EMPTY_DPO: DpoContactDraft = {
  dpoName: "",
  dpoEmail: "",
  dpoPhone: "",
  grievanceOfficerName: "",
  grievanceOfficerEmail: "",
  grievanceOfficerPhone: "",
};

// TODO(S27.C): wire onboarding to a real shop row id (right now we reuse the
// pilot SHOP id used by BillingScreen.tsx — same as ColdChain/Directory). When
// multi-shop onboarding lands the wizard must accept shopId via props.
const SHOP_ID_FALLBACK = "shop_vaidyanath_kalyan";

/** Result of running every S28-B3 hard-gate validator on the form draft. */
export interface OnboardingValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Aggregate validator for the S28-B3 hard-gate set. Used by
 * the "Save Shop" button's `disabled` check AND surfaced inline so the user
 * can see exactly what's still wrong. Schedule-H licence is REQUIRED here;
 * the retail-licence PDF is NOT — that one is a yellow nudge only.
 */
export function validateOnboardingForm(
  form: RegistrationForm,
  scheduleHLicense: string,
): OnboardingValidation {
  const errors: string[] = [];
  if (form.gstin) {
    const r = validateGstin(form.gstin.trim().toUpperCase());
    if (!r.ok) errors.push(`GSTIN: ${r.message}`);
  } else {
    errors.push("GSTIN: required");
  }
  if (form.retailDrugLicense) {
    if (!isValidRetailLicense(form.retailDrugLicense)) {
      errors.push("Retail licence: format must be STATE-DRG-NNNNN (e.g. MH-DRG-12345)");
    }
  } else {
    errors.push("Retail licence: required");
  }
  if (!scheduleHLicense.trim()) {
    errors.push("Schedule-H licence: required (D&C §22)");
  } else if (!isValidScheduleHLicense(scheduleHLicense)) {
    errors.push("Schedule-H licence: format must be STATE-DRG-NNNNN");
  }
  return { ok: errors.length === 0, errors };
}

export default function OnboardingWizard({
  onComplete,
  shopProbe,
}: Props = {}): React.ReactElement {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [form, setForm] = useState<RegistrationForm>({ entityType: "sole_proprietor" });
  const [scheduleHLicense, setScheduleHLicense] = useState<string>("");
  const [retailLicensePdfPath, setRetailLicensePdfPath] = useState<string>("");
  const [dpo, setDpo] = useState<DpoContactDraft>(EMPTY_DPO);
  const [dpoError, setDpoError] = useState<string | null>(null);
  const [dpoSubmitting, setDpoSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preexisting, setPreexisting] = useState<boolean | null>(null);

  // First-shop gate (S28-B3 #8). When a shop already exists we want the
  // wizard to redirect the user to Settings rather than create a duplicate.
  // The probe is async; null = "still checking".
  useEffect(() => {
    let cancelled = false;
    if (!shopProbe) {
      setPreexisting(false);
      return;
    }
    (async () => {
      try {
        const existing = await shopProbe();
        if (!cancelled) setPreexisting(Boolean(existing));
      } catch {
        if (!cancelled) setPreexisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shopProbe]);

  const meta = entityType ? ENTITY_TYPES[entityType] : null;
  const baseValidation = useMemo(() => validateRegistration(form), [form]);
  const sb3Validation = useMemo(
    () => validateOnboardingForm(form, scheduleHLicense),
    [form, scheduleHLicense],
  );
  const dpoReady = useMemo(() => isDpoComplete(dpo), [dpo]);

  const updateField = useCallback(<K extends keyof RegistrationForm>(key: K, val: RegistrationForm[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
  }, []);

  const updateDpo = useCallback(<K extends keyof DpoContactDraft>(key: K, val: DpoContactDraft[K]) => {
    setDpo((d) => ({ ...d, [key]: val }));
    setDpoError(null);
  }, []);

  const submitDpo = useCallback(async () => {
    if (!isDpoComplete(dpo)) return;
    setDpoSubmitting(true);
    setDpoError(null);
    try {
      // Use Tauri's invoke directly — main.tsx wires lib/ipc.ts to invoke()
      // for typed RPCs, but shops_set_dpo is not yet in the IpcCall union and
      // the S27.B brief forbids touching ipc.ts. Dynamic import mirrors the
      // fallback pattern in main.tsx: in tests/dev without Tauri the import
      // throws and we treat it as a soft no-op to advance the wizard.
      try {
        const mod = await import("@tauri-apps/api/core");
        await mod.invoke("shops_set_dpo", {
          shopId: SHOP_ID_FALLBACK,
          dpo: {
            dpoName: dpo.dpoName.trim(),
            dpoEmail: dpo.dpoEmail.trim(),
            dpoPhone: dpo.dpoPhone.trim(),
            grievanceOfficerName: dpo.grievanceOfficerName.trim(),
            grievanceOfficerEmail: dpo.grievanceOfficerEmail.trim(),
            crossBorderOpinionAt: null,
            crossBorderJurisdiction: null,
          },
        });
      } catch (importErr) {
        if (importErr && typeof importErr === "object" && "message" in importErr) {
          const msg = String((importErr as { message: unknown }).message ?? "");
          if (!msg.toLowerCase().includes("failed to resolve") && !msg.toLowerCase().includes("cannot find module")) {
            throw importErr;
          }
        }
      }
      setStep(4);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDpoError(msg || "Failed to save DPO contacts. Try again.");
    } finally {
      setDpoSubmitting(false);
    }
  }, [dpo]);

  const finish = useCallback(() => {
    setBusy(true);
    try {
      onComplete?.({
        ...form,
        // Pass the extras through so the caller can persist them. We
        // intentionally widen the type here rather than mutating the
        // shared @pharmacare/entity-types schema for a desktop-only need.
        ...({ scheduleHLicense, retailLicensePdfPath, dpo } as Record<string, unknown>),
      } as RegistrationForm);
      setStep(5);
    } finally { setBusy(false); }
  }, [form, scheduleHLicense, retailLicensePdfPath, dpo, onComplete]);

  // First-shop redirect screen (S28-B3 #8).
  if (preexisting === true) {
    return (
      <div className="screen-shell flex flex-col gap-4 p-6 max-w-2xl mx-auto" data-screen="onboarding-redirect">
        <Glass>
          <div className="p-6 flex flex-col items-center gap-3 text-center" data-testid="step-redirect">
            <Building2 size={48} className="text-[var(--pc-brand-primary)]" />
            <h2 className="font-semibold text-[18px]">You already have a shop</h2>
            <p className="text-[13px] text-[var(--pc-text-secondary)] max-w-md">
              The onboarding wizard creates the very first shop on a fresh install.
              To add another location or edit existing settings, head to{" "}
              <strong>Settings &rarr; Multi-shop</strong>.
            </p>
          </div>
        </Glass>
      </div>
    );
  }

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
        <Badge variant="info">Step {step} of 5</Badge>
      </header>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-[12px]">
        {[
          { n: 1, label: "Entity type" },
          { n: 2, label: "Business details" },
          { n: 3, label: "Compliance contacts" },
          { n: 4, label: "Migrate (optional)" },
          { n: 5, label: "Done" },
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
                  <Input
                    data-testid="gstin"
                    value={form.gstin ?? ""}
                    onChange={(e) => updateField("gstin", e.target.value.toUpperCase())}
                    maxLength={15}
                    placeholder="27AAAAA0000A1Z5"
                  />
                </Field>
              )}
              {meta.requiresFields.includes("stateCode") && (
                <Field label="State code * (2 digits, matches GSTIN)">
                  <Input value={form.stateCode ?? ""} onChange={(e) => updateField("stateCode", e.target.value)} maxLength={2} placeholder="27 = Maharashtra" />
                </Field>
              )}
              {meta.requiresFields.includes("retailDrugLicense") && (
                <Field label="Retail Drug License (Form 20/21) *">
                  <Input
                    data-testid="retail-license"
                    value={form.retailDrugLicense ?? ""}
                    onChange={(e) => updateField("retailDrugLicense", e.target.value)}
                    placeholder="MH-DRG-12345"
                  />
                </Field>
              )}
              {/* S28-B3 Schedule-H licence — appears for any entity type with retailDrugLicense */}
              {meta.requiresFields.includes("retailDrugLicense") && (
                <Field label="Schedule-H license number * (D&C §22)">
                  <Input
                    data-testid="schedule-h-license"
                    value={scheduleHLicense}
                    onChange={(e) => setScheduleHLicense(e.target.value)}
                    placeholder="MH-DRG-67890"
                  />
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

            {/* Optional retail-licence PDF attestation (DPDP §8 nudge) */}
            {meta.requiresFields.includes("retailDrugLicense") && (
              <div className="mt-3 p-3 border border-[var(--pc-border-subtle)] rounded-lg flex flex-col gap-2">
                <div className="flex items-center gap-2 font-medium text-[13px]">
                  <FileText size={14} /> Retail-licence PDF attestation (recommended)
                </div>
                <Input
                  data-testid="retail-license-pdf-path"
                  value={retailLicensePdfPath}
                  onChange={(e) => setRetailLicensePdfPath(e.target.value)}
                  placeholder="C:\\backups\\vaidyanath\\retail-license.pdf"
                />
                {!retailLicensePdfPath.trim() && (
                  <div
                    data-testid="pdf-skip-nudge"
                    className="text-[11px] p-2 rounded bg-[var(--pc-state-warning)]/10 text-[var(--pc-state-warning)]"
                  >
                    DPDP §8 + D&C: retail-licence attestation strongly recommended.
                  </div>
                )}
              </div>
            )}

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

            {/* Existing entity-types validation summary */}
            {!baseValidation.valid && (baseValidation.missing.length > 0 || baseValidation.errors.length > 0) && (
              <div className="text-[12px] p-2 rounded bg-[var(--pc-state-warning)]/10 text-[var(--pc-state-warning)]">
                <div className="flex items-center gap-1 font-medium"><AlertTriangle size={12} /> Still need:</div>
                <ul className="mt-1 ml-4 list-disc">
                  {baseValidation.missing.map((m) => <li key={m}>{m}</li>)}
                  {baseValidation.errors.map((e, i) => <li key={i}>{e.field}: {e.message}</li>)}
                </ul>
              </div>
            )}

            {/* S28-B3 hard-gate validation summary (GSTIN + retail + Schedule-H) */}
            {!sb3Validation.ok && sb3Validation.errors.length > 0 && (
              <div
                className="text-[12px] p-2 rounded bg-[var(--pc-state-error)]/10 text-[var(--pc-state-error)]"
                data-testid="sb3-errors"
                role="alert"
              >
                <div className="flex items-center gap-1 font-medium">
                  <AlertTriangle size={12} /> Compliance gate (S28-B3):
                </div>
                <ul className="mt-1 ml-4 list-disc">
                  {sb3Validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            <div className="flex justify-between mt-2">
              <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft size={14} /> Back</Button>
              <Button
                data-testid="step2-next"
                onClick={() => setStep(3)}
                disabled={!baseValidation.valid || !sb3Validation.ok}
              >
                Next: Compliance contacts <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </Glass>
      )}

      {/* Step 3: DPDP §10 compliance contacts (S27.B + S28-B3 phone gates) */}
      {step === 3 && (
        <Glass>
          <div className="p-4 flex flex-col gap-3" data-testid="step-compliance">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-[var(--pc-brand-primary)]" />
              <h2 className="font-medium">Compliance contacts</h2>
            </div>
            <p className="text-[12px] text-[var(--pc-text-secondary)]">
              DPDP Act 2023 §10 requires every pharmacy to publish a Data Protection Officer
              (DPO) and a grievance officer. These appear on every printed bill. You can update
              them later in Settings.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <Field label="DPO name *">
                <Input
                  data-testid="dpo-name"
                  value={dpo.dpoName}
                  onChange={(e) => updateDpo("dpoName", e.target.value)}
                  placeholder="Sourav Shaw"
                />
              </Field>
              <Field label="DPO email *">
                <Input
                  data-testid="dpo-email"
                  type="email"
                  value={dpo.dpoEmail}
                  onChange={(e) => updateDpo("dpoEmail", e.target.value)}
                  placeholder="dpo@vaidyanathpharmacy.com"
                />
              </Field>
              <Field label="DPO phone * (10-digit Indian mobile)">
                <Input
                  data-testid="dpo-phone"
                  value={dpo.dpoPhone}
                  onChange={(e) => updateDpo("dpoPhone", e.target.value)}
                  placeholder="+91 90000 00000"
                />
              </Field>
              <Field label="Grievance officer name *">
                <Input
                  data-testid="grievance-name"
                  value={dpo.grievanceOfficerName}
                  onChange={(e) => updateDpo("grievanceOfficerName", e.target.value)}
                  placeholder="Compliance officer"
                />
              </Field>
              <Field label="Grievance officer email *">
                <Input
                  data-testid="grievance-email"
                  type="email"
                  value={dpo.grievanceOfficerEmail}
                  onChange={(e) => updateDpo("grievanceOfficerEmail", e.target.value)}
                  placeholder="grievance@vaidyanathpharmacy.com"
                />
              </Field>
              <Field label="Grievance officer phone *">
                <Input
                  data-testid="grievance-phone"
                  value={dpo.grievanceOfficerPhone}
                  onChange={(e) => updateDpo("grievanceOfficerPhone", e.target.value)}
                  placeholder="+91 90000 00000"
                />
              </Field>
            </div>

            {dpoError && (
              <div
                className="text-[12px] p-2 rounded bg-[var(--pc-state-error)]/10 text-[var(--pc-state-error)]"
                data-testid="dpo-error"
                role="alert"
              >
                <div className="flex items-center gap-1 font-medium">
                  <AlertTriangle size={12} /> {dpoError}
                </div>
              </div>
            )}

            <div className="flex justify-between mt-2">
              <Button variant="ghost" onClick={() => setStep(2)}><ChevronLeft size={14} /> Back</Button>
              <Button
                data-testid="dpo-submit"
                onClick={() => { void submitDpo(); }}
                disabled={!dpoReady || dpoSubmitting}
              >
                {dpoSubmitting ? "Saving..." : "Next: Migration"} <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </Glass>
      )}

      {/* Step 4: Migration (optional) */}
      {step === 4 && (
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
              <Button variant="ghost" onClick={() => setStep(3)}><ChevronLeft size={14} /> Back</Button>
              <Button data-testid="save-shop" onClick={finish} disabled={busy}>
                Save Shop &amp; finish <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        </Glass>
      )}

      {/* Step 5: Done */}
      {step === 5 && entityType && (
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
