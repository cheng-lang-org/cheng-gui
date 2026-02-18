import { captureStrictHighAccuracyLocation } from '../hooks/useHighAccuracyLocation';

export interface ReverseGeocodeAddress {
  country: string;
  province: string;
  city: string;
  district: string;
}

export interface ResolvedContentLocation extends ReverseGeocodeAddress {
  latitude: number | null;
  longitude: number | null;
}

interface RawContentLocationFields {
  country: string;
  province: string;
  city: string;
  district: string;
  source: string;
  displayLevel: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

const DEFAULT_REVERSE_GEOCODE_TIMEOUT_MS = 12_000;
const DEFAULT_MAP_SRC = 'UniMaker';
const REVERSE_GEOCODE_TEST_MODE = 'test';
const GPS_COORD_PRECISION = 6;
const MAP_ROUTE_DECISION_TIMEOUT_MS = 2_500;
const MAP_CURRENT_LOCATION_TIMEOUT_MS = 3_000;
const MAP_CURRENT_LOCATION_ACCURACY_METERS = 1_000;
const MAP_REVERSE_GEOCODE_FAST_TIMEOUT_MS = 1_800;
const AMAP_JS_SCRIPT_ID = 'unimaker-amap-jsapi';
const BAIDU_JS_SCRIPT_ID = 'unimaker-baidu-jsapi';
let jsonpSequence = 0;
let amapJsApiPromise: Promise<Record<string, unknown> | null> | null = null;
let amapJsApiKey = '';
let baiduJsApiPromise: Promise<Record<string, unknown> | null> | null = null;
let baiduJsApiKey = '';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTextOrFirst(value: unknown): string {
  if (Array.isArray(value)) {
    for (const row of value) {
      const text = asText(row);
      if (text) {
        return text;
      }
    }
    return '';
  }
  return asText(value);
}

function isTownshipLikeName(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return /(镇|乡|街道|苏木)$/.test(normalized);
}

function extractCityLikeNameFromFormattedAddress(formattedAddress: string, province: string): string {
  let remaining = formattedAddress.trim();
  const provinceText = province.trim();
  if (!remaining) {
    return '';
  }
  if (provinceText && remaining.startsWith(provinceText)) {
    remaining = remaining.slice(provinceText.length);
  }
  const match = remaining.match(/^(.{1,24}?(?:市|自治州|地区|盟))/);
  if (!match) {
    return '';
  }
  const city = match[1].trim();
  return isTownshipLikeName(city) ? '' : city;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function hasFetchSupport(): boolean {
  return typeof fetch === 'function';
}

function hasDomSupport(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function isTestMode(): boolean {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (viteEnv?.MODE === REVERSE_GEOCODE_TEST_MODE) {
    return true;
  }
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return maybeProcess?.env?.VITEST === 'true' || maybeProcess?.env?.NODE_ENV === REVERSE_GEOCODE_TEST_MODE;
}

function sanitizeAddress(address: ReverseGeocodeAddress): ReverseGeocodeAddress {
  return {
    country: address.country.trim(),
    province: address.province.trim(),
    city: address.city.trim(),
    district: address.district.trim(),
  };
}

function hasAnyAddressField(address: ReverseGeocodeAddress | null): boolean {
  if (!address) {
    return false;
  }
  return Boolean(address.country || address.province || address.city || address.district);
}

function dedupeParts(values: string[]): string[] {
  const out: string[] = [];
  for (const row of values) {
    const value = row.trim();
    if (!value) {
      continue;
    }
    if (out.includes(value)) {
      continue;
    }
    out.push(value);
  }
  return out;
}

function resolveLocaleTag(locale?: string): string {
  const normalized = (locale ?? '').trim();
  if (normalized.length > 0) {
    return normalized;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.trim().length > 0) {
    return navigator.language.trim();
  }
  return 'zh-CN';
}

function resolveCountryDisplayName(country: string, locale?: string): string {
  const trimmed = country.trim();
  if (!trimmed) {
    return '';
  }
  if (!/^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const display = new Intl.DisplayNames([resolveLocaleTag(locale)], { type: 'region' });
    return display.of(trimmed.toUpperCase()) ?? trimmed.toUpperCase();
  } catch {
    return trimmed.toUpperCase();
  }
}

function normalizeCityName(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(市|地区|地區|盟|自治州|自治縣|自治县|县|縣|区|區|city|prefecture)$/gi, '');
}

function isSameCity(left: string, right: string): boolean {
  const normalizedLeft = normalizeCityName(left);
  const normalizedRight = normalizeCityName(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight;
}

function resolveAmapMapKey(): string {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const fromEnv = [
    viteEnv?.VITE_AMAP_KEY,
    viteEnv?.VITE_GAODE_KEY,
    viteEnv?.VITE_GAODE_MAP_KEY,
    viteEnv?.VITE_AMAP_WEB_KEY,
  ];
  const fromGlobal = (globalThis as { __UNIMAKER_AMAP_KEY?: string }).__UNIMAKER_AMAP_KEY;
  const fromStorage = (() => {
    if (typeof localStorage === 'undefined') {
      return '';
    }
    return localStorage.getItem('unimaker_amap_key') ?? '';
  })();
  return [...fromEnv, fromGlobal, fromStorage]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .find((item) => item.length > 0) ?? '';
}

function resolveAmapSecurityJsCode(): string {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const fromEnv = [
    viteEnv?.VITE_AMAP_SECURITY_JS_CODE,
    viteEnv?.VITE_GAODE_SECURITY_JS_CODE,
    viteEnv?.VITE_AMAP_SECURITY_CODE,
  ];
  const fromGlobal = (globalThis as { __UNIMAKER_AMAP_SECURITY_JS_CODE?: string }).__UNIMAKER_AMAP_SECURITY_JS_CODE;
  return [...fromEnv, fromGlobal]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .find((item) => item.length > 0) ?? '';
}

function resolveBaiduMapAk(): string {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const fromEnv = [
    viteEnv?.VITE_BAIDU_MAP_AK,
    viteEnv?.VITE_BAIDU_AK,
    viteEnv?.BAIDU_MAP_AK,
    viteEnv?.BAIDU_MAP_KEY,
    viteEnv?.BAIDU_AK,
  ];
  const fromGlobal = (globalThis as { __UNIMAKER_BAIDU_MAP_AK?: string }).__UNIMAKER_BAIDU_MAP_AK;
  const fromStorage = (() => {
    if (typeof localStorage === 'undefined') {
      return '';
    }
    return localStorage.getItem('unimaker_baidu_map_ak') ?? '';
  })();
  return [...fromEnv, fromGlobal, fromStorage]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .find((item) => item.length > 0) ?? '';
}

function outOfChina(latitude: number, longitude: number): boolean {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(x: number, y: number): number {
  let result = -100
    + (2 * x)
    + (3 * y)
    + (0.2 * y * y)
    + (0.1 * x * y)
    + (0.2 * Math.sqrt(Math.abs(x)));
  result += ((20 * Math.sin(6 * x * Math.PI)) + (20 * Math.sin(2 * x * Math.PI))) * (2 / 3);
  result += ((20 * Math.sin(y * Math.PI)) + (40 * Math.sin((y / 3) * Math.PI))) * (2 / 3);
  result += ((160 * Math.sin((y / 12) * Math.PI)) + (320 * Math.sin((y * Math.PI) / 30))) * (2 / 3);
  return result;
}

function transformLongitude(x: number, y: number): number {
  let result = 300
    + x
    + (2 * y)
    + (0.1 * x * x)
    + (0.1 * x * y)
    + (0.1 * Math.sqrt(Math.abs(x)));
  result += ((20 * Math.sin(6 * x * Math.PI)) + (20 * Math.sin(2 * x * Math.PI))) * (2 / 3);
  result += ((20 * Math.sin(x * Math.PI)) + (40 * Math.sin((x / 3) * Math.PI))) * (2 / 3);
  result += ((150 * Math.sin((x / 12) * Math.PI)) + (300 * Math.sin((x / 30) * Math.PI))) * (2 / 3);
  return result;
}

function convertWgs84ToGcj02(latitude: number, longitude: number): { latitude: number; longitude: number } {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { latitude, longitude };
  }
  if (outOfChina(latitude, longitude)) {
    return { latitude, longitude };
  }
  const a = 6378245;
  const ee = 0.00669342162296594323;
  const dLat = transformLatitude(longitude - 105, latitude - 35);
  const dLon = transformLongitude(longitude - 105, latitude - 35);
  const radLat = (latitude / 180) * Math.PI;
  const magic = Math.sin(radLat);
  const magicAdjusted = 1 - (ee * magic * magic);
  const sqrtMagic = Math.sqrt(magicAdjusted);
  const latitudeDelta = (dLat * 180) / (((a * (1 - ee)) / (magicAdjusted * sqrtMagic)) * Math.PI);
  const longitudeDelta = (dLon * 180) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return {
    latitude: latitude + latitudeDelta,
    longitude: longitude + longitudeDelta,
  };
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown | null> {
  if (!hasFetchSupport()) {
    return null;
  }
  const timeout = Math.max(1_000, timeoutMs);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
      controller.abort();
    }, timeout)
    : null;
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller?.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function fetchJsonpWithTimeout(url: string, timeoutMs: number): Promise<unknown | null> {
  if (!hasDomSupport()) {
    return null;
  }
  const timeout = Math.max(1_000, timeoutMs);
  const endpoint = new URL(url);
  const callbackName = `__unimaker_jsonp_${Date.now()}_${jsonpSequence.toString(36)}`;
  jsonpSequence += 1;
  endpoint.searchParams.set('callback', callbackName);
  const globalObject = globalThis as unknown as Record<string, unknown>;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (payload: unknown | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      delete globalObject[callbackName];
      script.remove();
      resolve(payload);
    };
    globalObject[callbackName] = (payload: unknown) => {
      finish(payload);
    };
    script.async = true;
    script.onerror = () => {
      finish(null);
    };
    script.src = endpoint.toString();
    const timer = setTimeout(() => {
      finish(null);
    }, timeout);
    document.head.appendChild(script);
  });
}

function parseAmapAddressComponent(
  component: Record<string, unknown> | null,
  formattedAddress = '',
): ReverseGeocodeAddress | null {
  if (!component) {
    return null;
  }
  const province = asTextOrFirst(component.province);
  const district = asTextOrFirst(component.district);
  const township = asText(component.township);
  let city = asTextOrFirst(component.city);
  if (!city) {
    city = extractCityLikeNameFromFormattedAddress(formattedAddress, province);
  }
  if (!city && /(?:市|特别行政区)$/.test(province)) {
    city = province;
  }
  if (isTownshipLikeName(city)) {
    city = extractCityLikeNameFromFormattedAddress(formattedAddress, province);
  }
  const address = sanitizeAddress({
    country: asText(component.country) || '中国',
    province,
    city,
    district: district || (isTownshipLikeName(township) ? township : ''),
  });
  return hasAnyAddressField(address) ? address : null;
}

function parseAmapReverseGeocodePayload(payload: unknown): ReverseGeocodeAddress | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const status = asText(root.status);
  if (status !== '1') {
    return null;
  }
  const regeocode = asRecord(root.regeocode);
  return parseAmapAddressComponent(
    asRecord(regeocode?.addressComponent),
    asText(regeocode?.formatted_address),
  );
}

