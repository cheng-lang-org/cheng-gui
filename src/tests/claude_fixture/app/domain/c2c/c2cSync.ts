import { c2cStore } from './c2cStore';
import {
  C2C_RENDEZVOUS_NS,
  C2C_TOPICS,
  type C2CEnvelope,
  type C2COrderRecord,
  type C2CSnapshot,
  type MarketListingV2,
  type MarketOrderV2,
  type MarketReceiptV2,
  type MarketTradeV2,
} from './types';
import type { JsonValue } from '../../libp2p/definitions';
import { buildEscrowId, decodeEnvelope, parseEscrowId, signEnvelopePayload } from './codec';
import { getAssetBalance, listMarketEvents, submitSignedTx } from '../rwad/rwadGateway';
import { getLibp2pRuntime, type RuntimeEvent } from '../../libp2p/runtime';
import { libp2pService } from '../../libp2p/service';

const DISCOVERY_INTERVAL_MS = 45_000;
const MARKET_EVENTS_INTERVAL_MS = 15_000;
const LISTING_VERIFY_INTERVAL_MS = 25_000;
const DEFAULT_ESCROW_TTL_MS = 30 * 60 * 1000;
const ROLLUP_METRIC_INTERVAL_MS = 60_000;

type C2CListener = (snapshot: C2CSnapshot) => void;

interface SignerIdentity {
  address: string;
  peerId: string;
  privateKeyPkcs8: string;
}

interface PublishListingInput {
  assetId: string;
  qty: number;
  unitPriceRwads: number;
  minQty?: number;
  maxQty?: number;
  expiresInMinutes?: number;
  metadata?: Record<string, JsonValue>;
}

interface PlaceOrderInput {
  listingId: string;
  qty: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escrowMatchesOrder(
  escrowId: string,
  expected: {
    assetId: string;
    qty: number;
    seller: string;
    buyer: string;
  },
): boolean {
  const parsed = parseEscrowId(escrowId);
  if (!parsed) {
    return false;
  }
  return (
    parsed.assetId === expected.assetId &&
    parsed.qty === expected.qty &&
    parsed.seller === expected.seller &&
    parsed.buyer === expected.buyer
  );
}

function metric(name: string, fields: Record<string, JsonValue> = {}): void {
  const payload = {
    name,
    ts: Date.now(),
    fields,
  };
  console.info('[c2c-metric]', payload);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('c2c-metric', { detail: payload }));
  }
}

function normalizeEnvelope(raw: unknown): C2CEnvelope<JsonValue> | null {
  const direct = decodeEnvelope(raw);
  if (direct) {
    return direct;
  }
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  if (record.envelope) {
    return decodeEnvelope(record.envelope);
  }
  if (record.payload) {
    return decodeEnvelope(record.payload);
  }
  return null;
}

class C2CSyncService {
  private runtime = getLibp2pRuntime();
  private unsubscribeStore: (() => void) | null = null;
  private listeners = new Set<C2CListener>();
  private unsubscribeTopics: Array<() => void> = [];
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private marketTimer: ReturnType<typeof setInterval> | null = null;
  private verifyTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private localPeerId = '';
  private seenMarketEventIds = new Set<string>();
  private seenTradeIds = new Set<string>();
  private invalidListingDropTotal = 0;
  private lastRollupMetricAt = 0;

