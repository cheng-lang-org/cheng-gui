import { describe, expect, it } from 'vitest';
import {
  computeEffectiveSpread,
  computeInventoryAdjBps,
  computeLatencyAdjBps,
  computeVolAdjBps,
  quotePriceWithSpread,
} from '../spreadEngine';

describe('dex spread engine', () => {
  it('clamps spread into [base, max]', () => {
    const spread = computeEffectiveSpread({
      baseSpreadBps: 18,
      maxSpreadBps: 60,
      volatilityBps: 400,
      inventorySkew: 2,
      latencyP95Ms: 10_000,
    });
    expect(spread.effectiveSpreadBps).toBeGreaterThanOrEqual(18);
    expect(spread.effectiveSpreadBps).toBeLessThanOrEqual(60);
  });

  it('computes volatility adjustment from 60s series', () => {
    const lowVol = computeVolAdjBps([100, 100.01, 99.99, 100.0, 100.02]);
    const highVol = computeVolAdjBps([100, 102, 96, 104, 95]);
    expect(highVol).toBeGreaterThan(lowVol);
  });

  it('computes inventory and latency adjustments', () => {
    expect(computeInventoryAdjBps(10, 10)).toBe(0);
    expect(computeInventoryAdjBps(20, 10)).toBeGreaterThan(0);
    expect(computeLatencyAdjBps(200)).toBe(0);
    expect(computeLatencyAdjBps(1200)).toBeGreaterThan(0);
  });

  it('applies side-aware quote price', () => {
    expect(quotePriceWithSpread(100, 'BUY', 20)).toBeLessThan(100);
    expect(quotePriceWithSpread(100, 'SELL', 20)).toBeGreaterThan(100);
  });
});
