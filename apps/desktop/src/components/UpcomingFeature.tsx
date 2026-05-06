// Shared fallback for scaffold-only screens hidden in pilot builds (S26.G).
//
// When a user deep-links into one of the four hidden modes
// (RxScanModal, ARShelfOverlay, CounselingScreen, ABHAVerifyModal) on a
// PILOT_BUILD=true artifact, the route still resolves but renders this
// clean "coming in next release" card instead of the literal SCAFFOLD
// placeholder text. Owner / pharmacist sees a polished message, not
// "coming online" debug copy.
//
// In dev (PILOT_BUILD=false) this component is bypassed and the real
// scaffold is rendered so the team can keep iterating.

import type { ReactNode } from "react";

export interface UpcomingFeatureProps {
  /** Human-readable name of the feature, e.g. "Patient Counseling Records". */
  readonly name: string;
  /** Optional one-liner explaining what this will do once shipped. */
  readonly note?: string;
  /** Optional icon override (defaults to a generic sparkle glyph). */
  readonly icon?: ReactNode;
}

/**
 * "Feature coming in next release" placeholder shown for scaffold-only
 * screens hidden behind PILOT_BUILD. One shared component for all four
 * hidden routes (counseling, arShelf, rxScan, abhaVerify).
 */
export function UpcomingFeature({ name, note, icon }: UpcomingFeatureProps): JSX.Element {
  return (
    <div
      className="screen-shell flex h-full items-center justify-center p-6"
      data-screen="upcoming-feature"
      data-status="upcoming"
      data-feature-name={name}
      role="region"
      aria-label={`${name} — coming in next release`}
    >
      <div
        className="pc-glass-2 max-w-md rounded-[var(--pc-radius-lg)] border border-[var(--pc-border-subtle)] p-6 text-center shadow-[var(--pc-elevation-2)]"
        data-testid="upcoming-feature-card"
      >
        <div
          aria-hidden
          className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--pc-brand-primary-soft)] text-[var(--pc-brand-primary)]"
        >
          {icon ?? <span className="text-lg leading-none">+</span>}
        </div>
        <h1 className="text-[15px] font-medium text-[var(--pc-text-primary)]">
          {name}
        </h1>
        <p className="mt-1 text-[12px] text-[var(--pc-text-secondary)]">
          Feature coming in the next release.
        </p>
        {note ? (
          <p className="mt-3 text-[11px] text-[var(--pc-text-tertiary)]">{note}</p>
        ) : null}
      </div>
    </div>
  );
}

export default UpcomingFeature;
