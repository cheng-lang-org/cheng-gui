import { buildEdgeBridgeRequest, invokeEdgeBridge, parseMetricsJson } from './nativeBridge';

export interface EdgeFilterOptions {
    phashDistance?: number;
    nudenetThreshold?: number;
    knownBlockedHashes?: string[];
}

export interface EdgeFilterImageRecord {
    index: number;
    phash: string;
    nudenetScore: number;
    skinRatio: number;
    yoloDetectionCount: number;
    flagged: boolean;
    reasons: string[];
}

export interface EdgeFilterSummary {
    passed: boolean;
    blockedReasons: string[];
    images: EdgeFilterImageRecord[];
    yolo: {
        backend: 'face-detector-fallback' | 'disabled' | 'cheng-native-kernel';
        detections: number;
    };
    nudenet: {
        backend: 'skin-ratio-fallback' | 'cheng-native-kernel';
        threshold: number;
        maxScore: number;
        flaggedIndices: number[];
    };
    phash: {
        backend: 'average-hash-fallback' | 'cheng-native-kernel';
        threshold: number;
        nearDuplicatePairs: Array<{ a: number; b: number; distance: number }>;
        knownBlockedHits: Array<{ index: number; hash: string; distance: number }>;
    };
}

interface KnownPhashManifest {
    version: number;
    updated_at: string;
    hashes: string[];
}

interface FaceDetectorLike {
    detect: (input: CanvasImageSource) => Promise<unknown[]>;
}

interface FaceDetectorCtor {
    new(options?: { fastMode?: boolean; maxDetectedFaces?: number }): FaceDetectorLike;
}

interface NativeFilterImageRecordLike {
    index?: unknown;
    phash?: unknown;
    nudenetScore?: unknown;
    skinRatio?: unknown;
    yoloDetectionCount?: unknown;
    flagged?: unknown;
    reasons?: unknown;
}

function asNumber(raw: unknown, fallback = 0): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}

function asBool(raw: unknown, fallback = false): boolean {
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (typeof raw === 'number') {
        return raw !== 0;
    }
    if (typeof raw === 'string') {
        const text = raw.trim().toLowerCase();
        if (text === 'true' || text === '1' || text === 'yes') {
            return true;
        }
        if (text === 'false' || text === '0' || text === 'no') {
            return false;
        }
    }
    return fallback;
}

function asString(raw: unknown): string {
    return typeof raw === 'string' ? raw : '';
}

function asObject(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    return raw as Record<string, unknown>;
}

function asStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((item): item is string => typeof item === 'string');
}

function coerceNativeImageRecord(raw: NativeFilterImageRecordLike, fallbackIndex: number): EdgeFilterImageRecord {
    return {
        index: Math.max(0, Math.floor(asNumber(raw.index, fallbackIndex))),
        phash: asString(raw.phash),
        nudenetScore: asNumber(raw.nudenetScore, 0),
        skinRatio: asNumber(raw.skinRatio, 0),
        yoloDetectionCount: Math.max(0, Math.floor(asNumber(raw.yoloDetectionCount, 0))),
        flagged: asBool(raw.flagged, false),
        reasons: asStringArray(raw.reasons),
    };
}

