import type { KycTier, RiskDecision, TradeScene } from './types';

const LEVEL: Record<KycTier, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
};

export interface RiskInput {
  scene: TradeScene;
  amountCny: number;
  buyerKycTier: KycTier;
  sellerKycTier: KycTier;
  profileChangedRecently?: boolean;
  complaintBurst?: boolean;
  crossRegionAnomaly?: boolean;
}

export function requiredKycTier(scene: TradeScene, amountCny: number, isSeller: boolean): KycTier {
  if (isSeller) {
    return 'L2';
  }
  if (scene === 'C2C_FIAT' && amountCny > 5_000) {
    return 'L2';
  }
  if (amountCny > 5_000) {
    return 'L2';
  }
  if (amountCny > 0) {
    return 'L1';
  }
  return 'L0';
}

export function evaluateRiskDecision(input: RiskInput): RiskDecision {
  const requiredBuyer = requiredKycTier(input.scene, input.amountCny, false);
  const requiredSeller = requiredKycTier(input.scene, input.amountCny, true);
  const reasons: string[] = [];

  if (LEVEL[input.buyerKycTier] < LEVEL[requiredBuyer]) {
    reasons.push(`buyer_kyc_below_${requiredBuyer}`);
  }
  if (LEVEL[input.sellerKycTier] < LEVEL[requiredSeller]) {
    reasons.push(`seller_kyc_below_${requiredSeller}`);
  }
  if (input.profileChangedRecently) {
    reasons.push('profile_changed_recently');
  }
  if (input.complaintBurst) {
    reasons.push('complaint_burst_detected');
  }
  if (input.crossRegionAnomaly) {
    reasons.push('cross_region_anomaly');
  }

  const hardReject = reasons.some((reason) => reason.startsWith('buyer_kyc_below') || reason.startsWith('seller_kyc_below'));

  if (hardReject) {
    return {
      allow: false,
      requiredKycTier: requiredBuyer,
      reasons,
      action: 'REJECT',
    };
  }

  if (reasons.length > 0) {
    return {
      allow: true,
      requiredKycTier: requiredBuyer,
      reasons,
      action: 'REVIEW',
    };
  }

  return {
    allow: true,
    requiredKycTier: requiredBuyer,
    reasons: [],
    action: 'ALLOW',
  };
}
