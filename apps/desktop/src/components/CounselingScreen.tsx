import { useEffect } from "react";
// SCAFFOLD — generated 2026-04-28 from MASTER_PLAN_v3.
// Schedule-H mandatory counseling records. Auto-drafted via AI Copilot per drug × language.
// Backing package: @pharmacare/ai-copilot
// See SCAFFOLD_INDEX.md for the full feature → file map.

export interface CounselingScreenProps {
  /** Mode the AppShell passes when navigating to this screen. */
  readonly visible?: boolean;
}

export default function CounselingScreen({ visible = true }: CounselingScreenProps) {
  useEffect(() => {
    if (!visible) return;
    // TODO(CounselingScreen): preload data via @pharmacare/ai-copilot
  }, [visible]);

  return (
    <div className="screen-shell" data-screen="counselingscreen" data-status="scaffold">
      <header className="screen-header">
        <h1 className="screen-title">Patient Counseling Records</h1>
        <span className="screen-status-pill scaffold">SCAFFOLD</span>
      </header>
      <div className="screen-empty">
        <p className="screen-empty__title">Patient Counseling Records — coming online</p>
        <p className="screen-empty__sub">Schedule-H mandatory counseling records. Auto-drafted via AI Copilot per drug × language.</p>
        <p className="screen-empty__hint">Backing package: <code>@pharmacare/ai-copilot</code></p>
      </div>
    </div>
  );
}
