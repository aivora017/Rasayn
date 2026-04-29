import { useEffect } from "react";
// SCAFFOLD — generated 2026-04-28 from MASTER_PLAN_v3.
// Verify customer ABHA number via NHA gateway + push dispensation as FHIR R4 MedicationDispense.
// Backing package: @pharmacare/abdm
// See SCAFFOLD_INDEX.md for the full feature → file map.

export interface ABHAVerifyModalProps {
  /** Mode the AppShell passes when navigating to this screen. */
  readonly visible?: boolean;
}

export default function ABHAVerifyModal({ visible = true }: ABHAVerifyModalProps) {
  useEffect(() => {
    if (!visible) return;
    // TODO(ABHAVerifyModal): preload data via @pharmacare/abdm
  }, [visible]);

  return (
    <div className="screen-shell" data-screen="abhaverifymodal" data-status="scaffold">
      <header className="screen-header">
        <h1 className="screen-title">ABHA Verification</h1>
        <span className="screen-status-pill scaffold">SCAFFOLD</span>
      </header>
      <div className="screen-empty">
        <p className="screen-empty__title">ABHA Verification — coming online</p>
        <p className="screen-empty__sub">Verify customer ABHA number via NHA gateway + push dispensation as FHIR R4 MedicationDispense.</p>
        <p className="screen-empty__hint">Backing package: <code>@pharmacare/abdm</code></p>
      </div>
    </div>
  );
}
