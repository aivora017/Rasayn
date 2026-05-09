// CounselingScreen — S28-A1, ADR-0073.
//
// Schedule-H mandatory counseling log. The cashier reaches this screen
// either (a) directly from BillingClinicalGuard's "Counseling required"
// banner, or (b) from save_bill's COUNSELING_INCOMPLETE error which
// AppShell intercepts and routes here with the bill_id pre-filled.
//
// Flow:
//   1. checkCounselingCompleteRpc(bill_id) -> list of missing drugs.
//   2. For each missing drug: render a card with:
//        - drug name + schedule class (H/H1/X) badge,
//        - notes textarea,
//        - patient-consented checkbox (must be checked to save),
//        - "Log counseling" button -> logCounselingRpc.
//   3. After all drugs are cleared, the "Continue to bill close" button
//      enables; clicking it dispatches `onComplete` (or, when used as a
//      stand-alone screen, calls window.history.back()).
//
// D&C s.22/s.27 + Rules 1945 r.65 — no soft warning. The cashier UI
// MUST hard-block the bill close until every Schedule-H/H1/X line has
// a counsel_log row.

import { useEffect, useState, useCallback } from "react";
import {
  checkCounselingCompleteRpc,
  logCounselingRpc,
  type MissingCounselDTO,
} from "../lib/ipc.js";

export interface CounselingScreenProps {
  /** AppShell convention. Defaults to true. */
  readonly visible?: boolean;
  /** Bill being closed. When omitted, screen renders an empty
   *  "no active bill" state — used by direct sidebar nav. */
  readonly billId?: string;
  /** Active cashier / RPh — used as `counselor_user_id`. */
  readonly counselorUserId?: string;
  /** Optional callback fired once all H/H1/X drugs have been counseled. */
  readonly onComplete?: () => void;
}

interface DrugFormState {
  readonly notes: string;
  readonly consent: boolean;
  readonly saving: boolean;
  readonly saved: boolean;
  readonly error: string | null;
}

const EMPTY_FORM: DrugFormState = {
  notes: "",
  consent: false,
  saving: false,
  saved: false,
  error: null,
};

export default function CounselingScreen({
  visible = true,
  billId,
  counselorUserId,
  onComplete,
}: CounselingScreenProps): React.ReactElement | null {
  const [missing, setMissing] = useState<readonly MissingCounselDTO[] | null>(null);
  const [forms, setForms] = useState<Record<string, DrugFormState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  // Load missing-counsel list on mount + after each successful save.
  useEffect(() => {
    if (!visible) return;
    if (!billId) {
      setMissing([]);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    checkCounselingCompleteRpc(billId)
      .then((rows) => {
        if (cancelled) return;
        setMissing(rows);
        // Initialise per-drug form state for any new drugs.
        setForms((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            if (!(r.drugId in next)) next[r.drugId] = EMPTY_FORM;
          }
          return next;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [billId, visible, reloadKey]);

  const updateForm = useCallback(
    (drugId: string, patch: Partial<DrugFormState>) => {
      setForms((prev) => ({
        ...prev,
        [drugId]: { ...(prev[drugId] ?? EMPTY_FORM), ...patch },
      }));
    },
    [],
  );

  const handleSave = useCallback(
    async (drug: MissingCounselDTO) => {
      if (!billId) return;
      const f = forms[drug.drugId] ?? EMPTY_FORM;
      if (!f.consent) {
        updateForm(drug.drugId, { error: "Patient consent is required to save" });
        return;
      }
      updateForm(drug.drugId, { saving: true, error: null });
      try {
        const trimmedNotes = f.notes.trim();
        await logCounselingRpc({
          billId,
          drugId: drug.drugId,
          drugName: drug.drugName,
          scheduleClass: drug.scheduleClass,
          patientConsented: true,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
          ...(counselorUserId ? { counselorUserId } : {}),
        });
        updateForm(drug.drugId, { saving: false, saved: true });
        // Trigger reload of the missing-list — the saved drug should
        // disappear, and "Continue to bill close" enables when empty.
        setReloadKey((k) => k + 1);
      } catch (err: unknown) {
        updateForm(drug.drugId, { saving: false, error: String(err) });
      }
    },
    [billId, forms, counselorUserId, updateForm],
  );

  const allClear = missing !== null && missing.length === 0;

  if (!visible) return null;

  return (
    <div
      className="screen-shell"
      data-screen="counselingscreen"
      data-status="real"
      data-testid="counseling-screen"
    >
      <header className="screen-header">
        <h1 className="screen-title">Patient Counseling Records</h1>
        <span className="screen-status-pill" data-testid="counsel-pill">
          {allClear ? "ALL CLEAR" : "ACTION REQUIRED"}
        </span>
      </header>

      {!billId && (
        <div className="screen-empty" data-testid="counsel-no-bill">
          <p className="screen-empty__title">No active bill selected</p>
          <p className="screen-empty__sub">
            Counseling is logged per-bill. Open Counseling from the
            Billing screen when an H/H1/X line is added.
          </p>
        </div>
      )}

      {billId && loadError && (
        <div className="screen-error" data-testid="counsel-load-error">
          Failed to load missing-counsel list: {loadError}
        </div>
      )}

      {billId && missing && missing.length === 0 && (
        <div className="screen-empty" data-testid="counsel-all-done">
          <p className="screen-empty__title">Counseling complete</p>
          <p className="screen-empty__sub">
            All Schedule-H/H1/X drugs in this bill have been counseled.
            You may now close the bill.
          </p>
          <button
            type="button"
            className="screen-cta"
            data-testid="counsel-continue"
            onClick={() => {
              if (onComplete) onComplete();
              else if (typeof window !== "undefined") window.history.back();
            }}
          >
            Continue to bill close
          </button>
        </div>
      )}

      {billId && missing && missing.length > 0 && (
        <ul className="counsel-list" data-testid="counsel-list">
          {missing.map((d) => {
            const f = forms[d.drugId] ?? EMPTY_FORM;
            const drugTestId = `counsel-card-${d.drugId}`;
            return (
              <li key={d.drugId} className="counsel-card" data-testid={drugTestId}>
                <header className="counsel-card__head">
                  <span className="counsel-card__name">{d.drugName}</span>
                  <span
                    className={`counsel-card__sched counsel-card__sched--${d.scheduleClass.toLowerCase()}`}
                    data-testid={`counsel-sched-${d.drugId}`}
                  >
                    Schedule {d.scheduleClass}
                  </span>
                </header>
                <label className="counsel-card__field">
                  <span>Counseling notes (optional)</span>
                  <textarea
                    rows={3}
                    value={f.notes}
                    onChange={(e) => updateForm(d.drugId, { notes: e.target.value })}
                    placeholder="e.g. Take with food. Avoid alcohol. Side-effects discussed."
                    data-testid={`counsel-notes-${d.drugId}`}
                  />
                </label>
                <label className="counsel-card__consent">
                  <input
                    type="checkbox"
                    checked={f.consent}
                    onChange={(e) => updateForm(d.drugId, { consent: e.target.checked, error: null })}
                    data-testid={`counsel-consent-${d.drugId}`}
                  />
                  <span>Patient acknowledged the counseling</span>
                </label>
                {f.error && (
                  <p className="counsel-card__error" data-testid={`counsel-error-${d.drugId}`}>
                    {f.error}
                  </p>
                )}
                <button
                  type="button"
                  className="counsel-card__save"
                  disabled={!f.consent || f.saving}
                  onClick={() => handleSave(d)}
                  data-testid={`counsel-save-${d.drugId}`}
                >
                  {f.saving ? "Saving..." : "Log counseling"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
