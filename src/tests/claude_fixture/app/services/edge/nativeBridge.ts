import { Capacitor, registerPlugin } from '@capacitor/core';
import { buildChengRuntimeEnvelope } from './chengRuntimeConfig';

export type EdgeCapability = 'content_filter' | 'speech_asr' | 'background_blur';

export interface EdgeBridgeRequestPayload {
    schema_version: 'edge-bridge-request/v1';
    request_id: string;
    plan_id: string;
    capability: EdgeCapability;
    framework: string;
    runtime: string;
    device: string;
    input_ref: string;
    options_json: string;
    timestamp: string;
    signer: string;
}

export interface EdgeBridgeResultPayload {
    schema_version: 'edge-bridge-result/v1';
    request_id: string;
    capability: EdgeCapability;
    ok: boolean;
    output_ref: string;
    metrics_json: string;
    error_code: string;
    error_message: string;
    timestamp: string;
    engine_version: string;
    op_trace_ref: string;
    thermal_state: string;
    dropped_frame_count: number;
}

interface EdgeInferenceBridgePlugin {
    run(options: { request: EdgeBridgeRequestPayload | string }): Promise<unknown>;
    infer(options: { request: EdgeBridgeRequestPayload | string }): Promise<unknown>;
    runEdgeInference(options: { request: EdgeBridgeRequestPayload | string }): Promise<unknown>;
    getCapabilities(): Promise<unknown>;
}

const EdgeInferenceBridge = registerPlugin<EdgeInferenceBridgePlugin>('EdgeInferenceBridge');

const EDGE_BRIDGE_SCHEMA_REQ = 'edge-bridge-request/v1' as const;
const EDGE_BRIDGE_SCHEMA_RES = 'edge-bridge-result/v1' as const;
const EDGE_BRIDGE_CAP_CACHE_MS = 30_000;

let edgeBridgeCapabilityCache: {
    fetchedAt: number;
    value: Record<string, unknown> | null;
} | null = null;

function asStr(raw: unknown): string {
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw === null || raw === undefined) {
        return '';
    }
    return String(raw);
}

function asBool(raw: unknown, fallback = false): boolean {
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (typeof raw === 'number') {
        return Number.isFinite(raw) && raw !== 0;
    }
    const text = asStr(raw).trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes' || text === 'ok') {
        return true;
    }
    if (text === 'false' || text === '0' || text === 'no') {
        return false;
    }
    return fallback;
}

function nowIso(): string {
    return new Date().toISOString();
}

function randomRequestId(capability: EdgeCapability): string {
    const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `edge-req-${capability}-${rand}`;
}

function safeStableJson(raw: unknown): string {
    try {
        if (typeof raw === 'string') {
            return raw;
        }
        return JSON.stringify(raw ?? {});
    } catch {
        return '{}';
    }
}

function normalizeCapability(raw: string): EdgeCapability {
    if (raw === 'content_filter' || raw === 'speech_asr' || raw === 'background_blur') {
        return raw;
    }
    return 'content_filter';
}

function hasCallableMethod<T extends (...args: unknown[]) => unknown>(candidate: unknown): candidate is T {
    return typeof candidate === 'function';
}

function parseJsonMaybe(raw: unknown): unknown {
    if (typeof raw !== 'string') {
        return raw;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function isObjectRecord(raw: unknown): raw is Record<string, unknown> {
    return Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);
}

function coerceMetricsJson(raw: unknown): string {
    if (typeof raw === 'string') {
        return raw.trim();
    }
    return safeStableJson(raw ?? {});
}

function nativeRuntimeEnabledFromCapabilities(raw: Record<string, unknown> | null): boolean {
    if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'native_runtime_enabled')) {
        return true;
    }
    return asBool(raw.native_runtime_enabled, true);
}

function capabilityEnabledFromCapabilities(raw: Record<string, unknown> | null, capability: EdgeCapability): boolean {
    if (!raw) {
        return true;
    }
    const supports = raw.supports;
    if (!supports || typeof supports !== 'object' || Array.isArray(supports)) {
        return true;
    }
    const map = supports as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(map, capability)) {
        return true;
    }
    return asBool(map[capability], true);
}

async function queryEdgeBridgeCapabilities(timeoutMs = 2_000): Promise<Record<string, unknown> | null> {
    const now = Date.now();
    if (edgeBridgeCapabilityCache && now - edgeBridgeCapabilityCache.fetchedAt <= EDGE_BRIDGE_CAP_CACHE_MS) {
        return edgeBridgeCapabilityCache.value;
    }
    const bridge = EdgeInferenceBridge as unknown as Record<string, unknown>;
    if (!hasCallableMethod<() => Promise<unknown>>(bridge.getCapabilities)) {
        edgeBridgeCapabilityCache = { fetchedAt: now, value: null };
        return null;
    }
    try {
        const raw = await invokeWithTimeout(bridge.getCapabilities(), timeoutMs);
        const parsed = parseJsonMaybe(raw);
        const value = isObjectRecord(parsed) ? parsed : null;
        edgeBridgeCapabilityCache = { fetchedAt: now, value };
        return value;
    } catch {
        edgeBridgeCapabilityCache = { fetchedAt: now, value: null };
        return null;
    }
}