function parseAmapJsGeocoderPayload(payload: unknown): ReverseGeocodeAddress | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const regeocode = asRecord(root.regeocode);
  return parseAmapAddressComponent(
    asRecord(regeocode?.addressComponent),
    asText(regeocode?.formattedAddress) || asText(regeocode?.formatted_address),
  );
}

async function loadAmapJsApi(key: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  if (!hasDomSupport() || !key) {
    return null;
  }
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const existingAmap = asRecord(globalObject.AMap);
  if (existingAmap && typeof existingAmap.Geocoder === 'function') {
    return existingAmap;
  }
  if (amapJsApiPromise && amapJsApiKey === key) {
    return amapJsApiPromise;
  }
  amapJsApiKey = key;
  amapJsApiPromise = new Promise<Record<string, unknown> | null>((resolve) => {
    const timeout = Math.max(1_500, timeoutMs);
    const finish = (payload: Record<string, unknown> | null) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve(payload);
    };
    const currentScript = document.getElementById(AMAP_JS_SCRIPT_ID);
    if (currentScript) {
      currentScript.remove();
    }
    const script = document.createElement('script');
    script.id = AMAP_JS_SCRIPT_ID;
    script.async = true;
    const securityJsCode = resolveAmapSecurityJsCode();
    if (securityJsCode) {
      (window as unknown as { _AMapSecurityConfig?: Record<string, string> })._AMapSecurityConfig = {
        securityJsCode,
      };
    }
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`;
    script.onerror = () => {
      finish(null);
    };
    script.onload = () => {
      const loadedAmap = asRecord(globalObject.AMap);
      finish(loadedAmap && typeof loadedAmap.Geocoder === 'function' ? loadedAmap : null);
    };
    const timer = setTimeout(() => {
      const loadedAmap = asRecord(globalObject.AMap);
      finish(loadedAmap && typeof loadedAmap.Geocoder === 'function' ? loadedAmap : null);
    }, timeout);
    document.head.appendChild(script);
  }).then((payload) => {
    if (!payload) {
      amapJsApiPromise = null;
    }
    return payload;
  });
  return amapJsApiPromise;
}

function parseBaiduReverseGeocodePayload(payload: unknown): ReverseGeocodeAddress | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const statusRaw = root.status;
  const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw);
  if (!Number.isFinite(status) || status !== 0) {
    return null;
  }
  const result = asRecord(root.result);
  const component = asRecord(result?.addressComponent);
  if (!component) {
    return null;
  }
  const address = sanitizeAddress({
    country: asText(component.country),
    province: asText(component.province),
    city: asText(component.city),
    district: asText(component.district),
  });
  return hasAnyAddressField(address) ? address : null;
}

function parseBaiduJsGeocodePayload(payload: unknown): ReverseGeocodeAddress | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const components = asRecord(root.addressComponents);
  if (!components) {
    return null;
  }
  const address = sanitizeAddress({
    country: asText(components.country) || '中国',
    province: asText(components.province),
    city: asText(components.city),
    district: asText(components.district),
  });
  return hasAnyAddressField(address) ? address : null;
}

function parseNominatimReverseGeocodePayload(payload: unknown): ReverseGeocodeAddress | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const addressRoot = asRecord(root.address);
  if (!addressRoot) {
    return null;
  }
  const cityByPrecision = asText(addressRoot.city)
    || asText(addressRoot.municipality)
    || asText(addressRoot.state_district)
    || asText(addressRoot.county)
    || asText(addressRoot.town);
  const city = isTownshipLikeName(cityByPrecision)
    ? (asText(addressRoot.state_district) || asText(addressRoot.county) || cityByPrecision)
    : cityByPrecision;
  const district = asText(addressRoot.city_district)
    || asText(addressRoot.suburb)
    || asText(addressRoot.district)
    || asText(addressRoot.neighbourhood)
    || asText(addressRoot.quarter)
    || (isTownshipLikeName(asText(addressRoot.town)) ? asText(addressRoot.town) : '');
  const address = sanitizeAddress({
    country: asText(addressRoot.country),
    province: asText(addressRoot.state)
      || asText(addressRoot.province)
      || asText(addressRoot.region)
      || asText(addressRoot.state_district),
    city,
    district,
  });
  return hasAnyAddressField(address) ? address : null;
}

function parseBigDataCloudReverseGeocodePayload(payload: unknown): ReverseGeocodeAddress | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const localityInfo = asRecord(root.localityInfo);
  const administrative = Array.isArray(localityInfo?.administrative)
    ? (localityInfo?.administrative as unknown[])
    : [];
  const districtFromLevels = administrative
    .map((row) => asRecord(row))
    .find((row) => row && typeof row.order === 'number' && row.order >= 8 && asText(row.name).length > 0);
  const address = sanitizeAddress({
    country: asText(root.countryName) || asText(root.countryCode),
    province: asText(root.principalSubdivision),
    city: asText(root.city) || asText(root.locality),
    district:
      asText(root.locality)
      || asText(root.localityName)
      || asText(districtFromLevels?.name),
  });
  return hasAnyAddressField(address) ? address : null;
}

async function reverseGeocodeByBaidu(
  latitude: number,
  longitude: number,
  timeoutMs: number,
): Promise<ReverseGeocodeAddress | null> {
  const ak = resolveBaiduMapAk();
  if (!ak) {
    return null;
  }
  const endpoint = new URL('https://api.map.baidu.com/reverse_geocoding/v3/');
  endpoint.searchParams.set('ak', ak);
  endpoint.searchParams.set('output', 'json');
  endpoint.searchParams.set('coordtype', 'wgs84ll');
  endpoint.searchParams.set('extensions_town', 'true');
  endpoint.searchParams.set('location', `${latitude},${longitude}`);
  const payload = hasDomSupport()
    ? await fetchJsonpWithTimeout(endpoint.toString(), timeoutMs)
    : await fetchJsonWithTimeout(endpoint.toString(), timeoutMs);
  return parseBaiduReverseGeocodePayload(payload);
}

async function loadBaiduJsApi(ak: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  if (!hasDomSupport() || !ak) {
    return null;
  }
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const existingBmap = asRecord(globalObject.BMap);
  if (existingBmap && typeof existingBmap.Geocoder === 'function') {
    return existingBmap;
  }
  if (baiduJsApiPromise && baiduJsApiKey === ak) {
    return baiduJsApiPromise;
  }
  baiduJsApiKey = ak;
  baiduJsApiPromise = new Promise<Record<string, unknown> | null>((resolve) => {
    const timeout = Math.max(1_500, timeoutMs);
    const callbackName = `__unimaker_baidu_js_${Date.now()}_${jsonpSequence.toString(36)}`;
    jsonpSequence += 1;
    const finish = (payload: Record<string, unknown> | null) => {
      if (timer) {
        clearTimeout(timer);
      }
      delete globalObject[callbackName];
      resolve(payload);
    };
    globalObject[callbackName] = () => {
      const loaded = asRecord(globalObject.BMap);
      finish(loaded && typeof loaded.Geocoder === 'function' ? loaded : null);
    };
    const currentScript = document.getElementById(BAIDU_JS_SCRIPT_ID);
    if (currentScript) {
      currentScript.remove();
    }
    const script = document.createElement('script');
    script.id = BAIDU_JS_SCRIPT_ID;
    script.async = true;
    script.src = `https://api.map.baidu.com/api?v=3.0&ak=${encodeURIComponent(ak)}&callback=${callbackName}`;
    script.onerror = () => {
      finish(null);
    };
    const timer = setTimeout(() => {
      const loaded = asRecord(globalObject.BMap);
      finish(loaded && typeof loaded.Geocoder === 'function' ? loaded : null);
    }, timeout);
    document.head.appendChild(script);
  }).then((payload) => {
    if (!payload) {
      baiduJsApiPromise = null;
    }
    return payload;
  });
  return baiduJsApiPromise;
}

