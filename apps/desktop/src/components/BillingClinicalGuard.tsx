// BillingClinicalGuard — single safety component BillingScreen wraps around its
// basket. Combines: DDI engine (formulary), generic-suggest (pmbjp), and
// counterfeit-shield results. Renders inline pills + a modal when blocking.
//
// Usage in BillingScreen:
//   <BillingClinicalGuard
//      basket={basketForGuard}
//      customer={selectedCustomer}
//      onSaveBlockedChange={setSaveBlocked}
//   />

import { useEffect, useMemo, useRef, useState } from "react";
import { Leaf, ShieldCheck } from "lucide-react";
import { Glass, Badge } from "@pharmacare/design-system";
import { listDdiPairsRpc, listCustomerAllergiesRpc, listDoseRangesRpc } from "../lib/ipc.js";
import { paise, formatINR, type Paise } from "@pharmacare/shared-types";
import { useDdiCheck, type BasketItem } from "../lib/useDdiCheck.js";
import DDIAlertModal from "./DDIAlertModal.js";
import { suggestGenerics, hasGenericAlternative, type BrandedDrugQuery, type GenericSuggestion } from "@pharmacare/pmbjp";
import type { DdiPair, CustomerAllergy, DoseRange } from "@pharmacare/formulary";

export interface ClinicalBasketLine extends BasketItem {
  /** Branded drug query for PMBJP suggestion */
  readonly brandedQuery?: BrandedDrugQuery;
  readonly productName?: string;
  /** S28-A1: Schedule class of the underlying product. When the basket
   *  contains any "H" | "H1" | "X" line, the guard surfaces the
   *  "Counseling required" banner that routes to CounselingScreen. */
  readonly scheduleClass?: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
}

interface BillingClinicalGuardProps {
  readonly basket: readonly ClinicalBasketLine[];
  readonly customer?: { id: string; ageYears?: number };
  /** Optional formulary tables — when omitted, DDI checks no-op (defensive). */
  readonly ddiTable?: readonly DdiPair[];
  readonly customerAllergies?: readonly CustomerAllergy[];
  readonly doseRanges?: readonly DoseRange[];
  /** Bubbles up to caller so the F10 / Save button can be disabled. */
  readonly onSaveBlockedChange?: (blocked: boolean) => void;
  /** S28-A1: invoked when the cashier clicks "Open Counseling" on the
   *  banner. BillingScreen wires this to its CounselingScreen route
   *  with the active bill_id. */
  readonly onOpenCounseling?: () => void;
}

