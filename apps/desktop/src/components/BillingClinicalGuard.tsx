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

import { useEffect, useMemo, useState } from "react";
import { Leaf, ShieldCheck } from "lucide-react";
import { Glass, Badge } from "@pharmacare/design-system";
import { paise, formatINR, type Paise } from "@pharmacare/shared-types";
import { useDdiCheck, type BasketItem } from "../lib/useDdiCheck.js";
import DDIAlertModal from "./DDIAlertModal.js";
import { suggestGenerics, hasGenericAlternative, type BrandedDrugQuery, type GenericSuggestion } from "@pharmacare/pmbjp";
import type { DdiPair, CustomerAllergy, DoseRange } from "@pharmacare/formulary";

export interface ClinicalBasketLine extends BasketItem {
  /** Branded drug query for PMBJP suggestion */
  readonly brandedQuery?: BrandedDrugQuery;
  readonly productName?: string;
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
}

export default function BillingClinicalGuard({
  basket, customer, ddiTable, customerAllergies, doseRanges, onSaveBlockedChange,
}: BillingClinicalGuardProps): React.ReactElement | null {

  // DDI / allergy / dose
  const { alerts, hasBlocker } = useDdiCheck({
    basket,
    ...(customer?.id !== undefined ? { customerId: customer.id } : {}),
    ...(customer?.ageYears !== undefined ? { patientAgeYears: customer.ageYears } : {}),
    ...(ddiTable !== undefined ? { ddiTable } : {}),
    ...(customerAllergies !== undefined ? { customerAllergies } : {}),
    ...(doseRanges !== undefined ? { doseRanges } : {}),
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

  if (alerts.length === 0 && suggestions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="billing-clinical-guard">
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
