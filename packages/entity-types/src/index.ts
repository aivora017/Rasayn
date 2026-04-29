// @pharmacare/entity-types
// Indian business entity types + per-type compliance matrix.
//
// Drives:
//   - OnboardingWizard (which fields to ask)
//   - ca-export-bundle (which files to include)
//   - ComplianceDashboard (which filings + due-dates to track)
//
// Sourced from: Companies Act 2013, LLP Act 2008, Partnership Act 1932,
// Income Tax Act 1961 §44AB / §44AA, Income Tax Department AY 2026-27.

// ────────────────────────────────────────────────────────────────────────
// Entity-type enum
// ────────────────────────────────────────────────────────────────────────

export type EntityType =
  | "sole_proprietor"     // No formal registration; GST + ITR-3
  | "partnership_firm"    // Partnership Act 1932; ITR-5; no ROC
  | "llp"                 // LLP Act 2008; Form 8 + Form 11 + DIR-3 KYC + ITR-5
  | "opc"                 // Companies Act 2013; AOC-4 + MGT-7A + DIR-3 + ITR-6
  | "pvt_ltd"             // Companies Act 2013; AOC-4 + MGT-7 + DIR-3 + board minutes + ITR-6
  | "public_ltd"          // Same as Pvt Ltd + AGM + listing if listed
  | "section_8"           // Section 8 NGO; AOC-4 + MGT-7 + ITR-7 + FCRA if foreign
  | "huf";                // Hindu Undivided Family; informal; ITR-2/3

export interface EntityTypeMeta {
  readonly id: EntityType;
  readonly displayName: string;
  readonly tagline: string;
  readonly governedBy: string;
  readonly hasRoc: boolean;
  readonly defaultItrForm: "ITR-2" | "ITR-3" | "ITR-5" | "ITR-6" | "ITR-7";
  /** Annual statutory audit threshold; null = always required.
   *  For LLP: turnover >₹40L OR contribution >₹25L. For others see audit notes. */
  readonly auditThreshold?: { readonly turnoverPaise?: number; readonly contributionPaise?: number };
  /** Always-required statutory audit (regardless of threshold). */
  readonly auditAlwaysRequired: boolean;
  /** Tax rate for AY 2026-27. Companies have lower rates (22% / 15%). */
  readonly incomeTaxRatePct: number;
  /** Surcharge applies above ₹X turnover. */
  readonly surchargeAbovePaise?: number;
  readonly minPartnersOrDirectors: number;
  readonly maxPartnersOrDirectors?: number;
  /** Personal liability of promoters? */
  readonly limitedLiability: boolean;
  /** Required at registration in our wizard. */
  readonly requiresFields: ReadonlyArray<RegistrationField>;
}

export type RegistrationField =
  | "gstin"               // 15-char GSTIN (always required if registered for GST)
  | "panNumber"           // 10-char PAN (mandatory for all entities)
  | "shopName"
  | "shopAddress"
  | "stateCode"           // 2-digit state code matching GSTIN
  | "retailDrugLicense"   // Form 20 / 21 (mandatory for ALL pharmacy entity types)
  | "ownerName"           // proprietor / karta name
  | "partners"            // partnership / LLP — 2+ partners with contributions
  | "designatedPartners"  // LLP only — Designated Partner ID Numbers
  | "directors"           // OPC / Pvt Ltd / Public Ltd — DIN-bearing directors
  | "shareholders"        // Pvt Ltd / Public Ltd — equity holders
  | "cinNumber"           // Companies — Corporate Identification Number
  | "llpinNumber"         // LLPs — LLP Identification Number
  | "ngoRegNumber"        // Section 8 — NGO registration
  | "fcraNumber"          // Section 8 with foreign donations
  | "kartaPan"            // HUF — Karta's PAN
  | "huffPan"             // HUF — separate PAN under HUF status
  | "tanNumber"           // Tax Account Number (mandatory if you deduct TDS)
  | "msmeUdyamNumber"     // MSME Udyam registration (optional but useful);

// ────────────────────────────────────────────────────────────────────────
// Per-entity-type metadata
// ────────────────────────────────────────────────────────────────────────

