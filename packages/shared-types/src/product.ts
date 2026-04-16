import type { ProductId, BatchId, SupplierId } from "./ids.js";
import type { DrugSchedule, HSN, GstRate } from "./compliance.js";
import type { Paise } from "./money.js";

export type PackForm =
  | "tablet" | "capsule" | "syrup" | "injection" | "ointment"
  | "drops" | "inhaler" | "device" | "strip" | "bottle" | "other";

export interface Product {
  readonly id: ProductId;
  readonly name: string;                  // Trade name
  readonly genericName: string | null;    // Salt / molecule
  readonly manufacturer: string;
  readonly hsn: HSN;
  readonly gstRate: GstRate;
  readonly schedule: DrugSchedule;
  readonly packForm: PackForm;
  readonly packSize: number;              // units per pack (e.g. 10 tabs/strip)
  readonly mrpPaise: Paise;               // MRP (incl. GST) — must be <= nppaMaxMrpPaise when set
  readonly nppaMaxMrpPaise: Paise | null; // DPCO 2013 / NPPA ceiling price; null = uncontrolled
  readonly imageSha256: string | null;    // X2 moat — mandatory for Schedule H/H1/X
  readonly isActive: boolean;
  readonly createdAt: string;             // ISO 8601
  readonly updatedAt: string;
}

export interface Batch {
  readonly id: BatchId;
  readonly productId: ProductId;
  readonly batchNo: string;
  readonly mfgDate: string;               // ISO date (YYYY-MM)
  readonly expiryDate: string;            // ISO date (YYYY-MM) \u2014 last day of month
  readonly qtyOnHand: number;             // in units (not packs)
  readonly purchasePricePaise: Paise;     // cost per unit, pre-GST
  readonly mrpPaise: Paise;               // batch MRP (can differ from product default)
  readonly supplierId: SupplierId;
  readonly grnId: string | null;
  readonly createdAt: string;
}
