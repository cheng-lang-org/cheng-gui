import type { DexSide } from './types';

export interface SpreadInput {
  baseSpreadBps: number;
  maxSpreadBps: number;
  volatilityBps: number;
  inventorySkew: number;
  latencyP95Ms: number;
}

export interface SpreadResult {
  baseSpreadBps: number;
  maxSpreadBps: number;
  volAdjBps: number;
  invAdjBps: number;
  latencyAdjBps: number;
  effectiveSpreadBps: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stdDev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  const mean = values.reduce((acc, item) => acc + item, 0) / values.length;
  const variance = values.reduce((acc, item) => acc + (item - mean) * (item - mean), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

export function computeVolAdjBps(priceSamples60s: number[]): number {
  const series = priceSamples60s.filter((item) => Number.isFinite(item) && item > 0);
  if (series.length <= 1) {
    return 0;
  }
  const mean = series.reduce((acc, item) => acc + item, 0) / series.length;
  if (mean <= 0) {
    return 0;
  }
  const realizedVol = stdDev(series) / mean;
  return Math.max(0, Math.round(realizedVol * 10_000));
}

export function computeInventoryAdjBps(currentQty: number, targetQty: number): number {
  if (!Number.isFinite(currentQty) || !Number.isFinite(targetQty) || targetQty <= 0) {
    return 0;
  }
  const deviation = Math.abs(currentQty - targetQty) / targetQty;
  return Math.max(0, Math.round(deviation * 100));
}

export function computeLatencyAdjBps(latencyP95Ms: number): number {
  if (!Number.isFinite(latencyP95Ms) || latencyP95Ms <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(Math.max(0, latencyP95Ms - 300) / 150));
}

export function computeEffectiveSpread(input: SpreadInput): SpreadResult {
  const base = Math.max(1, Math.floor(input.baseSpreadBps));
  const max = Math.max(base, Math.floor(input.maxSpreadBps));

  const volAdj = clamp(Math.round(Math.max(0, input.volatilityBps) * 0.4), 0, Math.max(0, max - base));
  const invAdj = clamp(Math.round(Math.abs(input.inventorySkew) * base * 1.5), 0, Math.max(0, max - base));
  const latencyAdj = clamp(computeLatencyAdjBps(input.latencyP95Ms), 0, Math.max(0, max - base));
  const effective = clamp(base + volAdj + invAdj + latencyAdj, base, max);

  return {
    baseSpreadBps: base,
    maxSpreadBps: max,
    volAdjBps: volAdj,
    invAdjBps: invAdj,
    latencyAdjBps: latencyAdj,
    effectiveSpreadBps: effective,
  };
}

export function quotePriceWithSpread(midPrice: number, side: DexSide, spreadBps: number): number {
  if (!Number.isFinite(midPrice) || midPrice <= 0) {
    return 0;
  }
  const spread = Math.max(0, spreadBps) / 10_000;
  const multiplier = side === 'BUY' ? 1 - spread : 1 + spread;
  return Number((midPrice * multiplier).toFixed(8));
}
