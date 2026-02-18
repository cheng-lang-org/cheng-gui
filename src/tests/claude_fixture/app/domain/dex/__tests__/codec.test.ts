import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signDexEnvelopePayload, verifyDexEnvelopeSignature } from '../codec';
import { DEX_TOPICS } from '../types';

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

describe('dex codec signature verification', () => {
  it('accepts valid signed envelope', async () => {
    const signer = await createSigner();
    const envelope = await signDexEnvelopePayload({
      schema: DEX_TOPICS.order,
      topic: DEX_TOPICS.order,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        orderId: 'dex-ord-1',
        marketId: 'BTC-USDC',
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price: 100_000,
        qty: 0.01,
        remainingQty: 0.01,
        makerAddress: signer.publicHex,
        makerPeerId: 'peer-1',
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 30_000,
      },
    });

    const verified = await verifyDexEnvelopeSignature(envelope);
    expect(verified.ok).toBe(true);
  });

  it('rejects tampered payload', async () => {
    const signer = await createSigner();
    const envelope = await signDexEnvelopePayload({
      schema: DEX_TOPICS.order,
      topic: DEX_TOPICS.order,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: {
        orderId: 'dex-ord-2',
        marketId: 'BTC-USDT',
        side: 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        price: 100_000,
        qty: 0.02,
        remainingQty: 0.02,
        makerAddress: signer.publicHex,
        makerPeerId: 'peer-2',
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 30_000,
      },
    });

    const tampered = {
      ...envelope,
      payload: {
        ...(envelope.payload as Record<string, unknown>),
        qty: 0.5,
      },
    };

    const verified = await verifyDexEnvelopeSignature(tampered);
    expect(verified.ok).toBe(false);
  });

  it('rejects replayed nonce', async () => {
    const signer = await createSigner();
    const now = Date.now();
    const envelope = await signDexEnvelopePayload({
      schema: DEX_TOPICS.link,
      topic: DEX_TOPICS.link,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      ts: now,
      nonce: 'replay-1',
      ttlMs: 60_000,
      payload: {
        linkId: 'link-1',
        marketId: 'BTC-USDC',
        direction: 'DEX_TO_C2C_FALLBACK',
        status: 'TRIGGERED',
        ts: now,
      },
    });

    const first = await verifyDexEnvelopeSignature(envelope, { nowMs: now });
    const second = await verifyDexEnvelopeSignature(envelope, { nowMs: now + 1000 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('replayed_nonce');
  });
});
