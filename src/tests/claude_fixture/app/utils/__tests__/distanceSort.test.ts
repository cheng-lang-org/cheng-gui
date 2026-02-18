import { describe, expect, it } from 'vitest';
import type { DistributedContent, DistributedContentLocation } from '../../data/distributedContent';
import { resolveContentCoordinates, sortContentsByDistance } from '../distanceSort';

function makeLocation(latitude: number, longitude: number): DistributedContentLocation {
  return {
    public: {
      country: 'CN',
      province: '上海',
      city: '上海',
      district: '',
      source: 'hint',
      displayLevel: 'city',
    },
    precise: {
      latitude,
      longitude,
      accuracy: 12,
      altitude: null,
      speed: null,
      heading: null,
      timestamp: 1_728_000_000_000,
    },
    commit: 'commit',
    nonce: 'nonce',
  };
}

function makeContent(id: string, timestamp: number, location?: DistributedContentLocation): DistributedContent {
  return {
    id,
    type: 'text',
    publishCategory: 'content',
    userId: 'peer',
    userName: 'tester',
    avatar: '',
    content: id,
    likes: 0,
    comments: 0,
    timestamp,
    location,
  };
}

describe('distance sort', () => {
  it('sorts by haversine distance and uses timestamp as secondary order', () => {
    const user = { latitude: 31.2304, longitude: 121.4737 };
    const nearOld = makeContent('near-old', 1000, makeLocation(31.2305, 121.4738));
    const nearNew = makeContent('near-new', 2000, makeLocation(31.2305, 121.4738));
    const far = makeContent('far', 3000, makeLocation(39.9042, 116.4074));

    const sorted = sortContentsByDistance([far, nearOld, nearNew], user, true);
    expect(sorted.map((item) => item.id)).toEqual(['near-new', 'near-old', 'far']);
  });

  it('hides content without valid coordinates in distance mode', () => {
    const user = { latitude: 31.2304, longitude: 121.4737 };
    const withCoordinates = makeContent('with-geo', 1000, makeLocation(31.2305, 121.4738));
    const withoutCoordinates = makeContent('without-geo', 2000, undefined);

    const sorted = sortContentsByDistance([withoutCoordinates, withCoordinates], user, true);
    expect(sorted.map((item) => item.id)).toEqual(['with-geo']);
  });

  it('does not treat zero coordinates as missing', () => {
    const zeroLegacy = makeContent('zero', 1000, {
      public: {
        country: '--',
        province: '',
        city: '',
        district: '',
        source: 'legacy',
        displayLevel: 'country',
      },
      precise: {
        latitude: Number.NaN,
        longitude: Number.NaN,
        accuracy: 9999,
        altitude: null,
        speed: null,
        heading: null,
        timestamp: 0,
      },
      commit: '',
      nonce: '',
    });
    (zeroLegacy as unknown as { location: Record<string, unknown> }).location = {
      country: 'CN',
      city: 'origin',
      latitude: 0,
      longitude: 0,
      accuracy: 20,
    };
    const far = makeContent('far', 1001, makeLocation(10, 10));
    const user = { latitude: 0.1, longitude: 0.1 };

    expect(resolveContentCoordinates(zeroLegacy)?.latitude).toBe(0);
    const sorted = sortContentsByDistance([far, zeroLegacy], user, true);
    expect(sorted.some((item) => item.id === 'zero')).toBe(true);
  });
});