  subscribe(listener: C2CListener): () => void {
    this.listeners.add(listener);
    listener(c2cStore.getSnapshot());
    if (!this.unsubscribeStore) {
      this.unsubscribeStore = c2cStore.subscribe((snapshot) => {
        for (const cb of this.listeners) {
          cb(snapshot);
        }
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unsubscribeStore) {
        this.unsubscribeStore();
        this.unsubscribeStore = null;
      }
    };
  }

  async start(): Promise<boolean> {
    if (this.started) {
      return true;
    }
    const runtimeStarted = await this.runtime.start();
    if (!runtimeStarted) {
      return false;
    }

    if (libp2pService.isNativePlatform()) {
      this.localPeerId = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
      void libp2pService.rendezvousAdvertise(C2C_RENDEZVOUS_NS, 300_000);
    }

    this.subscribeTopics();
    await this.refreshFeedSnapshot();
    await this.refreshDiscovery();
    await this.refreshListingVerification();
    await this.refreshMarketEvents();

    this.discoveryTimer = setInterval(() => {
      void this.refreshDiscovery();
      void this.refreshFeedSnapshot();
    }, DISCOVERY_INTERVAL_MS);

    this.marketTimer = setInterval(() => {
      void this.refreshMarketEvents();
    }, MARKET_EVENTS_INTERVAL_MS);

    this.verifyTimer = setInterval(() => {
      void this.refreshListingVerification();
      this.emitRollupMetricsIfDue();
    }, LISTING_VERIFY_INTERVAL_MS);

    this.started = true;
    return true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    for (const unsubscribe of this.unsubscribeTopics) {
      unsubscribe();
    }
    this.unsubscribeTopics = [];

    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    if (this.marketTimer) {
      clearInterval(this.marketTimer);
      this.marketTimer = null;
    }
    if (this.verifyTimer) {
      clearInterval(this.verifyTimer);
      this.verifyTimer = null;
    }

    this.seenMarketEventIds.clear();
    this.seenTradeIds.clear();
    this.invalidListingDropTotal = 0;
    this.lastRollupMetricAt = 0;

    await this.runtime.stop();
  }

  getSnapshot(): C2CSnapshot {
    return c2cStore.getSnapshot();
  }

  async publishListing(input: PublishListingInput, signer: SignerIdentity): Promise<{ ok: boolean; listingId?: string; reason?: string }> {
    if (!isPositiveInteger(input.qty) || !isPositiveInteger(input.unitPriceRwads)) {
      return { ok: false, reason: 'invalid_qty_or_price' };
    }
    if (!input.assetId.trim()) {
      return { ok: false, reason: 'missing_asset_id' };
    }

    const now = Date.now();
    const expiresInMinutes = Math.max(5, Math.min(input.expiresInMinutes ?? 30, 60));
    const listing: MarketListingV2 = {
      listingId: nowId('lst'),
      assetId: input.assetId.trim(),
      seller: signer.address,
      sellerPeerId: signer.peerId,
      qty: input.qty,
      unitPriceRwads: input.unitPriceRwads,
      minQty: Math.max(1, Math.min(input.minQty ?? 1, input.qty)),
      maxQty: Math.max(1, Math.min(input.maxQty ?? input.qty, input.qty)),
      createdAtMs: now,
      expiresAtMs: now + expiresInMinutes * 60 * 1000,
      metadata: input.metadata,
    };

    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.listing,
      topic: C2C_TOPICS.listing,
      signer: signer.address,
      privateKeyPkcs8: signer.privateKeyPkcs8,
      payload: listing as unknown as JsonValue,
    });

    const published = await this.runtime.publish(C2C_TOPICS.listing, envelope as unknown as JsonValue);
    if (!published) {
      return { ok: false, reason: 'publish_failed' };
    }

