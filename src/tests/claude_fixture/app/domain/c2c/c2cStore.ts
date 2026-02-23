import type {
  C2CEnvelope,
  C2CListingRecord,
  C2COrderRecord,
  C2CReceiptRecord,
  C2CSnapshot,
  C2CTradeRecord,
  MarketListingV2,
  MarketOrderV2,
  MarketReceiptV2,
  MarketTradeV2,
} from './types';
import type { JsonValue } from '../../libp2p/definitions';
import { decodeEnvelope, parseEscrowId, verifyEnvelopeSignature } from './codec';

const STORAGE_KEY = 'unimaker_c2c_store_v2';

type SnapshotListener = (snapshot: C2CSnapshot) => void;

function nowMs(): number {
  return Date.now();
}

function getLocalStorageSafe(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } | null {
  if (typeof localStorage === 'undefined' || !localStorage) {
    return null;
  }
  const storage = localStorage as unknown as {
    getItem?: (key: string) => string | null;
    setItem?: (key: string, value: string) => void;
  };
  if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return {
    getItem: storage.getItem.bind(localStorage),
    setItem: storage.setItem.bind(localStorage),
  };
}

function cloneSnapshot(snapshot: C2CSnapshot): C2CSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as C2CSnapshot;
}

function emptySnapshot(): C2CSnapshot {
  return {
    listings: [],
    orders: [],
    trades: [],
    receipts: [],
    updatedAt: nowMs(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function loadSnapshot(): C2CSnapshot {
  const storage = getLocalStorageSafe();
  if (!storage) {
    return emptySnapshot();
  }
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return emptySnapshot();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return emptySnapshot();
    }
    return {
      listings: Array.isArray(parsed.listings) ? (parsed.listings as C2CListingRecord[]) : [],
      orders: Array.isArray(parsed.orders) ? (parsed.orders as C2COrderRecord[]) : [],
      trades: Array.isArray(parsed.trades) ? (parsed.trades as C2CTradeRecord[]) : [],
      receipts: Array.isArray(parsed.receipts) ? (parsed.receipts as C2CReceiptRecord[]) : [],
      updatedAt: asNumber(parsed.updatedAt, nowMs()),
    };
  } catch {
    return emptySnapshot();
  }
}

function persistSnapshot(snapshot: C2CSnapshot): void {
  const storage = getLocalStorageSafe();
  if (!storage) {
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function sortListings(listings: C2CListingRecord[]): C2CListingRecord[] {
  return [...listings].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function sortOrders(orders: C2COrderRecord[]): C2COrderRecord[] {
  return [...orders].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function sortTrades(trades: C2CTradeRecord[]): C2CTradeRecord[] {
  return [...trades].sort((a, b) => b.settledAtMs - a.settledAtMs);
}

function sortReceipts(receipts: C2CReceiptRecord[]): C2CReceiptRecord[] {
  return [...receipts].sort((a, b) => b.ts - a.ts);
}

function orderStateFromEscrowStatus(status: MarketReceiptV2['status']): C2COrderRecord['state'] {
  switch (status) {
    case 'PENDING':
      return 'LOCK_PENDING';
    case 'LOCKED':
      return 'LOCKED';
    case 'RELEASED':
      return 'RELEASED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'FAILED';
  }
}

function escrowMatchesOrderPayload(payload: {
  escrowId: string;
  assetId: string;
  qty: number;
  seller: string;
  buyer: string;
}): boolean {
  const parsed = parseEscrowId(payload.escrowId);
  if (!parsed) {
    return false;
  }
  return (
    parsed.assetId === payload.assetId &&
    parsed.qty === payload.qty &&
    parsed.seller === payload.seller &&
    parsed.buyer === payload.buyer
  );
}

export class C2CStore {
  private snapshot: C2CSnapshot = loadSnapshot();
  private listeners = new Set<SnapshotListener>();

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): C2CSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  clear(): void {
    this.snapshot = emptySnapshot();
    this.emit();
  }

  upsertListing(record: C2CListingRecord): void {
    const next = [...this.snapshot.listings];
    const idx = next.findIndex((item) => item.listingId === record.listingId);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        ...record,
      };
    } else {
      next.push(record);
    }
    this.snapshot.listings = sortListings(next);
    this.emit();
  }

  markListingVerification(listingId: string, verified: boolean, reason = ''): void {
    const idx = this.snapshot.listings.findIndex((item) => item.listingId === listingId);
    if (idx < 0) {
      return;
    }
    const next = [...this.snapshot.listings];
    next[idx] = {
      ...next[idx],
      verified,
      invalidReason: reason || undefined,
      lastVerifiedAtMs: nowMs(),
    };
    this.snapshot.listings = sortListings(next);
    this.emit();
  }

  upsertOrder(order: C2COrderRecord): void {
    const next = [...this.snapshot.orders];
    const idx = next.findIndex((item) => item.orderId === order.orderId);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        ...order,
      };
    } else {
      next.push(order);
    }
    this.snapshot.orders = sortOrders(next);
    this.emit();
  }

  patchOrder(orderId: string, patch: Partial<C2COrderRecord>): void {
    const idx = this.snapshot.orders.findIndex((item) => item.orderId === orderId);
    if (idx < 0) {
      return;
    }
    const next = [...this.snapshot.orders];
    next[idx] = {
      ...next[idx],
      ...patch,
      updatedAtMs: nowMs(),
    };
    this.snapshot.orders = sortOrders(next);
    this.emit();
  }

  upsertTrade(trade: C2CTradeRecord): void {
    const next = [...this.snapshot.trades];
    const idx = next.findIndex((item) => item.tradeId === trade.tradeId);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        ...trade,
      };
    } else {
      next.push(trade);
    }
    this.snapshot.trades = sortTrades(next);
    this.emit();
  }

  upsertReceipt(receipt: C2CReceiptRecord): void {
    const next = [...this.snapshot.receipts];
    const idx = next.findIndex((item) => item.receiptId === receipt.receiptId);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        ...receipt,
      };
    } else {
      next.push(receipt);
    }
    this.snapshot.receipts = sortReceipts(next);
    this.emit();
  }

  async applyEnvelope(
    rawEnvelope: unknown,
    source: 'p2p' | 'chain' | 'local',
    options: { checkReplay?: boolean } = {},
  ): Promise<boolean> {
    const envelope = decodeEnvelope(rawEnvelope);
    if (!envelope) {
      return false;
    }
    const verified = await verifyEnvelopeSignature(envelope, {
      checkReplay: options.checkReplay ?? source !== 'local',
    });
    if (!verified.ok) {
      return false;
    }
    return this.applyVerifiedEnvelope(envelope, source);
  }

  applyVerifiedEnvelope(envelope: C2CEnvelope<JsonValue>, source: 'p2p' | 'chain' | 'local'): boolean {
    if (envelope.schema === 'unimaker.market.listing.v2') {
      const payload = envelope.payload as unknown as MarketListingV2;
      if (!payload.listingId || !payload.assetId || !payload.seller) {
        return false;
      }
      const record: C2CListingRecord = {
        ...payload,
        envelopeSig: envelope.sig,
        verified: source === 'local',
        receivedAtMs: nowMs(),
      };
      this.upsertListing(record);
      return true;
    }

    if (envelope.schema === 'unimaker.market.order.v2') {
      const payload = envelope.payload as unknown as MarketOrderV2;
      if (!payload.orderId || !payload.escrowId || !payload.assetId) {
        return false;
      }
      if (!escrowMatchesOrderPayload(payload)) {
        return false;
      }
      this.upsertOrder({
        ...payload,
        source,
      });
      return true;
    }

    if (envelope.schema === 'unimaker.market.trade.v2') {
      const payload = envelope.payload as unknown as MarketTradeV2;
      if (!payload.tradeId || !payload.releaseTxHash) {
        return false;
      }
      if (!payload.orderId || !payload.escrowId || !payload.assetId || !payload.buyer || !payload.seller || payload.qty <= 0) {
        return false;
      }
      if (!escrowMatchesOrderPayload({
        escrowId: payload.escrowId,
        assetId: payload.assetId,
        qty: payload.qty,
        seller: payload.seller,
        buyer: payload.buyer,
      })) {
        return false;
      }
      this.upsertTrade({
        ...payload,
        source,
      });
      this.patchOrder(payload.orderId, {
        state: orderStateFromEscrowStatus(payload.escrowState),
        escrowState: payload.escrowState,
      });
      return true;
    }

    if (envelope.schema === 'unimaker.market.receipt.v2') {
      const payload = envelope.payload as unknown as MarketReceiptV2;
      if (!payload.receiptId || !payload.orderId) {
        return false;
      }
      if (!payload.escrowId || !parseEscrowId(payload.escrowId)) {
        return false;
      }
      this.upsertReceipt({
        ...payload,
        source,
      });
      this.patchOrder(payload.orderId, {
        state: orderStateFromEscrowStatus(payload.status),
        escrowState: payload.status,
        lockTxHash: payload.txHash || undefined,
        lockTxStatus: payload.status === 'LOCKED' || payload.status === 'RELEASED' ? 'accepted' : payload.status === 'PENDING' ? 'pending' : 'rejected',
      });
      return true;
    }

    return false;
  }

  private emit(): void {
    this.snapshot.updatedAt = nowMs();
    persistSnapshot(this.snapshot);
    const current = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(current);
    }
  }
}

export const c2cStore = new C2CStore();

export function createListingRecordFromPayload(payload: MarketListingV2, envelopeSig: string): C2CListingRecord {
  return {
    ...payload,
    envelopeSig,
    verified: false,
    receivedAtMs: nowMs(),
  };
}

export function readSnapshot(): C2CSnapshot {
  return c2cStore.getSnapshot();
}

export function pickMyOrders(snapshot: C2CSnapshot, myAddress: string): C2COrderRecord[] {
  return snapshot.orders.filter((item) => item.buyer === myAddress || item.seller === myAddress);
}

export function pickVerifiedListings(snapshot: C2CSnapshot): C2CListingRecord[] {
  const now = nowMs();
  return snapshot.listings.filter((item) => item.verified && item.expiresAtMs > now && item.qty > 0);
}
