import { getC2CSnapshot, placeMarketOrder, subscribeC2CSnapshot } from '../c2c/c2cSync';
import { pickVerifiedListings } from '../c2c/c2cStore';
import type { C2CSnapshot, C2CTradeRecord } from '../c2c/types';
import { getDexMarketConfigById, inferDexMarketIdByAssetId } from './marketConfig';
import { estimateDepthFill, type DexOrderbookStore } from './orderbookStore';
import type { DexC2CLinkV1, DexLinkStatus, DexMarketId, DexSide, DexSignerIdentity } from './types';

export interface DexFallbackDecision {
  shouldFallback: boolean;
  reason?: 'insufficient_depth' | 'fallback_slippage_exceeded' | 'sell_side_c2c_fallback_unsupported';
  slippageBps: number;
  filledQty: number;
}

export interface DexToC2CFallbackInput {
  marketId: DexMarketId;
  side: DexSide;
  qty: number;
  signer: DexSignerIdentity;
  orderId?: string;
  orderbookStore: DexOrderbookStore;
  emitLink: (link: DexC2CLinkV1) => Promise<void> | void;
}

export interface C2CToDexHedgeSignal {
  marketId: DexMarketId;
  side: DexSide;
  qty: number;
  relatedTradeId: string;
}

export interface C2CToDexHedgeResult {
  ok: boolean;
  orderId?: string;
  reason?: string;
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAssetLike(value: string): string {
  return value.trim().toLowerCase();
}

function listingMatchesMarketAsset(assetId: string, marketId: DexMarketId): boolean {
  const market = getDexMarketConfigById(marketId);
  if (!market) {
    return false;
  }
  const normalized = normalizeAssetLike(assetId);
  if (normalized === normalizeAssetLike(market.assetId)) {
    return true;
  }
  if (market.baseAsset === 'XAU') {
    return normalized.includes('xau') || normalized.includes('paxg');
  }
  if (market.baseAsset === 'BTC') {
    return normalized.includes('btc');
  }
  return false;
}

function toIntQty(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor(value));
}

function fallbackDecision(input: {
  marketId: DexMarketId;
  side: DexSide;
  qty: number;
  orderbookStore: DexOrderbookStore;
}): DexFallbackDecision {
  const market = getDexMarketConfigById(input.marketId);
  if (!market) {
    return { shouldFallback: true, reason: 'insufficient_depth', slippageBps: 0, filledQty: 0 };
  }
  if (input.side === 'SELL') {
    return {
      shouldFallback: false,
      reason: 'sell_side_c2c_fallback_unsupported',
      slippageBps: 0,
      filledQty: 0,
    };
  }

  const depth = input.orderbookStore.getDepth(input.marketId);
  const estimate = estimateDepthFill({
    side: input.side,
    qty: input.qty,
    depth,
  });
  if (estimate.filledQty + 1e-12 < input.qty) {
    return {
      shouldFallback: true,
      reason: 'insufficient_depth',
      slippageBps: estimate.slippageBps,
      filledQty: estimate.filledQty,
    };
  }
  if (estimate.slippageBps > market.fallbackSlippageBps) {
    return {
      shouldFallback: true,
      reason: 'fallback_slippage_exceeded',
      slippageBps: estimate.slippageBps,
      filledQty: estimate.filledQty,
    };
  }
  return {
    shouldFallback: false,
    slippageBps: estimate.slippageBps,
    filledQty: estimate.filledQty,
  };
}

function buildLink(input: {
  marketId: DexMarketId;
  status: DexLinkStatus;
  reason?: string;
  direction: DexC2CLinkV1['direction'];
  relatedOrderId?: string;
  relatedTradeId?: string;
}): DexC2CLinkV1 {
  return {
    linkId: nowId('dex-link'),
    marketId: input.marketId,
    direction: input.direction,
    status: input.status,
    reason: input.reason,
    relatedOrderId: input.relatedOrderId,
    relatedTradeId: input.relatedTradeId,
    ts: Date.now(),
  };
}

export function decideDexToC2CFallback(input: {
  marketId: DexMarketId;
  side: DexSide;
  qty: number;
  orderbookStore: DexOrderbookStore;
}): DexFallbackDecision {
  return fallbackDecision(input);
}