export const ENTITY_TYPES: Record<EntityType, EntityTypeMeta> = {
  sole_proprietor: {
    id: "sole_proprietor",
    displayName: "Sole Proprietor",
    tagline: "Single owner, unlimited personal liability. Simplest registration. GST + ITR-3 only.",
    governedBy: "Income Tax Act 1961, Shops & Establishments Act, GST Act",
    hasRoc: false,
    defaultItrForm: "ITR-3",
    auditThreshold: { turnoverPaise: 1_00_00_000_00 },        // ₹1 Cr u/s 44AB
    auditAlwaysRequired: false,
    incomeTaxRatePct: 30,                                       // slab-based, simplified
    minPartnersOrDirectors: 1,
    maxPartnersOrDirectors: 1,
    limitedLiability: false,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "ownerName", "gstin"],
  },
  partnership_firm: {
    id: "partnership_firm",
    displayName: "Partnership Firm",
    tagline: "2+ partners share profits & unlimited liability. ITR-5. No ROC filing.",
    governedBy: "Partnership Act 1932, Income Tax Act 1961, GST Act",
    hasRoc: false,
    defaultItrForm: "ITR-5",
    auditThreshold: { turnoverPaise: 1_00_00_000_00 },
    auditAlwaysRequired: false,
    incomeTaxRatePct: 30,
    minPartnersOrDirectors: 2,
    maxPartnersOrDirectors: 20,
    limitedLiability: false,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "partners", "gstin"],
  },
  llp: {
    id: "llp",
    displayName: "Limited Liability Partnership (LLP)",
    tagline: "Limited liability + tax efficiency. ROC: Form 8 + Form 11 + DIR-3 KYC. ITR-5.",
    governedBy: "LLP Act 2008, Income Tax Act 1961, GST Act",
    hasRoc: true,
    defaultItrForm: "ITR-5",
    auditThreshold: { turnoverPaise: 40_00_000_00, contributionPaise: 25_00_000_00 },
    auditAlwaysRequired: false,
    incomeTaxRatePct: 30,
    minPartnersOrDirectors: 2,
    limitedLiability: true,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "llpinNumber", "designatedPartners", "partners", "gstin"],
  },
  opc: {
    id: "opc",
    displayName: "One Person Company (OPC)",
    tagline: "Solo entrepreneur with limited liability. ROC: AOC-4 + MGT-7A. Mandatory annual audit. ITR-6.",
    governedBy: "Companies Act 2013, Income Tax Act 1961, GST Act",
    hasRoc: true,
    defaultItrForm: "ITR-6",
    auditAlwaysRequired: true,                                   // §139 Companies Act
    incomeTaxRatePct: 22,                                        // §115BAA new regime
    minPartnersOrDirectors: 1,
    maxPartnersOrDirectors: 1,
    limitedLiability: true,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "cinNumber", "directors", "gstin"],
  },
  pvt_ltd: {
    id: "pvt_ltd",
    displayName: "Private Limited Company",
    tagline: "Best for scaling + raising funds. ROC: AOC-4 + MGT-7 + DIR-3 KYC + board minutes. Mandatory audit. ITR-6.",
    governedBy: "Companies Act 2013, Income Tax Act 1961, GST Act",
    hasRoc: true,
    defaultItrForm: "ITR-6",
    auditAlwaysRequired: true,
    incomeTaxRatePct: 22,
    minPartnersOrDirectors: 2,
    maxPartnersOrDirectors: 200,                                 // Pvt Ltd cap
    limitedLiability: true,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "cinNumber", "directors", "shareholders", "gstin"],
  },
  public_ltd: {
    id: "public_ltd",
    displayName: "Public Limited Company",
    tagline: "Can list on stock exchange. ROC: AOC-4 + MGT-7 + DIR-3 + AGM + secretarial audit. ITR-6.",
    governedBy: "Companies Act 2013, SEBI (LODR), Income Tax Act 1961",
    hasRoc: true,
    defaultItrForm: "ITR-6",
    auditAlwaysRequired: true,
    incomeTaxRatePct: 22,
    minPartnersOrDirectors: 3,                                   // 3 directors min for unlisted; 6 for listed
    limitedLiability: true,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "cinNumber", "directors", "shareholders", "gstin"],
  },
  section_8: {
    id: "section_8",
    displayName: "Section 8 Company (NGO / Charitable)",
    tagline: "Not-for-profit pharmacy (rare — Jan Aushadhi affiliates etc). ROC + 12A/80G + FCRA if foreign. ITR-7.",
    governedBy: "Companies Act 2013 §8, FCRA 2010, Income Tax Act 1961",
    hasRoc: true,
    defaultItrForm: "ITR-7",
    auditAlwaysRequired: true,
    incomeTaxRatePct: 0,                                         // exempt if 12A; can be revoked
    minPartnersOrDirectors: 2,
    limitedLiability: true,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "cinNumber", "directors", "ngoRegNumber"],
  },
  huf: {
    id: "huf",
    displayName: "Hindu Undivided Family (HUF)",
    tagline: "Joint-family business. Karta operates. Separate HUF PAN. ITR-2 / ITR-3.",
    governedBy: "Hindu Law, Income Tax Act 1961, GST Act",
    hasRoc: false,
    defaultItrForm: "ITR-3",
    auditThreshold: { turnoverPaise: 1_00_00_000_00 },
    auditAlwaysRequired: false,
    incomeTaxRatePct: 30,
    minPartnersOrDirectors: 1,
    limitedLiability: false,
    requiresFields: ["panNumber", "shopName", "shopAddress", "stateCode", "retailDrugLicense", "kartaPan", "huffPan", "gstin"],
  },
};

