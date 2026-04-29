import { describe, it, expect } from "vitest";
import {
  ENTITY_TYPES, ALL_ENTITY_TYPES, annualFilingsFor,
  isAuditRequired, isValidPan, isValidGstin, isValidCin, isValidLlpin,
  isGstinPanConsistent, validateRegistration, complianceGroupsFor,
  type EntityType, type RegistrationForm,
} from "./index.js";

describe("ENTITY_TYPES — coverage", () => {
  it("exposes 8 entity types", () => {
    expect(ALL_ENTITY_TYPES.length).toBe(8);
    for (const t of ALL_ENTITY_TYPES) expect(ENTITY_TYPES[t]).toBeDefined();
  });
  it("each has displayName + tagline + ITR form", () => {
    for (const t of ALL_ENTITY_TYPES) {
      const m = ENTITY_TYPES[t];
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(m.tagline.length).toBeGreaterThan(0);
      expect(m.defaultItrForm).toMatch(/ITR-/);
    }
  });
  it("companies have ROC, proprietor + HUF do not", () => {
    expect(ENTITY_TYPES.sole_proprietor.hasRoc).toBe(false);
    expect(ENTITY_TYPES.partnership_firm.hasRoc).toBe(false);
    expect(ENTITY_TYPES.huf.hasRoc).toBe(false);
    expect(ENTITY_TYPES.llp.hasRoc).toBe(true);
    expect(ENTITY_TYPES.opc.hasRoc).toBe(true);
    expect(ENTITY_TYPES.pvt_ltd.hasRoc).toBe(true);
  });
  it("LLP audit threshold matches LLP Act", () => {
    expect(ENTITY_TYPES.llp.auditThreshold?.turnoverPaise).toBe(40_00_000_00);
    expect(ENTITY_TYPES.llp.auditThreshold?.contributionPaise).toBe(25_00_000_00);
  });
  it("Companies have always-on audit", () => {
    expect(ENTITY_TYPES.opc.auditAlwaysRequired).toBe(true);
    expect(ENTITY_TYPES.pvt_ltd.auditAlwaysRequired).toBe(true);
    expect(ENTITY_TYPES.public_ltd.auditAlwaysRequired).toBe(true);
  });
});

describe("annualFilingsFor", () => {
  it("Sole proprietor → only GST + ITR (no ROC)", () => {
    const f = annualFilingsFor("sole_proprietor").map((x) => x.form);
    expect(f).toContain("GSTR-1");
    expect(f).toContain("ITR-3");
    expect(f.find((x) => x === "Form 8")).toBeUndefined();
    expect(f.find((x) => x === "AOC-4")).toBeUndefined();
  });
  it("LLP → GST + ITR-5 + Form 8 + Form 11 + DIR-3", () => {
    const f = annualFilingsFor("llp").map((x) => x.form);
    expect(f).toContain("LLP Form 8");
    expect(f).toContain("LLP Form 11");
    expect(f).toContain("DIR-3 KYC");
    expect(f).toContain("ITR-5");
  });
  it("Pvt Ltd → AOC-4 + MGT-7 + DIR-3 + ITR-6", () => {
    const f = annualFilingsFor("pvt_ltd").map((x) => x.form);
    expect(f).toContain("AOC-4");
    expect(f).toContain("MGT-7");
    expect(f).toContain("DIR-3 KYC");
    expect(f).toContain("ITR-6");
  });
  it("OPC → MGT-7A (small-co variant) not MGT-7", () => {
    const f = annualFilingsFor("opc").map((x) => x.form);
    expect(f).toContain("MGT-7A");
    expect(f).toContain("AOC-4");
    expect(f.find((x) => x === "MGT-7")).toBeUndefined();
  });
});

describe("isAuditRequired", () => {
  it("Pvt Ltd always requires audit", () => {
    expect(isAuditRequired({ entityType: "pvt_ltd", turnoverPaise: 100 }).required).toBe(true);
  });
  it("LLP — turnover ₹50L > ₹40L threshold → audit required", () => {
    const r = isAuditRequired({ entityType: "llp", turnoverPaise: 50_00_000_00 });
    expect(r.required).toBe(true);
    expect(r.reason).toContain("Turnover");
  });
  it("LLP — turnover ₹30L AND contribution ₹15L → no audit", () => {
    const r = isAuditRequired({ entityType: "llp", turnoverPaise: 30_00_000_00, contributionPaise: 15_00_000_00 });
    expect(r.required).toBe(false);
  });
  it("LLP — contribution ₹30L > ₹25L threshold → audit required", () => {
    const r = isAuditRequired({ entityType: "llp", turnoverPaise: 100, contributionPaise: 30_00_000_00 });
    expect(r.required).toBe(true);
    expect(r.reason).toContain("contribution");
  });
  it("Sole proprietor — turnover ₹50L → no §44AB audit (below ₹1cr)", () => {
    const r = isAuditRequired({ entityType: "sole_proprietor", turnoverPaise: 50_00_000_00 });
    expect(r.required).toBe(false);
  });
  it("Sole proprietor — turnover ₹2cr → §44AB audit required", () => {
    const r = isAuditRequired({ entityType: "sole_proprietor", turnoverPaise: 2_00_00_000_00 });
    expect(r.required).toBe(true);
  });
});