export function parseMetricsJson(raw: string): Record<string, unknown> | null {
    const parsed = parseJsonMaybe(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    return parsed as Record<string, unknown>;
}

export function buildEdgeBridgeRequest(
    capability: EdgeCapability,
    inputRef: string,
    options: unknown,
    signer = 'claudedesign-edge-adapter',
): EdgeBridgeRequestPayload {
    const now = nowIso();
    const platform = Capacitor.getPlatform();
    const device = platform === 'ios' ? 'metal' : platform === 'android' ? 'vulkan' : 'cpu';
    const framework = 'cheng_edge_runtime';
    let resolvedRuntime = 'cheng_native/filter';
    if (capability === 'speech_asr') {
        resolvedRuntime = 'cheng_native/asr';
    } else if (capability === 'background_blur') {
        resolvedRuntime = 'cheng_native/blur';
    }
    const envelope = buildChengRuntimeEnvelope(capability, platform, options);
    return {
        schema_version: EDGE_BRIDGE_SCHEMA_REQ,
        request_id: randomRequestId(capability),
        plan_id: 'edge-plan:claudedesign-runtime',
        capability,
        framework,
        runtime: resolvedRuntime,
        device,
        input_ref: inputRef,
        options_json: safeStableJson(envelope),
        timestamp: now,
        signer,
    };
}

function normalizeBridgeResult(
    raw: unknown,
    request: EdgeBridgeRequestPayload,
): EdgeBridgeResultPayload | null {
    const value = parseJsonMaybe(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const root = value as Record<string, unknown>;
    const innerValue = root.result ?? root.payload ?? root;
    const inner =
        innerValue && typeof innerValue === 'object' && !Array.isArray(innerValue)
            ? (innerValue as Record<string, unknown>)
            : root;
    const capability = normalizeCapability(asStr(inner.capability).trim() || request.capability);
    const requestId = asStr(inner.request_id).trim() || request.request_id;
    const ok = asBool(inner.ok, false);
    return {
        schema_version: EDGE_BRIDGE_SCHEMA_RES,
        request_id: requestId,
        capability,
        ok,
        output_ref: asStr(inner.output_ref).trim(),
        metrics_json: coerceMetricsJson(inner.metrics_json ?? inner.metrics ?? {}),
        error_code: asStr(inner.error_code).trim(),
        error_message: asStr(inner.error_message).trim(),
        timestamp: asStr(inner.timestamp).trim() || nowIso(),
        engine_version: asStr(inner.engine_version).trim(),
        op_trace_ref: asStr(inner.op_trace_ref).trim(),
        thermal_state: asStr(inner.thermal_state).trim(),
        dropped_frame_count: Math.max(0, Math.floor(Number(asStr(inner.dropped_frame_count) || '0') || 0)),
    };
}

async function invokeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('edge_bridge_timeout')), timeoutMs);
        promise
            .then((value) => {
                window.clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                window.clearTimeout(timer);
                reject(error);
            });
    });
}

export function isEdgeNativeBridgeAvailable(): boolean {
    const bridge = EdgeInferenceBridge as unknown as Record<string, unknown>;
    if (hasCallableMethod(bridge.run) || hasCallableMethod(bridge.infer) || hasCallableMethod(bridge.runEdgeInference)) {
        return true;
    }
    const cap = Capacitor as unknown as {
        isPluginAvailable?: (name: string) => boolean;
    };
    if (typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('EdgeInferenceBridge')) {
        return true;
    }
    return Capacitor.isNativePlatform();
}

export async function isEdgeCapabilitySupported(capability: EdgeCapability): Promise<boolean> {
    if (!isEdgeNativeBridgeAvailable()) {
        return false;
    }
    const capabilities = await queryEdgeBridgeCapabilities().catch(() => null);
    if (!nativeRuntimeEnabledFromCapabilities(capabilities)) {
        return false;
    }
    return capabilityEnabledFromCapabilities(capabilities, capability);
}

export async function invokeEdgeBridge(
    request: EdgeBridgeRequestPayload,
    timeoutMs = 15_000,
): Promise<EdgeBridgeResultPayload | null> {
    if (!isEdgeNativeBridgeAvailable()) {
        return null;
    }
    const capabilities = await queryEdgeBridgeCapabilities().catch(() => null);
    if (!nativeRuntimeEnabledFromCapabilities(capabilities)) {
        return null;
    }
    if (!capabilityEnabledFromCapabilities(capabilities, request.capability)) {
        return null;
    }
    const bridge = EdgeInferenceBridge as unknown as Record<string, unknown>;
    const methods: Array<(options: { request: EdgeBridgeRequestPayload | string }) => Promise<unknown>> = [];
    if (hasCallableMethod<(options: { request: EdgeBridgeRequestPayload | string }) => Promise<unknown>>(bridge.run)) {
        methods.push(bridge.run);
    }
    if (hasCallableMethod<(options: { request: EdgeBridgeRequestPayload | string }) => Promise<unknown>>(bridge.infer)) {
        methods.push(bridge.infer);
    }
    if (hasCallableMethod<(options: { request: EdgeBridgeRequestPayload | string }) => Promise<unknown>>(bridge.runEdgeInference)) {
        methods.push(bridge.runEdgeInference);
    }
    for (const method of methods) {
        try {
            const raw = await invokeWithTimeout(method({ request }), timeoutMs);
            const normalized = normalizeBridgeResult(raw, request);
            if (normalized) {
                return normalized;
            }
        } catch {
            continue;
        }
    }
    return null;
}
