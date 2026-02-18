import { buildEdgeBridgeRequest, invokeEdgeBridge, parseMetricsJson } from './nativeBridge';

export interface BackgroundBlurOptions {
    blurRadius?: number;
    modelSelection?: 0 | 1;
}

export interface BackgroundBlurResult {
    outputDataUrl: string;
    backend: 'cheng-native-kernel';
    foregroundRatio: number;
    latencyMs: number;
    degradedReason?: string;
}

export type BlurVoiceCommand = 'enable_blur' | 'disable_blur' | 'apply_blur' | 'unknown';

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

function asString(raw: unknown): string {
    return typeof raw === 'string' ? raw : '';
}

function asObject(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    return raw as Record<string, unknown>;
}

function coerceNativeBlurResult(metrics: Record<string, unknown> | null, fallbackOutputRef: string): BackgroundBlurResult | null {
    if (!metrics) {
        return null;
    }
    const outputDataUrl = asString(metrics.outputDataUrl) || (fallbackOutputRef.startsWith('data:image/') ? fallbackOutputRef : '');
    if (!outputDataUrl.startsWith('data:image/')) {
        return null;
    }
    return {
        outputDataUrl,
        backend: 'cheng-native-kernel',
        foregroundRatio: Math.max(0, Math.min(1, asNumber(metrics.foregroundRatio, 0))),
        latencyMs: Math.max(0, asNumber(metrics.latencyMs, 0)),
        degradedReason: asString(metrics.degradedReason) || undefined,
    };
}

async function runNativeBridgeBlur(
    inputDataUrl: string,
    options: BackgroundBlurOptions,
): Promise<BackgroundBlurResult | null> {
    const request = buildEdgeBridgeRequest(
        'background_blur',
        'inline:image_data_url',
        {
            inputDataUrl,
            options,
        },
    );
    const result = await invokeEdgeBridge(request, 20_000);
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
    const candidate = asObject(metrics.result) ?? metrics;
    return coerceNativeBlurResult(candidate, result.output_ref);
}

export function parseBlurVoiceCommand(text: string): BlurVoiceCommand {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
        return 'unknown';
    }
    const enableKeywords = ['开启背景虚化', '打开背景虚化', '启用背景虚化', '开启虚化', 'blur background on', 'enable blur'];
    const disableKeywords = ['关闭背景虚化', '取消背景虚化', '停止背景虚化', '关闭虚化', 'blur background off', 'disable blur'];
    const applyKeywords = ['虚化背景', '背景虚化', '执行虚化', 'apply blur', 'blur now'];

    if (enableKeywords.some((word) => normalized.includes(word))) {
        return 'enable_blur';
    }
    if (disableKeywords.some((word) => normalized.includes(word))) {
        return 'disable_blur';
    }
    if (applyKeywords.some((word) => normalized.includes(word))) {
        return 'apply_blur';
    }
    return 'unknown';
}

export async function blurBackgroundFromDataUrl(
    inputDataUrl: string,
    options: BackgroundBlurOptions = {},
): Promise<BackgroundBlurResult> {
    const bridged = await runNativeBridgeBlur(inputDataUrl, options);
    if (bridged) {
        return bridged;
    }
    throw new Error('cheng_runtime_unavailable');
}
