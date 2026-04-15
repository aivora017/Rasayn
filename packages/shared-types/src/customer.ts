import type { CustomerId, DoctorId, RxId, ShopId } from "./ids.js";

export interface Customer {
  readonly id: CustomerId;
  readonly shopId: ShopId;
  readonly name: string;
  readonly phone: string | null;          // E.164 or 10-digit
  readonly dob: string | null;            // ISO date
  readonly gender: "M" | "F" | "O" | null;
  readonly gstin: string | null;          // for B2B
  readonly address: string | null;
  readonly consent: ConsentRecord;        // DPDP Act 2023
  readonly createdAt: string;
}

export interface ConsentRecord {
  readonly marketing: boolean;
  readonly dataSharingABDM: boolean;      // ABDM opt-in
  readonly capturedAt: string;            // ISO 8601
  readonly method: "verbal" | "signed" | "otp" | "app";
}

export interface Doctor {
  readonly id: DoctorId;
  readonly regNo: string;                 // MCI / state council reg
  readonly name: string;
  readonly phone: string | null;
}

export type RxKind = "paper" | "digital" | "abdm";

export interface Rx {
  readonly id: RxId;
  readonly shopId: ShopId;
  readonly customerId: CustomerId;
  readonly doctorId: DoctorId | null;
  readonly kind: RxKind;
  readonly imagePath: string | null;      // LAN-local file path for paper Rx scan
  readonly issuedDate: string;            // ISO date
  readonly notes: string | null;
  readonly createdAt: string;
}
