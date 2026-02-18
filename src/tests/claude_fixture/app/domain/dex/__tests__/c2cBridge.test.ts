import { describe, expect, it } from 'vitest';
import { decideDexToC2CFallback } from '../c2cBridge';

function fakeStore(depth: unknown) {
  return {
    getDepth: () => depth,
  } as any;
}

describe('dex c2c bridge fallback policy', () => {
  it('triggers fallback when depth is missing', () => {
    const result = decideDexToC2CFallback({
      marketId: 'BTC-USDC',
      side: 'BUY',
      qty: 0.1,
      orderbookStore: fakeStore(null),
    });
    expect(result.shouldFallback).toBe(true);
    expect(result.reason).toBe('insufficient_depth');
  });

  it('skips fallback when depth can fill with low slippage', () => {
    const result = decideDexToC2CFallback({
      marketId: 'BTC-USDC',
      side: 'BUY',
      qty: 0.2,
      orderbookStore: fakeStore({
        marketId: 'BTC-USDC',
        sequence: 1,
        checksum: 'ok',
        bids: [{ price: 99990, qty: 1 }],
        asks: [{ price: 100000, qty: 1 }, { price: 100010, qty: 1 }],
        updatedAtMs: Date.now(),
        ts: Date.now(),
      }),
    });
    expect(result.shouldFallback).toBe(false);
  });

  it('triggers fallback when expected slippage exceeds threshold', () => {
    const result = decideDexToC2CFallback({
      marketId: 'BTC-USDC',
      side: 'BUY',
      qty: 0.02,
      orderbookStore: fakeStore({
        marketId: 'BTC-USDC',
        sequence: 2,
        checksum: 'ok',
        bids: [{ price: 100, qty: 1 }],
        asks: [{ price: 100, qty: 0.01 }, { price: 200, qty: 1 }],
        updatedAtMs: Date.now(),
        ts: Date.now(),
      }),
    });
    expect(result.shouldFallback).toBe(true);
    expect(result.reason).toBe('fallback_slippage_exceeded');
  });
});
