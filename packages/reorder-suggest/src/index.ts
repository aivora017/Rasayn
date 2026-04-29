// @pharmacare/reorder-suggest
// Pure auto-PO suggestion engine. Combines current stock + demand-forecast
// horizon + supplier MOQ/lead-time to produce a ranked reorder list,
// grouped by supplier so the owner can split into per-supplier POs.
//
// Math:
//   forecast_window = lead_time_days + safety_days
//   expected_demand = sum(forecast over forecast_window)
//   reorder_qty = ceil(max(0, expected_demand + safety_stock - on_hand))
//   round to MOQ multiple
//   if reorder_qty > 0 → suggest

// ────────────────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────────────────

export interface StockSnapshot {
  readonly productId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly preferredSupplierId: string;
  readonly onHandUnits: number;
  readonly avgCostPaise: number;       // weighted avg from recent GRNs
  readonly safetyStockUnits: number;
}

export interface SupplierProfile {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly leadTimeDays: number;
  readonly minOrderValuePaise: number;  // some distributors require min PO size
  readonly moqByProductId: Readonly<Record<string, number>>;
}

export interface DemandForecast {
  readonly productId: string;
  /** Daily demand units, indexed [day0, day1, ...]. */
  readonly dailyUnits: readonly number[];
}

export interface ReorderInputs {
  readonly stocks: readonly StockSnapshot[];
  readonly suppliers: readonly SupplierProfile[];
  readonly forecasts: readonly DemandForecast[];
  /** Days of safety on top of lead time (default 7). */
  readonly safetyDaysExtra?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────────────────────────────

export type Urgency = "critical" | "high" | "normal";

export interface ReorderSuggestion {
  readonly productId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly supplierId: string;
  readonly onHandUnits: number;
  readonly expectedDemandUnits: number;
  readonly safetyStockUnits: number;
  readonly suggestQtyUnits: number;
  readonly suggestValuePaise: number;
  readonly urgency: Urgency;
  readonly daysOfStockLeft: number;
}

export interface SupplierPOGroup {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly leadTimeDays: number;
  readonly lines: readonly ReorderSuggestion[];
  readonly totalValuePaise: number;
  readonly meetsMinOrderValue: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Core
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_SAFETY_DAYS = 7;

export function computeSuggestions(input: ReorderInputs): readonly ReorderSuggestion[] {
  const safetyDays = input.safetyDaysExtra ?? DEFAULT_SAFETY_DAYS;
  const supplierIndex = new Map(input.suppliers.map((s) => [s.supplierId, s]));
  const forecastIndex = new Map(input.forecasts.map((f) => [f.productId, f]));

  const out: ReorderSuggestion[] = [];
  for (const stock of input.stocks) {
    const supplier = supplierIndex.get(stock.preferredSupplierId);
    const forecast = forecastIndex.get(stock.productId);
    if (!supplier || !forecast) continue;

    const window = supplier.leadTimeDays + safetyDays;
    const expectedDemand = sumFirstN(forecast.dailyUnits, window);

    const target = expectedDemand + stock.safetyStockUnits;
    let needUnits = Math.max(0, Math.ceil(target - stock.onHandUnits));
    if (needUnits === 0) continue;

    // Round up to MOQ multiple if specified.
    const moq = supplier.moqByProductId[stock.productId] ?? 1;
    if (moq > 1) needUnits = Math.ceil(needUnits / moq) * moq;

    const dailyAvg = average(forecast.dailyUnits.slice(0, Math.max(7, window)));
    const daysLeft = dailyAvg > 0 ? Math.floor(stock.onHandUnits / dailyAvg) : Infinity;
    const urgency: Urgency =
      daysLeft <= supplier.leadTimeDays ? "critical" :
      daysLeft <= supplier.leadTimeDays + 3 ? "high" : "normal";

    out.push({
      productId: stock.productId,
      productName: stock.productName,
      skuCode: stock.skuCode,
      supplierId: supplier.supplierId,
      onHandUnits: stock.onHandUnits,
      expectedDemandUnits: Math.round(expectedDemand),
      safetyStockUnits: stock.safetyStockUnits,
      suggestQtyUnits: needUnits,
      suggestValuePaise: needUnits * stock.avgCostPaise,
      urgency,
      daysOfStockLeft: daysLeft === Infinity ? 9999 : daysLeft,
    });
  }
  // Sort: critical first, then highest value
  return [...out].sort((a, b) => {
    const urg: Record<Urgency, number> = { critical: 0, high: 1, normal: 2 };
    if (urg[a.urgency] !== urg[b.urgency]) return urg[a.urgency] - urg[b.urgency];
    return b.suggestValuePaise - a.suggestValuePaise;
  });
}

export function groupBySupplier(
  suggestions: readonly ReorderSuggestion[],
  suppliers: readonly SupplierProfile[],
): readonly SupplierPOGroup[] {
  const supplierIndex = new Map(suppliers.map((s) => [s.supplierId, s]));
  const groups = new Map<string, ReorderSuggestion[]>();
  for (const s of suggestions) {
    const list = groups.get(s.supplierId) ?? [];
    list.push(s);
    groups.set(s.supplierId, list);
  }
  const out: SupplierPOGroup[] = [];
  for (const [supplierId, lines] of groups) {
    const sup = supplierIndex.get(supplierId);
    if (!sup) continue;
    const total = lines.reduce((acc, l) => acc + l.suggestValuePaise, 0);
    out.push({
      supplierId,
      supplierName: sup.supplierName,
      leadTimeDays: sup.leadTimeDays,
      lines,
      totalValuePaise: total,
      meetsMinOrderValue: total >= sup.minOrderValuePaise,
    });
  }
  // Most valuable supplier first.
  return out.sort((a, b) => b.totalValuePaise - a.totalValuePaise);
}

function sumFirstN(arr: readonly number[], n: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(n, arr.length); i++) sum += arr[i]!;
  return sum;
}

function average(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

// ────────────────────────────────────────────────────────────────────────
// Export to PO-ready row shape
// ────────────────────────────────────────────────────────────────────────

export interface PORow {
  readonly skuCode: string;
  readonly productName: string;
  readonly qty: number;
  readonly rateRupees: number;
  readonly amountRupees: number;
}

export function buildPORows(group: SupplierPOGroup): readonly PORow[] {
  return group.lines.map((l) => ({
    skuCode: l.skuCode,
    productName: l.productName,
    qty: l.suggestQtyUnits,
    rateRupees: round2((l.suggestValuePaise / l.suggestQtyUnits) / 100),
    amountRupees: round2(l.suggestValuePaise / 100),
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
