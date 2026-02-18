import { describe, expect, it } from 'vitest';
import { DEFAULT_MAKER_FUNDS_V2, DEX_MARKETS, XAU_ASSET_ID, resolveDexMarketId } from '../marketConfig';

describe('marketConfig', () => {
  it('resolves XAU-USDT as a dex market id', () => {
    expect(resolveDexMarketId('XAU/USDT')).toBe('XAU-USDT');
    expect(resolveDexMarketId('xau-usdt')).toBe('XAU-USDT');
  });

  it('keeps mainstream non-dex pairs out of dex market ids', () => {
    expect(resolveDexMarketId('ETH/USDT')).toBeNull();
    expect(resolveDexMarketId('SOL/USDT')).toBeNull();
  });

  it('includes XAU-USDT in market and maker fund defaults', () => {
    const xauUsdt = DEX_MARKETS.find((item) => item.marketId === 'XAU-USDT');
    expect(xauUsdt).toEqual(expect.objectContaining({
      marketId: 'XAU-USDT',
      assetId: XAU_ASSET_ID,
      tickSize: 0.01,
      lotSize: 0.01,
      fallbackSlippageBps: 60,
    }));

    const usdtFund = DEFAULT_MAKER_FUNDS_V2.find((item) => item.assetCode === 'USDT');
    const xauFund = DEFAULT_MAKER_FUNDS_V2.find((item) => item.assetCode === 'XAU');
    expect(usdtFund?.marketPairs).toContain('XAU-USDT');
    expect(xauFund?.marketPairs).toContain('XAU-USDT');
  });
});
