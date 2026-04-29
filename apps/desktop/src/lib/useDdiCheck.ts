// useDdiCheck — React hook that wraps @pharmacare/formulary for BillingScreen.
//
// Drop-in usage:
//
//   const { alerts, hasBlocker, busy } = useDdiCheck({
//     basket: lines.map((l) => ({ productId: l.productId, ingredientIds: ingredientsByProduct[l.productId] ?? [] })),
//     customerId: selectedCustomer?.id,
//     patientAgeYears: selectedCustomer?.ageYears ?? 35,
//   });
//
//   if (alerts.length > 0) <DDIAlertModal alerts={alerts} onDismiss={...} onBlocked={...} />;
//   if (hasBlocker) disable the F10 / Save button.
//
// Real ingredient/allergy/dose data comes from @pharmacare/shared-db backed
// RPCs once they're wired. For now we stub from a tiny in-memory map so the
// hook is testable + the BillingScreen UX flow can be developed end-to-end.

import { useEffect, useMemo, useState } from "react";
import {
  checkAll, hasBlocker as fbHasBlocker,
  type FormularyAlert, type DdiPair, type CustomerAllergy, type DoseRange,
} from "@pharmacare/formulary";

export interface BasketItem {
  readonly productId: string;
  readonly ingredientIds: readonly string[];
  readonly perDoseMg?: number;
  readonly dailyMg?: number;
}

export interface UseDdiCheckArgs {
  readonly basket: readonly BasketItem[];
  readonly customerId?: string;
  readonly patientAgeYears?: number;
  /** Inject formulary table — caller fetches from @pharmacare/shared-db.
   *  When undefined, hook returns no alerts (defensive default). */
  readonly ddiTable?: readonly DdiPair[];
  readonly customerAllergies?: readonly CustomerAllergy[];
  readonly doseRanges?: readonly DoseRange[];
}

export interface UseDdiCheckResult {
  readonly alerts: readonly FormularyAlert[];
  readonly hasBlocker: boolean;
  readonly busy: boolean;
  readonly recheck: () => void;
}

export function useDdiCheck(args: UseDdiCheckArgs): UseDdiCheckResult {
  const [alerts, setAlerts] = useState<readonly FormularyAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Stable basket signature to avoid re-checking on referential-equality misses
  const sig = useMemo(() => {
    return args.basket.map((b) => `${b.productId}:${b.ingredientIds.join(",")}:${b.perDoseMg ?? ""}:${b.dailyMg ?? ""}`).join("|")
      + `||${args.customerId ?? ""}|${args.patientAgeYears ?? ""}`;
  }, [args.basket, args.customerId, args.patientAgeYears]);

  useEffect(() => {
    if (!args.ddiTable && !args.customerAllergies && !args.doseRanges) {
      // No formulary loaded — silent (defensive).
      setAlerts([]);
      return;
    }
    if (args.basket.length === 0) {
      setAlerts([]);
      return;
    }
    setBusy(true);
    // Synchronous in current impl, but kept async-shaped for future server-side checks.
    Promise.resolve().then(() => {
      const next = checkAll({
        customerId: args.customerId ?? "anon",
        patientAgeYears: args.patientAgeYears ?? 35,
        basket: args.basket,
        ddiTable: args.ddiTable ?? [],
        customerAllergies: args.customerAllergies ?? [],
        doseRanges: args.doseRanges ?? [],
      });
      setAlerts(next);
      setBusy(false);
    });
  }, [sig, args.ddiTable, args.customerAllergies, args.doseRanges, generation, args.basket, args.customerId, args.patientAgeYears]);

  return {
    alerts,
    hasBlocker: fbHasBlocker(alerts),
    busy,
    recheck: () => setGeneration((g) => g + 1),
  };
}
