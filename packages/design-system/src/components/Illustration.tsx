import { useId } from "react";
import { useReducedMotion } from "../utils/useReducedMotion.js";

/**
 * Custom-illustrated empty / hero / moat artwork.
 *
 * Each illustration is a hand-crafted SVG using the brand palette + a subtle
 * breathing or float animation. Reduced-motion: animation suppressed.
 *
 * Reach: <Illustration name="empty-bills" /> in any empty state.
 */

export type IllustrationName =
  | "empty-bills"
  | "empty-inventory"
  | "empty-customers"
  | "empty-search"
  | "x1-gmail"
  | "x2-image"
  | "x3-photo-bill"
  | "shop-mascot";

export interface IllustrationProps {
  name: IllustrationName;
  size?: number;
  className?: string;
  ariaLabel?: string;
}

export function Illustration({ name, size = 120, className, ariaLabel }: IllustrationProps): JSX.Element {
  const id = useId();
  const reduce = useReducedMotion();
  const breathe = reduce ? "" : "pc-ill-breathe";

  switch (name) {
    case "empty-bills":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 200 200"
          role="img"
          aria-label={ariaLabel ?? "no bills yet"}
          className={className}
        >
          <defs>
            <linearGradient id={`b1-${id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--pc-brand-primary-soft)" />
              <stop offset="100%" stopColor="var(--pc-brand-primary)" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <rect x="50" y="40" width="100" height="130" rx="8" fill={`url(#b1-${id})`} stroke="var(--pc-brand-primary)" strokeWidth="1.5" />
            <line x1="65" y1="65" x2="135" y2="65" stroke="var(--pc-brand-primary)" strokeWidth="2" strokeLinecap="round" />
            <line x1="65" y1="80" x2="120" y2="80" stroke="var(--pc-brand-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            <line x1="65" y1="95" x2="125" y2="95" stroke="var(--pc-brand-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            <line x1="65" y1="110" x2="105" y2="110" stroke="var(--pc-brand-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            <circle cx="100" cy="140" r="12" fill="var(--pc-accent-saffron)" />
            <text x="100" y="145" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--pc-bg-surface)">₹</text>
          </g>
        </svg>
      );

    case "empty-inventory":
      return (
        <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? "no inventory"} className={className}>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <ellipse cx="100" cy="170" rx="65" ry="6" fill="var(--pc-text-tertiary)" opacity="0.2" />
            <rect x="55" y="80" width="90" height="80" rx="4" fill="var(--pc-brand-primary-soft)" stroke="var(--pc-brand-primary)" strokeWidth="1.5" />
            <rect x="55" y="80" width="90" height="14" fill="var(--pc-brand-primary)" opacity="0.4" />
            <line x1="100" y1="80" x2="100" y2="160" stroke="var(--pc-brand-primary)" strokeWidth="1" opacity="0.3" />
            <line x1="55" y1="120" x2="145" y2="120" stroke="var(--pc-brand-primary)" strokeWidth="1" opacity="0.3" />
            <circle cx="78" cy="62" r="14" fill="var(--pc-accent-saffron)" />
            <rect x="74" y="55" width="8" height="14" rx="2" fill="var(--pc-bg-surface)" />
          </g>
        </svg>
      );

    case "empty-customers":
      return (
        <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? "no customers"} className={className}>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <circle cx="100" cy="80" r="28" fill="var(--pc-brand-primary-soft)" stroke="var(--pc-brand-primary)" strokeWidth="1.5" />
            <path d="M 60 160 Q 100 120 140 160" fill="var(--pc-brand-primary-soft)" stroke="var(--pc-brand-primary)" strokeWidth="1.5" />
            <circle cx="92" cy="76" r="2.5" fill="var(--pc-brand-primary)" />
            <circle cx="108" cy="76" r="2.5" fill="var(--pc-brand-primary)" />
            <path d="M 90 90 Q 100 95 110 90" stroke="var(--pc-brand-primary)" strokeWidth="2" fill="none" strokeLinecap="round" />
          </g>
        </svg>
      );

    case "empty-search":
      return (
        <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? "no results"} className={className}>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <circle cx="85" cy="85" r="40" fill="var(--pc-brand-primary-soft)" stroke="var(--pc-brand-primary)" strokeWidth="3" />
            <line x1="115" y1="115" x2="160" y2="160" stroke="var(--pc-brand-primary)" strokeWidth="6" strokeLinecap="round" />
            <text x="85" y="92" textAnchor="middle" fontSize="32" fill="var(--pc-text-tertiary)">?</text>
          </g>
        </svg>
      );

    case "x1-gmail":
      return (
        <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? "Gmail inbox"} className={className}>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <rect x="40" y="60" width="120" height="80" rx="6" fill="var(--pc-bg-surface)" stroke="var(--pc-state-info)" strokeWidth="2" />
            <path d="M 40 60 L 100 110 L 160 60" stroke="var(--pc-state-info)" strokeWidth="2" fill="none" />
            <circle cx="155" cy="55" r="14" fill="var(--pc-state-success)" />
            <text x="155" y="60" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--pc-bg-surface)">✓</text>
          </g>
        </svg>
      );

    case "x2-image":
      return (
        <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? "SKU images"} className={className}>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <rect x="40" y="50" width="120" height="100" rx="6" fill="var(--pc-state-success-bg)" stroke="var(--pc-state-success)" strokeWidth="1.5" />
            <circle cx="70" cy="80" r="10" fill="var(--pc-accent-saffron)" />
            <path d="M 50 130 L 80 100 L 110 120 L 150 90 L 150 140 L 50 140 Z" fill="var(--pc-state-success)" opacity="0.5" />
          </g>
        </svg>
      );

    case "x3-photo-bill":
      return (
        <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? "photo bill"} className={className}>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <rect x="50" y="40" width="100" height="130" rx="6" fill="var(--pc-bg-surface)" stroke="var(--pc-accent-saffron)" strokeWidth="2" transform="rotate(-4 100 100)" />
            <line x1="60" y1="70" x2="130" y2="70" stroke="var(--pc-text-secondary)" strokeWidth="1.5" transform="rotate(-4 100 100)" />
            <line x1="60" y1="85" x2="120" y2="85" stroke="var(--pc-text-secondary)" strokeWidth="1.5" transform="rotate(-4 100 100)" opacity="0.5" />
            <line x1="60" y1="100" x2="125" y2="100" stroke="var(--pc-text-secondary)" strokeWidth="1.5" transform="rotate(-4 100 100)" opacity="0.5" />
            {/* Camera */}
            <rect x="120" y="120" width="50" height="40" rx="6" fill="var(--pc-accent-saffron)" />
            <circle cx="145" cy="140" r="11" fill="var(--pc-bg-surface)" />
            <circle cx="145" cy="140" r="6" fill="var(--pc-accent-saffron-hover)" />
          </g>
        </svg>
      );

    case "shop-mascot":
      return (
        <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel ?? "pharmacy"} className={className}>
          <g className={breathe} style={{ transformOrigin: "100px 100px" }}>
            <rect x="50" y="60" width="100" height="110" rx="6" fill="var(--pc-bg-surface)" stroke="var(--pc-brand-primary)" strokeWidth="2" />
            <rect x="40" y="50" width="120" height="20" rx="4" fill="var(--pc-brand-primary)" />
            <rect x="80" y="120" width="40" height="50" fill="var(--pc-brand-primary-soft)" />
            <rect x="60" y="80" width="25" height="25" fill="var(--pc-state-success-bg)" />
            <rect x="115" y="80" width="25" height="25" fill="var(--pc-state-success-bg)" />
            <text x="100" y="65" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--pc-bg-surface)">℞</text>
          </g>
        </svg>
      );

    default:
      return <span aria-hidden />;
  }
}