export default function BillingClinicalGuard({
  basket, customer, ddiTable, customerAllergies, doseRanges, onSaveBlockedChange, onOpenCounseling,
}: BillingClinicalGuardProps): React.ReactElement | null {

  // S26.D — Wave 2 Agent C: hydrate formulary tables from IPC.
  // Caller-supplied props (ddiTable / customerAllergies / doseRanges) take
  // precedence (used by tests); when omitted we fetch live from Tauri.
  // DDI pairs are session-cached in a module-scoped ref — they don't change
  // per-bill. Allergies refetch on customer change. Dose-ranges pre-fetch
  // per-line as products are added.
  const [fetchedDdi, setFetchedDdi] = useState<readonly DdiPair[] | undefined>(undefined);
  const [fetchedAllergies, setFetchedAllergies] = useState<readonly CustomerAllergy[] | undefined>(undefined);
  const [fetchedDoses, setFetchedDoses] = useState<readonly DoseRange[] | undefined>(undefined);
  const ddiCacheRef = useRef<readonly DdiPair[] | null>(null);
  const doseCacheRef = useRef<Map<string, DoseRange | null>>(new Map());

  // DDI pairs — once per session.
  useEffect(() => {
    if (ddiTable !== undefined) return; // caller injected (tests) — skip IPC
    if (ddiCacheRef.current !== null) {
      setFetchedDdi(ddiCacheRef.current);
      return;
    }
    let cancelled = false;
    listDdiPairsRpc()
      .then((rows) => {
        if (cancelled) return;
        ddiCacheRef.current = rows;
        setFetchedDdi(rows);
      })
      .catch((err: unknown) => {
        // Graceful degradation per Playbook §12 — log + empty array.
        // BillingScreen flow continues; engine no-ops on empty DDI table.
        console.error("[BillingClinicalGuard] list_ddi_pairs failed:", err);
        if (!cancelled) {
          ddiCacheRef.current = [];
          setFetchedDdi([]);
        }
      });
    return () => { cancelled = true; };
  }, [ddiTable]);

  // Customer allergies — refetch when customer.id changes.
  useEffect(() => {
    if (customerAllergies !== undefined) return; // caller injected
    if (!customer?.id) {
      setFetchedAllergies([]);
      return;
    }
    let cancelled = false;
    listCustomerAllergiesRpc(customer.id)
      .then((rows) => { if (!cancelled) setFetchedAllergies(rows); })
      .catch((err: unknown) => {
        console.error("[BillingClinicalGuard] list_customer_allergies failed:", err);
        if (!cancelled) setFetchedAllergies([]);
      });
    return () => { cancelled = true; };
  }, [customer?.id, customerAllergies]);

  // Dose ranges — pre-fetch per current basket line. Cache by productId so
  // re-renders don't refetch. list_dose_ranges returns DoseRange | null per
  // product (null = no rule recorded).
  const productIdsKey = basket.map((l) => l.productId).filter(Boolean).join(",");
  useEffect(() => {
    if (doseRanges !== undefined) return; // caller injected
    let cancelled = false;
    const productIds = productIdsKey ? productIdsKey.split(",") : [];
    const missing = productIds.filter((pid) => !doseCacheRef.current.has(pid));
    if (missing.length === 0) {
      const collected: DoseRange[] = [];
      for (const pid of productIds) {
        const r = doseCacheRef.current.get(pid);
        if (r) collected.push(r);
      }
      setFetchedDoses(collected);
      return;
    }
    Promise.all(
      missing.map((pid) =>
        listDoseRangesRpc(pid)
          .then((r) => ({ pid, r }))
          .catch((err: unknown) => {
            console.error("[BillingClinicalGuard] list_dose_ranges failed for", pid, err);
            return { pid, r: null as DoseRange | null };
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      for (const { pid, r } of results) doseCacheRef.current.set(pid, r);
      const collected: DoseRange[] = [];
      for (const pid of productIds) {
        const r = doseCacheRef.current.get(pid);
        if (r) collected.push(r);
      }
      setFetchedDoses(collected);
    });
    return () => { cancelled = true; };
    // productIdsKey is a stable string projection of basket; that's the right
    // dep — using `basket` directly would re-fire on every parent re-render.
  }, [productIdsKey, doseRanges]);

  // Effective tables — caller-supplied wins; otherwise use the IPC-fetched ones.
  const effectiveDdi = ddiTable ?? fetchedDdi;
  const effectiveAllergies = customerAllergies ?? fetchedAllergies;
  const effectiveDoses = doseRanges ?? fetchedDoses;

  // DDI / allergy / dose
  const { alerts, hasBlocker } = useDdiCheck({
    basket,
    ...(customer?.id !== undefined ? { customerId: customer.id } : {}),
    ...(customer?.ageYears !== undefined ? { patientAgeYears: customer.ageYears } : {}),
    ...(effectiveDdi !== undefined ? { ddiTable: effectiveDdi } : {}),
    ...(effectiveAllergies !== undefined ? { customerAllergies: effectiveAllergies } : {}),
    ...(effectiveDoses !== undefined ? { doseRanges: effectiveDoses } : {}),
  });

  const [modalOpen, setModalOpen] = useState(true);
  const [overridden, setOverridden] = useState(false);

  // PMBJP suggestions
  const suggestions = useMemo<readonly GenericSuggestion[]>(() => {
    const out: GenericSuggestion[] = [];
    for (const line of basket) {
      if (!line.brandedQuery) continue;
      if (!hasGenericAlternative(line.brandedQuery)) continue;
      const best = suggestGenerics(line.brandedQuery)[0];
      if (best) out.push(best);
    }
    return out;
  }, [basket]);

  // Bubble blocked state — must run as an effect so we don't trigger a parent
  // setState during render of this child.
  const blocked = hasBlocker && !overridden;
  useEffect(() => {
    onSaveBlockedChange?.(blocked);
  }, [blocked, onSaveBlockedChange]);

  // S28-A1: Schedule-H counseling required indicator. Drawn from
  // basket lines whose scheduleClass is H/H1/X. Pure derivation --
  // does NOT issue an IPC call (the per-line schedule must be passed
  // by BillingScreen because it already has the product row); the
  // canonical save_bill gate runs server-side regardless.
  const scheduledLines = basket.filter((l) =>
    l.scheduleClass === "H" || l.scheduleClass === "H1" || l.scheduleClass === "X",
  );
  const counselingRequired = scheduledLines.length > 0;

  if (
    alerts.length === 0 &&
    suggestions.length === 0 &&
    !counselingRequired
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="billing-clinical-guard">
      {/* S28-A1: Schedule-H counseling-required banner -- blocks bill close */}
      {counselingRequired && (
        <div
          className="counsel-required-banner"
          data-testid="counsel-required-banner"
          role="alert"
        >
          <div className="counsel-required-banner__text">
            <strong>Counseling required</strong> -- this bill has{" "}
            {scheduledLines.length} Schedule-H/H1/X line
            {scheduledLines.length === 1 ? "" : "s"}. Pharmacist must counsel
            the patient before bill close (D&amp;C s.22 / s.27).
          </div>
          <button
            type="button"
            className="counsel-required-banner__cta"
            onClick={() => onOpenCounseling?.()}
            data-testid="counsel-open-button"
          >
            Open Counseling
          </button>
        </div>
      )}
      {/* Generic-suggestion banner — non-blocking */}
      {suggestions.length > 0 && (
        <Glass>
          <div className="p-3 flex items-start gap-2 text-[13px]">
            <Leaf size={14} className="mt-0.5 text-[var(--pc-state-success)]" aria-hidden />
            <div>
              <div className="font-medium">
                Jan Aushadhi alternative{suggestions.length === 1 ? "" : "s"} available — could save{" "}
                <span className="font-mono tabular-nums">
                  {formatINR(paise(suggestions.reduce((s, g) => s + (g.savingsPaise as number), 0)))}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-[12px] text-[var(--pc-text-secondary)]">
                {suggestions.slice(0, 3).map((g) => (
                  <li key={g.suggested.drugCode}>
                    <strong>{g.originalQuery.molecule}</strong> {g.originalQuery.strength} →{" "}
                    <strong>{g.suggested.molecule}</strong> {g.suggested.strength}{" "}
                    <Badge variant="success">save {formatINR(g.savingsPaise)} ({g.savingsPct}%)</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Glass>
      )}

      {/* Clinical alerts summary pill (modal renders separately when needed) */}
      {alerts.length > 0 && !modalOpen && (
        <Glass>
          <div className="p-3 flex items-center justify-between text-[13px]">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} aria-hidden />
              <span>{alerts.length} clinical alert{alerts.length === 1 ? "" : "s"} acknowledged</span>
              {blocked && <Badge variant="danger">SAVE BLOCKED</Badge>}
              {overridden && <Badge variant="warning">OWNER OVERRIDE ACTIVE</Badge>}
            </div>
            <button onClick={() => setModalOpen(true)} className="text-[var(--pc-brand-primary)] hover:underline text-[12px]">
              Re-open
            </button>
          </div>
        </Glass>
      )}

      {alerts.length > 0 && modalOpen && (
        <DDIAlertModal
          alerts={alerts}
          onAcknowledge={() => setModalOpen(false)}
          onOwnerOverride={() => { setOverridden(true); setModalOpen(false); }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