// ────────────────────────────────────────────────────────────────────────
// Annual filings — what each entity must file
// ────────────────────────────────────────────────────────────────────────

export interface AnnualFiling {
  readonly form: string;                  // "Form 8", "AOC-4", "ITR-3", etc.
  readonly fullName: string;
  readonly governingAct: string;
  readonly dueMonth: number;              // 1..12 from FY start (Apr=1)
  readonly dueDayOfMonth: number;
  readonly forMonths: 12 | "monthly" | "quarterly";
  readonly latePenalty: string;
  readonly portal: "MCA" | "GSTN" | "Income Tax" | "FCRA Online" | "EPFO" | "ESIC";
}

const COMMON_GST_FILINGS: AnnualFiling[] = [
  {
    form: "GSTR-1",
    fullName: "Outward supplies return",
    governingAct: "GST Act 2017",
    dueMonth: 0, dueDayOfMonth: 11, forMonths: "monthly",
    latePenalty: "₹50/day late + 18% interest on tax",
    portal: "GSTN",
  },
  {
    form: "GSTR-3B",
    fullName: "Tax liability summary + ITC claim",
    governingAct: "GST Act 2017",
    dueMonth: 0, dueDayOfMonth: 20, forMonths: "monthly",
    latePenalty: "₹50/day late + 18% interest on tax",
    portal: "GSTN",
  },
  {
    form: "GSTR-9",
    fullName: "Annual GST return",
    governingAct: "GST Act 2017",
    dueMonth: 9, dueDayOfMonth: 31, forMonths: 12,            // 31 Dec
    latePenalty: "₹200/day late",
    portal: "GSTN",
  },
];

const LLP_FILINGS: AnnualFiling[] = [
  {
    form: "LLP Form 11", fullName: "Annual Return",
    governingAct: "LLP Act 2008",
    dueMonth: 2, dueDayOfMonth: 30, forMonths: 12,            // 30 May
    latePenalty: "₹100/day, no upper limit",
    portal: "MCA",
  },
  {
    form: "LLP Form 8", fullName: "Statement of Account & Solvency",
    governingAct: "LLP Act 2008",
    dueMonth: 7, dueDayOfMonth: 30, forMonths: 12,            // 30 Oct
    latePenalty: "₹100/day, no upper limit",
    portal: "MCA",
  },
  {
    form: "DIR-3 KYC", fullName: "Director KYC",
    governingAct: "Companies Act 2013",
    dueMonth: 6, dueDayOfMonth: 30, forMonths: 12,            // 30 Sep
    latePenalty: "₹5,000",
    portal: "MCA",
  },
];

const COMPANY_FILINGS: AnnualFiling[] = [
  {
    form: "AOC-4", fullName: "Financial Statements",
    governingAct: "Companies Act 2013 §137",
    dueMonth: 7, dueDayOfMonth: 30, forMonths: 12,            // 30 days from AGM (typ. 30 Oct)
    latePenalty: "₹100/day, no upper limit",
    portal: "MCA",
  },
  {
    form: "MGT-7", fullName: "Annual Return",
    governingAct: "Companies Act 2013 §92",
    dueMonth: 8, dueDayOfMonth: 28, forMonths: 12,            // 60 days from AGM (typ. 28 Nov)
    latePenalty: "₹100/day, no upper limit",
    portal: "MCA",
  },
  {
    form: "DIR-3 KYC", fullName: "Director KYC",
    governingAct: "Companies Act 2013",
    dueMonth: 6, dueDayOfMonth: 30, forMonths: 12,            // 30 Sep
    latePenalty: "₹5,000",
    portal: "MCA",
  },
];

