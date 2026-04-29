import { useEffect } from "react";
// SCAFFOLD — generated 2026-04-28 from MASTER_PLAN_v3.
// Cross-store KPI consolidation, parent/worker health, sync lag, transfer queue.
// Backing package: @pharmacare/shared-types
// See SCAFFOLD_INDEX.md for the full feature → file map.

export interface MultiStoreScreenProps {
  /** Mode the AppShell passes when navigating to this screen. */
  readonly visible?: boolean;
}

export default function MultiStoreScreen({ visible = true }: MultiStoreScreenProps) {
  useEffect(() => {
    if (!visible) return;
    // TODO(MultiStoreScreen): preload data via @pharmacare/shared-types
  }, [visible]);

  return (
    <div className="screen-shell" data-screen="multistorescreen" data-status="scaffold">
      <header className="screen-header">
        <h1 className="screen-title">Multi-Store Dashboard</h1>
        <span className="screen-status-pill scaffold">SCAFFOLD</span>
      </header>
      <div className="screen-empty">
        <p className="screen-empty__title">Multi-Store Dashboard — coming online</p>
        <p className="screen-empty__sub">Cross-store KPI consolidation, parent/worker health, sync lag, transfer queue.</p>
        <p className="screen-empty__hint">Backing package: <code>@pharmacare/shared-types</code></p>
      </div>
    </div>
  );
}
