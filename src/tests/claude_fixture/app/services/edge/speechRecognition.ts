import {
    buildEdgeBridgeRequest,
    invokeEdgeBridge,
    isEdgeCapabilitySupported,
    parseMetricsJson,
} from './nativeBridge';

export interface EdgeSpeechOptions {
    language?: string;
    maxResults?: number;
    timeoutMs?: number;
    onPartial?: (text: string) => void;
}

export interface EdgeSpeechResult {
    transcript: string;
    provider: 'native_bridge';
    durationMs: number;
}

function asString(raw: unknown): string {
    return typeof raw === 'string' ? raw : '';
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

async function transcribeNativeBridge(options: EdgeSpeechOptions): Promise<EdgeSpeechResult | null> {
    const request = buildEdgeBridgeRequest(
        'speech_asr',
        'inline:microphone',
        {
            options: {
                language: options.language ?? 'zh-CN',
                maxResults: options.maxResults ?? 1,
                timeoutMs: options.timeoutMs ?? 12_000,
            },
        },
    );
    const result = await invokeEdgeBridge(request, options.timeoutMs ?? 12_000);
    if (!result || !result.ok) {
        return null;
    }
    const metrics = parseMetricsJson(result.metrics_json);
    if (!metrics) {
        return null;
    }
    const engine = asString(metrics.engine).trim();
    if (engine && engine !== 'cheng_native') {
        return null;
    }
    const transcript = asString(metrics.transcript).trim();
    if (!transcript) {
        return null;
    }
    return {
        transcript,
        provider: 'native_bridge',
        durationMs: Math.max(0, asNumber(metrics.durationMs, 0)),
    };
}

export async function isEdgeSpeechSupported(): Promise<boolean> {
    return isEdgeCapabilitySupported('speech_asr');
}

export async function transcribeOnce(options: EdgeSpeechOptions = {}): Promise<EdgeSpeechResult> {
    const bridged = await transcribeNativeBridge(options).catch(() => null);
    if (bridged) {
        return bridged;
    }
    throw new Error('cheng_runtime_unavailable');
}