async function reverseGeocodeByBaiduJs(
  latitude: number,
  longitude: number,
  timeoutMs: number,
): Promise<ReverseGeocodeAddress | null> {
  const ak = resolveBaiduMapAk();
  if (!ak || !hasDomSupport()) {
    return null;
  }
  const bmap = await loadBaiduJsApi(ak, timeoutMs);
  const geocoderConstructor = bmap?.Geocoder;
  const pointConstructor = bmap?.Point;
  if (typeof geocoderConstructor !== 'function' || typeof pointConstructor !== 'function') {
    return null;
  }
  const timeout = Math.max(1_500, timeoutMs);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload: ReverseGeocodeAddress | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, timeout);
    try {
      const geocoder = new geocoderConstructor() as {
        getLocation?: (point: unknown, callback: (result: unknown) => void) => void;
      };
      const point = new pointConstructor(longitude, latitude);
      if (!geocoder || typeof geocoder.getLocation !== 'function') {
        finish(null);
        return;
      }
      geocoder.getLocation(point, (result: unknown) => {
        finish(parseBaiduJsGeocodePayload(result));
      });
    } catch {
      finish(null);
    }
  });
}

async function reverseGeocodeByAmapRest(
  latitude: number,
  longitude: number,
  timeoutMs: number,
): Promise<ReverseGeocodeAddress | null> {
  const key = resolveAmapMapKey();
  if (!key) {
    return null;
  }
  const converted = convertWgs84ToGcj02(latitude, longitude);
  const endpoint = new URL('https://restapi.amap.com/v3/geocode/regeo');
  endpoint.searchParams.set('key', key);
  endpoint.searchParams.set('location', `${converted.longitude},${converted.latitude}`);
  endpoint.searchParams.set('extensions', 'base');
  endpoint.searchParams.set('output', 'json');
  endpoint.searchParams.set('radius', '1000');
  const payload = await fetchJsonWithTimeout(endpoint.toString(), timeoutMs);
  return parseAmapReverseGeocodePayload(payload);
}

