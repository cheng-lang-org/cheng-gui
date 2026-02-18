import type { JsonValue } from '../../libp2p/definitions';

export const DEX_SCHEMAS = {
  order: 'unimaker.dex.order.v1',
  match: 'unimaker.dex.match.v1',
  depth: 'unimaker.dex.depth.v1',
  link: 'unimaker.dex.c2c.link.v1',
} as const;

export const DEX_TOPICS = {
  order: 'unimaker.dex.order.v1',
  match: 'unimaker.dex.match.v1',
  depth: 'unimaker.dex.depth.v1',
  link: 'unimaker.dex.c2c.link.v1',
} as const;

export const DEX_RENDEZVOUS_NS = 'unimaker/dex/v1';

export type DexSchema = (typeof DEX_SCHEMAS)[keyof typeof DEX_SCHEMAS];
export type DexTopic = (typeof DEX_TOPICS)[keyof typeof DEX_TOPICS];

export type DexMarketId = 'BTC-USDC' | 'BTC-USDT' | 'XAU-USDC' | 'XAU-USDT';
export type DexSide = 'BUY' | 'SELL';
export type DexOrderType = 'LIMIT' | 'MARKET';
export type DexTimeInForce = 'GTC' | 'IOC' | 'FOK';
export type DexOrderStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type DexSettlementState = 'PENDING' | 'LOCKED' | 'RELEASED' | 'REFUNDED' | 'FAILED';

export interface DexEnvelope<TPayload extends JsonValue = JsonValue> {
  schema: DexSchema;
  topic: DexTopic;
  version: 'v1';
  ts: number;
  nonce: string;
  ttlMs: number;
  signer: string;
  sig: string;
  traceId: string;
  payload: TPayload;
}

export interface DexDepthLevel {
  price: number;
  qty: number;
}

export interface DexOrderV1 {
  orderId: string;
  clientOrderId?: string;
  marketId: DexMarketId;
  side: DexSide;
  type: DexOrderType;
  timeInForce: DexTimeInForce;
  price?: number;
  qty: number;
  remainingQty: number;
  makerAddress: string;
  makerPeerId: string;
  createdAtMs: number;
  expiresAtMs: number;
  metadata?: Record<string, JsonValue>;
}

export interface DexMatchV1 {
  matchId: string;
  marketId: DexMarketId;
  makerOrderId: string;
  takerOrderId: string;
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  qty: number;
  notionalQuote: number;
  sequence: number;
  ts: number;
  escrowId?: string;
  settlementState: DexSettlementState;
  lockTxHash?: string;
  releaseTxHash?: string;
  metadata?: Record<string, JsonValue>;
}

export interface DexDepthV1 {
  marketId: DexMarketId;
  sequence: number;
  checksum: string;
  bids: DexDepthLevel[];
  asks: DexDepthLevel[];
  ts: number;
  source?: string;
}

export type DexLinkDirection = 'DEX_TO_C2C_FALLBACK' | 'C2C_TO_DEX_HEDGE';
export type DexLinkStatus = 'TRIGGERED' | 'EXECUTED' | 'SKIPPED' | 'FAILED';

export interface DexC2CLinkV1 {
  linkId: string;
  marketId: DexMarketId;
  direction: DexLinkDirection;
  status: DexLinkStatus;
  relatedOrderId?: string;
  relatedTradeId?: string;
  reason?: string;
  ts: number;
  metadata?: Record<string, JsonValue>;
}

export interface DexOrderRecord extends DexOrderV1 {
  status: DexOrderStatus;
  filledQty: number;
  settlementState: DexSettlementState;
  source: 'local' | 'p2p' | 'chain';
}

export interface DexMatchRecord extends DexMatchV1 {
  source: 'local' | 'p2p' | 'chain';
}

export interface DexDepthRecord extends DexDepthV1 {
  updatedAtMs: number;
}

export interface DexLinkRecord extends DexC2CLinkV1 {
  source: 'local' | 'p2p' | 'chain';
}

export interface DexSnapshot {
  orders: DexOrderRecord[];
  matches: DexMatchRecord[];
  depths: DexDepthRecord[];
  links: DexLinkRecord[];
  updatedAt: number;
}

export interface DexSignerIdentity {
  address: string;
  peerId: string;
  privateKeyPkcs8: string;
}

export interface ListingFallbackResult {
  ok: boolean;
  c2cOrderId?: string;
  reason?: string;
  linkId?: string;
}

export function isDexSchema(value: string): value is DexSchema {
  return Object.values(DEX_SCHEMAS).includes(value as DexSchema);
}

export function isDexTopic(value: string): value is DexTopic {
  return Object.values(DEX_TOPICS).includes(value as DexTopic);
}