export async function runDexToC2CFallback(input: DexToC2CFallbackInput): Promise<{
  ok: boolean;
  reason?: string;
  c2cOrderId?: string;
  linkId?: string;
}> {
  const decision = fallbackDecision({
    marketId: input.marketId,
    side: input.side,
    qty: input.qty,
    orderbookStore: input.orderbookStore,
  });
  if (!decision.shouldFallback) {
    return {
      ok: false,
      reason: decision.reason || 'fallback_not_required',
    };
  }

  const trigger = buildLink({
    marketId: input.marketId,
    direction: 'DEX_TO_C2C_FALLBACK',
    status: 'TRIGGERED',
    reason: decision.reason,
    relatedOrderId: input.orderId,
  });
  await input.emitLink(trigger);

  if (input.side !== 'BUY') {
    const skipped = buildLink({
      marketId: input.marketId,
      direction: 'DEX_TO_C2C_FALLBACK',
      status: 'SKIPPED',
      reason: 'sell_side_c2c_fallback_unsupported',
      relatedOrderId: input.orderId,
    });
    await input.emitLink(skipped);
    return {
      ok: false,
      reason: 'sell_side_c2c_fallback_unsupported',
      linkId: skipped.linkId,
    };
  }

  const listings = pickVerifiedListings(getC2CSnapshot())
    .filter((item) => listingMatchesMarketAsset(item.assetId, input.marketId))
    .sort((a, b) => a.unitPriceRwads - b.unitPriceRwads);
  if (listings.length === 0) {
    const failed = buildLink({
      marketId: input.marketId,
      direction: 'DEX_TO_C2C_FALLBACK',
      status: 'FAILED',
      reason: 'c2c_liquidity_unavailable',
      relatedOrderId: input.orderId,
    });
    await input.emitLink(failed);
    return {
      ok: false,
      reason: 'c2c_liquidity_unavailable',
      linkId: failed.linkId,
    };
  }

  const listing = listings[0];
  const qtyInt = Math.min(listing.maxQty, Math.max(listing.minQty, toIntQty(input.qty)));
  const result = await placeMarketOrder(
    {
      listingId: listing.listingId,
      qty: qtyInt,
    },
    input.signer,
  );

  if (!result.ok) {
    const failed = buildLink({
      marketId: input.marketId,
      direction: 'DEX_TO_C2C_FALLBACK',
      status: 'FAILED',
      reason: result.reason || 'c2c_order_failed',
      relatedOrderId: input.orderId,
    });
    await input.emitLink(failed);
    return {
      ok: false,
      reason: result.reason || 'c2c_order_failed',
      linkId: failed.linkId,
    };
  }

  const executed = buildLink({
    marketId: input.marketId,
    direction: 'DEX_TO_C2C_FALLBACK',
    status: 'EXECUTED',
    reason: decision.reason,
    relatedOrderId: input.orderId,
    relatedTradeId: result.orderId,
  });
  await input.emitLink(executed);
  return {
    ok: true,
    c2cOrderId: result.orderId,
    linkId: executed.linkId,
  };
}

function marketIdFromTrade(trade: C2CTradeRecord): DexMarketId | null {
  const metadata = (trade.metadata ?? {}) as Record<string, unknown>;
  const candidate = typeof metadata.marketId === 'string' ? metadata.marketId : '';
  if (candidate === 'BTC-USDC' || candidate === 'BTC-USDT' || candidate === 'XAU-USDC' || candidate === 'XAU-USDT') {
    return candidate;
  }
  return inferDexMarketIdByAssetId(trade.assetId);
}

function createHedgeSignal(trade: C2CTradeRecord, localAddresses: Set<string>): C2CToDexHedgeSignal | null {
  const marketId = marketIdFromTrade(trade);
  if (!marketId) {
    return null;
  }
  const sellerMine = localAddresses.has(trade.seller);
  const buyerMine = localAddresses.has(trade.buyer);
  if (!sellerMine && !buyerMine) {
    return null;
  }

  const side: DexSide = sellerMine ? 'BUY' : 'SELL';
  const qty = Number(trade.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }
  return {
    marketId,
    side,
    qty,
    relatedTradeId: trade.tradeId,
  };
}

export class DexC2CBridgeService {
  private unsubscribe: (() => void) | null = null;
  private seenTradeIds = new Set<string>();

  start(options: {
    getLocalAddresses: () => Set<string>;
    onHedgeSignal: (signal: C2CToDexHedgeSignal) => Promise<C2CToDexHedgeResult>;
    emitLink: (link: DexC2CLinkV1) => Promise<void> | void;
  }): void {
    if (this.unsubscribe) {
      return;
    }
    // Seed current trade ids to avoid hedging historical trades after restart.
    const current = getC2CSnapshot();
    for (const trade of current.trades) {
      if (trade.tradeId) {
        this.seenTradeIds.add(trade.tradeId);
      }
    }
    this.unsubscribe = subscribeC2CSnapshot((snapshot) => {
      void this.handleSnapshot(snapshot, options);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.seenTradeIds.clear();
  }

  private async handleSnapshot(
    snapshot: C2CSnapshot,
    options: {
      getLocalAddresses: () => Set<string>;
      onHedgeSignal: (signal: C2CToDexHedgeSignal) => Promise<C2CToDexHedgeResult>;
      emitLink: (link: DexC2CLinkV1) => Promise<void> | void;
    },
  ): Promise<void> {
    const localAddresses = options.getLocalAddresses();
    if (localAddresses.size === 0) {
      return;
    }

    const trades = [...snapshot.trades].sort((a, b) => a.settledAtMs - b.settledAtMs);
    for (const trade of trades) {
      if (!trade.tradeId || this.seenTradeIds.has(trade.tradeId)) {
        continue;
      }
      this.seenTradeIds.add(trade.tradeId);
      if (this.seenTradeIds.size > 8_000) {
        const keep = Array.from(this.seenTradeIds).slice(-2_000);
        this.seenTradeIds = new Set(keep);
      }

      const signal = createHedgeSignal(trade, localAddresses);
      if (!signal) {
        continue;
      }

      const trigger = buildLink({
        marketId: signal.marketId,
        direction: 'C2C_TO_DEX_HEDGE',
        status: 'TRIGGERED',
        relatedTradeId: signal.relatedTradeId,
      });
      await options.emitLink(trigger);

      const result = await options.onHedgeSignal(signal);
      const follow = buildLink({
        marketId: signal.marketId,
        direction: 'C2C_TO_DEX_HEDGE',
        status: result.ok ? 'EXECUTED' : 'FAILED',
        reason: result.reason,
        relatedOrderId: result.orderId,
        relatedTradeId: signal.relatedTradeId,
      });
      await options.emitLink(follow);
    }
  }
}