async function reverseGeocodeByAmapJs(
  latitude: number,
  longitude: number,
  timeoutMs: number,
): Promise<ReverseGeocodeAddress | null> {
  const key = resolveAmapMapKey();
  if (!key || !hasDomSupport()) {
    return null;
  }
  const amap = await loadAmapJsApi(key, timeoutMs);
  const geocoderConstructor = amap?.Geocoder;
  if (typeof geocoderConstructor !== 'function') {
    return null;
  }
  const converted = convertWgs84ToGcj02(latitude, longitude);
  const timeout = Math.max(1_500, timeoutMs);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload: ReverseGeocodeAddress | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, timeout);
    try {
      const geocoder = new geocoderConstructor({
        extensions: 'base',
        radius: 1000,
      }) as { getAddress?: (location: [number, number], callback: (status: unknown, result: unknown) => void) => void };
      if (!geocoder || typeof geocoder.getAddress !== 'function') {
        finish(null);
        return;
      }
      geocoder.getAddress([converted.longitude, converted.latitude], (status: unknown, result: unknown) => {
        if (status !== 'complete') {
          finish(null);
          return;
        }
        finish(parseAmapJsGeocoderPayload(result));
      });
    } catch {
      finish(null);
    }
  });
}

async function reverseGeocodeByNominatim(
  latitude: number,
  longitude: number,
  locale?: string,
  timeoutMs = DEFAULT_REVERSE_GEOCODE_TIMEOUT_MS,
): Promise<ReverseGeocodeAddress | null> {
  const endpoint = new URL('https://nominatim.openstreetmap.org/reverse');
  endpoint.searchParams.set('format', 'jsonv2');
  endpoint.searchParams.set('addressdetails', '1');
  endpoint.searchParams.set('zoom', '18');
  endpoint.searchParams.set('lat', String(latitude));
  endpoint.searchParams.set('lon', String(longitude));
  endpoint.searchParams.set('accept-language', resolveLocaleTag(locale));
  const payload = await fetchJsonWithTimeout(endpoint.toString(), timeoutMs);
  return parseNominatimReverseGeocodePayload(payload);
}