const OPC_FILINGS: AnnualFiling[] = [
  {
    form: "AOC-4", fullName: "Financial Statements (OPC variant)",
    governingAct: "Companies Act 2013",
    dueMonth: 5, dueDayOfMonth: 27, forMonths: 12,            // 6 months from FY end → 27 Sep
    latePenalty: "₹100/day, no upper limit",
    portal: "MCA",
  },
  {
    form: "MGT-7A", fullName: "Annual Return (OPC + Small Co.)",
    governingAct: "Companies Act 2013 §92",
    dueMonth: 8, dueDayOfMonth: 28, forMonths: 12,
    latePenalty: "₹100/day, no upper limit",
    portal: "MCA",
  },
  {
    form: "DIR-3 KYC", fullName: "Director KYC",
    governingAct: "Companies Act 2013",
    dueMonth: 6, dueDayOfMonth: 30, forMonths: 12,
    latePenalty: "₹5,000",
    portal: "MCA",
  },
];

export function annualFilingsFor(type: EntityType): readonly AnnualFiling[] {
  const itrFormName = ENTITY_TYPES[type].defaultItrForm;
  const itr: AnnualFiling = {
    form: itrFormName, fullName: `Income Tax Return — ${itrFormName}`,
    governingAct: "Income Tax Act 1961",
    dueMonth: 4, dueDayOfMonth: 31, forMonths: 12,           // 31 Jul (or 31 Oct if audited)
    latePenalty: "₹5,000 (₹1,000 if income < ₹5L)",
    portal: "Income Tax",
  };
  switch (type) {
    case "sole_proprietor":
    case "partnership_firm":
    case "huf":
      return [...COMMON_GST_FILINGS, itr];
    case "llp":
      return [...COMMON_GST_FILINGS, itr, ...LLP_FILINGS];
    case "opc":
      return [...COMMON_GST_FILINGS, itr, ...OPC_FILINGS];
    case "pvt_ltd":
    case "public_ltd":
      return [...COMMON_GST_FILINGS, itr, ...COMPANY_FILINGS];
    case "section_8":
      return [...COMMON_GST_FILINGS, itr, ...COMPANY_FILINGS];
  }
}

// ────────────────────────────────────────────────────────────────────────
// Audit determination
// ────────────────────────────────────────────────────────────────────────

export function isAuditRequired(args: {
  entityType: EntityType;
  turnoverPaise?: number;
  contributionPaise?: number;
}): { required: boolean; reason: string } {
  const meta = ENTITY_TYPES[args.entityType];
  if (meta.auditAlwaysRequired) {
    return { required: true, reason: `${meta.displayName} mandatory annual audit (${meta.governedBy})` };
  }
  const t = meta.auditThreshold;
  if (!t) return { required: false, reason: "No audit threshold for this entity type" };
  if (t.turnoverPaise !== undefined && (args.turnoverPaise ?? 0) > t.turnoverPaise) {
    return {
      required: true,
      reason: `Turnover ₹${(args.turnoverPaise ?? 0) / 100} exceeds ₹${t.turnoverPaise / 100} audit threshold`,
    };
  }
  if (t.contributionPaise !== undefined && (args.contributionPaise ?? 0) > t.contributionPaise) {
    return {
      required: true,
      reason: `Capital contribution ₹${(args.contributionPaise ?? 0) / 100} exceeds ₹${t.contributionPaise / 100} threshold`,
    };
  }
  return { required: false, reason: "Below audit thresholds" };
}

// ────────────────────────────────────────────────────────────────────────
// Validators
// ────────────────────────────────────────────────────────────────────────

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const LLPIN_RE = /^[A-Z]{3}-[0-9]{4}$/;

export function isValidPan(pan: string): boolean { return PAN_RE.test(pan); }
export function isValidGstin(g: string): boolean { return GSTIN_RE.test(g); }
export function isValidCin(c: string): boolean { return CIN_RE.test(c); }
export function isValidLlpin(l: string): boolean { return LLPIN_RE.test(l); }

/** PAN ↔ GSTIN consistency: positions 3-12 of GSTIN are the entity's PAN. */
export function isGstinPanConsistent(gstin: string, pan: string): boolean {
  if (!isValidGstin(gstin) || !isValidPan(pan)) return false;
  return gstin.slice(2, 12) === pan;
}

