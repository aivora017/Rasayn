// @pharmacare/demand-forecast
// Per-SKU demand forecasting via Holt-Winters triple-exponential-smoothing.
// Pure TypeScript — no Python infra, no Prophet/LSTM dependency. Single-shop
// scale; for 100+ shops switch to Prophet via a Tauri Python sidecar later.
//
// Algorithm:
//   Holt-Winters (additive seasonality) — captures level + trend + weekly
//   seasonality. Weekly cycle (period=7) is the right choice for retail
//   pharmacy where demand spikes on Mondays + dips on weekends.
//
// References:
//   Hyndman & Athanasopoulos, "Forecasting: Principles and Practice", §8.3
//   https://otexts.com/fpp3/holt-winters.html

import type { ProductId, Paise } from "@pharmacare/shared-types";
import { paise } from "@pharmacare/shared-types";

// ────────────────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────────────────

export interface DailySalesPoint {
  readonly date: string;      // ISO YYYY-MM-DD
  readonly qty: number;
}

export interface ForecastParams {
  /** Smoothing factors. Calibrated defaults work for most pharmacy SKUs.
   *  alpha = level smoothing (0..1, higher = more reactive)
   *  beta  = trend smoothing (0..1)
   *  gamma = seasonality smoothing (0..1) */
  readonly alpha: number;
  readonly beta:  number;
  readonly gamma: number;
  /** Weekly seasonality. */
  readonly seasonalPeriod: number;
}

export const DEFAULT_PARAMS: ForecastParams = {
  alpha: 0.4, beta: 0.1, gamma: 0.3, seasonalPeriod: 7,
};

// ────────────────────────────────────────────────────────────────────────
// Output
// ────────────────────────────────────────────────────────────────────────

export interface ForecastPoint {
  readonly date: string;          // ISO
  readonly expectedQty: number;   // point forecast
  readonly p90Qty: number;        // 90th percentile (upper)
  readonly p10Qty: number;        // 10th percentile (lower)
}

export interface ReorderRecommendation {
  readonly productId: ProductId;
  readonly horizonDays: number;
  readonly currentStockQty: number;
  readonly safetyStockQty: number;
  readonly reorderPointQty: number;
  readonly orderQty: number;
  readonly suggestedDistributorId?: string;
  readonly estCostPaise: Paise;
  readonly daysOfCoverLeft: number;
  readonly forecast: readonly ForecastPoint[];
}

// ────────────────────────────────────────────────────────────────────────
// Holt-Winters core
// ────────────────────────────────────────────────────────────────────────

export interface HoltWintersResult {
  readonly fitted: readonly number[];      // in-sample fitted values
  readonly forecast: readonly number[];    // out-of-sample forecast (length = horizon)
  readonly residualStdev: number;          // for confidence interval calc
  readonly finalLevel: number;
  readonly finalTrend: number;
  readonly finalSeasonals: readonly number[];
}