async function reverseGeocodeByBigDataCloud(
  latitude: number,
  longitude: number,
  locale?: string,
  timeoutMs = DEFAULT_REVERSE_GEOCODE_TIMEOUT_MS,
): Promise<ReverseGeocodeAddress | null> {
  const endpoint = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  endpoint.searchParams.set('latitude', String(latitude));
  endpoint.searchParams.set('longitude', String(longitude));
  endpoint.searchParams.set('localityLanguage', resolveLocaleTag(locale).startsWith('zh') ? 'zh' : 'en');
  const payload = await fetchJsonWithTimeout(endpoint.toString(), timeoutMs);
  return parseBigDataCloudReverseGeocodePayload(payload);
}

export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  locale?: string,
  timeoutMs = DEFAULT_REVERSE_GEOCODE_TIMEOUT_MS,
): Promise<ReverseGeocodeAddress | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (isTestMode()) {
    return null;
  }
  const amapRestResult = await reverseGeocodeByAmapRest(latitude, longitude, timeoutMs);
  if (amapRestResult) {
    return amapRestResult;
  }
  const amapJsResult = await reverseGeocodeByAmapJs(latitude, longitude, timeoutMs);
  if (amapJsResult) {
    return amapJsResult;
  }
  const baiduResult = await reverseGeocodeByBaidu(latitude, longitude, timeoutMs);
  if (baiduResult) {
    return baiduResult;
  }
  const baiduJsResult = await reverseGeocodeByBaiduJs(latitude, longitude, timeoutMs);
  if (baiduJsResult) {
    return baiduJsResult;
  }
  const nominatimResult = await reverseGeocodeByNominatim(latitude, longitude, locale, timeoutMs);
  if (nominatimResult) {
    return nominatimResult;
  }
  return reverseGeocodeByBigDataCloud(latitude, longitude, locale, timeoutMs);
}

