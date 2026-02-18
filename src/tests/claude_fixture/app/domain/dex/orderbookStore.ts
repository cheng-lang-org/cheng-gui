import type {
  DexC2CLinkV1,
  DexDepthLevel,
  DexDepthRecord,
  DexDepthV1,
  DexEnvelope,
  DexMatchRecord,
  DexMatchV1,
  DexMarketId,
  DexOrderRecord,
  DexOrderStatus,
  DexOrderV1,
  DexSnapshot,
} from './types';
import type { JsonValue } from '../../libp2p/definitions';
import { decodeDexEnvelope, verifyDexEnvelopeSignature } from './codec';

const STORAGE_KEY = 'unimaker_dex_orderbook_store_v1';

type SnapshotListener = (snapshot: DexSnapshot) => void;

function nowMs(): number {
  return Date.now();
}

function cloneSnapshot(snapshot: DexSnapshot): DexSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as DexSnapshot;
}

function emptySnapshot(): DexSnapshot {
  return {
    orders: [],
    matches: [],
    depths: [],
    links: [],
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

function normalizeQty(value: number): number {
  return Number(Math.max(0, value).toFixed(8));
}

function normalizePrice(value: number): number {
  return Number(Math.max(0, value).toFixed(8));
}

function loadSnapshot(): DexSnapshot {
  if (typeof localStorage === 'undefined') {
    return emptySnapshot();
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return emptySnapshot();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return emptySnapshot();
    }
    return {
      orders: Array.isArray(parsed.orders) ? (parsed.orders as DexOrderRecord[]) : [],
      matches: Array.isArray(parsed.matches) ? (parsed.matches as DexMatchRecord[]) : [],
      depths: Array.isArray(parsed.depths) ? (parsed.depths as DexDepthRecord[]) : [],
      links: Array.isArray(parsed.links) ? (parsed.links as DexSnapshot['links']) : [],
      updatedAt: asNumber(parsed.updatedAt, nowMs()),
    };
  } catch {
    return emptySnapshot();
  }
}

function persistSnapshot(snapshot: DexSnapshot): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function sortOrders(orders: DexOrderRecord[]): DexOrderRecord[] {
  return [...orders].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function sortMatches(matches: DexMatchRecord[]): DexMatchRecord[] {
  return [...matches].sort((a, b) => b.ts - a.ts);
}

function sortDepths(depths: DexDepthRecord[]): DexDepthRecord[] {
  return [...depths].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function sortLinks(links: DexSnapshot['links']): DexSnapshot['links'] {
  return [...links].sort((a, b) => b.ts - a.ts);
}

function openStatus(status: DexOrderStatus): boolean {
  return status === 'OPEN' || status === 'PARTIALLY_FILLED';
}

function fnv1aHashHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < input.length; idx += 1) {
    hash ^= input.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalDepthLevels(levels: DexDepthLevel[]): DexDepthLevel[] {
  return levels
    .map((item) => ({
      price: normalizePrice(item.price),
      qty: normalizeQty(item.qty),
    }))
    .filter((item) => item.price > 0 && item.qty > 0);
}

export function computeDepthChecksum(input: {
  marketId: DexMarketId;
  sequence: number;
  bids: DexDepthLevel[];
  asks: DexDepthLevel[];
}): string {
  const normalized = {
    marketId: input.marketId,
    sequence: input.sequence,
    bids: canonicalDepthLevels(input.bids),
    asks: canonicalDepthLevels(input.asks),
  };
  return fnv1aHashHex(JSON.stringify(normalized));
}

export function verifyDepthChecksum(input: DexDepthV1): boolean {
  return computeDepthChecksum(input) === input.checksum;
}

function upsertById<T>(
  rows: T[],
  matches: (item: T) => boolean,
  next: T,
): T[] {
  const idx = rows.findIndex((item) => matches(item));
  if (idx < 0) {
    return [...rows, next];
  }
  const merged = [...rows];
  merged[idx] = next;
  return merged;
}

function sequenceForMarket(snapshot: DexSnapshot, marketId: DexMarketId): number {
  const depthSeq = snapshot.depths.find((item) => item.marketId === marketId)?.sequence ?? 0;
  const matchSeq = snapshot.matches.filter((item) => item.marketId === marketId).reduce((max, item) => Math.max(max, item.sequence), 0);
  return Math.max(depthSeq, matchSeq);
}

export class DexOrderbookStore {
  private snapshot: DexSnapshot = loadSnapshot();
  private listeners = new Set<SnapshotListener>();

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): DexSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  clear(): void {
    this.snapshot = emptySnapshot();
    this.emit();
  }

  getLastSequence(marketId: DexMarketId): number {
    return sequenceForMarket(this.snapshot, marketId);
  }

  getDepth(marketId: DexMarketId): DexDepthRecord | null {
    return this.snapshot.depths.find((item) => item.marketId === marketId) ?? null;
  }

  upsertOrder(order: DexOrderRecord): void {
    const next = upsertById(this.snapshot.orders, (item) => item.orderId === order.orderId, order);
    this.snapshot.orders = sortOrders(next);
    this.emit();
  }

  patchOrder(orderId: string, patch: Partial<DexOrderRecord>): void {
    const idx = this.snapshot.orders.findIndex((item) => item.orderId === orderId);
    if (idx < 0) {
      return;
    }
    const next = [...this.snapshot.orders];
    next[idx] = {
      ...next[idx],
      ...patch,
    };
    this.snapshot.orders = sortOrders(next);
    this.emit();
  }

  upsertMatch(match: DexMatchRecord): void {
    const next = upsertById(this.snapshot.matches, (item) => item.matchId === match.matchId, match);
    this.snapshot.matches = sortMatches(next);
    this.emit();
  }

  upsertDepth(depth: DexDepthRecord): void {
    const prev = this.snapshot.depths.find((item) => item.marketId === depth.marketId);
    if (prev && depth.sequence < prev.sequence) {
      return;
    }
    const next = upsertById(this.snapshot.depths, (item) => item.marketId === depth.marketId, depth);
    this.snapshot.depths = sortDepths(next);
    this.emit();
  }

  upsertLink(link: DexSnapshot['links'][number]): void {
    const next = upsertById(this.snapshot.links, (item) => item.linkId === link.linkId, link);
    this.snapshot.links = sortLinks(next);
    this.emit();
  }

  async applyEnvelope(
    rawEnvelope: unknown,
    source: 'p2p' | 'chain' | 'local',
    options: { checkReplay?: boolean } = {},
  ): Promise<boolean> {
    const envelope = decodeDexEnvelope(rawEnvelope);
    if (!envelope) {
      return false;
    }
    const verified = await verifyDexEnvelopeSignature(envelope, {
      checkReplay: options.checkReplay ?? source !== 'local',
    });
    if (!verified.ok) {
      return false;
    }
    return this.applyVerifiedEnvelope(envelope, source);
  }

  applyVerifiedEnvelope(envelope: DexEnvelope<JsonValue>, source: 'p2p' | 'chain' | 'local'): boolean {
    if (envelope.schema === 'unimaker.dex.order.v1') {
      const payload = envelope.payload as unknown as DexOrderV1;
      if (!payload.orderId || !payload.marketId || !payload.side || !payload.type) {
        return false;
      }
      if (payload.qty <= 0 || payload.remainingQty < 0) {
        return false;
      }
      const filledQty = normalizeQty(payload.qty - payload.remainingQty);
      const status: DexOrderStatus =
        payload.remainingQty <= 0 ? 'FILLED' : filledQty > 0 ? 'PARTIALLY_FILLED' : 'OPEN';
      this.upsertOrder({
        ...payload,
        price: payload.price ? normalizePrice(payload.price) : undefined,
        qty: normalizeQty(payload.qty),
        remainingQty: normalizeQty(payload.remainingQty),
        filledQty,
        status,
        settlementState: 'PENDING',
        source,
      });
      return true;
    }

    if (envelope.schema === 'unimaker.dex.match.v1') {
      const payload = envelope.payload as unknown as DexMatchV1;
      if (!payload.matchId || !payload.marketId || payload.qty <= 0 || payload.price <= 0) {
        return false;
      }
      if (payload.sequence <= 0) {
        return false;
      }
      const lastSeq = this.getLastSequence(payload.marketId);
      if (payload.sequence < lastSeq) {
        return false;
      }

      this.upsertMatch({
        ...payload,
        price: normalizePrice(payload.price),
        qty: normalizeQty(payload.qty),
        notionalQuote: normalizeQty(payload.notionalQuote),
        source,
      });
      this.applyMatchFill(payload);
      return true;
    }

    if (envelope.schema === 'unimaker.dex.depth.v1') {
      const payload = envelope.payload as unknown as DexDepthV1;
      if (!payload.marketId || payload.sequence <= 0) {
        return false;
      }
      if (!verifyDepthChecksum(payload)) {
        return false;
      }
      this.upsertDepth({
        ...payload,
        bids: canonicalDepthLevels(payload.bids),
        asks: canonicalDepthLevels(payload.asks),
        updatedAtMs: nowMs(),
      });
      return true;
    }

    if (envelope.schema === 'unimaker.dex.c2c.link.v1') {
      const payload = envelope.payload as unknown as DexC2CLinkV1;
      if (!payload.linkId || !payload.marketId || !payload.direction || !payload.status) {
        return false;
      }
      this.upsertLink({
        ...payload,
        source,
      });
      return true;
    }

    return false;
  }

  private applyMatchFill(match: DexMatchV1): void {
    const orders = [...this.snapshot.orders];
    const applyOrderFill = (orderId: string): void => {
      const idx = orders.findIndex((item) => item.orderId === orderId);
      if (idx < 0) {
        return;
      }
      const order = orders[idx];
      const nextFilled = normalizeQty(order.filledQty + match.qty);
      const nextRemaining = normalizeQty(order.qty - nextFilled);
      const nextStatus: DexOrderStatus =
        nextRemaining <= 0 ? 'FILLED' : nextFilled > 0 ? 'PARTIALLY_FILLED' : order.status;
      orders[idx] = {
        ...order,
        filledQty: nextFilled,
        remainingQty: nextRemaining,
        status: nextStatus,
        settlementState: match.settlementState,
      };
    };
    applyOrderFill(match.buyOrderId);
    applyOrderFill(match.sellOrderId);
    this.snapshot.orders = sortOrders(orders);
    this.emit();
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

export const dexOrderbookStore = new DexOrderbookStore();

export function readDexSnapshot(): DexSnapshot {
  return dexOrderbookStore.getSnapshot();
}

export function pickMarketOrders(snapshot: DexSnapshot, marketId: DexMarketId): DexOrderRecord[] {
  return snapshot.orders.filter((item) => item.marketId === marketId);
}

export function pickOpenOrders(snapshot: DexSnapshot, marketId: DexMarketId): DexOrderRecord[] {
  return snapshot.orders.filter((item) => item.marketId === marketId && openStatus(item.status));
}

export function pickRecentMatches(snapshot: DexSnapshot, marketId: DexMarketId, limit = 50): DexMatchRecord[] {
  return snapshot.matches.filter((item) => item.marketId === marketId).slice(0, limit);
}

export function pickDepth(snapshot: DexSnapshot, marketId: DexMarketId): DexDepthRecord | null {
  return snapshot.depths.find((item) => item.marketId === marketId) ?? null;
}

export function buildDepthFromOrders(input: {
  marketId: DexMarketId;
  sequence: number;
  orders: DexOrderRecord[];
  maxLevels?: number;
}): DexDepthV1 {
  const maxLevels = Math.max(1, Math.floor(input.maxLevels ?? 30));
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();

  for (const order of input.orders) {
    if (order.marketId !== input.marketId || order.remainingQty <= 0 || order.price === undefined || order.price <= 0) {
      continue;
    }
    const target = order.side === 'BUY' ? bids : asks;
    const prev = target.get(order.price) ?? 0;
    target.set(order.price, normalizeQty(prev + order.remainingQty));
  }

  const sortedBids = Array.from(bids.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, maxLevels)
    .map(([price, qty]) => ({ price: normalizePrice(price), qty: normalizeQty(qty) }));

  const sortedAsks = Array.from(asks.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, maxLevels)
    .map(([price, qty]) => ({ price: normalizePrice(price), qty: normalizeQty(qty) }));

  const depth: DexDepthV1 = {
    marketId: input.marketId,
    sequence: input.sequence,
    bids: sortedBids,
    asks: sortedAsks,
    checksum: '',
    ts: Date.now(),
  };
  depth.checksum = computeDepthChecksum(depth);
  return depth;
}

export function normalizeDexEnvelope(raw: unknown): DexEnvelope<JsonValue> | null {
  const direct = decodeDexEnvelope(raw);
  if (direct) {
    return direct;
  }
  const record = isRecord(raw) ? raw : null;
  if (!record) {
    return null;
  }
  if (record.envelope) {
    return decodeDexEnvelope(record.envelope);
  }
  if (record.payload) {
    return decodeDexEnvelope(record.payload);
  }
  return null;
}

export function bestBidAsk(depth: DexDepthRecord | null): { bid: number; ask: number } {
  if (!depth) {
    return { bid: 0, ask: 0 };
  }
  const bid = depth.bids.length > 0 ? depth.bids[0].price : 0;
  const ask = depth.asks.length > 0 ? depth.asks[0].price : 0;
  return { bid, ask };
}

export function estimateDepthFill(input: {
  side: 'BUY' | 'SELL';
  qty: number;
  depth: DexDepthRecord | null;
}): { filledQty: number; avgPrice: number; bestPrice: number; slippageBps: number } {
  const qty = normalizeQty(input.qty);
  if (!input.depth || qty <= 0) {
    return { filledQty: 0, avgPrice: 0, bestPrice: 0, slippageBps: 0 };
  }
  const levels = input.side === 'BUY' ? input.depth.asks : input.depth.bids;
  if (levels.length === 0) {
    return { filledQty: 0, avgPrice: 0, bestPrice: 0, slippageBps: 0 };
  }
  const bestPrice = levels[0].price;
  let remaining = qty;
  let filled = 0;
  let notional = 0;
  for (const level of levels) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(level.qty, remaining);
    if (take <= 0) {
      continue;
    }
    filled += take;
    notional += take * level.price;
    remaining -= take;
  }
  const avgPrice = filled > 0 ? notional / filled : 0;
  if (filled <= 0 || bestPrice <= 0) {
    return { filledQty: 0, avgPrice: 0, bestPrice: 0, slippageBps: 0 };
  }
  const diff = input.side === 'BUY' ? avgPrice - bestPrice : bestPrice - avgPrice;
  const slippageBps = Math.max(0, Math.round((diff / bestPrice) * 10_000));
  return {
    filledQty: normalizeQty(filled),
    avgPrice: normalizePrice(avgPrice),
    bestPrice: normalizePrice(bestPrice),
    slippageBps,
  };
}

export function safeOrderStatus(order: DexOrderRecord): DexOrderStatus {
  if (order.remainingQty <= 0) {
    return 'FILLED';
  }
  if (order.filledQty > 0) {
    return 'PARTIALLY_FILLED';
  }
  return order.status;
}

export function parseOrderIdPrefix(orderId: string): string {
  const [prefix] = asString(orderId).split('-');
  return prefix || '';
}