/** Fit Holt-Winters additive model + forecast `horizon` steps ahead. */
export function holtWintersForecast(
  series: readonly number[],
  horizon: number,
  params: ForecastParams = DEFAULT_PARAMS,
): HoltWintersResult {
  const { alpha, beta, gamma, seasonalPeriod: P } = params;

  if (series.length < 2 * P) {
    // Not enough data for seasonality; fall back to simple exponential smoothing.
    return simpleExponentialFallback(series, horizon, alpha);
  }

  // Initial level = average of first P values
  const initLevel = series.slice(0, P).reduce((s, v) => s + v, 0) / P;
  // Initial trend = average of first-period differences
  let trendSum = 0;
  for (let i = 0; i < P; i++) trendSum += (series[P + i]! - series[i]!) / P;
  const initTrend = trendSum / P;
  // Initial seasonals = first season's deviations from initial level
  const initSeasonals: number[] = [];
  for (let i = 0; i < P; i++) initSeasonals.push(series[i]! - initLevel);

  let level = initLevel;
  let trend = initTrend;
  const seasonals = [...initSeasonals];
  const fitted: number[] = [];
  const residuals: number[] = [];

  for (let t = 0; t < series.length; t++) {
    const s = seasonals[t % P]!;
    const forecastT = level + trend + s;
    fitted.push(forecastT);
    residuals.push(series[t]! - forecastT);

    const newLevel    = alpha * (series[t]! - s) + (1 - alpha) * (level + trend);
    const newTrend    = beta  * (newLevel - level) + (1 - beta) * trend;
    const newSeasonal = gamma * (series[t]! - newLevel) + (1 - gamma) * s;
    level = newLevel;
    trend = newTrend;
    seasonals[t % P] = newSeasonal;
  }

  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const s = seasonals[(series.length + h - 1) % P]!;
    forecast.push(Math.max(0, level + h * trend + s));    // demand can't be negative
  }

  // Residual stdev for prediction intervals
  const residMean = residuals.reduce((s, r) => s + r, 0) / residuals.length;
  const residVar = residuals.reduce((s, r) => s + (r - residMean) ** 2, 0) / Math.max(1, residuals.length - 1);
  const residualStdev = Math.sqrt(residVar);

  return { fitted, forecast, residualStdev, finalLevel: level, finalTrend: trend, finalSeasonals: seasonals };
}

/** Fall-back when series too short for seasonality detection. */
function simpleExponentialFallback(series: readonly number[], horizon: number, alpha: number): HoltWintersResult {
  if (series.length === 0) {
    return { fitted: [], forecast: new Array(horizon).fill(0), residualStdev: 0, finalLevel: 0, finalTrend: 0, finalSeasonals: [] };
  }
  let level = series[0]!;
  const fitted: number[] = [level];
  const residuals: number[] = [0];
  for (let t = 1; t < series.length; t++) {
    fitted.push(level);
    residuals.push(series[t]! - level);
    level = alpha * series[t]! + (1 - alpha) * level;
  }
  const forecast = new Array(horizon).fill(Math.max(0, level));
  const residMean = residuals.reduce((s, r) => s + r, 0) / Math.max(1, residuals.length);
  const residVar = residuals.reduce((s, r) => s + (r - residMean) ** 2, 0) / Math.max(1, residuals.length - 1);
  return { fitted, forecast, residualStdev: Math.sqrt(residVar), finalLevel: level, finalTrend: 0, finalSeasonals: [] };
}

// ────────────────────────────────────────────────────────────────────────
// Forecast point with prediction interval
// ────────────────────────────────────────────────────────────────────────

const Z_90 = 1.282;   // 90th percentile of standard normal

