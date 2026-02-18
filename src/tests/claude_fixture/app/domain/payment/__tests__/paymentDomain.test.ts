import { describe, expect, it } from 'vitest';
import { evaluateRiskDecision, requiredKycTier } from '../riskPolicy';
import { extractLegacyPaymentFields, isOrderUnlockReady } from '../paymentApi';
import type { UnifiedOrder } from '../types';

function makeOrder(patch: Partial<UnifiedOrder>): UnifiedOrder {
  return {
    orderId: 'ord_test_1',
    scene: 'CONTENT_PAYWALL',
    buyerId: 'buyer_a',
    sellerId: 'seller_a',
    paymentProfileId: 'pp_1',
    amountCny: 88,
    preferredRail: 'BYOP_WECHAT',
    orderState: 'CREATED',
    paymentState: 'UNPAID',
    policyGroupId: 'CN',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    ...patch,
  };
}

describe('payment risk policy', () => {
  it('requires L2 for seller and large buyer orders', () => {
    expect(requiredKycTier('CONTENT_PAYWALL', 100, false)).toBe('L1');
    expect(requiredKycTier('C2C_FIAT', 6_000, false)).toBe('L2');
    expect(requiredKycTier('ECOM_PRODUCT', 200, true)).toBe('L2');
  });

  it('rejects when buyer kyc is below threshold', () => {
    const decision = evaluateRiskDecision({
      scene: 'C2C_FIAT',
      amountCny: 8_000,
      buyerKycTier: 'L1',
      sellerKycTier: 'L2',
    });

    expect(decision.allow).toBe(false);
    expect(decision.action).toBe('REJECT');
    expect(decision.reasons).toContain('buyer_kyc_below_L2');
  });
});

describe('payment compatibility and unlock state', () => {
  it('extracts legacy qr fields with fallback order', () => {
    const extra = {
      paymentQr: {
        wechat: 'wechat_from_object',
        alipay: 'alipay_from_object',
      },
      wechatQrCode: 'wechat_legacy',
    };

    const legacy = extractLegacyPaymentFields(extra);
    expect(legacy.wechatQr).toBe('wechat_legacy');
    expect(legacy.alipayQr).toBe('alipay_from_object');
  });

  it('unlocks only after payment is verified', () => {
    expect(isOrderUnlockReady(makeOrder({ orderState: 'PAY_PROOF_SUBMITTED', paymentState: 'PAID_UNVERIFIED' }))).toBe(false);
    expect(isOrderUnlockReady(makeOrder({ orderState: 'COMPLETED', paymentState: 'PAID_VERIFIED' }))).toBe(true);
    expect(isOrderUnlockReady(makeOrder({ orderState: 'FULFILLING', paymentState: 'PAID_VERIFIED' }))).toBe(true);
    expect(isOrderUnlockReady(makeOrder({ orderState: 'AWAIT_PAY', paymentState: 'PROOF_PENDING' }))).toBe(false);
  });
});
