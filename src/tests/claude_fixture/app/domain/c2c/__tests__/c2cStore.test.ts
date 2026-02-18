import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { c2cStore } from '../c2cStore';
import { signEnvelopePayload } from '../codec';
import { C2C_TOPICS } from '../types';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function ensureBrowserPrimitives(): void {
  if (typeof globalThis.btoa !== 'function') {
    Object.defineProperty(globalThis, 'btoa', {
      configurable: true,
      value: (value: string) => Buffer.from(value, 'binary').toString('base64'),
    });
  }
  if (typeof globalThis.atob !== 'function') {
    Object.defineProperty(globalThis, 'atob', {
      configurable: true,
      value: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    });
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let idx = 0; idx < bytes.length; idx += 1) {
    binary += String.fromCharCode(bytes[idx]);
  }
  return btoa(binary);
}

async function createSigner(): Promise<{ publicHex: string; privatePkcs8: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const publicRaw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return {
    publicHex: bytesToHex(new Uint8Array(publicRaw)),
    privatePkcs8: `pkcs8:${bytesToBase64(new Uint8Array(privatePkcs8))}`,
  };
}

beforeAll(() => {
  ensureBrowserPrimitives();
});

beforeEach(() => {
  globalThis.localStorage.clear();
  c2cStore.clear();
});