function coerceNativeFilterSummary(raw: Record<string, unknown>): EdgeFilterSummary | null {
    const imagesRaw = Array.isArray(raw.images) ? raw.images : [];
    const images: EdgeFilterImageRecord[] = imagesRaw
        .map((item, index) => coerceNativeImageRecord(asObject(item) ?? {}, index))
        .filter((item) => Number.isFinite(item.index));
    const yoloRaw = asObject(raw.yolo) ?? {};
    const nudenetRaw = asObject(raw.nudenet) ?? {};
    const phashRaw = asObject(raw.phash) ?? {};
    const blockedReasons = asStringArray(raw.blockedReasons);
    const yoloBackendRaw = asString(yoloRaw.backend);
    const yoloBackend: 'face-detector-fallback' | 'disabled' | 'cheng-native-kernel' =
        yoloBackendRaw === 'cheng-native-kernel'
            ? 'cheng-native-kernel'
            : yoloBackendRaw === 'disabled'
              ? 'disabled'
              : 'face-detector-fallback';
    const nudenetBackendRaw = asString(nudenetRaw.backend);
    const nudenetBackend: 'skin-ratio-fallback' | 'cheng-native-kernel' =
        nudenetBackendRaw === 'cheng-native-kernel' ? 'cheng-native-kernel' : 'skin-ratio-fallback';
    const phashBackendRaw = asString(phashRaw.backend);
    const phashBackend: 'average-hash-fallback' | 'cheng-native-kernel' =
        phashBackendRaw === 'cheng-native-kernel' ? 'cheng-native-kernel' : 'average-hash-fallback';
    const flaggedIndicesRaw = Array.isArray(nudenetRaw.flaggedIndices) ? nudenetRaw.flaggedIndices : [];
    const flaggedIndices = flaggedIndicesRaw.map((entry) => Math.max(0, Math.floor(asNumber(entry, 0))));
    const nearDuplicatePairsRaw = Array.isArray(phashRaw.nearDuplicatePairs) ? phashRaw.nearDuplicatePairs : [];
    const knownBlockedHitsRaw = Array.isArray(phashRaw.knownBlockedHits) ? phashRaw.knownBlockedHits : [];
    const nearDuplicatePairs = nearDuplicatePairsRaw
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
            a: Math.max(0, Math.floor(asNumber(entry.a, 0))),
            b: Math.max(0, Math.floor(asNumber(entry.b, 0))),
            distance: Math.max(0, Math.floor(asNumber(entry.distance, 0))),
        }));
    const knownBlockedHits = knownBlockedHitsRaw
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
            index: Math.max(0, Math.floor(asNumber(entry.index, 0))),
            hash: asString(entry.hash),
            distance: Math.max(0, Math.floor(asNumber(entry.distance, 0))),
        }));
    const maxScore = asNumber(nudenetRaw.maxScore, 0);
    const threshold = asNumber(nudenetRaw.threshold, 0.62);
    const phashThreshold = Math.max(0, Math.floor(asNumber(phashRaw.threshold, 10)));
    const detections = Math.max(0, Math.floor(asNumber(yoloRaw.detections, 0)));

    return {
        passed: asBool(raw.passed, blockedReasons.length === 0),
        blockedReasons,
        images,
        yolo: {
            backend: yoloBackend,
            detections,
        },
        nudenet: {
            backend: nudenetBackend,
            threshold,
            maxScore,
            flaggedIndices,
        },
        phash: {
            backend: phashBackend,
            threshold: phashThreshold,
            nearDuplicatePairs,
            knownBlockedHits,
        },
    };
}

async function runNativeBridgeFilter(
    previews: string[],
    options: EdgeFilterOptions,
): Promise<EdgeFilterSummary | null> {
    const request = buildEdgeBridgeRequest(
        'content_filter',
        'inline:media_previews',
        {
            previews,
            options,
        },
    );
    const result = await invokeEdgeBridge(request);
    if (!result || !result.ok) {
        return null;
    }
    const metrics = parseMetricsJson(result.metrics_json);
    if (!metrics) {
        return null;
    }
    const engine = asString(metrics.engine);
    if (engine && engine !== 'cheng_native') {
        return null;
    }
    const candidate = asObject(metrics.summary) ?? metrics;
    return coerceNativeFilterSummary(candidate);
}

function getFaceDetectorCtor(): FaceDetectorCtor | null {
    const candidate = (window as Window & { FaceDetector?: FaceDetectorCtor }).FaceDetector;
    return candidate ?? null;
}

function normalizeHash(raw: string): string {
    const trimmed = raw.trim().toLowerCase();
    if (/^[01]{64}$/.test(trimmed)) {
        return trimmed;
    }
    if (/^[0-9a-f]{16}$/.test(trimmed)) {
        return trimmed.split('').map((ch) => parseInt(ch, 16).toString(2).padStart(4, '0')).join('');
    }
    return '';
}

