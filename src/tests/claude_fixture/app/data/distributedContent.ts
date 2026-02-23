import type { PublishType } from '../components/PublishTypeSelector';
import {
  HighAccuracyLocationError,
  captureStrictHighAccuracyLocation,
} from '../hooks/useHighAccuracyLocation';
import type { BridgeEventEntry, JsonValue } from '../libp2p/definitions';
import { libp2pEventPump } from '../libp2p/eventPump';
import { libp2pService } from '../libp2p/service';
import { reverseGeocodeCoordinates, type ReverseGeocodeAddress } from '../utils/contentLocation';
import { getRegionPolicySync } from '../utils/region';

export type DistributedContentType = 'text' | 'image' | 'audio' | 'video';
export type DistributedPublishCategory = PublishType;

type GeoPublicSource = 'hint' | 'policy' | 'mixed' | 'legacy' | 'geocode';
type GeoDisplayLevel = 'country' | 'province' | 'city' | 'district';

export interface DistributedGeoPublic {
  country: string;
  province: string;
  city: string;
  district: string;
  source: GeoPublicSource;
  displayLevel: GeoDisplayLevel;
}

export interface DistributedGeoPrecise {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface DistributedContentLocation {
  public: DistributedGeoPublic;
  precise: DistributedGeoPrecise;
  commit: string;
  nonce: string;
}

export interface PublishLocationHint {
  country?: string;
  province?: string;
  city?: string;
  district?: string;
}

export type PublishLocationErrorCode = 'permission_denied' | 'accuracy_too_low' | 'timeout' | 'unavailable';

export class PublishLocationError extends Error {
  readonly code: PublishLocationErrorCode;