/** Validate a registration form against the per-entity-type required field list. */
export interface RegistrationForm {
  readonly entityType: EntityType;
  readonly panNumber?: string;
  readonly gstin?: string;
  readonly shopName?: string;
  readonly shopAddress?: string;
  readonly stateCode?: string;
  readonly retailDrugLicense?: string;
  readonly ownerName?: string;
  readonly partners?: ReadonlyArray<{ name: string; panNumber: string; contributionPaise: number }>;
  readonly designatedPartners?: ReadonlyArray<{ name: string; dpinNumber: string }>;
  readonly directors?: ReadonlyArray<{ name: string; dinNumber: string }>;
  readonly shareholders?: ReadonlyArray<{ name: string; shares: number }>;
  readonly cinNumber?: string;
  readonly llpinNumber?: string;
  readonly ngoRegNumber?: string;
  readonly fcraNumber?: string;
  readonly kartaPan?: string;
  readonly huffPan?: string;
  readonly tanNumber?: string;
  readonly msmeUdyamNumber?: string;
}

export interface RegistrationValidationResult {
  readonly valid: boolean;
  readonly missing: readonly RegistrationField[];
  readonly errors: readonly { field: RegistrationField; message: string }[];
}

export function validateRegistration(f: RegistrationForm): RegistrationValidationResult {
  const meta = ENTITY_TYPES[f.entityType];
  const missing: RegistrationField[] = [];
  const errors: { field: RegistrationField; message: string }[] = [];

  for (const req of meta.requiresFields) {
    const v = (f as unknown as Record<string, unknown>)[req];
    if (v === undefined || v === null || (typeof v === "string" && v.trim().length === 0) || (Array.isArray(v) && v.length === 0)) {
      missing.push(req);
      continue;
    }
    if (req === "panNumber" && typeof v === "string" && !isValidPan(v)) {
      errors.push({ field: req, message: "PAN must match AAAAA9999A pattern" });
    }
    if (req === "gstin" && typeof v === "string" && !isValidGstin(v)) {
      errors.push({ field: req, message: "GSTIN must be 15 chars: 2-state+5-pan-letters+4-pan-digits+pan-letter+entity+Z+checksum" });
    }
    if (req === "cinNumber" && typeof v === "string" && !isValidCin(v)) {
      errors.push({ field: req, message: "CIN must match L/U+5digit+2state+4year+3type+6serial pattern" });
    }
    if (req === "llpinNumber" && typeof v === "string" && !isValidLlpin(v)) {
      errors.push({ field: req, message: "LLPIN must match AAA-9999 pattern" });
    }
    if (req === "partners" && Array.isArray(v) && v.length < (meta.minPartnersOrDirectors ?? 1)) {
      errors.push({ field: req, message: `Need at least ${meta.minPartnersOrDirectors} partners` });
    }
    if (req === "directors" && Array.isArray(v) && v.length < (meta.minPartnersOrDirectors ?? 1)) {
      errors.push({ field: req, message: `Need at least ${meta.minPartnersOrDirectors} directors` });
    }
  }

  // Cross-field consistency
  if (f.panNumber && f.gstin && !isGstinPanConsistent(f.gstin, f.panNumber)) {
    errors.push({ field: "gstin", message: "GSTIN's embedded PAN (chars 3-12) must match the PAN field" });
  }

  return { valid: missing.length === 0 && errors.length === 0, missing, errors };
}

// ────────────────────────────────────────────────────────────────────────
// Convenience: which compliance file groups a CA bundle should include
// ────────────────────────────────────────────────────────────────────────

export type ComplianceFileGroup =
  | "gst_monthly"           // GSTR-1 + GSTR-3B + 2B reconcile + sales/purchase registers
  | "gst_annual"            // GSTR-9
  | "income_tax"            // ITR + computation
  | "llp_form_8_11"         // LLP-only
  | "company_aoc_mgt"       // Pvt Ltd / Public Ltd / Section 8
  | "opc_aoc_mgt"           // OPC variant
  | "huf_specific"          // HUF needs separate ITR-2 / 3
  | "pharmacy_records"      // Schedule H register, NDPS, FDA inspector (ALL pharmacies)
  | "accounting_partners";  // Tally / Zoho / QB exports — always

export function complianceGroupsFor(type: EntityType): readonly ComplianceFileGroup[] {
  const base: ComplianceFileGroup[] = ["gst_monthly", "gst_annual", "income_tax", "pharmacy_records", "accounting_partners"];
  switch (type) {
    case "llp":      return [...base, "llp_form_8_11"];
    case "opc":      return [...base, "opc_aoc_mgt"];
    case "pvt_ltd":
    case "public_ltd":
    case "section_8": return [...base, "company_aoc_mgt"];
    case "huf":      return [...base, "huf_specific"];
    default:         return base;     // sole_proprietor, partnership_firm
  }
}

export const ALL_ENTITY_TYPES: readonly EntityType[] = [
  "sole_proprietor","partnership_firm","llp","opc","pvt_ltd","public_ltd","section_8","huf",
];
