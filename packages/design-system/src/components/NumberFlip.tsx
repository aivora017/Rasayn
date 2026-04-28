import { useEffect, useState, useMemo } from "react";
import { useReducedMotion } from "../utils/useReducedMotion.js";
import { cn } from "../utils/cn.js";

/**
 * Digit-roll number animator. Each digit independently rolls to its target.
 * Reduced-motion: instantly displays final value.
 *
 * Use cases: dashboard KPIs, bill grand total update, inventory count.
 */

export interface NumberFlipProps {
  /** Final string value (e.g. "₹47,820" or "1,23,456"). */
  value: string;
  className?: string;
  /** Element role override (default span). */
  as?: "span" | "div";
  ariaLabel?: string;
}

const DIGITS = "0123456789";

interface Cell {
  /** The character at this position (digit or non-digit). */
  ch: string;
  /** If digit, target index 0-9. -1 if not a digit. */
  digit: number;
}

function tokenize(s: string): Cell[] {
  return Array.from(s).map((ch) => ({
    ch,
    digit: DIGITS.includes(ch) ? Number(ch) : -1,
  }));
}

export function NumberFlip({ value, className, as: As = "span", ariaLabel }: NumberFlipProps): JSX.Element {
  const reduce = useReducedMotion();
  const [tokens, setTokens] = useState<Cell[]>(() => tokenize(value));

  useEffect(() => {
    setTokens(tokenize(value));
  }, [value]);

  const content = useMemo(() => {
    return tokens.map((t, i) => {
      if (t.digit < 0) {
        return (
          <span key={i} className="inline-block">
            {t.ch}
          </span>
        );
      }
      const offset = reduce ? -t.digit : -t.digit;
      return (
        <span key={i} className="pc-numflip-digit" aria-hidden>
          <span style={{ transform: `translateY(${offset}em)` }}>
            {DIGITS.split("").map((d, j) => (
              <span key={j} className="block leading-[1em]">
                {d}
              </span>
            ))}
          </span>
        </span>
      );
    });
  }, [tokens, reduce]);

  return (
    <As
      className={cn("pc-numflip", className)}
      aria-label={ariaLabel ?? value}
      role="text"
    >
      {/* SR-only canonical text */}
      <span className="sr-only">{value}</span>
      {/* Visual digits */}
      <span aria-hidden className="contents">
        {content}
      </span>
    </As>
  );
}