  constructor(code: PublishLocationErrorCode, message: string) {
    super(message);
    this.name = 'PublishLocationError';
    this.code = code;
  }
}

export function isPublishLocationError(error: unknown): error is PublishLocationError {
  return error instanceof PublishLocationError;
}

export interface DistributedContent {
  id: string;
  type: DistributedContentType;
  publishCategory: DistributedPublishCategory;
  userId: string;
  userName: string;
  avatar: string;
  content: string;
  media?: string;
  mediaItems?: string[];
  coverMedia?: string;
  mediaAspectRatio?: number;
  likes: number;
  comments: number;
  timestamp: number;
  isDuplicate?: boolean;
  location?: DistributedContentLocation;
  extra?: Record<string, unknown>;
}

export interface PublishDistributedContentInput {
  publishCategory: DistributedPublishCategory;
  content: string;
  type?: DistributedContentType;
  media?: string;
  mediaItems?: string[];
  coverMedia?: string;
  mediaAspectRatio?: number;
  userName?: string;
  avatar?: string;
  locationHint?: PublishLocationHint;
  extra?: Record<string, JsonValue>;
}

type ContentListener = (items: DistributedContent[]) => void;

const STORAGE_KEY = 'unimaker_distributed_contents_v1';
const CLEAR_MARKER_KEY = 'unimaker_distributed_clear_markers_v1';
const LOCAL_PEER_CACHE_KEY = 'profile_local_peer_id_v1';
const MAX_CONTENT_ITEMS = 180;
const RENDEZVOUS_REFRESH_MS = 45_000;
const DETAIL_RESOLVE_RETRIES = 2;
const DETAIL_RESOLVE_WAIT_MS = 180;
const MAX_MEDIA_ITEMS = 6;
const MIN_MEDIA_ASPECT_RATIO = 0.6;
const MAX_MEDIA_ASPECT_RATIO = 1.8;
const MAX_INLINE_MEDIA_CHARS = 256 * 1024;
const MAX_CONTENT_TEXT_CHARS = 4096;
const TEXT_COVER_WIDTH = 900;
const TEXT_COVER_HEIGHT = 1200;
const TEXT_COVER_LINE_MAX = 4;
const TEXT_COVER_LINE_VISUAL_MAX = 12;
const GEO_COMMIT_PREFIX = 'geo:v1';
const GEO_NONCE_BYTES = 16;
const GEO_ACCURACY_THRESHOLD_METERS = 50;

export const DISTRIBUTED_CONTENT_TOPIC = 'unimaker/content/v1';
export const DISTRIBUTED_CONTENT_RENDEZVOUS_NS = 'unimaker/content/v1';

const CATEGORY_VALUES: DistributedPublishCategory[] = [
  'content',
  'product',
  'live',
  'app',
  'food',
  'ride',
  'job',
  'hire',
  'rent',
  'sell',
  'secondhand',
  'crowdfunding',
  'ad',
];

const listeners = new Set<ContentListener>();
const subscribedFeedPeers = new Set<string>();
let cachedContents: DistributedContent[] = [];
let syncStarted = false;
let pumpUnsubscribe: (() => void) | null = null;
let rendezvousTimer: ReturnType<typeof setInterval> | null = null;
let localPeerIdPromise: Promise<string> | null = null;
let clearedBeforeByPeer: Record<string, number> = readClearMarkers();

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function normalizePeerId(raw: string): string {
  return raw.trim();
}

function readCachedLocalPeerId(): string {
  if (!hasStorage()) {
    return '';
  }
  return normalizePeerId(localStorage.getItem(LOCAL_PEER_CACHE_KEY) ?? '');
}

function persistCachedLocalPeerId(peerId: string): void {
  if (!hasStorage()) {
    return;
  }
  const normalized = normalizePeerId(peerId);
  if (normalized.length === 0) {
    return;
  }
  localStorage.setItem(LOCAL_PEER_CACHE_KEY, normalized);
}

function readClearMarkers(): Record<string, number> {
  if (!hasStorage()) {
    return {};
  }
  try {
    const raw = localStorage.getItem(CLEAR_MARKER_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const output: Record<string, number> = {};
    for (const [peerIdRaw, valueRaw] of Object.entries(parsed as Record<string, unknown>)) {
      const peerId = normalizePeerId(peerIdRaw);
      if (!peerId) {
        continue;
      }
      const value = asNumber(valueRaw);
      if (Number.isFinite(value) && value > 0) {
        output[peerId] = Math.trunc(value);
      }
    }
    return output;
  } catch {
    return {};
  }
}

function persistClearMarkers(): void {
  if (!hasStorage()) {
    return;
  }
  localStorage.setItem(CLEAR_MARKER_KEY, JSON.stringify(clearedBeforeByPeer));
}

function clearMarkerForPeer(peerId: string): number {
  return clearedBeforeByPeer[normalizePeerId(peerId)] ?? 0;
}

function setClearMarkerForPeer(peerId: string, markerMs: number): void {
  const normalized = normalizePeerId(peerId);
  if (!normalized) {
    return;
  }
  if (!Number.isFinite(markerMs) || markerMs <= 0) {
    return;
  }
  clearedBeforeByPeer[normalized] = Math.trunc(markerMs);
  persistClearMarkers();
}

function shouldKeepContentByClearMarker(content: DistributedContent): boolean {
  const marker = clearMarkerForPeer(content.userId);
  if (marker <= 0) {
    return true;
  }
  return content.timestamp >= marker;
}

function pruneClearedContents(items: DistributedContent[]): DistributedContent[] {
  return items.filter((item) => shouldKeepContentByClearMarker(item));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPublishCategory(value: string): value is DistributedPublishCategory {
  return (CATEGORY_VALUES as string[]).includes(value);
}

function isContentType(value: unknown): value is DistributedContentType {
  return value === 'image' || value === 'audio' || value === 'video' || value === 'text';
}

function inferTypeFromMedia(media: string): DistributedContentType {
  if (media.length === 0) {
    return 'text';
  }
  const normalized = media.toLowerCase();
  if (
    normalized.startsWith('data:audio') ||
    normalized.includes('/audio/') ||
    normalized.includes('/audio') ||
    normalized.includes('audio')
  ) {
    return 'audio';
  }
  if (
    normalized.startsWith('data:video') ||
    normalized.includes('/video/') ||
    normalized.includes('/video') ||
    normalized.includes('video')
  ) {
    return 'video';
  }
  return 'image';
}

function normalizeType(value: unknown, media: string): DistributedContentType {
  if (isContentType(value)) {
    return value;
  }
  return inferTypeFromMedia(media);
}

function clampContentText(value: string): string {
  if (value.length <= MAX_CONTENT_TEXT_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_CONTENT_TEXT_CHARS)}...`;
}

function normalizeInlineMedia(value: unknown): string {
  const media = asString(value).trim();
  if (media.length === 0) {
    return '';
  }
  if (media.startsWith('data:') && media.length > MAX_INLINE_MEDIA_CHARS) {
    return '';
  }
  return media;
}

function normalizeMediaItems(value: unknown): string[] {
  const out: string[] = [];
  for (const row of asArray(value)) {
    const media = normalizeInlineMedia(row);
    if (media.length === 0 || out.includes(media)) {
      continue;
    }
    out.push(media);
    if (out.length >= MAX_MEDIA_ITEMS) {
      break;
    }
  }
  return out;
}

function mergeMediaItems(base: string[], media: string, coverMedia: string): string[] {
  const out = [...base];
  const pushUnique = (value: string): void => {
    const normalized = value.trim();
    if (normalized.length === 0 || out.includes(normalized) || out.length >= MAX_MEDIA_ITEMS) {
      return;
    }
    out.unshift(normalized);
  };
  pushUnique(media);
  pushUnique(coverMedia);
  return out;
}

function normalizeMediaAspectRatio(value: unknown): number | undefined {
  const ratio = asNumber(value);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return undefined;
  }
  return Math.min(MAX_MEDIA_ASPECT_RATIO, Math.max(MIN_MEDIA_ASPECT_RATIO, ratio));
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function visualCharWeight(char: string): number {
  return char.charCodeAt(0) > 0x2E7F ? 2 : 1;
}

function splitTextToCoverLines(input: string): string[] {
  const source = input.replace(/\s+/g, ' ').trim();
  if (source.length === 0) {
    return ['分享生活点滴'];
  }
  const lines: string[] = [];
  let line = '';
  let lineVisualLen = 0;
  for (const char of source) {
    const weight = visualCharWeight(char);
    if (lineVisualLen + weight > TEXT_COVER_LINE_VISUAL_MAX) {
      if (line.length > 0) {
        lines.push(line);
      }
      line = char;
      lineVisualLen = weight;
      if (lines.length >= TEXT_COVER_LINE_MAX - 1) {
        break;
      }
      continue;
    }
    line += char;
    lineVisualLen += weight;
  }
  if (line.length > 0 && lines.length < TEXT_COVER_LINE_MAX) {
    lines.push(line);
  }
  if (lines.length === 0) {
    lines.push('分享生活点滴');
  }
  if (lines.length >= TEXT_COVER_LINE_MAX && source.length > lines.join('').length) {
    const lastLine = lines[TEXT_COVER_LINE_MAX - 1];
    lines[TEXT_COVER_LINE_MAX - 1] = `${lastLine.slice(0, Math.max(0, lastLine.length - 1))}…`;
  }
  return lines.slice(0, TEXT_COVER_LINE_MAX);
}

function createAutoTextCover(content: string, seed: string): string {
  const palettes = [
    ['#7C3AED', '#4F46E5', '#FFFFFF'],
    ['#DC2626', '#EA580C', '#FFF7ED'],
    ['#0F766E', '#0891B2', '#ECFEFF'],
    ['#334155', '#1E293B', '#F8FAFC'],
    ['#BE185D', '#7E22CE', '#FDF4FF'],
    ['#14532D', '#166534', '#F0FDF4'],
  ] as const;
  const palette = palettes[hashString(seed) % palettes.length];
  const lines = splitTextToCoverLines(content).map(escapeXml);
  const textBlocks = lines
    .map((line, idx) => {
      const y = 520 + idx * 96;
      return `<text x="96" y="${y}" font-family="PingFang SC, SF Pro Display, Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="${palette[2]}">${line}</text>`;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TEXT_COVER_WIDTH} ${TEXT_COVER_HEIGHT}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${palette[0]}"/>
<stop offset="100%" stop-color="${palette[1]}"/>
</linearGradient>
</defs>
<rect width="${TEXT_COVER_WIDTH}" height="${TEXT_COVER_HEIGHT}" fill="url(#g)"/>
<circle cx="760" cy="220" r="180" fill="rgba(255,255,255,0.12)"/>
<circle cx="140" cy="1030" r="220" fill="rgba(255,255,255,0.08)"/>
<rect x="72" y="432" rx="28" ry="28" width="756" height="472" fill="rgba(0,0,0,0.12)"/>
${textBlocks}
<text x="96" y="970" font-family="PingFang SC, SF Pro Display, Helvetica, Arial, sans-serif" font-size="28" fill="rgba(255,255,255,0.8)">UNIMAKER</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function shouldAutoGenerateTextCover(category: DistributedPublishCategory, type: DistributedContentType, media: string): boolean {
  return category === 'content' && type === 'text' && media.trim().length === 0;
}

function isGeoPublicSource(value: unknown): value is GeoPublicSource {
  return value === 'hint' || value === 'policy' || value === 'mixed' || value === 'legacy' || value === 'geocode';
}

function isGeoDisplayLevel(value: unknown): value is GeoDisplayLevel {
  return value === 'country' || value === 'province' || value === 'city' || value === 'district';
}

function inferDisplayLevel(country: string, province: string, city: string, district: string): GeoDisplayLevel {
  if (district.length > 0) {
    return 'district';
  }
  if (city.length > 0) {
    return 'city';
  }
  if (province.length > 0) {
    return 'province';
  }
  return 'country';
}

function normalizeGeoPublicRecord(record: Record<string, unknown>, defaultSource: GeoPublicSource): DistributedGeoPublic | undefined {
  const country = asString(record.country).trim();
  const province = asString(record.province).trim();
  const city = asString(record.city).trim();
  const district = asString(record.district).trim();
  if (country.length === 0 && province.length === 0 && city.length === 0 && district.length === 0) {
    return undefined;
  }
  const displayLevelRaw = asString(record.displayLevel).trim();
  const displayLevel = isGeoDisplayLevel(displayLevelRaw)
    ? displayLevelRaw
    : inferDisplayLevel(country, province, city, district);
  const sourceRaw = asString(record.source).trim();
  const source = isGeoPublicSource(sourceRaw) ? sourceRaw : defaultSource;
  return {
    country: country || '--',
    province,
    city,
    district,
    source,
    displayLevel,
  };
}

function normalizeGeoPreciseRecord(record: Record<string, unknown>): DistributedGeoPrecise | undefined {
  const latitude = asOptionalNumber(record.latitude);
  const longitude = asOptionalNumber(record.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }
  const resolvedLatitude = latitude as number;
  const resolvedLongitude = longitude as number;
  const accuracy = asOptionalNumber(record.accuracy);
  const timestamp = asOptionalNumber(record.timestamp);
  return {
    latitude: resolvedLatitude,
    longitude: resolvedLongitude,
    accuracy: Number.isFinite(accuracy) && (accuracy as number) > 0 ? (accuracy as number) : 9999,
    altitude: asOptionalNumber(record.altitude) ?? null,
    speed: asOptionalNumber(record.speed) ?? null,
    heading: asOptionalNumber(record.heading) ?? null,
    timestamp: Number.isFinite(timestamp) && (timestamp as number) > 0 ? Math.trunc(timestamp as number) : Date.now(),
  };
}

function fallbackCountryCode(): string {
  const policy = getRegionPolicySync();
  const countryCode = policy.countryCode.trim().toUpperCase();
  if (countryCode.length > 0) {
    return countryCode;
  }
  return policy.policyGroupId === 'CN' ? 'CN' : 'INTL';
}

function normalizeHintField(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasHintAddressFields(hint: PublishLocationHint | undefined): boolean {
  return Boolean(
    normalizeHintField(hint?.country) ||
    normalizeHintField(hint?.province) ||
    normalizeHintField(hint?.city) ||
    normalizeHintField(hint?.district),
  );
}

function hasReverseAddressFields(reverse: ReverseGeocodeAddress | null | undefined): boolean {
  if (!reverse) {
    return false;
  }
  return Boolean(
    normalizeHintField(reverse.country) ||
    normalizeHintField(reverse.province) ||
    normalizeHintField(reverse.city) ||
    normalizeHintField(reverse.district),
  );
}

function resolveGeoPublicSource(
  hint: PublishLocationHint | undefined,
  reverse: ReverseGeocodeAddress | null | undefined,
  usesPolicyCountry: boolean,
): GeoPublicSource {
  const hasHint = Boolean(
    hasHintAddressFields(hint),
  );
  const hasReverse = hasReverseAddressFields(reverse);
  if (hasReverse && hasHint) {
    return 'mixed';
  }
  if (hasReverse) {
    return 'geocode';
  }
  if (!hasHint) {
    return 'policy';
  }
  return usesPolicyCountry ? 'mixed' : 'hint';
}

function createUnknownGeoPublic(): DistributedGeoPublic {
  return {
    country: '--',
    province: '',
    city: '',
    district: '',
    source: 'legacy',
    displayLevel: 'country',
  };
}

function resolvePreferredLocaleTag(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.trim().length > 0) {
    return navigator.language.trim();
  }
  return 'zh-CN';
}

function buildGeoPublicFromSources(
  hint?: PublishLocationHint,
  reverse?: ReverseGeocodeAddress | null,
): DistributedGeoPublic {
  const fallbackCountry = fallbackCountryCode();
  const countryHint = normalizeHintField(hint?.country);
  const provinceHint = normalizeHintField(hint?.province);
  const cityHint = normalizeHintField(hint?.city);
  const districtHint = normalizeHintField(hint?.district);
  const countryReverse = normalizeHintField(reverse?.country);
  const provinceReverse = normalizeHintField(reverse?.province);
  const cityReverse = normalizeHintField(reverse?.city);
  const districtReverse = normalizeHintField(reverse?.district);
  const country = countryReverse || countryHint || fallbackCountry;
  const province = provinceReverse || provinceHint;
  const city = cityReverse || cityHint;
  const district = districtReverse || districtHint;
  const usesPolicyCountry = countryReverse.length === 0 && countryHint.length === 0;
  return {
    country,
    province,
    city,
    district,
    source: resolveGeoPublicSource(hint, reverse, usesPolicyCountry),
    displayLevel: inferDisplayLevel(country, province, city, district),
  };
}

function normalizeLocation(value: unknown): DistributedContentLocation | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const preciseRecord = asRecord(record.precise);
  const publicRecord = asRecord(record.public);
  const precise = preciseRecord ? normalizeGeoPreciseRecord(preciseRecord) : normalizeGeoPreciseRecord(record);
  const publicLocation = publicRecord ? normalizeGeoPublicRecord(publicRecord, 'legacy') : normalizeGeoPublicRecord(record, 'legacy');
  if (!precise && !publicLocation) {
    return undefined;
  }
  return {
    public: publicLocation ?? createUnknownGeoPublic(),
    precise: precise ?? {
      latitude: Number.NaN,
      longitude: Number.NaN,
      accuracy: 9999,
      altitude: null,
      speed: null,
      heading: null,
      timestamp: Date.now(),
    },
    commit: asString(record.commit).trim(),
    nonce: asString(record.nonce).trim(),
  };
}

function toLocationE7(value: number): number {
  return Math.round(value * 1e7);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('');
}

function utf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

async function sha256Hex(input: string): Promise<string> {
  const data = Uint8Array.from(utf8Bytes(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(bytesLength: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(bytesLength);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }
  const fallback = Array.from({ length: bytesLength }, () => Math.floor(Math.random() * 256));
  return bytesToHex(Uint8Array.from(fallback));
}

function toPublishLocationError(error: unknown): PublishLocationError {
  if (error instanceof PublishLocationError) {
    return error;
  }
  if (error instanceof HighAccuracyLocationError) {
    return new PublishLocationError(error.code, error.message);
  }
  const message = error instanceof Error ? error.message : '定位服务不可用';
  return new PublishLocationError('unavailable', message);
}

async function buildGeoCommit(precise: DistributedGeoPrecise, nonce: string): Promise<string> {
  const latE7 = toLocationE7(precise.latitude);
  const lonE7 = toLocationE7(precise.longitude);
  const accMeters = Math.max(1, Math.round(precise.accuracy));
  const tsMs = Math.trunc(precise.timestamp);
  const payload = `${GEO_COMMIT_PREFIX}|${latE7}|${lonE7}|${accMeters}|${tsMs}|${nonce}`;
  return sha256Hex(payload);
}

function toPreciseLocation(captured: Awaited<ReturnType<typeof captureStrictHighAccuracyLocation>>): DistributedGeoPrecise {
  return {
    latitude: captured.coords.latitude,
    longitude: captured.coords.longitude,
    accuracy: captured.coords.accuracy,
    altitude: captured.coords.altitude,
    speed: captured.coords.speed,
    heading: captured.coords.heading,
    timestamp: captured.timestamp,
  };
}

async function buildPublishLocation(hint?: PublishLocationHint): Promise<DistributedContentLocation> {
  let captured: Awaited<ReturnType<typeof captureStrictHighAccuracyLocation>>;
  try {
    captured = await captureStrictHighAccuracyLocation({ requiredAccuracyMeters: GEO_ACCURACY_THRESHOLD_METERS });
  } catch (error) {
    throw toPublishLocationError(error);
  }
  const precise = toPreciseLocation(captured);
  const reverseAddress = await reverseGeocodeCoordinates(
    precise.latitude,
    precise.longitude,
    resolvePreferredLocaleTag(),
  ).catch(() => null);
  const nonce = randomHex(GEO_NONCE_BYTES);
  const commit = await buildGeoCommit(precise, nonce);
  return {
    public: buildGeoPublicFromSources(hint, reverseAddress),
    precise,
    commit,
    nonce,
  };
}

function avatarForPeer(peerId: string): string {
  const seed = peerId.trim() || 'unimaker';
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

function normalizeContent(raw: unknown, fallbackPeerId = ''): DistributedContent | null {
  let source: unknown = raw;
  if (typeof source === 'string') {
    const text = source.trim();
    if (text.length === 0) {
      return null;
    }
    try {
      source = JSON.parse(text);
    } catch {
      return null;
    }
  }

  const record = asRecord(source);
  if (!record) {
    return null;
  }

  const category = asString(record.publishCategory).trim();
  if (!isPublishCategory(category)) {
    return null;
  }

  const content = clampContentText(asString(record.content).trim());
  if (content.length === 0) {
    return null;
  }

  const media = normalizeInlineMedia(record.media);
  const coverMedia = normalizeInlineMedia(record.coverMedia);
  const mediaItems = mergeMediaItems(normalizeMediaItems(record.mediaItems), media, coverMedia);
  let primaryMedia = media || coverMedia || mediaItems[0] || '';
  const userId = asString(record.userId).trim() || asString(record.author).trim() || fallbackPeerId || 'unknown-peer';
  const timestampRaw = Math.trunc(asNumber(record.timestamp));
  const timestamp = timestampRaw > 0 ? timestampRaw : Date.now();
  const id = asString(record.id).trim() || `${category}-${userId}-${timestamp}`;
  const userName = asString(record.userName).trim() || `节点 ${userId.slice(0, 8)}`;
  const normalizedType = normalizeType(record.type, primaryMedia);
  const shouldGenerateCover = shouldAutoGenerateTextCover(category, normalizedType, primaryMedia);
  if (shouldGenerateCover) {
    primaryMedia = createAutoTextCover(content, id);
  }
  const normalizedMediaItems = shouldGenerateCover ? [primaryMedia] : mediaItems;

  return {
    id,
    type: normalizedType,
    publishCategory: category,
    userId,
    userName,
    avatar: asString(record.avatar).trim() || avatarForPeer(userId),
    content,
    media: primaryMedia.length > 0 ? primaryMedia : undefined,
    mediaItems: normalizedMediaItems.length > 0 ? normalizedMediaItems : undefined,
    coverMedia: (coverMedia || primaryMedia).length > 0 ? (coverMedia || primaryMedia) : undefined,
    mediaAspectRatio: shouldGenerateCover ? 3 / 4 : normalizeMediaAspectRatio(record.mediaAspectRatio),
    likes: Math.max(0, Math.trunc(asNumber(record.likes))),
    comments: Math.max(0, Math.trunc(asNumber(record.comments))),
    timestamp,
    location: normalizeLocation(record.location ?? record),
    extra: asRecord(record.extra) as Record<string, unknown> | undefined ?? undefined,
  };
}

function sortByTimestampDesc(items: DistributedContent[]): DistributedContent[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

function readStoredContents(): DistributedContent[] {
  if (!hasStorage()) {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: DistributedContent[] = [];
    for (const item of parsed) {
      const normalized = normalizeContent(item);
      if (!normalized) {
        continue;
      }
      if (out.some((existing) => existing.id === normalized.id)) {
        continue;
      }
      out.push(normalized);
    }
    return pruneClearedContents(sortByTimestampDesc(out)).slice(0, MAX_CONTENT_ITEMS);
  } catch {
    return [];
  }
}

function persistContents(): void {
  if (!hasStorage()) {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedContents));
}

function emitContents(): void {
  const snapshot = getDistributedContents();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function upsertContent(content: DistributedContent, notify = true): void {
  if (!shouldKeepContentByClearMarker(content)) {
    return;
  }
  const index = cachedContents.findIndex((item) => item.id === content.id);
  if (index >= 0) {
    const previous = cachedContents[index];
    cachedContents[index] = {
      ...previous,
      ...content,
      likes: Math.max(previous.likes, content.likes),
      comments: Math.max(previous.comments, content.comments),
    };
  } else {
    cachedContents.unshift(content);
  }
  cachedContents = sortByTimestampDesc(cachedContents).slice(0, MAX_CONTENT_ITEMS);
  persistContents();
  if (notify) {
    emitContents();
  }
}

function decodeBase64Utf8(value: string): string {
  if (value.trim().length === 0) {
    return '';
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function ingestPayload(raw: unknown, fallbackPeerId = ''): void {
  const content = normalizeContent(raw, fallbackPeerId);
  if (!content) {
    return;
  }
  upsertContent(content);
}

function handleBridgeEvent(event: BridgeEventEntry): void {
  const topic = asString(event.topic).trim();
  if (topic.length === 0) {
    return;
  }
  if (topic === 'network_event') {
    const payload = asRecord(event.payload);
    if (!payload) {
      return;
    }
    if (asString(payload.type) === 'ContentFeedItem') {
      ingestPayload(payload.payload, asString(payload.peer_id));
    }
    return;
  }
  if (topic === 'pubsub.message') {
    const payload = asRecord(event.payload);
    if (!payload) {
      return;
    }
    const messageTopic = asString(payload.topic).trim();
    if (messageTopic !== DISTRIBUTED_CONTENT_TOPIC) {
      return;
    }
    const encoded = asString(payload.payloadBase64).trim();
    if (encoded.length === 0) {
      return;
    }
    const decoded = decodeBase64Utf8(encoded);
    ingestPayload(decoded);
    return;
  }
  if (topic === DISTRIBUTED_CONTENT_TOPIC) {
    ingestPayload(event.payload);
  }
}

function toWirePayload(content: DistributedContent, extra?: Record<string, JsonValue>): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {
    id: content.id,
    type: content.type,
    publishCategory: content.publishCategory,
    userId: content.userId,
    userName: content.userName,
    avatar: content.avatar,
    content: content.content,
    likes: content.likes,
    comments: content.comments,
    timestamp: content.timestamp,
  };
  if (content.media) {
    payload.media = content.media;
  }
  if (content.mediaItems && content.mediaItems.length > 0) {
    payload.mediaItems = content.mediaItems;
  }
  if (content.coverMedia) {
    payload.coverMedia = content.coverMedia;
  }
  if (typeof content.mediaAspectRatio === 'number') {
    payload.mediaAspectRatio = content.mediaAspectRatio;
  }
  if (content.location) {
    payload.location = {
      public: {
        country: content.location.public.country,
        province: content.location.public.province,
        city: content.location.public.city,
        district: content.location.public.district,
        source: content.location.public.source,
        displayLevel: content.location.public.displayLevel,
      },
      precise: {
        latitude: content.location.precise.latitude,
        longitude: content.location.precise.longitude,
        accuracy: content.location.precise.accuracy,
        altitude: content.location.precise.altitude,
        speed: content.location.precise.speed,
        heading: content.location.precise.heading,
        timestamp: content.location.precise.timestamp,
      },
      commit: content.location.commit,
      nonce: content.location.nonce,
      // legacy mirrors for backward compatibility
      country: content.location.public.country,
      province: content.location.public.province,
      city: content.location.public.city,
      district: content.location.public.district,
      latitude: content.location.precise.latitude,
      longitude: content.location.precise.longitude,
      accuracy: content.location.precise.accuracy,
    };
  }
  if (extra && Object.keys(extra).length > 0) {
    payload.extra = extra;
  }
  return payload;
}

function ensureLocalPeerId(): Promise<string> {
  if (localPeerIdPromise) {
    return localPeerIdPromise;
  }
  localPeerIdPromise = (async () => {
    // 1. Always attempt libp2pService first, as it's the source of truth for "device identity" (Web or Native)
    const servicePeerId = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
    if (servicePeerId.length > 0) {
      persistCachedLocalPeerId(servicePeerId);
      return servicePeerId;
    }

    // 2. Fallback to cached ID if service failed or returned empty
    const cachedPeerId = readCachedLocalPeerId();
    if (cachedPeerId.length > 0) {
      return cachedPeerId;
    }

    // 3. Generate a local fallback ID if absolutely nothing else works (should rarely happen on Web if libp2pService is working)
    const fallbackPeerId = `local-${Math.random().toString(36).slice(2, 10)}`;
    persistCachedLocalPeerId(fallbackPeerId);
    return fallbackPeerId;
  })();
  return localPeerIdPromise;
}

async function refreshFeedSnapshot(): Promise<void> {
  if (!libp2pService.isNativePlatform()) {
    return;
  }
  const snapshot = await libp2pService.fetchFeedSnapshot().catch(() => ({} as Record<string, JsonValue>));
  const root = asRecord(snapshot);
  if (!root) {
    return;
  }
  for (const row of asArray(root.items)) {
    const item = asRecord(row);
    if (!item) {
      continue;
    }
    ingestPayload(item.payload, asString(item.author));
  }
}

async function refreshRendezvousPeers(): Promise<void> {
  if (!libp2pService.isNativePlatform()) {
    return;
  }
  const localPeerId = await ensureLocalPeerId();
  const peers = await libp2pService.rendezvousDiscover(DISTRIBUTED_CONTENT_RENDEZVOUS_NS, 64).catch(() => []);
  for (const row of peers) {
    const peerId = asString(row.peerId).trim();
    if (peerId.length === 0 || peerId === localPeerId || subscribedFeedPeers.has(peerId)) {
      continue;
    }
    const subscribed = await libp2pService.feedSubscribePeer(peerId).catch(() => false);
    if (subscribed) {
      subscribedFeedPeers.add(peerId);
    }
  }
}

export function getDistributedContents(): DistributedContent[] {
  const filtered = sortByTimestampDesc(pruneClearedContents(cachedContents)).slice(0, MAX_CONTENT_ITEMS);
  const changed =
    filtered.length !== cachedContents.length ||
    filtered.some((item, index) => cachedContents[index]?.id !== item.id);
  if (changed) {
    cachedContents = filtered;
    persistContents();
  }
  return filtered;
}

export function getDistributedContentsByPeer(peerId: string, limit = MAX_CONTENT_ITEMS): DistributedContent[] {
  const normalized = normalizePeerId(peerId);
  if (normalized.length === 0) {
    return [];
  }
  return getDistributedContents()
    .filter((item) => normalizePeerId(item.userId) === normalized)
    .slice(0, Math.max(1, limit));
}

export function getDistributedContentById(contentId: string): DistributedContent | null {
  const normalized = contentId.trim();
  if (normalized.length === 0) {
    return null;
  }
  return getDistributedContents().find((item) => item.id === normalized) ?? null;
}

export function clearDistributedContentsByPeer(peerId: string): number {
  const normalized = normalizePeerId(peerId);
  if (normalized.length === 0) {
    return 0;
  }
  setClearMarkerForPeer(normalized, Date.now());
  const before = cachedContents.length;
  cachedContents = cachedContents.filter((item) => normalizePeerId(item.userId) !== normalized);
  const removed = before - cachedContents.length;
  persistContents();
  if (removed > 0) {
    emitContents();
  }
  return removed;
}

export async function clearLocalPublishedContents(): Promise<{ peerId: string; removed: number }> {
  const peerId = await ensureLocalPeerId();
  const removed = clearDistributedContentsByPeer(peerId);
  return { peerId, removed };
}

export function subscribeDistributedContents(listener: ContentListener): () => void {
  listeners.add(listener);
  listener(getDistributedContents());
  return () => {
    listeners.delete(listener);
  };
}

export async function publishDistributedContent(input: PublishDistributedContentInput): Promise<DistributedContent> {
  const location = await buildPublishLocation(input.locationHint);
  const peerId = await ensureLocalPeerId();
  const now = Date.now();
  const contentText = clampContentText(input.content.trim());
  const resolvedContent = contentText.length > 0 ? contentText : `${input.publishCategory} 发布`;
  const media = normalizeInlineMedia(input.media);
  const coverMedia = normalizeInlineMedia(input.coverMedia);
  const mediaItems = mergeMediaItems(normalizeMediaItems(input.mediaItems), media, coverMedia);
  let primaryMedia = media || coverMedia || mediaItems[0] || '';
  const normalizedType = normalizeType(input.type, primaryMedia);
  const itemId = `${input.publishCategory}-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const shouldGenerateCover = shouldAutoGenerateTextCover(input.publishCategory, normalizedType, primaryMedia);
  if (shouldGenerateCover) {
    primaryMedia = createAutoTextCover(resolvedContent, itemId);
  }
  const normalizedCoverMedia = coverMedia || primaryMedia;
  const normalizedMediaItems = shouldGenerateCover ? [primaryMedia] : mediaItems;
  const mediaAspectRatio = shouldGenerateCover ? 3 / 4 : normalizeMediaAspectRatio(input.mediaAspectRatio);

  const item: DistributedContent = {
    id: itemId,
    type: normalizedType,
    publishCategory: input.publishCategory,
    userId: peerId,
    userName: input.userName?.trim() || `节点 ${peerId.slice(0, 8)}`,
    avatar: input.avatar?.trim() || avatarForPeer(peerId),
    content: resolvedContent,
    media: primaryMedia.length > 0 ? primaryMedia : undefined,
    mediaItems: normalizedMediaItems.length > 0 ? normalizedMediaItems : undefined,
    coverMedia: normalizedCoverMedia.length > 0 ? normalizedCoverMedia : undefined,
    mediaAspectRatio,
    likes: 0,
    comments: 0,
    timestamp: now,
    location,
    extra: input.extra as Record<string, unknown> | undefined,
  };

  upsertContent(item);

  if (libp2pService.isNativePlatform()) {
    const wire = toWirePayload(item, input.extra);
    void (async () => {
      await Promise.allSettled([
        libp2pService.pubsubPublish(DISTRIBUTED_CONTENT_TOPIC, JSON.stringify(wire)),
        libp2pService.feedPublishEntry(wire),
      ]);
    })();
  }

  return item;
}

export async function syncDistributedContentFromNetwork(peerId = ''): Promise<void> {
  if (!libp2pService.isNativePlatform()) {
    return;
  }
  const targetPeerId = peerId.trim();
  if (targetPeerId.length > 0) {
    const localPeerId = await ensureLocalPeerId();
    if (targetPeerId !== localPeerId && !subscribedFeedPeers.has(targetPeerId)) {
      const subscribed = await libp2pService.feedSubscribePeer(targetPeerId).catch(() => false);
      if (subscribed) {
        subscribedFeedPeers.add(targetPeerId);
      }
    }
  }
  await refreshFeedSnapshot();
}

export async function resolveDistributedContentDetail(contentId: string, authorPeerId = ''): Promise<DistributedContent | null> {
  const normalizedId = contentId.trim();
  if (normalizedId.length === 0) {
    return null;
  }

  const localHit = getDistributedContentById(normalizedId);
  if (!libp2pService.isNativePlatform()) {
    return localHit;
  }

  const localPeerId = await ensureLocalPeerId();
  const normalizedAuthorPeerId = authorPeerId.trim();
  if (localHit && localHit.userId === localPeerId) {
    return localHit;
  }
  if (localHit && normalizedAuthorPeerId.length > 0 && normalizedAuthorPeerId === localPeerId) {
    return localHit;
  }

  for (let attempt = 0; attempt <= DETAIL_RESOLVE_RETRIES; attempt += 1) {
    await syncDistributedContentFromNetwork(normalizedAuthorPeerId);
    const resolved = getDistributedContentById(normalizedId);
    if (resolved) {
      return resolved;
    }
    if (attempt < DETAIL_RESOLVE_RETRIES) {
      await sleep(DETAIL_RESOLVE_WAIT_MS);
    }
  }
  return getDistributedContentById(normalizedId);
}

export const __distributedContentTestUtils = {
  normalizeLocation,
  buildGeoCommit,
};

import { mockApps } from './appList';

function ensureMockAppsInFeed(): void {
  const now = Date.now();

  // 1. Clean up ALL legacy or previous app notifications to prevent duplicates
  // Filter out any content that looks like an auto-generated app item
  cachedContents = cachedContents.filter(item => {
    if (item.publishCategory !== 'app') return true;
    // Remove if it has one of our specific prefixes
    if (item.id.startsWith('app-announce-') || item.id.startsWith('app-release-') || item.id.startsWith('app-item-')) {
      return false;
    }
    return true;
  });

  // 2. Re-inject current apps from the registry (App Market)
  // Reverse mockApps so the first defined app in list appears last (latest time), or simply stagger times
  mockApps.forEach((app, index) => {
    const itemId = `app-item-${app.id}`;

    // Create app announce content
    const content: DistributedContent = {
      id: itemId,
      type: 'text',
      publishCategory: 'app',
      userId: app.sellerId || 'peer-market-index',
      userName: '',
      avatar: '',
      content: app.name, // Just the name
      media: app.icon.startsWith('http') || app.icon.startsWith('data:') ? app.icon : undefined,
      likes: 0,
      comments: 0,
      timestamp: now - (index * 60 * 1000),
      location: undefined,
      extra: {
        appMeta: {
          appName: app.name,
          version: '1.0.0',
          category: app.category,
          packageName: `${app.id}.app`,
          icon: app.icon // Store original icon (URL or emoji) here for UI to use
        }
      }
    };

    upsertContent(content, false);
  });
}

export function startDistributedContentSync(): void {
  if (syncStarted) {
    return;
  }
  syncStarted = true;
  cachedContents = readStoredContents();

  // Inject mock apps if missing
  ensureMockAppsInFeed();

  pumpUnsubscribe = libp2pEventPump.subscribe(handleBridgeEvent);
  if (!libp2pService.isNativePlatform()) {
    emitContents();
    return;
  }
  void (async () => {
    const runtimeReady = await libp2pService.ensureStarted().catch(() => false);
    if (!runtimeReady || !syncStarted) {
      return;
    }
    await libp2pService.pubsubSubscribe(DISTRIBUTED_CONTENT_TOPIC).catch(() => false);
    await libp2pService.rendezvousAdvertise(DISTRIBUTED_CONTENT_RENDEZVOUS_NS, 300_000).catch(() => false);
    await refreshFeedSnapshot();
    await refreshRendezvousPeers();
    if (!syncStarted || rendezvousTimer) {
      return;
    }
    rendezvousTimer = setInterval(() => {
      void refreshRendezvousPeers();
    }, RENDEZVOUS_REFRESH_MS);
  })();
  emitContents();
}

export function stopDistributedContentSync(): void {
  if (!syncStarted) {
    return;
  }
  syncStarted = false;
  if (pumpUnsubscribe) {
    pumpUnsubscribe();
    pumpUnsubscribe = null;
  }
  if (rendezvousTimer) {
    clearInterval(rendezvousTimer);
    rendezvousTimer = null;
  }
  if (libp2pService.isNativePlatform()) {
    void libp2pService.pubsubUnsubscribe(DISTRIBUTED_CONTENT_TOPIC);
  }
}
