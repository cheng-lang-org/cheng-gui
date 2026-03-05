import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCaptureStrictHighAccuracyLocation,
  mockIsNativePlatform,
  mockGetLocalPeerId,
  mockSocialMomentsPublish,
  mockPubsubPublish,
  mockFeedPublishEntry,
  mockFetchFeedSnapshot,
  mockSetGateStatus,
} = vi.hoisted(() => ({
  mockCaptureStrictHighAccuracyLocation: vi.fn(),
  mockIsNativePlatform: vi.fn(),
  mockGetLocalPeerId: vi.fn(),
  mockSocialMomentsPublish: vi.fn(),
  mockPubsubPublish: vi.fn(),
  mockFeedPublishEntry: vi.fn(),
  mockFetchFeedSnapshot: vi.fn(),
  mockSetGateStatus: vi.fn(),
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
    isNativePlatform: mockIsNativePlatform,
    getLocalPeerId: mockGetLocalPeerId,
    socialMomentsPublish: mockSocialMomentsPublish,
    pubsubPublish: mockPubsubPublish,
    feedPublishEntry: mockFeedPublishEntry,
    fetchFeedSnapshot: mockFetchFeedSnapshot,
  },
}));

vi.mock('../../libp2p/sevenGatesRuntime', () => ({
  sevenGatesRuntime: {
    setGateStatus: mockSetGateStatus,
  },
}));

vi.mock('../../libp2p/eventPump', () => ({
  libp2pEventPump: {
    subscribe: () => () => undefined,
  },
}));

import { HighAccuracyLocationError } from '../../hooks/useHighAccuracyLocation';
import { __distributedContentTestUtils, preloadPublishLocation, publishDistributedContent } from '../distributedContent';

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
    mockIsNativePlatform.mockReset();
    mockGetLocalPeerId.mockReset();
    mockSocialMomentsPublish.mockReset();
    mockPubsubPublish.mockReset();
    mockFeedPublishEntry.mockReset();
    mockFetchFeedSnapshot.mockReset();
    mockSetGateStatus.mockReset();
    mockIsNativePlatform.mockReturnValue(false);
    mockGetLocalPeerId.mockResolvedValue('peer-test-1');
    mockSocialMomentsPublish.mockResolvedValue({ postId: 'native-post-default' });
    mockPubsubPublish.mockResolvedValue(true);
    mockFeedPublishEntry.mockResolvedValue(true);
    mockFetchFeedSnapshot.mockResolvedValue({});
    __distributedContentTestUtils.resetPublishLocationPreloadState();
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
    __distributedContentTestUtils.resetPublishLocationPreloadState();

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

  it('reuses preloaded location during publish', async () => {
    const captured = {
      coords: {
        latitude: 39.9042,
        longitude: 116.4074,
        altitude: null,
        accuracy: 18,
        speed: null,
        heading: null,
      },
      timestamp: 1_728_100_000_000,
    };
    mockCaptureStrictHighAccuracyLocation.mockResolvedValueOnce(captured);

    await preloadPublishLocation();

    const published = await publishDistributedContent({
      publishCategory: 'content',
      content: 'prefetch hit',
    });
    expect(published.location?.precise.latitude).toBe(captured.coords.latitude);
    expect(published.location?.precise.longitude).toBe(captured.coords.longitude);
    expect(mockCaptureStrictHighAccuracyLocation).toHaveBeenCalledTimes(1);
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

  it('falls back to contentId when native publish response misses postId', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    mockSocialMomentsPublish.mockResolvedValueOnce({});
    mockPubsubPublish.mockResolvedValueOnce(true);
    mockFeedPublishEntry.mockResolvedValueOnce(false);

    mockCaptureStrictHighAccuracyLocation.mockResolvedValueOnce({
      coords: {
        latitude: 31.2304,
        longitude: 121.4737,
        altitude: null,
        accuracy: 12,
        speed: null,
        heading: null,
      },
      timestamp: 1_728_000_000_000,
    });

    const published = await publishDistributedContent({
      publishCategory: 'content',
      content: 'native fallback post id',
    });
    const extra = (published.extra ?? {}) as Record<string, unknown>;
    expect(extra.postId).toBe(published.id);
    await vi.waitFor(() => {
      expect(mockSetGateStatus).toHaveBeenCalledWith(
        'gate.content_publish_home_feed',
        'passed',
        expect.any(Object),
      );
    });
  });

  it('keeps local publish successful when native transport publish fails', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    mockSocialMomentsPublish.mockResolvedValueOnce({ postId: 'native-post-2' });
    mockPubsubPublish.mockResolvedValueOnce(false);
    mockFeedPublishEntry.mockResolvedValueOnce(false);
    mockFetchFeedSnapshot.mockResolvedValueOnce({
      items: [{ postId: 'native-post-2' }],
    });

    mockCaptureStrictHighAccuracyLocation.mockResolvedValueOnce({
      coords: {
        latitude: 31.2304,
        longitude: 121.4737,
        altitude: null,
        accuracy: 12,
        speed: null,
        heading: null,
      },
      timestamp: 1_728_000_000_000,
    });

    const published = await publishDistributedContent({
      publishCategory: 'content',
      content: 'native transport failed fallback',
    });
    const extra = (published.extra ?? {}) as Record<string, unknown>;
    expect(extra.postId).toBe('native-post-2');
    await vi.waitFor(() => {
      expect(mockSetGateStatus).toHaveBeenCalledWith(
        'gate.content_publish_home_feed',
        'failed',
        expect.objectContaining({
          error: 'content_transport_publish_failed',
        }),
      );
    });
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
