// Demo catalogue for Vaidyanath Pharmacy (Kalyan). Indian ICP-representative.
// Prices are INR-realistic (MRP in paise). Schedule H/H1/X get a stub SHA-256.

const FAKE_SHA = "a".repeat(64); // stub for X2 moat; real app stores real hashes

export interface SeedProduct {
  id: string;
  name: string;
  generic: string | null;
  manufacturer: string;
  hsn: string;
  gst: 0 | 5 | 12 | 18 | 28;
  schedule: "OTC" | "G" | "H" | "H1" | "X" | "NDPS";
  packForm: string;
  packSize: number;
  mrpPaise: number;
  imageSha: string | null;
}

export interface SeedBatch {
  id: string;
  productId: string;
  batchNo: string;
  mfg: string;        // YYYY-MM-01
  expiry: string;     // YYYY-MM-DD (last day of month)
  qty: number;
  costPaise: number;
  mrpPaise: number;
  supplierId: string;
}

export const SHOP = {
  id: "shop_vaidyanath_kalyan",
  name: "Vaidyanath Pharmacy",
  gstin: "27ABCDE1234F1Z5",
  stateCode: "27", // Maharashtra
  retailLicense: "MH-KLN-RET-20-21-0482",
  address: "Shop 4, Shivaji Chowk, Kalyan West, Thane 421301, Maharashtra",
};

export const USERS = [
  { id: "user_sourav_owner", shopId: SHOP.id, name: "Sourav Shaw", role: "owner", pin: "1234" },
  { id: "user_priya_pharm",  shopId: SHOP.id, name: "Priya Deshmukh", role: "pharmacist", pin: "4321" },
  { id: "user_rahul_cash",   shopId: SHOP.id, name: "Rahul Patil", role: "cashier", pin: "9999" },
];

export const SUPPLIERS = [
  { id: "sup_cipla",    shopId: SHOP.id, name: "Cipla Ltd.",                gstin: "27AAACC3849E1Z8", phone: "+912261095000" },
  { id: "sup_sun",      shopId: SHOP.id, name: "Sun Pharmaceutical",        gstin: "24AAACS5978H1ZR", phone: "+912266455645" },
  { id: "sup_gsk",      shopId: SHOP.id, name: "GlaxoSmithKline Pharma",    gstin: "27AAACG1570E1ZZ", phone: "+912224959595" },
  { id: "sup_alembic",  shopId: SHOP.id, name: "Alembic Pharmaceuticals",   gstin: "24AAACA1429J1ZS", phone: "+912653224203" },
  { id: "sup_localwhl", shopId: SHOP.id, name: "Kalyan Medical Distributors", gstin: "27AABCK9910M1ZV", phone: "+912512201234" },
];

export const CUSTOMERS = [
  { id: "cust_meera",   shopId: SHOP.id, name: "Meera Joshi",     phone: "+919820012345" },
  { id: "cust_arjun",   shopId: SHOP.id, name: "Arjun Kulkarni",  phone: "+919920023456" },
  { id: "cust_fatima",  shopId: SHOP.id, name: "Fatima Shaikh",   phone: "+917021034567" },
  { id: "cust_walkin",  shopId: SHOP.id, name: "Walk-in",         phone: null },
];

export const DOCTORS = [
  { id: "doc_deshpande", regNo: "MMC/2011/45821", name: "Dr. Anil Deshpande" },
  { id: "doc_khan",      regNo: "MMC/2015/67234", name: "Dr. Sana Khan" },
];

