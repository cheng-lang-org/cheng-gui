export type TradeScene = 'CONTENT_PAYWALL' | 'ECOM_PRODUCT' | 'C2C_FIAT' | 'APP_ITEM' | 'AD_ITEM';

export type PaymentRail =
  | 'BYOP_WECHAT'
  | 'BYOP_ALIPAY'
  | 'WECHAT_OFFICIAL'
  | 'ALIPAY_OFFICIAL'
  | 'RWAD_ESCROW';

export type OrderState =
  | 'CREATED'
  | 'ACCEPTED'
  | 'AWAIT_PAY'
  | 'PAY_PROOF_SUBMITTED'
  | 'FULFILLING'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type PaymentState = 'UNPAID' | 'PROOF_PENDING' | 'PAID_UNVERIFIED' | 'PAID_VERIFIED' | 'FAILED';

export type KycTier = 'L0' | 'L1' | 'L2';
export type ByopChannel = 'WECHAT' | 'ALIPAY';
export type ProofVerificationState = 'PENDING' | 'PASSED' | 'REVIEW_REQUIRED' | 'REJECTED';
export type ProofVerificationMethod = 'AUTO_OCR_RULES' | 'MANUAL';

export interface PaymentProfile {
  paymentProfileId: string;
  ownerId: string;
  policyGroupId: string;
  kycTier: KycTier;
  visibility: 'ORDER_ONLY';
  rails: {
    wechatQr?: string;
    alipayQr?: string;
    walletAddress?: string;
    creditCardEnabled?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedOrder {
  orderId: string;
  scene: TradeScene;
  buyerId: string;
  sellerId: string;
  paymentProfileId: string;
  amountCny: number;
  preferredRail: PaymentRail;
  orderState: OrderState;
  paymentState: PaymentState;
  policyGroupId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface PaymentIntent {
  orderId: string;
  rail: Extract<PaymentRail, 'WECHAT_OFFICIAL' | 'ALIPAY_OFFICIAL'>;
  payUrl: string;
  payToken: string;
  expiresAt: string;
}

export interface PaymentProof {
  proofId: string;
  orderId: string;
  buyerId: string;
  proofType: string;
  proofRef: string;
  channel?: ByopChannel;
  tradeNoNorm?: string;
  paidAmountCny?: number;
  paidAt?: string;
  proofHash?: string;
  metadata: Record<string, unknown>;
  submittedAt: string;
}

export interface ByopProofMetadataV1 {
  channel: ByopChannel;
  tradeNo: string;
  paidAmountCny: number;
  paidAt: string;
  purchaseSnapshot: Record<string, unknown>;
  screenshotDataUrl?: string;
  screenshotHash?: string;
  remark?: string;
}

export interface ProofVerification {
  proofId: string;
  orderId: string;
  state: ProofVerificationState;
  method?: ProofVerificationMethod;
  confidence?: number;
  reasonCodes: string[];
  extractedFields: Record<string, unknown>;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ByopProofReviewItem {
  order: UnifiedOrder;
  proof: PaymentProof;
  verification: ProofVerification;
}

export interface DisputeTicket {
  disputeId: string;
  orderId: string;
  status: 'OPEN' | 'RESOLVED';
  openedBy: string;
  reason: string;
}

export interface RiskDecision {
  allow: boolean;
  requiredKycTier: KycTier;
  reasons: string[];
  action: 'ALLOW' | 'REVIEW' | 'REJECT';
}

export interface RevealPaymentResult {
  accessToken: string;
  expiresAt: string;
  order: UnifiedOrder;
  paymentProfile: {
    paymentProfileId: string;
    rails: {
      wechatQr?: string | null;
      alipayQr?: string | null;
      walletAddress?: string | null;
      creditCardEnabled?: boolean | null;
    };
  };
}

export interface LegacyPaymentFields {
  wechatQr?: string;
  alipayQr?: string;
}