export function resolveContentLocation(location: unknown): ResolvedContentLocation | null {
  const root = asRecord(location);
  if (!root) {
    return null;
  }
  const publicLocation = asRecord(root.public) ?? root;
  const preciseLocation = asRecord(root.precise) ?? root;
  const country = asText(publicLocation.country);
  const province = asText(publicLocation.province);
  const city = asText(publicLocation.city);
  const district = asText(publicLocation.district);
  const latitude = asFiniteNumber(preciseLocation.latitude);
  const longitude = asFiniteNumber(preciseLocation.longitude);
  if (!country && !province && !city && !district && latitude === null && longitude === null) {
    return null;
  }
  return {
    country,
    province,
    city,
    district,
    latitude,
    longitude,
  };
}

export function formatContentLocationLabel(location: unknown, locale?: string): string {
  const resolved = resolveContentLocation(location);
  if (!resolved) {
    return '';
  }
  const parts = dedupeParts([
    resolveCountryDisplayName(resolved.country, locale),
    resolved.province,
    resolved.city,
    resolved.district,
  ]);
  if (parts.length > 0) {
    return parts.join(' · ');
  }
  return '';
}

function resolveRawContentLocationFields(location: unknown): RawContentLocationFields | null {
  const root = asRecord(location);
  if (!root) {
    return null;
  }
  const publicLocation = asRecord(root.public) ?? root;
  const preciseLocation = asRecord(root.precise) ?? root;
  const country = asText(publicLocation.country);
  const province = asText(publicLocation.province);
  const city = asText(publicLocation.city);
  const district = asText(publicLocation.district);
  const source = asText(publicLocation.source);
  const displayLevel = asText(publicLocation.displayLevel);
  const latitude = asFiniteNumber(preciseLocation.latitude);
  const longitude = asFiniteNumber(preciseLocation.longitude);
  const accuracy = asFiniteNumber(preciseLocation.accuracy);
  if (!country && !province && !city && !district && latitude === null && longitude === null) {
    return null;
  }
  return {
    country,
    province,
    city,
    district,
    source,
    displayLevel,
    latitude,
    longitude,
    accuracy,
  };
}