    c2cStore.applyVerifiedEnvelope(envelope, 'local');
    c2cStore.markListingVerification(listing.listingId, true);
    metric('c2c_listing_publish', { listingId: listing.listingId, assetId: listing.assetId, qty: listing.qty });
    return { ok: true, listingId: listing.listingId };
  }

  async placeOrder(input: PlaceOrderInput, signer: SignerIdentity): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
    const snapshot = c2cStore.getSnapshot();
    const listing = snapshot.listings.find((item) => item.listingId === input.listingId && item.verified);
    if (!listing) {
      return { ok: false, reason: 'listing_not_found' };
    }
    if (!isPositiveInteger(input.qty)) {
      return { ok: false, reason: 'invalid_qty' };
    }
    if (input.qty < listing.minQty || input.qty > listing.maxQty || input.qty > listing.qty) {
      return { ok: false, reason: 'qty_out_of_range' };
    }

    const now = Date.now();
    const orderId = nowId('ord');
    const escrowId = buildEscrowId({
      assetId: listing.assetId,
      qty: input.qty,
      seller: listing.seller,
      buyer: signer.address,
      nonce: Math.random().toString(16).slice(2, 10),
    });
    if (!escrowMatchesOrder(escrowId, { assetId: listing.assetId, qty: input.qty, seller: listing.seller, buyer: signer.address })) {
      return { ok: false, reason: 'invalid_escrow_id' };
    }
    const totalRwads = listing.unitPriceRwads * input.qty;

    const orderPayload: MarketOrderV2 = {
      orderId,
      listingId: listing.listingId,
      assetId: listing.assetId,
      escrowId,
      buyer: signer.address,
      buyerPeerId: signer.peerId,
      seller: listing.seller,
      sellerPeerId: listing.sellerPeerId,
      qty: input.qty,
      unitPriceRwads: listing.unitPriceRwads,
      totalRwads,
      escrowState: 'PENDING',
      state: 'LOCK_PENDING',
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + DEFAULT_ESCROW_TTL_MS,
    };

    const orderEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.order,
      topic: C2C_TOPICS.order,
      signer: signer.address,
      privateKeyPkcs8: signer.privateKeyPkcs8,
      payload: orderPayload as unknown as JsonValue,
    });

    c2cStore.applyVerifiedEnvelope(orderEnvelope, 'local');
    const published = await this.runtime.publish(C2C_TOPICS.order, orderEnvelope as unknown as JsonValue);
    if (!published) {
      c2cStore.patchOrder(orderId, { state: 'FAILED', escrowState: 'FAILED' });
      return { ok: false, reason: 'order_publish_failed' };
    }

    metric('c2c_escrow_lock_submit', { orderId, escrowId, totalRwads });
    const submitResult = await submitSignedTx({
      chainId: 'rwad-main',
      sender: signer.address,
      privateKeyPkcs8: signer.privateKeyPkcs8,
      txType: 'rwad_escrow_lock',
      payload: {
        escrow_id: escrowId,
        payer: signer.address,
        amount: totalRwads,
        expires_at: now + DEFAULT_ESCROW_TTL_MS,
      },
      encoding: 'cbor',
    });

    if (!submitResult.ok) {
      c2cStore.patchOrder(orderId, {
        lockTxHash: submitResult.txHash,
        lockTxStatus: 'rejected',
        state: 'FAILED',
        escrowState: 'FAILED',
      });
      return { ok: false, reason: submitResult.reason || 'lock_submit_failed' };
    }

    c2cStore.patchOrder(orderId, {
      lockTxHash: submitResult.txHash,
      lockTxStatus: submitResult.status === 'accepted' ? 'accepted' : 'pending',
      state: submitResult.status === 'accepted' ? 'LOCKED' : 'LOCK_PENDING',
      escrowState: submitResult.status === 'accepted' ? 'LOCKED' : 'PENDING',
    });

    return { ok: true, orderId };
  }

  async submitAssetTransfer(order: C2COrderRecord, signer: SignerIdentity): Promise<{ ok: boolean; reason?: string }> {
    if (!order.orderId || !order.escrowId) {
      return { ok: false, reason: 'invalid_order' };
    }
    if (order.seller !== signer.address) {
      return { ok: false, reason: 'seller_mismatch' };
    }
    if (!escrowMatchesOrder(order.escrowId, { assetId: order.assetId, qty: order.qty, seller: order.seller, buyer: order.buyer })) {
      return { ok: false, reason: 'invalid_escrow_id' };
    }
    c2cStore.patchOrder(order.orderId, { state: 'DELIVERING' });
    metric('c2c_asset_transfer_submit', { orderId: order.orderId, escrowId: order.escrowId });

    const result = await submitSignedTx({
      chainId: 'rwad-main',
      sender: signer.address,
      privateKeyPkcs8: signer.privateKeyPkcs8,
      txType: 'asset_transfer',
      payload: {
        to: order.buyer,
        ref: order.escrowId,
        from: signer.address,
        amount: order.qty,
        asset_id: order.assetId,
      },
      encoding: 'cbor',
    });

    if (!result.ok) {
      c2cStore.patchOrder(order.orderId, {
        state: 'FAILED',
        escrowState: 'FAILED',
      });
      return { ok: false, reason: result.reason || 'asset_transfer_failed' };
    }

    c2cStore.patchOrder(order.orderId, {
      state: 'SETTLING',
      escrowState: 'LOCKED',
      lockTxStatus: 'accepted',
    });

    const receipt: MarketReceiptV2 = {
      receiptId: nowId('rcpt'),
      orderId: order.orderId,
      escrowId: order.escrowId,
      status: 'LOCKED',
      txHash: result.txHash,
      ts: Date.now(),
    };
    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.receipt,
      topic: C2C_TOPICS.receipt,
      signer: signer.address,
      privateKeyPkcs8: signer.privateKeyPkcs8,
      payload: receipt as unknown as JsonValue,
    });
    c2cStore.applyVerifiedEnvelope(envelope, 'local');
    await this.runtime.publish(C2C_TOPICS.receipt, envelope as unknown as JsonValue);
    return { ok: true };
  }

  private subscribeTopics(): void {
    for (const topic of Object.values(C2C_TOPICS)) {
      const unsubscribe = this.runtime.subscribe(topic, (event) => {
        void this.handleRuntimeEvent(event);
      });
      this.unsubscribeTopics.push(unsubscribe);
    }
  }

  private async handleRuntimeEvent(event: RuntimeEvent): Promise<void> {
    const envelope = normalizeEnvelope(event.payload);
    if (!envelope) {
      return;
    }
    const applied = await c2cStore.applyEnvelope(envelope, 'p2p');
    if (applied && envelope.schema === C2C_TOPICS.trade) {
      const payload = asRecord(envelope.payload) ?? {};
      const tradeId = asString(payload.tradeId);
      const orderId = asString(payload.orderId);
      const settledAtMs = asNumber(payload.settledAtMs, Date.now());
      const order = c2cStore.getSnapshot().orders.find((item) => item.orderId === orderId);
      if (tradeId && order) {
        metric('c2c_lock_to_release_latency_ms', {
          orderId: order.orderId,
          tradeId,
          latencyMs: Math.max(0, settledAtMs - order.createdAtMs),
        });
      }
      metric('c2c_settlement_finalized', { tradeId });
    }
  }

  private async refreshFeedSnapshot(): Promise<void> {
    const items = await this.runtime.fetchSnapshot().catch(() => []);
    for (const item of items) {
      if (!Object.values(C2C_TOPICS).includes(item.topic as (typeof C2C_TOPICS)[keyof typeof C2C_TOPICS])) {
        continue;
      }
      const envelope = normalizeEnvelope(item.payload);
      if (!envelope) {
        continue;
      }
      await c2cStore.applyEnvelope(envelope, 'p2p').catch(() => false);
    }
  }

  private async refreshDiscovery(): Promise<void> {
    const peers = await this.runtime.discover(C2C_RENDEZVOUS_NS, 64).catch(() => []);
    if (libp2pService.isNativePlatform()) {
      for (const peer of peers) {
        if (!peer.peerId || peer.peerId === this.localPeerId) {
          continue;
        }
        await libp2pService.feedSubscribePeer(peer.peerId).catch(() => false);
      }
      void libp2pService.rendezvousAdvertise(C2C_RENDEZVOUS_NS, 300_000);
    }
  }

  private async refreshListingVerification(): Promise<void> {
    const snapshot = c2cStore.getSnapshot();
    for (const listing of snapshot.listings) {
      if (listing.expiresAtMs <= Date.now()) {
        if (listing.verified || listing.invalidReason !== 'expired') {
          this.invalidListingDropTotal += 1;
          metric('c2c_invalid_listing_drop_total', {
            value: this.invalidListingDropTotal,
            listingId: listing.listingId,
            reason: 'expired',
          });
        }
        c2cStore.markListingVerification(listing.listingId, false, 'expired');
        continue;
      }
      const balance = await getAssetBalance(listing.assetId, listing.seller).catch(() => -1);
      if (balance < 0) {
        continue;
      }
      const ok = balance >= listing.qty;
      if (!ok && (listing.verified || listing.invalidReason !== 'insufficient_asset_balance')) {
        this.invalidListingDropTotal += 1;
        metric('c2c_invalid_listing_drop_total', {
          value: this.invalidListingDropTotal,
          listingId: listing.listingId,
          reason: 'insufficient_asset_balance',
        });
      }
      c2cStore.markListingVerification(listing.listingId, ok, ok ? '' : 'insufficient_asset_balance');
    }
    this.emitRollupMetricsIfDue();
  }

  private async refreshMarketEvents(): Promise<void> {
    const events = await listMarketEvents({ limit: 100 }).catch(() => ({ items: [], nextCursor: '', hasMore: false }));
    for (const event of events.items) {
      if (event.eventId) {
        if (this.seenMarketEventIds.has(event.eventId)) {
          continue;
        }
        this.seenMarketEventIds.add(event.eventId);
        if (this.seenMarketEventIds.size > 10_000) {
          const keep = Array.from(this.seenMarketEventIds).slice(-2_000);
          this.seenMarketEventIds = new Set(keep);
        }
      }

      const metadata = asRecord(event.metadata) ?? {};
      const schema = asString(metadata.schema);
      if (schema === C2C_TOPICS.trade) {
        const payload = asRecord(metadata.payload) ?? metadata;
        const trade: MarketTradeV2 = {
          tradeId: asString(payload.tradeId),
          orderId: asString(payload.orderId),
          listingId: asString(payload.listingId),
          escrowId: asString(payload.escrowId),
          assetId: asString(payload.assetId),
          buyer: asString(payload.buyer),
          seller: asString(payload.seller),
          qty: asNumber(payload.qty),
          unitPriceRwads: asNumber(payload.unitPriceRwads),
          totalRwads: asNumber(payload.totalRwads),
          releaseTxHash: asString(payload.releaseTxHash) || event.txHash || '',
          escrowState: (asString(payload.escrowState) as MarketTradeV2['escrowState']) || 'RELEASED',
          settledAtMs: asNumber(payload.settledAtMs, event.ts),
          metadata: payload as Record<string, JsonValue>,
        };
        if (!trade.tradeId) {
          continue;
        }
        const existingOrder = c2cStore.getSnapshot().orders.find((item) => item.orderId === trade.orderId);
        if (!existingOrder) {
          c2cStore.upsertOrder({
            orderId: trade.orderId,
            listingId: trade.listingId,
            assetId: trade.assetId,
            escrowId: trade.escrowId,
            buyer: trade.buyer,
            buyerPeerId: '',
            seller: trade.seller,
            sellerPeerId: '',
            qty: trade.qty,
            unitPriceRwads: trade.unitPriceRwads,
            totalRwads: trade.totalRwads,
            escrowState: trade.escrowState,
            state: trade.escrowState,
            createdAtMs: Math.max(0, trade.settledAtMs - DEFAULT_ESCROW_TTL_MS),
            updatedAtMs: trade.settledAtMs,
            expiresAtMs: trade.settledAtMs,
            lockTxHash: trade.releaseTxHash,
            lockTxStatus: 'accepted',
            source: 'chain',
          });
        }
        c2cStore.upsertTrade({ ...trade, source: 'chain' });
        c2cStore.patchOrder(trade.orderId, {
          state: trade.escrowState === 'RELEASED' ? 'RELEASED' : trade.escrowState,
          escrowState: trade.escrowState,
        });
        if (!this.seenTradeIds.has(trade.tradeId)) {
          this.seenTradeIds.add(trade.tradeId);
          const order = c2cStore.getSnapshot().orders.find((item) => item.orderId === trade.orderId);
          if (order) {
            const latencyMs = Math.max(0, trade.settledAtMs - order.createdAtMs);
            metric('c2c_lock_to_release_latency_ms', {
              orderId: order.orderId,
              tradeId: trade.tradeId,
              latencyMs,
            });
          }
        }
        metric('c2c_settlement_finalized', {
          tradeId: trade.tradeId,
          escrowState: trade.escrowState,
          txHash: trade.releaseTxHash,
        });
      }

      if (event.action.includes('refund') || event.action.includes('expire')) {
        const orderId = asString(metadata.orderId);
        if (orderId) {
          c2cStore.patchOrder(orderId, {
            state: event.action.includes('expire') ? 'EXPIRED' : 'REFUNDED',
            escrowState: event.action.includes('expire') ? 'EXPIRED' : 'REFUNDED',
          });
          metric('c2c_auto_refund', {
            orderId,
            action: event.action,
            txHash: event.txHash ?? '',
          });
        }
      }
    }
    this.emitRollupMetricsIfDue();
  }

  private emitRollupMetricsIfDue(): void {
    const now = Date.now();
    if (now - this.lastRollupMetricAt < ROLLUP_METRIC_INTERVAL_MS) {
      return;
    }
    this.lastRollupMetricAt = now;

    const snapshot = c2cStore.getSnapshot();
    const activeListings = snapshot.listings.filter((item) => item.verified && item.expiresAtMs > now && item.qty > 0).length;
    const closedOrders = snapshot.orders.filter((item) => (
      item.state === 'RELEASED' || item.state === 'REFUNDED' || item.state === 'EXPIRED' || item.state === 'FAILED'
    )).length;
    const timeoutRefunded = snapshot.orders.filter((item) => item.state === 'REFUNDED' || item.state === 'EXPIRED').length;
    const timeoutRefundRatio = closedOrders > 0 ? timeoutRefunded / closedOrders : 0;

    metric('c2c_active_listings', { value: activeListings });
    metric('c2c_timeout_refund_ratio', {
      value: Number(timeoutRefundRatio.toFixed(6)),
      timeoutRefunded,
      closedOrders,
    });
    metric('c2c_invalid_listing_drop_total', { value: this.invalidListingDropTotal });
  }
}

const c2cSync = new C2CSyncService();

export function subscribeC2CSnapshot(listener: C2CListener): () => void {
  return c2cSync.subscribe(listener);
}

export function getC2CSnapshot(): C2CSnapshot {
  return c2cSync.getSnapshot();
}

export function startC2CSync(): Promise<boolean> {
  return c2cSync.start();
}

export function stopC2CSync(): Promise<void> {
  return c2cSync.stop();
}

export function publishMarketListing(input: PublishListingInput, signer: SignerIdentity): Promise<{ ok: boolean; listingId?: string; reason?: string }> {
  return c2cSync.publishListing(input, signer);
}

export function placeMarketOrder(input: PlaceOrderInput, signer: SignerIdentity): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  return c2cSync.placeOrder(input, signer);
}

export function submitOrderAssetTransfer(order: C2COrderRecord, signer: SignerIdentity): Promise<{ ok: boolean; reason?: string }> {
  return c2cSync.submitAssetTransfer(order, signer);
}
