import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeDepthChecksum } from '../orderbookStore';

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

async function createSigner(): Promise<{ address: string; peerId: string; privateKeyPkcs8: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const publicRaw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const address = bytesToHex(new Uint8Array(publicRaw));
  return {
    address,
    peerId: `peer-${address.slice(0, 8)}`,
    privateKeyPkcs8: `pkcs8:${bytesToBase64(new Uint8Array(privatePkcs8))}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function setFlag(name: string, enabled: boolean): void {
  localStorage.setItem(`feature_flag_${name}`, enabled ? '1' : '0');
}

const runtimeState = {
  publishOk: true,
  published: [] as Array<{ topic: string; payload: unknown }>,
  snapshotItems: [] as Array<{ id: string; topic: string; payload: unknown }>,
};

const runtimeListeners = new Map<string, Set<(event: unknown) => void>>();

const runtimeMock = {
  start: vi.fn(async () => true),
  stop: vi.fn(async () => {}),
  subscribe: vi.fn((topic: string, listener: (event: unknown) => void) => {
    const bucket = runtimeListeners.get(topic) ?? new Set<(event: unknown) => void>();
    bucket.add(listener);
    runtimeListeners.set(topic, bucket);
    return () => {
      const existing = runtimeListeners.get(topic);
      existing?.delete(listener);
      if (existing && existing.size === 0) {
        runtimeListeners.delete(topic);
      }
    };
  }),
  publish: vi.fn(async (topic: string, payload: unknown) => {
    if (!runtimeState.publishOk) {
      return false;
    }
    runtimeState.published.push({ topic, payload });
    return true;
  }),
  fetchSnapshot: vi.fn(async () => runtimeState.snapshotItems),
  discover: vi.fn(async () => []),
  isNative: vi.fn(() => false),
};

const runDexToC2CFallbackMock = vi.fn(async () => ({ ok: false, reason: 'fallback_not_required' }));
let txIndex = 0;
const submitSignedTxMock = vi.fn(async () => ({
  ok: true,
  txHash: `tx-${++txIndex}`,
}));

class MockDexC2CBridgeService {
  start(): void {}
  stop(): void {}
}

vi.mock('../../../libp2p/runtime', () => ({
  getLibp2pRuntime: () => runtimeMock,
}));

vi.mock('../../../libp2p/service', () => ({
  libp2pService: {
    isNativePlatform: () => false,
    getLocalPeerId: async () => 'peer-local',
    rendezvousAdvertise: async () => true,
    feedSubscribePeer: async () => true,
    rwadSubmitTx: async () => ({ ok: true, txHash: 'native-mock-tx' }),
  },
}));

vi.mock('../../rwad/rwadGateway', () => ({
  submitSignedTx: (input: unknown) => submitSignedTxMock(input),
}));

vi.mock('../../../utils/region', () => ({
  getCurrentPolicyGroupId: () => 'INTL',
}));

vi.mock('../../../utils/walletChains', () => ({
  loadWallets: () => [],
  getWalletPrivateKey: async () => '',
}));

vi.mock('../c2cBridge', () => ({
  DexC2CBridgeService: MockDexC2CBridgeService,
  runDexToC2CFallback: (input: unknown) => runDexToC2CFallbackMock(input),
}));

beforeAll(() => {
  ensureBrowserPrimitives();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  localStorage.clear();
  runtimeState.publishOk = true;
  runtimeState.published = [];
  runtimeState.snapshotItems = [];
  runtimeListeners.clear();
  txIndex = 0;
  setFlag('dex_clob_v1', true);
  setFlag('dex_c2c_bridge_v1', false);
});

afterEach(async () => {
  const dex = await import('../dexSync');
  await dex.stopDexSync();
  dex.getDexOrderbookStore().clear();
});

describe('dex sync production closure integration', () => {
  it('matches with price-time priority and preserves partial resting state', async () => {
    const dex = await import('../dexSync');
    const makerA = await createSigner();
    const makerB = await createSigner();
    const taker = await createSigner();

    const sellA = await dex.submitDexOrder(
      {
        marketId: 'BTC-USDT',
        side: 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        qty: 0.02,
        price: 100000,
      },
      makerA,
    );
    expect(sellA.ok).toBe(true);

    await sleep(2);

    const sellB = await dex.submitDexOrder(
      {
        marketId: 'BTC-USDT',
        side: 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        qty: 0.03,
        price: 100000,
      },
      makerB,
    );
    expect(sellB.ok).toBe(true);

    const buy = await dex.submitDexOrder(
      {
        marketId: 'BTC-USDT',
        side: 'BUY',
        type: 'MARKET',
        timeInForce: 'IOC',
        qty: 0.025,
      },
      taker,
    );
    expect(buy.ok).toBe(true);
    expect(Number(buy.filledQty ?? 0)).toBeCloseTo(0.025, 8);

    const snapshot = dex.getDexSnapshot();
    const matches = snapshot.matches
      .filter((item) => item.marketId === 'BTC-USDT')
      .sort((a, b) => a.sequence - b.sequence);

    expect(matches).toHaveLength(2);
    expect(matches[0]?.makerOrderId).toBe(sellA.orderId);
    expect(matches[1]?.makerOrderId).toBe(sellB.orderId);

    const orderA = snapshot.orders.find((item) => item.orderId === sellA.orderId);
    const orderB = snapshot.orders.find((item) => item.orderId === sellB.orderId);
    expect(orderA?.status).toBe('FILLED');
    expect(orderB?.status).toBe('PARTIALLY_FILLED');
    expect(Number(orderB?.remainingQty ?? 0)).toBeCloseTo(0.025, 8);
  });

  it('falls back to c2c when orderbook cannot fill', async () => {
    setFlag('dex_c2c_bridge_v1', true);
    runDexToC2CFallbackMock.mockResolvedValueOnce({
      ok: true,
      c2cOrderId: 'c2c-ord-1',
      linkId: 'dex-link-1',
    });

    const dex = await import('../dexSync');
    const signer = await createSigner();

    const result = await dex.submitDexOrder(
      {
        marketId: 'BTC-USDT',
        side: 'BUY',
        type: 'MARKET',
        timeInForce: 'IOC',
        qty: 0.01,
      },
      signer,
    );

    expect(result.ok).toBe(true);
    expect(result.fallbackOrderId).toBe('c2c-ord-1');
    expect(runDexToC2CFallbackMock).toHaveBeenCalledTimes(1);
  });

  it('keeps daily-limit budget intact when publish fails first', async () => {
    const dex = await import('../dexSync');
    const signer = await createSigner();

    runtimeState.publishOk = false;
    const failed = await dex.submitDexOrder(
      {
        marketId: 'BTC-USDT',
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        qty: 0.01,
        price: 100000,
      },
      signer,
    );
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe('order_publish_failed');

    const afterFailed = dex.getDexSnapshot();
    expect(afterFailed.orders[0]?.status).toBe('REJECTED');

    runtimeState.publishOk = true;
    const retry = await dex.submitDexOrder(
      {
        marketId: 'BTC-USDT',
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        qty: 0.01,
        price: 100000,
      },
      signer,
    );
    expect(retry.ok).toBe(true);
  });

  it('settles XAU-USDT using paxg_wrapped_v1 asset transfer mapping', async () => {
    const dex = await import('../dexSync');
    const signer = await createSigner();

    const buy = await dex.submitDexOrder(
      {
        marketId: 'XAU-USDT',
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        qty: 0.01,
        price: 2400,
      },
      signer,
    );
    expect(buy.ok).toBe(true);

    submitSignedTxMock.mockClear();

    const sell = await dex.submitDexOrder(
      {
        marketId: 'XAU-USDT',
        side: 'SELL',
        type: 'MARKET',
        timeInForce: 'IOC',
        qty: 0.01,
      },
      signer,
    );
    expect(sell.ok).toBe(true);
    expect(Number(sell.filledQty ?? 0)).toBeCloseTo(0.01, 8);

    const txCalls = submitSignedTxMock.mock.calls.map((entry) => entry[0] as Record<string, any>);
    const release = txCalls.find((entry) => entry.txType === 'asset_transfer');
    expect(release).toBeTruthy();
    expect(release?.payload?.asset_id).toBe('paxg_wrapped_v1');
  });

  it('recovers snapshot/depth sequence after restart replay', async () => {
    const dex = await import('../dexSync');
    const signer = await createSigner();

    const first = await dex.submitDexOrder(
      {
        marketId: 'BTC-USDT',
        side: 'SELL',
        type: 'LIMIT',
        timeInForce: 'GTC',
        qty: 0.01,
        price: 100000,
      },
      signer,
    );
    expect(first.ok).toBe(true);
    expect(runtimeState.published.length).toBeGreaterThan(0);

    await dex.stopDexSync();
    dex.getDexOrderbookStore().clear();

    runtimeState.snapshotItems = runtimeState.published.map((item, index) => ({
      id: `snap-${index}`,
      topic: item.topic,
      payload: item.payload,
    }));

    const restarted = await dex.startDexSync();
    expect(restarted).toBe(true);

    const snapshot = dex.getDexSnapshot();
    expect(snapshot.orders.length).toBeGreaterThan(0);
    const depth = snapshot.depths.find((item) => item.marketId === 'BTC-USDT');
    expect(depth).toBeTruthy();
    if (depth) {
      expect(depth.checksum).toBe(computeDepthChecksum(depth));
    }
    expect(dex.getDexOrderbookStore().getLastSequence('BTC-USDT')).toBeGreaterThan(0);
  });
});
