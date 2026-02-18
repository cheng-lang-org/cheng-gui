import type { JsonValue } from '../../libp2p/definitions';

export const C2C_SCHEMAS = {
  listing: 'unimaker.market.listing.v2',
  order: 'unimaker.market.order.v2',
  trade: 'unimaker.market.trade.v2',
  receipt: 'unimaker.market.receipt.v2',
} as const;

export const C2C_TOPICS = {
  listing: 'unimaker.market.listing.v2',
  order: 'unimaker.market.order.v2',
  trade: 'unimaker.market.trade.v2',
  receipt: 'unimaker.market.receipt.v2',
} as const;

export const C2C_RENDEZVOUS_NS = 'unimaker/market/v2';

export type C2CSchema = (typeof C2C_SCHEMAS)[keyof typeof C2C_SCHEMAS];
export type C2CTopic = (typeof C2C_TOPICS)[keyof typeof C2C_TOPICS];

export type EscrowState = 'PENDING' | 'LOCKED' | 'RELEASED' | 'REFUNDED' | 'EXPIRED' | 'FAILED';

export type C2COrderState =
  | 'DRAFT'
  | 'LISTED'
  | 'LOCK_PENDING'
  | 'LOCKED'
  | 'DELIVERING'
  | 'SETTLING'
  | 'RELEASED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'FAILED';

export interface C2CEnvelope<TPayload extends JsonValue = JsonValue> {
  schema: C2CSchema;
  topic: C2CTopic;
  version: 'v2';
  ts: number;
  nonce: string;
  ttlMs: number;
  signer: string;
  sig: string;
  traceId: string;
  payload: TPayload;
}

export interface MarketListingV2 {
  listingId: string;
  assetId: string;
  seller: string;
  sellerPeerId: string;
  qty: number;
  unitPriceRwads: number;
  minQty: number;
  maxQty: number;
  createdAtMs: number;
  expiresAtMs: number;
  metadata?: Record<string, JsonValue>;
}

export interface MarketOrderV2 {
  orderId: string;
  listingId: string;
  assetId: string;
  escrowId: string;
  buyer: string;
  buyerPeerId: string;
  seller: string;
  sellerPeerId: string;
  qty: number;
  unitPriceRwads: number;
  totalRwads: number;
  lockTxHash?: string;
  lockTxStatus?: 'pending' | 'accepted' | 'rejected';
  escrowState: EscrowState;
  state: C2COrderState;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  metadata?: Record<string, JsonValue>;
}

export interface MarketTradeV2 {
  tradeId: string;
  orderId: string;
  listingId: string;
  escrowId: string;
  assetId: string;
  buyer: string;
  seller: string;
  qty: number;
  unitPriceRwads: number;
  totalRwads: number;
  releaseTxHash: string;
  escrowState: Extract<EscrowState, 'RELEASED' | 'REFUNDED' | 'FAILED' | 'EXPIRED'>;
  settledAtMs: number;
  metadata?: Record<string, JsonValue>;
}

export interface MarketReceiptV2 {
  receiptId: string;
  orderId: string;
  escrowId: string;
  status: EscrowState;
  txHash?: string;
  reason?: string;
  ts: number;
  metadata?: Record<string, JsonValue>;
}

export interface C2CListingRecord extends MarketListingV2 {
  envelopeSig: string;
  verified: boolean;
  invalidReason?: string;
  lastVerifiedAtMs?: number;
  receivedAtMs: number;
}

export interface C2COrderRecord extends MarketOrderV2 {
  source: 'local' | 'p2p' | 'chain';
}

export interface C2CTradeRecord extends MarketTradeV2 {
  source: 'local' | 'p2p' | 'chain';
}

export interface C2CReceiptRecord extends MarketReceiptV2 {
  source: 'local' | 'p2p' | 'chain';
}

export interface C2CSnapshot {
  listings: C2CListingRecord[];
  orders: C2COrderRecord[];
  trades: C2CTradeRecord[];
  receipts: C2CReceiptRecord[];
  updatedAt: number;
}

export interface ListingValidationResult {
  ok: boolean;
  reason?: string;
}

export function isC2CSchema(value: string): value is C2CSchema {
  return Object.values(C2C_SCHEMAS).includes(value as C2CSchema);
}

export function isC2CTopic(value: string): value is C2CTopic {
  return Object.values(C2C_TOPICS).includes(value as C2CTopic);
}
