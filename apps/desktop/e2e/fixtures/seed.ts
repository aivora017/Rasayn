// Minimal deterministic seed data for pharmacare-pro E2E.
// Mirrors the IPC contract DTOs in apps/desktop/src/lib/ipc.ts.
// Keep this file dependency-free (no Playwright imports) so it can be
// inlined into the in-page IPC stub via Playwright's addInitScript.

export const SEED_SHOP = {
  id: "shop_local",
  name: "Vaidyanath E2E",
  gstin: "27AAAPV1234A1ZA",
  stateCode: "27",
  retailLicense: "MH-KAL-0001",
  address: "Kalyan, MH 421301",
} as const;

export const SEED_USER = {
  id: "user_e2e",
  shopId: SEED_SHOP.id,
  username: "e2e",
  // password "e2e" — never trust this for real auth, fixture only
  passwordHash: "$2a$10$e2eTestHashFixtureNeverUseInProd",
  role: "owner" as const,
};

export const SEED_DRUG = {
  id: "prod_e2e_paracetamol",
  name: "Paracetamol 500mg",
  genericName: "Paracetamol",
  manufacturer: "Cipla",
  hsn: "30049099",
  gstRate: 12 as const,
  schedule: "OTC" as const,
  mrpPaise: 2_500,
};

export const SEED_BATCH = {
  id: "batch_e2e_001",
  productId: SEED_DRUG.id,
  batchNo: "B-E2E-001",
  expiryDate: "2027-12-31",
  qtyOnHand: 100,
  mrpPaise: SEED_DRUG.mrpPaise,
};

export const SEED_BILL = {
  id: "bill_e2e_existing",
  shopId: SEED_SHOP.id,
  billNo: "INV-E2E-0001",
  cashierId: SEED_USER.id,
  customerId: null,
  paymentMode: "cash" as const,
  customerStateCode: SEED_SHOP.stateCode,
  lines: [
    {
      productId: SEED_DRUG.id,
      batchId: SEED_BATCH.id,
      mrpPaise: SEED_DRUG.mrpPaise,
      qty: 2,
      gstRate: SEED_DRUG.gstRate,
    },
  ],
  grandTotalPaise: 5_600,
};

export const SEED_CREDS = {
  username: "e2e",
  password: "e2e",
} as const;
