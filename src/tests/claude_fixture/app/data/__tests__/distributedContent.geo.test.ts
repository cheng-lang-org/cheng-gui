import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCaptureStrictHighAccuracyLocation } = vi.hoisted(() => ({
  mockCaptureStrictHighAccuracyLocation: vi.fn(),
}));

vi.mock('../../hooks/useHighAccuracyLocation', () => {
  class HighAccuracyLocationError extends Error {
    readonly code: 'permission_denied' | 'accuracy_too_low' | 'timeout' | 'unavailable';

    constructor(code: 'permission_denied' | 'accuracy_too_low' | 'timeout' | 'unavailable', message: string) {
      super(message);
      this.name = 'HighAccuracyLocationError';
      this.code = code;
    }
  }
  return {
    captureStrictHighAccuracyLocation: mockCaptureStrictHighAccuracyLocation,
    HighAccuracyLocationError,
  };
});

vi.mock('../../libp2p/service', () => ({
  libp2pService: {
    isNativePlatform: () => false,
    getLocalPeerId: vi.fn().mockResolvedValue('peer-test-1'),
  },
}));

vi.mock('../../libp2p/eventPump', () => ({
  libp2pEventPump: {
    subscribe: () => () => undefined,
  },
}));

import { HighAccuracyLocationError } from '../../hooks/useHighAccuracyLocation';
import { __distributedContentTestUtils, publishDistributedContent } from '../distributedContent';

describe('distributed content geo publish', () => {
  const originalLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  beforeEach(() => {
    const memory = new Map<string, string>();
    (globalThis as unknown as { localStorage?: Storage }).localStorage = {
      getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
      key: (index: number) => Array.from(memory.keys())[index] ?? null,
      get length() {
        return memory.size;
      },
    } as Storage;
    mockCaptureStrictHighAccuracyLocation.mockReset();
  });

  afterEach(() => {
    (globalThis as unknown as { localStorage?: Storage }).localStorage = originalLocalStorage;
  });

  it('accepts accuracy <= 50m and rejects > 50m', async () => {
    mockCaptureStrictHighAccuracyLocation.mockResolvedValueOnce({
      coords: {
        latitude: 31.2304,
        longitude: 121.4737,
        altitude: null,
        accuracy: 49,
        speed: null,
        heading: null,
      },
      timestamp: 1_728_000_000_000,
    });

    const success = await publishDistributedContent({
      publishCategory: 'content',
      content: 'accuracy pass',
    });
    expect(success.location?.precise.accuracy).toBe(49);
    expect(success.location?.commit).toMatch(/^[a-f0-9]{64}$/);
    expect(success.location?.nonce).toMatch(/^[a-f0-9]{32}$/);

    mockCaptureStrictHighAccuracyLocation.mockRejectedValueOnce(
      new HighAccuracyLocationError('accuracy_too_low', 'too low'),
    );

    await expect(
      publishDistributedContent({
        publishCategory: 'content',
        content: 'accuracy fail',
      }),
    ).rejects.toMatchObject({
      code: 'accuracy_too_low',
    });
  });

  it('produces different geo.commit when nonce changes', async () => {
    const precise = {
      latitude: 31.2304,
      longitude: 121.4737,
      accuracy: 12,
      altitude: null,
      speed: null,
      heading: null,
      timestamp: 1_728_000_000_000,
    };
    const first = await __distributedContentTestUtils.buildGeoCommit(precise, 'a'.repeat(32));
    const second = await __distributedContentTestUtils.buildGeoCommit(precise, 'b'.repeat(32));
    expect(first).not.toBe(second);
  });

  it('normalizes both new and legacy location shapes', () => {
    const modern = __distributedContentTestUtils.normalizeLocation({
      public: {
        country: 'CN',
        province: '上海',
        city: '上海',
        district: '徐汇',
        source: 'hint',
        displayLevel: 'district',
      },
      precise: {
        latitude: 31.2,
        longitude: 121.4,
        accuracy: 15,
        altitude: null,
        speed: null,
        heading: null,
        timestamp: 1_728_000_000_000,
      },
      commit: 'abc',
      nonce: 'def',
    });
    expect(modern?.public.city).toBe('上海');
    expect(modern?.precise.latitude).toBe(31.2);
    expect(modern?.commit).toBe('abc');

    const legacy = __distributedContentTestUtils.normalizeLocation({
      country: 'CN',
      province: '',
      city: '上海',
      district: '徐汇',
      latitude: 0,
      longitude: 0,
      accuracy: 20,
    });
    expect(legacy?.public.city).toBe('上海');
    expect(legacy?.precise.latitude).toBe(0);
    expect(legacy?.precise.longitude).toBe(0);
  });
});