export function formatContentLocationRawLabel(location: unknown, locale?: string): string {
  const raw = resolveRawContentLocationFields(location);
  if (!raw) {
    return '';
  }
  const country = resolveCountryDisplayName(raw.country, locale) || '--';
  const province = raw.province || '--';
  const city = raw.city || '--';
  const district = raw.district || '--';
  const source = raw.source || '--';
  const displayLevel = raw.displayLevel || '--';
  const latitude = raw.latitude !== null ? raw.latitude.toFixed(GPS_COORD_PRECISION) : '--';
  const longitude = raw.longitude !== null ? raw.longitude.toFixed(GPS_COORD_PRECISION) : '--';
  const accuracy = raw.accuracy !== null ? `${Math.round(raw.accuracy)}m` : '--';
  return `RAW country=${country} | province=${province} | city=${city} | district=${district} | source=${source} | level=${displayLevel} | lat=${latitude} | lon=${longitude} | acc=${accuracy}`;
}

function buildAmapMarkerUrl(
  latitude: number,
  longitude: number,
  title: string,
): string {
  const converted = convertWgs84ToGcj02(latitude, longitude);
  const endpoint = new URL('https://uri.amap.com/marker');
  endpoint.searchParams.set('position', `${converted.longitude},${converted.latitude}`);
  endpoint.searchParams.set('name', title);
  endpoint.searchParams.set('src', DEFAULT_MAP_SRC);
  endpoint.searchParams.set('coordinate', 'gaode');
  endpoint.searchParams.set('callnative', '1');
  return endpoint.toString();
}

