import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildEscrowId, parseEscrowId, signEnvelopePayload, verifyEnvelopeSignature } from '../codec';
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
});

describe('c2c codec signature verification', () => {
  it('accepts valid signed envelope', async () => {
    const signer = await createSigner();
    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.listing,
      topic: C2C_TOPICS.listing,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        listingId: 'lst-1',
        assetId: 'asset-1',
        seller: signer.publicHex,
        sellerPeerId: 'peer-1',
        qty: 2,
        unitPriceRwads: 3,
        minQty: 1,
        maxQty: 2,
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      },
    });

    const verified = await verifyEnvelopeSignature(envelope);
    expect(verified.ok).toBe(true);
  });

  it('rejects tampered payload', async () => {
    const signer = await createSigner();
    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.listing,
      topic: C2C_TOPICS.listing,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        listingId: 'lst-2',
        assetId: 'asset-2',
        seller: signer.publicHex,
        sellerPeerId: 'peer-2',
        qty: 2,
        unitPriceRwads: 3,
        minQty: 1,
        maxQty: 2,
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
      },
    });
    const tampered = {
      ...envelope,
      payload: { ...(envelope.payload as Record<string, unknown>), qty: 9 },
    };

    const verified = await verifyEnvelopeSignature(tampered);
    expect(verified.ok).toBe(false);
  });

  it('rejects expired envelope', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.order,
      topic: C2C_TOPICS.order,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      ts: now - 120_000,
      ttlMs: 5_000,
      payload: {
        orderId: 'ord-1',
        listingId: 'lst-1',
        assetId: 'asset-1',
        escrowId: 'mkt1:asset-1:1:seller:buyer:nonce',
        buyer: 'buyer',
        buyerPeerId: 'peer-buyer',
        seller: 'seller',
        sellerPeerId: 'peer-seller',
        qty: 1,
        unitPriceRwads: 10,
        totalRwads: 10,
        escrowState: 'PENDING',
        state: 'LOCK_PENDING',
        createdAtMs: now,
        updatedAtMs: now,
        expiresAtMs: now + 60_000,
      },
    });

    const verified = await verifyEnvelopeSignature(envelope, { nowMs: now });
    expect(verified.ok).toBe(false);
    expect(verified.reason).toBe('expired');
  });

  it('rejects replayed nonce', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const envelope = await signEnvelopePayload({
      schema: C2C_TOPICS.receipt,
      topic: C2C_TOPICS.receipt,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      ts: now,
      ttlMs: 60_000,
      nonce: 'replay-1',
      payload: {
        receiptId: 'rcpt-1',
        orderId: 'ord-1',
        escrowId: 'mkt1:asset-1:1:seller:buyer:nonce',
        status: 'LOCKED',
        txHash: 'tx-1',
        ts: now,
      },
    });

    const first = await verifyEnvelopeSignature(envelope, { nowMs: now });
    const second = await verifyEnvelopeSignature(envelope, { nowMs: now + 1_000 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('replayed_nonce');
  });
});

describe('c2c escrow id', () => {
  it('builds and parses escrow id with stable fields', () => {
    const escrowId = buildEscrowId({
      assetId: 'asset-42',
      qty: 3,
      seller: 'seller-addr',
      buyer: 'buyer-addr',
      nonce: 'abcd1234',
    });

    expect(escrowId).toBe('mkt1:asset-42:3:seller-addr:buyer-addr:abcd1234');
    expect(parseEscrowId(escrowId)).toEqual({
      assetId: 'asset-42',
      qty: 3,
      seller: 'seller-addr',
      buyer: 'buyer-addr',
      nonce: 'abcd1234',
    });
  });
});