export const PRODUCTS: SeedProduct[] = [
  // OTC — analgesics / antacids / household
  { id: "prod_crocin500", name: "Crocin 500 Tablet", generic: "Paracetamol 500mg",
    manufacturer: "GSK", hsn: "30049099", gst: 12, schedule: "OTC",
    packForm: "strip", packSize: 15, mrpPaise: 3600, imageSha: null },
  { id: "prod_dolo650",   name: "Dolo 650 Tablet", generic: "Paracetamol 650mg",
    manufacturer: "Micro Labs", hsn: "30049099", gst: 12, schedule: "OTC",
    packForm: "strip", packSize: 15, mrpPaise: 3495, imageSha: null },
  { id: "prod_digene",    name: "Digene Mint Tablet", generic: "Antacid combination",
    manufacturer: "Abbott", hsn: "30049099", gst: 12, schedule: "OTC",
    packForm: "strip", packSize: 15, mrpPaise: 6500, imageSha: null },
  { id: "prod_volini50",  name: "Volini Gel 50g", generic: "Diclofenac/Methyl salicylate",
    manufacturer: "Sun Pharma", hsn: "30049099", gst: 12, schedule: "OTC",
    packForm: "ointment", packSize: 1, mrpPaise: 18300, imageSha: null },
  { id: "prod_ors",       name: "Electral Powder 21.8g", generic: "ORS WHO",
    manufacturer: "FDC", hsn: "30049099", gst: 5, schedule: "OTC",
    packForm: "bottle", packSize: 1, mrpPaise: 2300, imageSha: null },
  { id: "prod_vicks50",   name: "Vicks VapoRub 50ml", generic: "Camphor/Menthol/Eucalyptus",
    manufacturer: "P&G", hsn: "30049099", gst: 12, schedule: "OTC",
    packForm: "ointment", packSize: 1, mrpPaise: 15500, imageSha: null },
  { id: "prod_saridon",   name: "Saridon Tablet", generic: "Paracetamol+Propyphenazone+Caffeine",
    manufacturer: "Piramal", hsn: "30049099", gst: 12, schedule: "OTC",
    packForm: "strip", packSize: 10, mrpPaise: 4300, imageSha: null },

  // Schedule H — common Rx
  { id: "prod_azithral500", name: "Azithral 500 Tablet", generic: "Azithromycin 500mg",
    manufacturer: "Alembic", hsn: "30042031", gst: 12, schedule: "H",
    packForm: "strip", packSize: 5, mrpPaise: 13750, imageSha: FAKE_SHA },
  { id: "prod_augmentin625", name: "Augmentin 625 Duo Tablet", generic: "Amoxicillin 500mg + Clavulanic 125mg",
    manufacturer: "GSK", hsn: "30042031", gst: 12, schedule: "H",
    packForm: "strip", packSize: 10, mrpPaise: 25250, imageSha: FAKE_SHA },
  { id: "prod_pan40",      name: "Pan 40 Tablet", generic: "Pantoprazole 40mg",
    manufacturer: "Alkem", hsn: "30049099", gst: 12, schedule: "H",
    packForm: "strip", packSize: 15, mrpPaise: 17400, imageSha: FAKE_SHA },
  { id: "prod_telma40",    name: "Telma 40 Tablet", generic: "Telmisartan 40mg",
    manufacturer: "Glenmark", hsn: "30049099", gst: 12, schedule: "H",
    packForm: "strip", packSize: 15, mrpPaise: 18500, imageSha: FAKE_SHA },
  { id: "prod_glycomet500", name: "Glycomet 500 SR Tablet", generic: "Metformin 500mg SR",
    manufacturer: "USV", hsn: "30049099", gst: 12, schedule: "H",
    packForm: "strip", packSize: 20, mrpPaise: 3200, imageSha: FAKE_SHA },
  { id: "prod_atorva10",   name: "Atorva 10 Tablet", generic: "Atorvastatin 10mg",
    manufacturer: "Zydus", hsn: "30049099", gst: 12, schedule: "H",
    packForm: "strip", packSize: 15, mrpPaise: 8700, imageSha: FAKE_SHA },
  { id: "prod_amlokind5",  name: "Amlokind 5 Tablet", generic: "Amlodipine 5mg",
    manufacturer: "Mankind", hsn: "30049099", gst: 12, schedule: "H",
    packForm: "strip", packSize: 15, mrpPaise: 2800, imageSha: FAKE_SHA },
  { id: "prod_montek10",   name: "Montek LC Tablet", generic: "Montelukast 10mg + Levocetirizine 5mg",
    manufacturer: "Sun Pharma", hsn: "30049099", gst: 12, schedule: "H",
    packForm: "strip", packSize: 10, mrpPaise: 14900, imageSha: FAKE_SHA },

  // Schedule H1 — antibiotics/psychotropics requiring retention
  { id: "prod_alprax025",  name: "Alprax 0.25 Tablet", generic: "Alprazolam 0.25mg",
    manufacturer: "Torrent", hsn: "30049099", gst: 12, schedule: "H1",
    packForm: "strip", packSize: 15, mrpPaise: 2500, imageSha: FAKE_SHA },
  { id: "prod_moxikind625", name: "Moxikind-CV 625 Tablet", generic: "Amoxicillin 500mg + Clavulanic 125mg",
    manufacturer: "Mankind", hsn: "30042031", gst: 12, schedule: "H1",
    packForm: "strip", packSize: 10, mrpPaise: 18950, imageSha: FAKE_SHA },

  // Schedule X — ultra-restricted (example demo row)
  { id: "prod_pentaz30",   name: "Fortwin Injection 30mg/1ml", generic: "Pentazocine 30mg",
    manufacturer: "Ranbaxy", hsn: "30042029", gst: 12, schedule: "X",
    packForm: "injection", packSize: 1, mrpPaise: 4200, imageSha: FAKE_SHA },

  // Schedule G
  { id: "prod_insulin_hm", name: "Huminsulin R 40IU Vial 10ml", generic: "Human Insulin Regular",
    manufacturer: "Eli Lilly", hsn: "30043110", gst: 5, schedule: "G",
    packForm: "injection", packSize: 1, mrpPaise: 16400, imageSha: null },
];

