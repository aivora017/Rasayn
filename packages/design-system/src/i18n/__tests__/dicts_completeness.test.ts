import { describe, expect, it } from "vitest";
import { en } from "../en.js";
import { hi } from "../hi.js";
import { mr } from "../mr.js";

type Dict = Record<string, unknown>;

function flat(prefix: string, obj: Dict, out: Set<string>): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flat(key, v as Dict, out);
    } else {
      out.add(key);
    }
  }
}

function keysOf(d: Dict): Set<string> {
  const out = new Set<string>();
  flat("", d, out);
  return out;
}

describe("i18n dictionary completeness", () => {
  const enKeys = keysOf(en as unknown as Dict);
  const hiKeys = keysOf(hi as unknown as Dict);
  const mrKeys = keysOf(mr as unknown as Dict);

  it("hi has every key that en has", () => {
    const missing = [...enKeys].filter((k) => !hiKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("mr has every key that en has", () => {
    const missing = [...enKeys].filter((k) => !mrKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("hi has no extra keys beyond en", () => {
    const extra = [...hiKeys].filter((k) => !enKeys.has(k));
    expect(extra).toEqual([]);
  });

  it("mr has no extra keys beyond en", () => {
    const extra = [...mrKeys].filter((k) => !enKeys.has(k));
    expect(extra).toEqual([]);
  });

  it("each locale has at least 100 keys", () => {
    expect(enKeys.size).toBeGreaterThanOrEqual(100);
    expect(hiKeys.size).toBeGreaterThanOrEqual(100);
    expect(mrKeys.size).toBeGreaterThanOrEqual(100);
  });

  it("no key value is the empty string", () => {
    function values(d: Dict, out: string[]): void {
      for (const v of Object.values(d)) {
        if (v && typeof v === "object") values(v as Dict, out);
        else if (typeof v === "string") out.push(v);
      }
    }
    const all: string[] = [];
    values(en as unknown as Dict, all);
    values(hi as unknown as Dict, all);
    values(mr as unknown as Dict, all);
    expect(all.every((s) => s.length > 0)).toBe(true);
  });
});
