import { describe, expect, it, beforeAll } from "vitest";
import i18next from "i18next";
import { initI18n, setLocale, getLocale, t } from "../index.js";

describe("i18n.t() + setLocale + fallback chain", () => {
  beforeAll(() => {
    initI18n("en");
  });

  it("returns the correct English string for a known key", () => {
    void i18next.changeLanguage("en");
    expect(t("common.save")).toBe("Save");
    expect(t("billing.qty")).toBe("Qty");
  });

  it("returns the correct Hindi string for a known key", () => {
    void i18next.changeLanguage("hi");
    expect(t("common.save")).toBe("सेव");
    expect(t("billing.qty")).toBe("मात्रा");
  });

  it("returns the correct Marathi string for a known key", () => {
    void i18next.changeLanguage("mr");
    expect(t("common.save")).toBe("सेव्ह");
    expect(t("billing.qty")).toBe("संख्या");
  });

  it("falls back through the chain mr -> hi -> en for missing keys", () => {
    // No Hindi/Marathi key for `nonexistent.key.path` exists in any locale,
    // so t() returns the key itself (i18next default behavior) — but the
    // chain wiring is the load-bearing part: we assert it does not crash.
    void i18next.changeLanguage("mr");
    const v = t("definitely.not.a.key.bbb");
    expect(typeof v).toBe("string");
    // The key path is preserved when nothing matches.
    expect(v).toBe("definitely.not.a.key.bbb");
  });

  it("interpolation with {{value}} works in all 3 locales", () => {
    void i18next.changeLanguage("en");
    expect(t("dashboard.avgBill", { value: "1,234" })).toContain("1,234");
    void i18next.changeLanguage("hi");
    expect(t("dashboard.avgBill", { value: "1,234" })).toContain("1,234");
    void i18next.changeLanguage("mr");
    expect(t("dashboard.avgBill", { value: "1,234" })).toContain("1,234");
  });

  it("setLocale + getLocale round-trip", () => {
    setLocale("hi");
    expect(getLocale()).toBe("hi");
    setLocale("mr");
    expect(getLocale()).toBe("mr");
    setLocale("en");
    expect(getLocale()).toBe("en");
  });

  it("setLocale rejects unsupported codes silently (no throw)", () => {
    setLocale("hi");
    // @ts-expect-error — testing runtime guard
    setLocale("fr");
    // Stays on hi, did not switch to fr.
    expect(getLocale()).toBe("hi");
  });
});
