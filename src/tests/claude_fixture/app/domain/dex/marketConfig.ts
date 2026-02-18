import type { DexMarketId } from './types';

export type DexAssetCode = 'BTC' | 'USDC' | 'USDT' | 'XAU';

export interface DexMarketConfig {
  marketId: DexMarketId;
  baseAsset: DexAssetCode;
  quoteAsset: DexAssetCode;
  symbol: string;
  tickSize: number;
  lotSize: number;
  fallbackSlippageBps: number;
  assetId: string;
}

export interface DexMakerFundConfig {
  assetCode: DexAssetCode;
  assetId: string;
  dailyLimit: number;
  baseSpreadBps: number;
  maxSpreadBps: number;
  marketPairs: DexMarketId[];
}

export const XAU_ASSET_ID = 'paxg_wrapped_v1';
export const BTC_ASSET_ID = 'btc_wrapped_v1';
export const USDC_ASSET_ID = 'usdc_wrapped_v1';
export const USDT_ASSET_ID = 'usdt_wrapped_v1';

export const DEX_MARKETS: DexMarketConfig[] = [
  {
    marketId: 'BTC-USDC',
    baseAsset: 'BTC',
    quoteAsset: 'USDC',
    symbol: 'BTC/USDC',
    tickSize: 0.1,
    lotSize: 0.0001,
    fallbackSlippageBps: 40,
    assetId: BTC_ASSET_ID,
  },
  {
    marketId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    symbol: 'BTC/USDT',
    tickSize: 0.1,
    lotSize: 0.0001,
    fallbackSlippageBps: 40,
    assetId: BTC_ASSET_ID,
  },
  {
    marketId: 'XAU-USDC',
    baseAsset: 'XAU',
    quoteAsset: 'USDC',
    symbol: 'XAU/USDC',
    tickSize: 0.01,
    lotSize: 0.01,
    fallbackSlippageBps: 60,
    assetId: XAU_ASSET_ID,
  },
  {
    marketId: 'XAU-USDT',
    baseAsset: 'XAU',
    quoteAsset: 'USDT',
    symbol: 'XAU/USDT',
    tickSize: 0.01,
    lotSize: 0.01,
    fallbackSlippageBps: 60,
    assetId: XAU_ASSET_ID,
  },
];

export const DEFAULT_MAKER_FUNDS_V2: DexMakerFundConfig[] = [
  {
    assetCode: 'BTC',
    assetId: BTC_ASSET_ID,
    dailyLimit: 0.1,
    baseSpreadBps: 18,
    maxSpreadBps: 60,
    marketPairs: ['BTC-USDC', 'BTC-USDT'],
  },
  {
    assetCode: 'USDC',
    assetId: USDC_ASSET_ID,
    dailyLimit: 1000,
    baseSpreadBps: 8,
    maxSpreadBps: 30,
    marketPairs: ['BTC-USDC', 'XAU-USDC'],
  },
  {
    assetCode: 'USDT',
    assetId: USDT_ASSET_ID,
    dailyLimit: 1000,
    baseSpreadBps: 8,
    maxSpreadBps: 30,
    marketPairs: ['BTC-USDT', 'XAU-USDT'],
  },
  {
    assetCode: 'XAU',
    assetId: XAU_ASSET_ID,
    dailyLimit: 2,
    baseSpreadBps: 30,
    maxSpreadBps: 90,
    marketPairs: ['XAU-USDC', 'XAU-USDT'],
  },
];

const MARKET_ID_SET = new Set(DEX_MARKETS.map((item) => item.marketId));

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace('/', '-');
}

export function isDexMarketId(value: string): value is DexMarketId {
  return MARKET_ID_SET.has(value as DexMarketId);
}

export function getDexMarketConfigById(marketId: DexMarketId): DexMarketConfig | null {
  return DEX_MARKETS.find((item) => item.marketId === marketId) ?? null;
}

export function getDexMakerFundConfig(assetCode: DexAssetCode): DexMakerFundConfig | null {
  return DEFAULT_MAKER_FUNDS_V2.find((item) => item.assetCode === assetCode) ?? null;
}

export function resolveDexMarketId(value: string): DexMarketId | null {
  const normalized = normalizeSymbol(value);
  return isDexMarketId(normalized) ? normalized : null;
}

export function resolveDexMarketBySymbol(value: string): DexMarketConfig | null {
  const marketId = resolveDexMarketId(value);
  if (!marketId) {
    return null;
  }
  return getDexMarketConfigById(marketId);
}

export function inferDexMarketIdByAssetId(assetId: string): DexMarketId | null {
  const normalized = assetId.trim().toLowerCase();
  const market = DEX_MARKETS.find((item) => item.assetId.toLowerCase() === normalized);
  if (market) {
    return market.marketId;
  }
  if (normalized.includes('paxg') || normalized.includes('xau')) {
    return 'XAU-USDC';
  }
  if (normalized.includes('btc')) {
    return 'BTC-USDT';
  }
  return null;
}

export function inferPrimaryMarketByBaseAsset(asset: DexAssetCode): DexMarketId | null {
  const target = asset.trim().toUpperCase();
  const market = DEX_MARKETS.find((item) => item.baseAsset === target);
  return market?.marketId ?? null;
}

export function inferBaseAssetCodeByAssetId(assetId: string): DexAssetCode | null {
  const normalized = assetId.trim().toLowerCase();
  if (normalized === XAU_ASSET_ID || normalized.includes('paxg') || normalized.includes('xau')) {
    return 'XAU';
  }
  if (normalized.includes('btc')) {
    return 'BTC';
  }
  if (normalized.includes('usdc')) {
    return 'USDC';
  }
  if (normalized.includes('usdt')) {
    return 'USDT';
  }
  return null;
}

export function roundToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || price <= 0 || tickSize <= 0) {
    return 0;
  }
  const scaled = Math.round(price / tickSize) * tickSize;
  return Number(scaled.toFixed(8));
}

export function roundToLot(qty: number, lotSize: number): number {
  if (!Number.isFinite(qty) || qty <= 0 || lotSize <= 0) {
    return 0;
  }
  const scaled = Math.floor(qty / lotSize) * lotSize;
  return Number(scaled.toFixed(8));
}