function buildAmapRouteUrl(
  originLatitude: number,
  originLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number,
  destinationName: string,
): string {
  const origin = convertWgs84ToGcj02(originLatitude, originLongitude);
  const destination = convertWgs84ToGcj02(destinationLatitude, destinationLongitude);
  const endpoint = new URL('https://uri.amap.com/navigation');
  endpoint.searchParams.set('from', `${origin.longitude},${origin.latitude},我的位置`);
  endpoint.searchParams.set('to', `${destination.longitude},${destination.latitude},${destinationName}`);
  endpoint.searchParams.set('mode', 'car');
  endpoint.searchParams.set('policy', '1');
  endpoint.searchParams.set('src', DEFAULT_MAP_SRC);
  endpoint.searchParams.set('coordinate', 'gaode');
  endpoint.searchParams.set('callnative', '1');
  return endpoint.toString();
}

function openExternalUrl(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) {
    window.location.href = url;
  }
}

interface CurrentCityResolution {
  city: string;
  latitude: number;
  longitude: number;
}

async function resolveCurrentCity(locale?: string): Promise<CurrentCityResolution | null> {
  try {
    const current = await captureStrictHighAccuracyLocation({
      requiredAccuracyMeters: MAP_CURRENT_LOCATION_ACCURACY_METERS,
      timeoutMs: MAP_CURRENT_LOCATION_TIMEOUT_MS,
      maximumAgeMs: 0,
    });
    const latitude = current.coords.latitude;
    const longitude = current.coords.longitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    const city = (await reverseGeocodeCoordinates(
      latitude,
      longitude,
      locale,
      MAP_REVERSE_GEOCODE_FAST_TIMEOUT_MS,
    ))?.city ?? '';
    return {
      city,
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}

function waitTimeout(ms: number): Promise<null> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), Math.max(100, ms));
  });
}

export type LocationOpenResult = 'route' | 'marker' | 'no_coordinates';

export async function openContentLocationInMap(location: unknown, locale?: string): Promise<LocationOpenResult> {
  const resolved = resolveContentLocation(location);
  if (!resolved || resolved.latitude === null || resolved.longitude === null) {
    return 'no_coordinates';
  }
  const coordsText = `${resolved.latitude.toFixed(GPS_COORD_PRECISION)}, ${resolved.longitude.toFixed(GPS_COORD_PRECISION)}`;
  const label = formatContentLocationLabel(location, locale);
  const mapTitle = label ? `${label} · GPS ${coordsText}` : `GPS ${coordsText}`;
  const routeUrlPromise = (async (): Promise<string | null> => {
    let targetCity = resolved.city;
    if (!targetCity) {
      targetCity = (
        await reverseGeocodeCoordinates(
          resolved.latitude,
          resolved.longitude,
          locale,
          MAP_REVERSE_GEOCODE_FAST_TIMEOUT_MS,
        ).catch(() => null)
      )?.city ?? '';
    }
    if (!targetCity) {
      return null;
    }
    const current = await resolveCurrentCity(locale);
    if (!current || !isSameCity(current.city, targetCity)) {
      return null;
    }
    return buildAmapRouteUrl(
      current.latitude,
      current.longitude,
      resolved.latitude,
      resolved.longitude,
      mapTitle,
    );
  })();
  const routeUrl = await Promise.race([routeUrlPromise, waitTimeout(MAP_ROUTE_DECISION_TIMEOUT_MS)]);

  if (routeUrl) {
    openExternalUrl(
      routeUrl,
    );
    return 'route';
  }

  openExternalUrl(buildAmapMarkerUrl(resolved.latitude, resolved.longitude, mapTitle));
  return 'marker';
}