const KNOWN_HASH_MANIFEST_PATH = '/edge-models/filter/known_phash_blacklist_v1.json';
let cachedKnownHashes: string[] | null = null;

function hammingDistance(a: string, b: string): number {
    if (!a || !b || a.length !== b.length) {
        return Number.MAX_SAFE_INTEGER;
    }
    let distance = 0;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            distance += 1;
        }
    }
    return distance;
}

export async function loadKnownBlockedHashes(forceRefresh = false): Promise<string[]> {
    if (!forceRefresh && cachedKnownHashes) {
        return cachedKnownHashes;
    }
    try {
        const response = await fetch(KNOWN_HASH_MANIFEST_PATH, { cache: 'no-store' });
        if (!response.ok) {
            cachedKnownHashes = [];
            return cachedKnownHashes;
        }
        const payload = (await response.json()) as Partial<KnownPhashManifest>;
        const hashes = Array.isArray(payload.hashes)
            ? payload.hashes.map((entry) => normalizeHash(String(entry))).filter((hash) => hash.length === 64)
            : [];
        cachedKnownHashes = hashes;
        return hashes;
    } catch {
        cachedKnownHashes = [];
        return cachedKnownHashes;
    }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('image_decode_failed'));
        image.src = dataUrl;
    });
}

function computeAverageHash(image: HTMLImageElement): string {
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    if (!context) {
        return ''.padEnd(64, '0');
    }
    context.drawImage(image, 0, 0, 8, 8);
    const pixels = context.getImageData(0, 0, 8, 8).data;
    const gray: number[] = [];
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const value = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        gray.push(value);
        sum += value;
    }
    const avg = sum / gray.length;
    return gray.map((value) => (value >= avg ? '1' : '0')).join('');
}

function estimateSkinRatio(image: HTMLImageElement): number {
    const side = 160;
    const canvas = createCanvas(side, side);
    const context = canvas.getContext('2d');
    if (!context) {
        return 0;
    }
    context.drawImage(image, 0, 0, side, side);
    const pixels = context.getImageData(0, 0, side, side).data;
    let skin = 0;
    let sampled = 0;
    for (let i = 0; i < pixels.length; i += 16) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        if (y > 40 && cb > 85 && cb < 135 && cr > 135 && cr < 180) {
            skin += 1;
        }
        sampled += 1;
    }
    if (sampled === 0) {
        return 0;
    }
    return skin / sampled;
}

async function detectFaces(image: HTMLImageElement): Promise<{ count: number; backend: 'face-detector-fallback' | 'disabled' }> {
    const Ctor = getFaceDetectorCtor();
    if (!Ctor) {
        return { count: 0, backend: 'disabled' };
    }
    try {
        const detector = new Ctor({ fastMode: true, maxDetectedFaces: 5 });
        const faces = await detector.detect(image);
        return { count: faces.length, backend: 'face-detector-fallback' };
    } catch {
        return { count: 0, backend: 'disabled' };
    }
}

function estimateNudenetScore(skinRatio: number, faceCount: number): number {
    const facePenalty = faceCount > 0 ? 0.82 : 1;
    const score = skinRatio * facePenalty;
    return Math.max(0, Math.min(1, score));
}

export async function runEdgeFilterPipeline(
    previews: string[],
    options: EdgeFilterOptions = {},
): Promise<EdgeFilterSummary> {
    const bridged = await runNativeBridgeFilter(previews, options);
    if (bridged) {
        return bridged;
    }
    return {
        passed: false,
        blockedReasons: ['cheng_runtime_unavailable'],
        images: [],
        yolo: {
            backend: 'disabled',
            detections: 0,
        },
        nudenet: {
            backend: 'skin-ratio-fallback',
            threshold: options.nudenetThreshold ?? 0.62,
            maxScore: 0,
            flaggedIndices: [],
        },
        phash: {
            backend: 'average-hash-fallback',
            threshold: options.phashDistance ?? 10,
            nearDuplicatePairs: [],
            knownBlockedHits: [],
        },
    };
}
