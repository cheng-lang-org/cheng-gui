import { describe, expect, it } from 'vitest';
import { formatContentLocationLabel, formatContentLocationRawLabel, resolveContentLocation } from '../contentLocation';

describe('contentLocation', () => {
  it('resolves modern location payload', () => {
    const resolved = resolveContentLocation({
      public: {
        country: '中国',
        province: '广东省',
        city: '深圳市',
        district: '南山区',
      },
      precise: {
        latitude: 22.5431,
        longitude: 114.0579,
      },
    });
    expect(resolved).toMatchObject({
      country: '中国',
      province: '广东省',
      city: '深圳市',
      district: '南山区',
      latitude: 22.5431,
      longitude: 114.0579,
    });
  });

  it('resolves legacy payload and keeps zero coordinates', () => {
    const resolved = resolveContentLocation({
      country: 'CN',
      city: 'origin',
      latitude: 0,
      longitude: 0,
      accuracy: 20,
    });
    expect(resolved?.latitude).toBe(0);
    expect(resolved?.longitude).toBe(0);
    expect(resolved?.city).toBe('origin');
  });

  it('formats country/province/city/district label', () => {
    const label = formatContentLocationLabel({
      public: {
        country: '中国',
        province: '广东省',
        city: '深圳市',
        district: '南山区',
      },
      precise: {
        latitude: 22.5431,
        longitude: 114.0579,
      },
    }, 'zh-CN');
    expect(label).toBe('中国 · 广东省 · 深圳市 · 南山区');
  });

  it('shows only country name when no other address parts are available', () => {
    const label = formatContentLocationLabel({
      public: {
        country: 'CN',
        province: '',
        city: '',
        district: '',
      },
      precise: {
        latitude: 31.2304,
        longitude: 121.4737,
      },
    }, 'zh-CN');
    expect(label).toBe('中国');
    expect(label).not.toContain('GPS');
  });

  it('formats raw location debug label with source and precision fields', () => {
    const label = formatContentLocationRawLabel({
      public: {
        country: '中国',
        province: '河南省',
        city: '',
        district: '陕州区',
        source: 'mixed',
        displayLevel: 'district',
      },
      precise: {
        latitude: 34.7201,
        longitude: 111.1039,
        accuracy: 18.2,
      },
    }, 'zh-CN');
    expect(label).toContain('city=--');
    expect(label).toContain('source=mixed');
    expect(label).toContain('level=district');
    expect(label).toContain('lat=34.720100');
    expect(label).toContain('lon=111.103900');
    expect(label).toContain('acc=18m');
  });
});