describe('c2cStore sync convergence', () => {
  it('deduplicates identical listing from feed and pubsub paths', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.listing,
      topic: C2C_TOPICS.listing,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        listingId: 'lst-sync-1',
        assetId: 'asset-sync',
        seller: signer.publicHex,
        sellerPeerId: 'peer-sync',
        qty: 8,
        unitPriceRwads: 5,
        minQty: 1,
        maxQty: 8,
        createdAtMs: now,
        expiresAtMs: now + 60_000,
      },
    });

    const feedApplied = await c2cStore.applyEnvelope(envelope, 'p2p', { checkReplay: false });
    const pubsubApplied = await c2cStore.applyEnvelope(envelope, 'p2p', { checkReplay: false });

    expect(feedApplied).toBe(true);
    expect(pubsubApplied).toBe(true);
    expect(c2cStore.getSnapshot().listings).toHaveLength(1);
    expect(c2cStore.getSnapshot().listings[0].listingId).toBe('lst-sync-1');
  });

  it('rejects invalid signature payload mutation', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.listing,
      topic: C2C_TOPICS.listing,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        listingId: 'lst-sync-2',
        assetId: 'asset-sync',
        seller: signer.publicHex,
        sellerPeerId: 'peer-sync',
        qty: 1,
        unitPriceRwads: 10,
        minQty: 1,
        maxQty: 1,
        createdAtMs: now,
        expiresAtMs: now + 60_000,
      },
    });
    const tampered = {
      ...envelope,
      payload: { ...(envelope.payload as Record<string, unknown>), unitPriceRwads: 11 },
    };

    const ok = await c2cStore.applyEnvelope(tampered, 'p2p');
    expect(ok).toBe(false);
    expect(c2cStore.getSnapshot().listings).toHaveLength(0);
  });

  it('advances order state when receipt is received', async () => {
    const signer = await createSigner();
    const now = Date.now();

    const orderEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.order,
      topic: C2C_TOPICS.order,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        orderId: 'ord-sync-1',
        listingId: 'lst-sync-1',
        assetId: 'asset-sync',
        escrowId: `mkt1:asset-sync:2:${signer.publicHex}:buyer-1:nonce-1`,
        buyer: 'buyer-1',
        buyerPeerId: 'peer-buyer',
        seller: signer.publicHex,
        sellerPeerId: 'peer-seller',
        qty: 2,
        unitPriceRwads: 4,
        totalRwads: 8,
        escrowState: 'PENDING',
        state: 'LOCK_PENDING',
        createdAtMs: now,
        updatedAtMs: now,
        expiresAtMs: now + 60_000,
      },
    });
    const orderApplied = await c2cStore.applyEnvelope(orderEnvelope, 'p2p');
    expect(orderApplied).toBe(true);

    const receiptEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.receipt,
      topic: C2C_TOPICS.receipt,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        receiptId: 'rcpt-sync-1',
        orderId: 'ord-sync-1',
        escrowId: `mkt1:asset-sync:2:${signer.publicHex}:buyer-1:nonce-1`,
        status: 'LOCKED',
        txHash: 'tx-lock-1',
        ts: now + 1_000,
      },
    });
    const receiptApplied = await c2cStore.applyEnvelope(receiptEnvelope, 'p2p');
    expect(receiptApplied).toBe(true);

    const order = c2cStore.getSnapshot().orders.find((item) => item.orderId === 'ord-sync-1');
    expect(order?.state).toBe('LOCKED');
    expect(order?.escrowState).toBe('LOCKED');
    expect(order?.lockTxHash).toBe('tx-lock-1');
  });

  it('rejects order when escrow_id is inconsistent with order fields', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const orderEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.order,
      topic: C2C_TOPICS.order,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        orderId: 'ord-sync-bad-escrow',
        listingId: 'lst-sync-1',
        assetId: 'asset-sync',
        escrowId: `mkt1:asset-sync:3:${signer.publicHex}:buyer-1:nonce-1`,
        buyer: 'buyer-1',
        buyerPeerId: 'peer-buyer',
        seller: signer.publicHex,
        sellerPeerId: 'peer-seller',
        qty: 2,
        unitPriceRwads: 4,
        totalRwads: 8,
        escrowState: 'PENDING',
        state: 'LOCK_PENDING',
        createdAtMs: now,
        updatedAtMs: now,
        expiresAtMs: now + 60_000,
      },
    });

    const applied = await c2cStore.applyEnvelope(orderEnvelope, 'p2p');
    expect(applied).toBe(false);
    expect(c2cStore.getSnapshot().orders).toHaveLength(0);
  });

  it('advances order state when trade is settled to RELEASED', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const escrowId = `mkt1:asset-sync:2:${signer.publicHex}:buyer-2:nonce-2`;

    const orderEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.order,
      topic: C2C_TOPICS.order,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        orderId: 'ord-sync-trade-1',
        listingId: 'lst-sync-1',
        assetId: 'asset-sync',
        escrowId,
        buyer: 'buyer-2',
        buyerPeerId: 'peer-buyer-2',
        seller: signer.publicHex,
        sellerPeerId: 'peer-seller',
        qty: 2,
        unitPriceRwads: 4,
        totalRwads: 8,
        escrowState: 'LOCKED',
        state: 'LOCKED',
        createdAtMs: now,
        updatedAtMs: now,
        expiresAtMs: now + 60_000,
      },
    });
    expect(await c2cStore.applyEnvelope(orderEnvelope, 'p2p')).toBe(true);

    const tradeEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.trade,
      topic: C2C_TOPICS.trade,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        tradeId: 'trd-sync-1',
        orderId: 'ord-sync-trade-1',
        listingId: 'lst-sync-1',
        escrowId,
        assetId: 'asset-sync',
        buyer: 'buyer-2',
        seller: signer.publicHex,
        qty: 2,
        unitPriceRwads: 4,
        totalRwads: 8,
        releaseTxHash: 'tx-release-1',
        escrowState: 'RELEASED',
        settledAtMs: now + 5_000,
      },
    });
    expect(await c2cStore.applyEnvelope(tradeEnvelope, 'p2p')).toBe(true);

    const order = c2cStore.getSnapshot().orders.find((item) => item.orderId === 'ord-sync-trade-1');
    const trade = c2cStore.getSnapshot().trades.find((item) => item.tradeId === 'trd-sync-1');
    expect(order?.state).toBe('RELEASED');
    expect(order?.escrowState).toBe('RELEASED');
    expect(trade?.releaseTxHash).toBe('tx-release-1');
  });

  it('advances order state to REFUNDED on refund receipt', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const escrowId = `mkt1:asset-sync:1:${signer.publicHex}:buyer-3:nonce-3`;

    const orderEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.order,
      topic: C2C_TOPICS.order,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        orderId: 'ord-sync-refund-1',
        listingId: 'lst-sync-1',
        assetId: 'asset-sync',
        escrowId,
        buyer: 'buyer-3',
        buyerPeerId: 'peer-buyer-3',
        seller: signer.publicHex,
        sellerPeerId: 'peer-seller',
        qty: 1,
        unitPriceRwads: 4,
        totalRwads: 4,
        escrowState: 'PENDING',
        state: 'LOCK_PENDING',
        createdAtMs: now,
        updatedAtMs: now,
        expiresAtMs: now + 60_000,
      },
    });
    expect(await c2cStore.applyEnvelope(orderEnvelope, 'p2p')).toBe(true);

    const receiptEnvelope = await signEnvelopePayload({
      schema: C2C_TOPICS.receipt,
      topic: C2C_TOPICS.receipt,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        receiptId: 'rcpt-sync-refund-1',
        orderId: 'ord-sync-refund-1',
        escrowId,
        status: 'REFUNDED',
        txHash: 'tx-refund-1',
        ts: now + 10_000,
      },
    });
    expect(await c2cStore.applyEnvelope(receiptEnvelope, 'p2p')).toBe(true);

    const order = c2cStore.getSnapshot().orders.find((item) => item.orderId === 'ord-sync-refund-1');
    expect(order?.state).toBe('REFUNDED');
    expect(order?.escrowState).toBe('REFUNDED');
    expect(order?.lockTxStatus).toBe('rejected');
  });
});
