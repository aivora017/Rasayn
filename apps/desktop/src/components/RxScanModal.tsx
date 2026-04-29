import { useEffect } from "react";
// SCAFFOLD — generated 2026-04-28 from MASTER_PLAN_v3.
// TrOCR (printed) + Gemini 2.5 Vision (handwritten) → structured Rx lines with confidence chips.
// Backing package: @pharmacare/ocr-rx
// See SCAFFOLD_INDEX.md for the full feature → file map.

export interface RxScanModalProps {
  /** Mode the AppShell passes when navigating to this screen. */
  readonly visible?: boolean;
}

export default function RxScanModal({ visible = true }: RxScanModalProps) {
  useEffect(() => {
    if (!visible) return;
    // TODO(RxScanModal): preload data via @pharmacare/ocr-rx
  }, [visible]);

  return (
    <div className="screen-shell" data-screen="rxscanmodal" data-status="scaffold">
      <header className="screen-header">
        <h1 className="screen-title">Prescription Scan (OCR)</h1>
        <span className="screen-status-pill scaffold">SCAFFOLD</span>
      </header>
      <div className="screen-empty">
        <p className="screen-empty__title">Prescription Scan (OCR) — coming online</p>
        <p className="screen-empty__sub">TrOCR (printed) + Gemini 2.5 Vision (handwritten) → structured Rx lines with confidence chips.</p>
        <p className="screen-empty__hint">Backing package: <code>@pharmacare/ocr-rx</code></p>
      </div>
    </div>
  );
}