describe("validators", () => {
  it("PAN well-formed", () => {
    expect(isValidPan("AAAAA1111A")).toBe(true);
    expect(isValidPan("AAAA1111A")).toBe(false);
    expect(isValidPan("aaaaa1111a")).toBe(false);
  });
  it("GSTIN well-formed", () => {
    expect(isValidGstin("27AAAAA0000A1Z5")).toBe(true);
    expect(isValidGstin("not a gstin")).toBe(false);
  });
  it("CIN well-formed (Pvt Ltd company)", () => {
    expect(isValidCin("U24230MH2020PTC123456")).toBe(true);
    expect(isValidCin("nope")).toBe(false);
  });
  it("LLPIN well-formed", () => {
    expect(isValidLlpin("AAB-1234")).toBe(true);
    expect(isValidLlpin("AAB1234")).toBe(false);
  });
  it("GSTIN ↔ PAN consistency: positions 3-12 of GSTIN = PAN", () => {
    expect(isGstinPanConsistent("27AAAAA0000A1Z5", "AAAAA0000A")).toBe(true);
    expect(isGstinPanConsistent("27AAAAA0000A1Z5", "BBBBB1111B")).toBe(false);
  });
});

describe("validateRegistration", () => {
  const minProprietor: RegistrationForm = {
    entityType: "sole_proprietor",
    panNumber: "AAAAA0000A",
    gstin: "27AAAAA0000A1Z5",
    shopName: "Test Pharmacy",
    shopAddress: "123 Main St",
    stateCode: "27",
    retailDrugLicense: "MH-FORM-20-12345",
    ownerName: "Sourav Shaw",
  };

  it("complete proprietor registration → valid", () => {
    const r = validateRegistration(minProprietor);
    expect(r.valid).toBe(true);
    expect(r.missing).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });

  it("missing required field → invalid + missing list", () => {
    const incomplete = { ...minProprietor, retailDrugLicense: "" };
    const r = validateRegistration(incomplete);
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("retailDrugLicense");
  });

  it("bad PAN → invalid + error", () => {
    const r = validateRegistration({ ...minProprietor, panNumber: "BAD" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "panNumber")).toBe(true);
  });

  it("GSTIN PAN mismatch → invalid", () => {
    const r = validateRegistration({ ...minProprietor, panNumber: "BBBBB1111B" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "gstin" && /PAN/.test(e.message))).toBe(true);
  });

  it("LLP needs partners + LLPIN", () => {
    const r = validateRegistration({
      entityType: "llp",
      panNumber: "AAAAA0000A",
      gstin: "27AAAAA0000A1Z5",
      shopName: "Test", shopAddress: "Addr", stateCode: "27",
      retailDrugLicense: "MH-FORM-20-12345",
    });
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("llpinNumber");
    expect(r.missing).toContain("designatedPartners");
    expect(r.missing).toContain("partners");
  });

  it("LLP with partners + LLPIN → valid", () => {
    const r = validateRegistration({
      entityType: "llp",
      panNumber: "AAAAA0000A",
      gstin: "27AAAAA0000A1Z5",
      shopName: "Test", shopAddress: "Addr", stateCode: "27",
      retailDrugLicense: "MH-FORM-20-12345",
      llpinNumber: "AAB-1234",
      partners: [
        { name: "Sourav", panNumber: "AAAAA0000A", contributionPaise: 50_000_00 },
        { name: "Co-partner", panNumber: "BBBBB1111B", contributionPaise: 50_000_00 },
      ],
      designatedPartners: [
        { name: "Sourav", dpinNumber: "DPIN001" },
        { name: "Co-partner", dpinNumber: "DPIN002" },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("LLP with only 1 partner fails min count", () => {
    const r = validateRegistration({
      entityType: "llp",
      panNumber: "AAAAA0000A",
      gstin: "27AAAAA0000A1Z5",
      shopName: "Test", shopAddress: "Addr", stateCode: "27",
      retailDrugLicense: "MH-FORM-20-12345",
      llpinNumber: "AAB-1234",
      partners: [{ name: "Solo", panNumber: "AAAAA0000A", contributionPaise: 100_000_00 }],
      designatedPartners: [{ name: "Solo", dpinNumber: "DPIN001" }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /at least 2/.test(e.message))).toBe(true);
  });

  it("Pvt Ltd needs CIN + directors + shareholders", () => {
    const r = validateRegistration({
      entityType: "pvt_ltd",
      panNumber: "AAAAA0000A",
      gstin: "27AAAAA0000A1Z5",
      shopName: "Test", shopAddress: "Addr", stateCode: "27",
      retailDrugLicense: "MH-FORM-20-12345",
    });
    expect(r.missing).toContain("cinNumber");
    expect(r.missing).toContain("directors");
    expect(r.missing).toContain("shareholders");
  });
});

describe("complianceGroupsFor", () => {
  it("proprietor → base groups, no LLP/Company-specific", () => {
    const g = complianceGroupsFor("sole_proprietor");
    expect(g).toContain("gst_monthly");
    expect(g).toContain("income_tax");
    expect(g).not.toContain("llp_form_8_11");
    expect(g).not.toContain("company_aoc_mgt");
  });
  it("LLP → base + LLP-specific", () => {
    const g = complianceGroupsFor("llp");
    expect(g).toContain("llp_form_8_11");
  });
  it("Pvt Ltd → base + company-specific", () => {
    const g = complianceGroupsFor("pvt_ltd");
    expect(g).toContain("company_aoc_mgt");
  });
  it("OPC → base + opc-specific (MGT-7A)", () => {
    const g = complianceGroupsFor("opc");
    expect(g).toContain("opc_aoc_mgt");
  });
});
