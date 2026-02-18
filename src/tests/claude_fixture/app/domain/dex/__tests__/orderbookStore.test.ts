import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signDexEnvelopePayload } from '../codec';
import { DEX_TOPICS } from '../types';
import { buildDepthFromOrders, computeDepthChecksum, dexOrderbookStore, pickDepth } from '../orderbookStore';

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
  dexOrderbookStore.clear();
});

describe('dex orderbook store replay consistency', () => {
  it('accepts higher sequence and rejects stale depth updates', async () => {
    const signer = await createSigner();
    const depth1 = {
      marketId: 'BTC-USDC' as const,
      sequence: 10,
      bids: [{ price: 100_000, qty: 0.2 }],
      asks: [{ price: 100_010, qty: 0.3 }],
      ts: Date.now(),
      checksum: '',
    };
    depth1.checksum = computeDepthChecksum(depth1);
    const env1 = await signDexEnvelopePayload({
      schema: DEX_TOPICS.depth,
      topic: DEX_TOPICS.depth,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: depth1,
    });

    expect(await dexOrderbookStore.applyEnvelope(env1, 'p2p')).toBe(true);

    const depth2 = {
      marketId: 'BTC-USDC' as const,
      sequence: 9,
      bids: [{ price: 99_900, qty: 0.5 }],
      asks: [{ price: 100_100, qty: 0.5 }],
      ts: Date.now() + 10,
      checksum: '',
    };
    depth2.checksum = computeDepthChecksum(depth2);
    const env2 = await signDexEnvelopePayload({
      schema: DEX_TOPICS.depth,
      topic: DEX_TOPICS.depth,
      signer: signer.publicHex,
      privateKeyPkcs8: signer.privatePkcs8,
      payload: depth2,
    });

    expect(await dexOrderbookStore.applyEnvelope(env2, 'p2p')).toBe(true);
    const depth = pickDepth(dexOrderbookStore.getSnapshot(), 'BTC-USDC');
    expect(depth?.sequence).toBe(10);
  });

  it('builds deterministic depth checksum from open orders', () => {
    const depth = buildDepthFromOrders({
      marketId: 'BTC-USDT',
      sequence: 1,
      orders: [
        {
          orderId: 'o1',
          marketId: 'BTC-USDT',
          side: 'BUY',
          type: 'LIMIT',
          timeInForce: 'GTC',
          price: 100_000,
          qty: 0.2,
          remainingQty: 0.2,
          makerAddress: 'a',
          makerPeerId: 'p',
          createdAtMs: 1,
          expiresAtMs: 2,
          status: 'OPEN',
          filledQty: 0,
          settlementState: 'PENDING',
          source: 'local',
        },
        {
          orderId: 'o2',
          marketId: 'BTC-USDT',
          side: 'SELL',
          type: 'LIMIT',
          timeInForce: 'GTC',
          price: 100_100,
          qty: 0.3,
          remainingQty: 0.3,
          makerAddress: 'b',
          makerPeerId: 'p',
          createdAtMs: 1,
          expiresAtMs: 2,
          status: 'OPEN',
          filledQty: 0,
          settlementState: 'PENDING',
          source: 'local',
        },
      ],
    });

    expect(depth.checksum).toBe(computeDepthChecksum(depth));
  });
});
