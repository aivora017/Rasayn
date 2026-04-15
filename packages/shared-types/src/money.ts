// Money primitives. All monetary math in paise (integer). Never float.

export type CurrencyCode = "INR";

export type Paise = number & { readonly __brand: "Paise" };

export const paise = (n: number): Paise => {
  if (!Number.isFinite(n)) throw new Error("paise: non-finite input");
  return Math.round(n) as Paise;
};

export const rupeesToPaise = (rupees: number): Paise => paise(rupees * 100);
export const paiseToRupees = (p: Paise): number => p / 100;

/** Banker-safe add/sub/mul for paise. */
export const addP = (a: Paise, b: Paise): Paise => paise(a + b);
export const subP = (a: Paise, b: Paise): Paise => paise(a - b);
export const mulP = (a: Paise, factor: number): Paise => paise(a * factor);

/** Format paise as "\u20b912,345.67" (en-IN grouping). */
export const formatINR = (p: Paise): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paiseToRupees(p));
