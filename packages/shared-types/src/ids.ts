// Branded ID types \u2014 prevents passing a ProductId where a BatchId is expected.

type Brand<K, T> = K & { readonly __brand: T };

export type ShopId     = Brand<string, "ShopId">;
export type ProductId  = Brand<string, "ProductId">;
export type BatchId    = Brand<string, "BatchId">;
export type BillId     = Brand<string, "BillId">;
export type BillLineId = Brand<string, "BillLineId">;
export type CustomerId = Brand<string, "CustomerId">;
export type DoctorId   = Brand<string, "DoctorId">;
export type RxId       = Brand<string, "RxId">;
export type UserId     = Brand<string, "UserId">;
export type SupplierId = Brand<string, "SupplierId">;

export const asShopId     = (s: string): ShopId     => s as ShopId;
export const asProductId  = (s: string): ProductId  => s as ProductId;
export const asBatchId    = (s: string): BatchId    => s as BatchId;
export const asBillId     = (s: string): BillId     => s as BillId;
export const asBillLineId = (s: string): BillLineId => s as BillLineId;
export const asCustomerId = (s: string): CustomerId => s as CustomerId;
export const asDoctorId   = (s: string): DoctorId   => s as DoctorId;
export const asRxId       = (s: string): RxId       => s as RxId;
export const asUserId     = (s: string): UserId     => s as UserId;
export const asSupplierId = (s: string): SupplierId => s as SupplierId;
