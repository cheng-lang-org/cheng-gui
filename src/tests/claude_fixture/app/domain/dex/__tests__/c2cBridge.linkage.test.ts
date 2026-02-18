import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { C2CSnapshot, C2CTradeRecord } from '../../c2c/types';

let snapshotState: C2CSnapshot = {
  listings: [],
  orders: [],
  trades: [],
  receipts: [],
  updatedAt: Date.now(),
};

const listeners = new Set<(snapshot: C2CSnapshot) => void>();
const placeMarketOrderMock = vi.fn(async () => ({ ok: false, reason: 'disabled_in_test' }));

function emitSnapshot(next: C2CSnapshot): void {
  snapshotState = next;
  for (const listener of listeners) {
    listener(next);
  }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function makeTrade(input: {
  tradeId: string;
  seller: string;
  buyer: string;
  assetId: string;
  qty: number;
  settledAtMs: number;
  marketId?: string;
}): C2CTradeRecord {
  return {
    tradeId: input.tradeId,
    orderId: `ord-${input.tradeId}`,
    listingId: `lst-${input.tradeId}`,
    escrowId: `mkt1:${input.assetId}:${input.qty}:${input.seller}:${input.buyer}:nonce`,
    assetId: input.assetId,
    buyer: input.buyer,
    seller: input.seller,
    qty: input.qty,
    unitPriceRwads: 1000,
    totalRwads: Math.floor(input.qty * 1000),
    releaseTxHash: `tx-${input.tradeId}`,
    escrowState: 'RELEASED',
    settledAtMs: input.settledAtMs,
    metadata: input.marketId ? { marketId: input.marketId } : undefined,
    source: 'local',
  };
}

function makeSnapshot(trades: C2CTradeRecord[]): C2CSnapshot {
  return {
    listings: [],
    orders: [],
    trades,
    receipts: [],
    updatedAt: Date.now(),
  };
}

vi.mock('../../c2c/c2cSync', () => ({
  getC2CSnapshot: () => snapshotState,
  subscribeC2CSnapshot: (listener: (snapshot: C2CSnapshot) => void) => {
    listeners.add(listener);
    listener(snapshotState);
    return () => {
      listeners.delete(listener);
    };
  },
  placeMarketOrder: (input: unknown, signer: unknown) => placeMarketOrderMock(input, signer),
}));

vi.mock('../../c2c/c2cStore', () => ({
  pickVerifiedListings: () => [],
}));

import { DexC2CBridgeService } from '../c2cBridge';

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  snapshotState = makeSnapshot([]);
});

describe('dex c2c bridge linkage', () => {
  it('does not hedge historical trades on start and only hedges new trades', async () => {
    const historical = makeTrade({
      tradeId: 't-old',
      seller: 'maker-1',
      buyer: 'buyer-1',
      assetId: 'paxg_wrapped_v1',
      qty: 1,
      settledAtMs: 1,
      marketId: 'XAU-USDT',
    });
    snapshotState = makeSnapshot([historical]);

    const service = new DexC2CBridgeService();
    const onHedgeSignal = vi.fn(async () => ({ ok: true, orderId: 'dex-hedge-1' }));
    const emitLink = vi.fn(async () => {});

    service.start({
      getLocalAddresses: () => new Set(['maker-1']),
      onHedgeSignal,
      emitLink,
    });
    await flushAsync();

    expect(onHedgeSignal).not.toHaveBeenCalled();

    const fresh = makeTrade({
      tradeId: 't-new',
      seller: 'maker-1',
      buyer: 'buyer-2',
      assetId: 'paxg_wrapped_v1',
      qty: 2,
      settledAtMs: 2,
      marketId: 'XAU-USDT',
    });
    emitSnapshot(makeSnapshot([historical, fresh]));
    await flushAsync();

    expect(onHedgeSignal).toHaveBeenCalledTimes(1);
    expect(onHedgeSignal.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      marketId: 'XAU-USDT',
      side: 'BUY',
      relatedTradeId: 't-new',
    }));
    expect(emitLink).toHaveBeenCalledTimes(2);

    service.stop();
  });

  it('keeps restart idempotent and avoids duplicate hedges for already-seen trades', async () => {
    const t1 = makeTrade({
      tradeId: 't-1',
      seller: 'maker-2',
      buyer: 'buyer-1',
      assetId: 'btc_wrapped_v1',
      qty: 1,
      settledAtMs: 1,
      marketId: 'BTC-USDT',
    });
    const t2 = makeTrade({
      tradeId: 't-2',
      seller: 'maker-2',
      buyer: 'buyer-2',
      assetId: 'btc_wrapped_v1',
      qty: 1,
      settledAtMs: 2,
      marketId: 'BTC-USDT',
    });
    snapshotState = makeSnapshot([t1, t2]);

    const service = new DexC2CBridgeService();
    const onHedgeSignal = vi.fn(async () => ({ ok: true, orderId: 'dex-hedge-ok' }));
    const emitLink = vi.fn(async () => {});

    service.start({
      getLocalAddresses: () => new Set(['maker-2']),
      onHedgeSignal,
      emitLink,
    });
    await flushAsync();
    expect(onHedgeSignal).not.toHaveBeenCalled();

    service.stop();

    service.start({
      getLocalAddresses: () => new Set(['maker-2']),
      onHedgeSignal,
      emitLink,
    });
    await flushAsync();
    expect(onHedgeSignal).not.toHaveBeenCalled();

    const t3 = makeTrade({
      tradeId: 't-3',
      seller: 'maker-2',
      buyer: 'buyer-3',
      assetId: 'btc_wrapped_v1',
      qty: 1,
      settledAtMs: 3,
      marketId: 'BTC-USDT',
    });
    emitSnapshot(makeSnapshot([t1, t2, t3]));
    await flushAsync();

    expect(onHedgeSignal).toHaveBeenCalledTimes(1);
    expect(onHedgeSignal.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      relatedTradeId: 't-3',
      marketId: 'BTC-USDT',
      side: 'BUY',
    }));

    service.stop();
  });
});