function buildForecastPoints(
  startIso: string,
  forecast: readonly number[],
  stdev: number,
): readonly ForecastPoint[] {
  const start = new Date(startIso);
  const out: ForecastPoint[] = [];
  for (let h = 0; h < forecast.length; h++) {
    const d = new Date(start.getTime() + (h + 1) * 24 * 60 * 60 * 1000);
    const expected = Math.round(forecast[h]!);
    // Interval widens with horizon — sqrt-of-time scaling
    const widthAtH = Z_90 * stdev * Math.sqrt(h + 1);
    out.push({
      date: d.toISOString().slice(0, 10),
      expectedQty: expected,
      p90Qty: Math.max(expected, Math.round(forecast[h]! + widthAtH)),
      p10Qty: Math.max(0, Math.round(forecast[h]! - widthAtH)),
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Public API: forecast + reorder
// ────────────────────────────────────────────────────────────────────────

export interface ForecastProductArgs {
  readonly productId: ProductId;
  readonly history: readonly DailySalesPoint[];   // chronological
  readonly horizonDays: number;
  readonly currentStockQty: number;
  readonly leadTimeDays?: number;                  // distributor lead (default 3d)
  readonly serviceLevel?: 0.90 | 0.95 | 0.98;     // default 0.95
  readonly perUnitCostPaise?: Paise;
  readonly suggestedDistributorId?: string;
}

const Z_AT_SERVICE: Record<number, number> = { 0.90: 1.282, 0.95: 1.645, 0.98: 2.054 };

/** Forecast a single product + recommend a reorder qty using the safety-stock formula. */
export function forecastProduct(a: ForecastProductArgs): ReorderRecommendation {
  const series = a.history.map((p) => p.qty);
  const today = a.history.length > 0 ? a.history[a.history.length - 1]!.date : new Date().toISOString().slice(0, 10);
  const result = holtWintersForecast(series, a.horizonDays);

  const points = buildForecastPoints(today, result.forecast, result.residualStdev);

  const leadTimeDays = a.leadTimeDays ?? 3;
  const serviceLevel = a.serviceLevel ?? 0.95;
  const z = Z_AT_SERVICE[serviceLevel] ?? 1.645;

  // Demand during lead time = sum of forecast over leadTimeDays
  const demandDuringLead = result.forecast.slice(0, leadTimeDays).reduce((s, v) => s + v, 0);
  // Safety stock = z * stdev * sqrt(leadTime)
  const safetyStock = Math.ceil(z * result.residualStdev * Math.sqrt(leadTimeDays));
  const reorderPoint = Math.ceil(demandDuringLead + safetyStock);

  // Order qty = bring stock up to (forecast horizon demand + safety) − current stock
  const horizonDemand = result.forecast.reduce((s, v) => s + v, 0);
  const targetStock = Math.ceil(horizonDemand + safetyStock);
  const orderQty = Math.max(0, targetStock - a.currentStockQty);

  // Days of cover at expected daily demand
  const avgDailyDemand = result.forecast.length > 0 ? horizonDemand / result.forecast.length : 0;
  const daysOfCoverLeft = avgDailyDemand > 0 ? Math.floor(a.currentStockQty / avgDailyDemand) : 999;

  return {
    productId: a.productId,
    horizonDays: a.horizonDays,
    currentStockQty: a.currentStockQty,
    safetyStockQty: safetyStock,
    reorderPointQty: reorderPoint,
    orderQty,
    ...(a.suggestedDistributorId !== undefined ? { suggestedDistributorId: a.suggestedDistributorId } : {}),
    estCostPaise: paise((a.perUnitCostPaise ?? paise(0) as number) * orderQty),
    daysOfCoverLeft,
    forecast: points,
  };
}

/** Train forecasts for every product in a shop (nightly batch). */
export function trainForShop(args: {
  readonly products: ReadonlyArray<{
    productId: ProductId;
    history: readonly DailySalesPoint[];
    currentStockQty: number;
    leadTimeDays?: number;
    perUnitCostPaise?: Paise;
    suggestedDistributorId?: string;
  }>;
  readonly horizonDays?: number;
  readonly nowIso?: string;
}): { trained: number; recommendations: readonly ReorderRecommendation[]; durationMs: number } {
  const start = Date.now();
  const horizonDays = args.horizonDays ?? 30;
  const recommendations: ReorderRecommendation[] = [];
  for (const p of args.products) {
    if (p.history.length === 0) continue;
    recommendations.push(forecastProduct({
      productId: p.productId,
      history: p.history,
      horizonDays,
      currentStockQty: p.currentStockQty,
      ...(p.leadTimeDays !== undefined ? { leadTimeDays: p.leadTimeDays } : {}),
      ...(p.perUnitCostPaise !== undefined ? { perUnitCostPaise: p.perUnitCostPaise } : {}),
      ...(p.suggestedDistributorId !== undefined ? { suggestedDistributorId: p.suggestedDistributorId } : {}),
    }));
  }
  return { trained: recommendations.length, recommendations, durationMs: Date.now() - start };
}
