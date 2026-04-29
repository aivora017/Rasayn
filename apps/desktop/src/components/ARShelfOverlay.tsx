import { useEffect } from "react";
// SCAFFOLD — generated 2026-04-28 from MASTER_PLAN_v3.
// WebXR + WebGPU camera overlay annotating each pack with MRP/expiry/stock/tamper-shield score.
// Backing package: @pharmacare/ar-shelf
// See SCAFFOLD_INDEX.md for the full feature → file map.

export interface ARShelfOverlayProps {
  /** Mode the AppShell passes when navigating to this screen. */
  readonly visible?: boolean;
}

export default function ARShelfOverlay({ visible = true }: ARShelfOverlayProps) {
  useEffect(() => {
    if (!visible) return;
    // TODO(ARShelfOverlay): preload data via @pharmacare/ar-shelf
  }, [visible]);

  return (
    <div className="screen-shell" data-screen="arshelfoverlay" data-status="scaffold">
      <header className="screen-header">
        <h1 className="screen-title">AR Shelf Overlay</h1>
        <span className="screen-status-pill scaffold">SCAFFOLD</span>
      </header>
      <div className="screen-empty">
        <p className="screen-empty__title">AR Shelf Overlay — coming online</p>
        <p className="screen-empty__sub">WebXR + WebGPU camera overlay annotating each pack with MRP/expiry/stock/tamper-shield score.</p>
        <p className="screen-empty__hint">Backing package: <code>@pharmacare/ar-shelf</code></p>
      </div>
    </div>
  );
}
