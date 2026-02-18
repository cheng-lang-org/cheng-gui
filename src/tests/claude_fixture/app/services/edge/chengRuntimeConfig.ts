import type { EdgeCapability } from './nativeBridge';

export interface ChengModelPack {
    schema_version: 'cheng-model-pack/v1';
    pack_id: string;
    model_domain: 'content_filter' | 'speech_asr' | 'background_blur';
    opset_version: string;
    tensor_layout: string;
    quant_policy: string;
    checksum: string;
    signer: string;
}

export interface ChengRuntimeProfile {
    schema_version: 'cheng-runtime-profile/v1';
    profile_id: string;
    platform: 'android' | 'ios' | 'harmony' | 'desktop' | 'web';
    simd_level: string;
    memory_budget_mb: number;
    thread_policy: string;
    thermal_policy: string;
}

interface ChengRuntimeEnvelope {
    engine: 'cheng_native';
    graph_id: string;
    quant_profile: string;
    runtime_profile_id: string;
    model_pack: ChengModelPack;
    runtime_profile: ChengRuntimeProfile;
    rollout: {
        channel: 'stable';
        percent: number;
        auto_rollback: boolean;
    };
    options: unknown;
}

const PACK_SIGNER = 'did:yi:runtime:cheng-edge';
const OPSET = 'cheng-opset/v1';
const LAYOUT = 'nhwc';
const QUANT = 'int8_balanced';
const PROFILE_ID = 'runtime-profile:claudedesign-mobile-v1';

const DEFAULT_PACKS: Record<EdgeCapability, ChengModelPack> = {
    content_filter: {
        schema_version: 'cheng-model-pack/v1',
        pack_id: 'pack:cheng-filter-v1',
        model_domain: 'content_filter',
        opset_version: OPSET,
        tensor_layout: LAYOUT,
        quant_policy: QUANT,
        checksum: 'sha256:4de4f4f00595f49e8fbd6b2fd93b7dbef0b4dbc6b85d4e89f61f7f22ebdb3f31',
        signer: PACK_SIGNER,
    },
    speech_asr: {
        schema_version: 'cheng-model-pack/v1',
        pack_id: 'pack:cheng-asr-v1',
        model_domain: 'speech_asr',
        opset_version: OPSET,
        tensor_layout: LAYOUT,
        quant_policy: QUANT,
        checksum: 'sha256:d4404f45aa8d95f8f02915e7196842035ff9658280af0ad7a2fda3298cc54f40',
        signer: PACK_SIGNER,
    },
    background_blur: {
        schema_version: 'cheng-model-pack/v1',
        pack_id: 'pack:cheng-blur-v1',
        model_domain: 'background_blur',
        opset_version: OPSET,
        tensor_layout: LAYOUT,
        quant_policy: QUANT,
        checksum: 'sha256:00c43feebf7f88f4afe34d5d924efd29fd66890f84df7f10f261286eec191a38',
        signer: PACK_SIGNER,
    },
};

export function buildChengRuntimeEnvelope(capability: EdgeCapability, platform: string, options: unknown): ChengRuntimeEnvelope {
    const modelPack = DEFAULT_PACKS[capability];
    const runtimeProfile: ChengRuntimeProfile = {
        schema_version: 'cheng-runtime-profile/v1',
        profile_id: PROFILE_ID,
        platform: platform === 'android' || platform === 'ios' || platform === 'harmony' ? platform : 'web',
        simd_level: platform === 'ios' ? 'simd128' : 'neon',
        memory_budget_mb: 896,
        thread_policy: 'balanced',
        thermal_policy: 'balanced',
    };
    return {
        engine: 'cheng_native',
        graph_id: 'graph:cheng-edge-v1',
        quant_profile: QUANT,
        runtime_profile_id: PROFILE_ID,
        model_pack: modelPack,
        runtime_profile: runtimeProfile,
        rollout: {
            channel: 'stable',
            percent: 100,
            auto_rollback: true,
        },
        options,
    };
}