// Expiry dates anchored on today=2026-04-15. Mix near/far/expired.
// Expired batch included to demo DB-level block.
export const BATCHES: SeedBatch[] = [
  // Crocin: 2 batches, FEFO must pick the earlier expiry first
  { id: "bat_crocin_A", productId: "prod_crocin500", batchNo: "CRN2510", mfg: "2025-10-01", expiry: "2027-09-30", qty: 240, costPaise: 2400, mrpPaise: 3600, supplierId: "sup_gsk" },
  { id: "bat_crocin_B", productId: "prod_crocin500", batchNo: "CRN2601", mfg: "2026-01-01", expiry: "2027-12-31", qty: 150, costPaise: 2400, mrpPaise: 3600, supplierId: "sup_gsk" },
  // Dolo650: near expiry
  { id: "bat_dolo_A",   productId: "prod_dolo650",   batchNo: "DOL2509", mfg: "2025-09-01", expiry: "2026-08-31", qty: 300, costPaise: 2300, mrpPaise: 3495, supplierId: "sup_localwhl" },
  // Digene
  { id: "bat_digene_A", productId: "prod_digene",    batchNo: "DIG2511", mfg: "2025-11-01", expiry: "2028-10-31", qty: 90,  costPaise: 4400, mrpPaise: 6500, supplierId: "sup_localwhl" },
  // Volini
  { id: "bat_volini_A", productId: "prod_volini50",  batchNo: "VOL2601", mfg: "2026-01-01", expiry: "2028-12-31", qty: 48,  costPaise: 12200, mrpPaise: 18300, supplierId: "sup_sun" },
  // ORS
  { id: "bat_ors_A",    productId: "prod_ors",       batchNo: "ELE2512", mfg: "2025-12-01", expiry: "2028-11-30", qty: 200, costPaise: 1550, mrpPaise: 2300, supplierId: "sup_localwhl" },
  // Vicks
  { id: "bat_vicks_A",  productId: "prod_vicks50",   batchNo: "VIC2510", mfg: "2025-10-01", expiry: "2029-09-30", qty: 60,  costPaise: 10400, mrpPaise: 15500, supplierId: "sup_localwhl" },
  // Saridon
  { id: "bat_saridon_A", productId: "prod_saridon",  batchNo: "SAR2602", mfg: "2026-02-01", expiry: "2029-01-31", qty: 120, costPaise: 2900, mrpPaise: 4300, supplierId: "sup_localwhl" },

  // Azithral: 2 batches, the first nearer expiry (FEFO test)
  { id: "bat_azi_A",    productId: "prod_azithral500", batchNo: "AZI2509", mfg: "2025-09-01", expiry: "2027-02-28", qty: 80, costPaise: 9300, mrpPaise: 13750, supplierId: "sup_alembic" },
  { id: "bat_azi_B",    productId: "prod_azithral500", batchNo: "AZI2601", mfg: "2026-01-01", expiry: "2028-12-31", qty: 60, costPaise: 9300, mrpPaise: 13750, supplierId: "sup_alembic" },
  // Augmentin
  { id: "bat_aug_A",    productId: "prod_augmentin625", batchNo: "AUG2511", mfg: "2025-11-01", expiry: "2027-10-31", qty: 45, costPaise: 17000, mrpPaise: 25250, supplierId: "sup_gsk" },
  // Pan40
  { id: "bat_pan_A",    productId: "prod_pan40",       batchNo: "PAN2510", mfg: "2025-10-01", expiry: "2027-09-30", qty: 120, costPaise: 11800, mrpPaise: 17400, supplierId: "sup_cipla" },
  // Telma40
  { id: "bat_telma_A",  productId: "prod_telma40",     batchNo: "TEL2512", mfg: "2025-12-01", expiry: "2027-11-30", qty: 90, costPaise: 12500, mrpPaise: 18500, supplierId: "sup_cipla" },
  // Glycomet
  { id: "bat_gly_A",    productId: "prod_glycomet500", batchNo: "GLY2509", mfg: "2025-09-01", expiry: "2027-08-31", qty: 250, costPaise: 2100, mrpPaise: 3200, supplierId: "sup_localwhl" },
  // Atorva
  { id: "bat_ator_A",   productId: "prod_atorva10",    batchNo: "ATO2510", mfg: "2025-10-01", expiry: "2027-09-30", qty: 180, costPaise: 5800, mrpPaise: 8700, supplierId: "sup_cipla" },
  // Amlokind
  { id: "bat_amlo_A",   productId: "prod_amlokind5",   batchNo: "AML2601", mfg: "2026-01-01", expiry: "2028-12-31", qty: 210, costPaise: 1800, mrpPaise: 2800, supplierId: "sup_localwhl" },
  // Montek LC
  { id: "bat_mon_A",    productId: "prod_montek10",    batchNo: "MON2511", mfg: "2025-11-01", expiry: "2027-10-31", qty: 70, costPaise: 10000, mrpPaise: 14900, supplierId: "sup_sun" },

  // Alprax (H1)
  { id: "bat_alp_A",    productId: "prod_alprax025",   batchNo: "ALP2512", mfg: "2025-12-01", expiry: "2027-11-30", qty: 80, costPaise: 1700, mrpPaise: 2500, supplierId: "sup_localwhl" },
  // Moxikind-CV (H1)
  { id: "bat_mox_A",    productId: "prod_moxikind625", batchNo: "MOX2601", mfg: "2026-01-01", expiry: "2027-12-31", qty: 50, costPaise: 12800, mrpPaise: 18950, supplierId: "sup_localwhl" },

  // Fortwin (X) — low stock
  { id: "bat_fort_A",   productId: "prod_pentaz30",    batchNo: "FOR2509", mfg: "2025-09-01", expiry: "2027-08-31", qty: 10, costPaise: 2900, mrpPaise: 4200, supplierId: "sup_localwhl" },

  // Insulin (G) — cold chain
  { id: "bat_ins_A",    productId: "prod_insulin_hm",  batchNo: "INS2602", mfg: "2026-02-01", expiry: "2027-01-31", qty: 25, costPaise: 10900, mrpPaise: 16400, supplierId: "sup_localwhl" },

  // EXPIRED batch — sits in stock, DB trigger blocks sale. Demo gate.
  { id: "bat_expired_dolo", productId: "prod_dolo650", batchNo: "DOL2401EXP", mfg: "2024-01-01", expiry: "2025-12-31", qty: 30, costPaise: 2300, mrpPaise: 3495, supplierId: "sup_localwhl" },
];
