// DDIAlertModal — fires when formulary engine flags ≥1 alert at line-add.
// Severity drives action:
//   block  → red banner, disable F10 save, owner-override required
//   warn   → amber, pharmacist must acknowledge
//   info   → green tint, auto-dismiss after 5s

import { useEffect } from "react";
import { AlertTriangle, ShieldAlert, Info, X } from "lucide-react";
import { Glass, Badge, Button } from "@pharmacare/design-system";
import { hasBlocker, type FormularyAlert } from "@pharmacare/formulary";

interface DDIAlertModalProps {
  alerts: readonly FormularyAlert[];
  onAcknowledge: () => void;
  onOwnerOverride?: () => void;
  onClose: () => void;
}

export default function DDIAlertModal({ alerts, onAcknowledge, onOwnerOverride, onClose }: DDIAlertModalProps): React.ReactElement | null {
  const blocking = hasBlocker(alerts);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !blocking) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [blocking, onClose]);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="ddi-title">
      <Glass>
        <div className="max-w-2xl w-full p-5 flex flex-col gap-3" data-testid="ddi-modal">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              {blocking
                ? <ShieldAlert size={20} className="text-[var(--pc-state-danger)] mt-0.5" />
                : <AlertTriangle size={20} className="text-[var(--pc-state-warning)] mt-0.5" />}
              <div>
                <h2 id="ddi-title" className="font-semibold text-[15px]">
                  {blocking ? "Clinical block" : "Clinical alert"}
                </h2>
                <p className="text-[12px] text-[var(--pc-text-secondary)]">
                  {alerts.length} alert{alerts.length === 1 ? "" : "s"} detected by formulary engine.
                </p>
              </div>
            </div>
            {!blocking && <Button variant="ghost" onClick={onClose}><X size={14} /></Button>}
          </div>

          <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {alerts.map((a, i) => (
              <li key={i} className="rounded border border-[var(--pc-border-subtle)] p-3 text-[13px]" data-testid={`alert-${a.kind}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={a.severity === "block" ? "danger" : a.severity === "warn" ? "warning" : "info"}>
                    {a.severity.toUpperCase()}
                  </Badge>
                  <span className="font-medium uppercase text-[11px] text-[var(--pc-text-tertiary)]">{a.kind}</span>
                </div>
                {a.kind === "ddi" && (
                  <>
                    <div><strong>{a.productA}</strong> ↔ <strong>{a.productB}</strong></div>
                    <div className="text-[var(--pc-text-secondary)]"><em>{a.ingredientA} + {a.ingredientB}</em></div>
                    {a.mechanism && <div className="mt-1"><span className="text-[var(--pc-text-tertiary)]">Mechanism:</span> {a.mechanism}</div>}
                    {a.clinicalEffect && <div className="mt-1"><span className="text-[var(--pc-text-tertiary)]">Clinical effect:</span> {a.clinicalEffect}</div>}
                  </>
                )}
                {a.kind === "allergy" && (
                  <>
                    <div><strong>{a.product}</strong> contains <strong>{a.ingredientId}</strong></div>
                    <div className="text-[var(--pc-text-secondary)]">Customer flagged allergy on {a.ingredientId}</div>
                  </>
                )}
                {a.kind === "dose" && (
                  <>
                    <div><strong>{a.product}</strong> — {a.reason}</div>
                    {a.observedMg !== undefined && a.limitMg !== undefined && (
                      <div className="text-[var(--pc-text-secondary)]">
                        observed {a.observedMg} mg vs limit {a.limitMg} mg
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="flex justify-end gap-2 border-t border-[var(--pc-border-subtle)] pt-3">
            {!blocking && <Button onClick={onAcknowledge}>I understand · proceed</Button>}
            {blocking && (
              <>
                <span className="text-[12px] text-[var(--pc-state-danger)] mr-auto self-center">
                  Save BLOCKED until owner overrides.
                </span>
                {onOwnerOverride && <Button onClick={onOwnerOverride}><Info size={12} /> Owner override</Button>}
                <Button variant="ghost" onClick={onClose}>Cancel basket</Button>
              </>
            )}
          </div>
        </div>
      </Glass>
    </div>
  );
}
