import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UpdateManifestV2 } from '../protocol/UpdateManifestV2';
import { verifyVrf } from '../protocol/UpdateVrfChainV1';

const mock = vi.hoisted(() => ({
  lastPubsubTopic: '',
  lastPubsubPayload: '',
  lastFeedPayload: null as Record<string, unknown> | null,
  localPeerId: 'peer-test',
  native: false,
  failFirstPubsub: false,
  failAllPubsub: false,
  failFeedPublish: false,
  pubsubPublishCalls: 0,
  pubsubSubscribeCalls: 0,
  reconnectCalls: 0,
  boostCalls: 0,
  syncCalls: 0,
  joinCalls: 0,
  lastError: '',
}));

vi.mock('../../../libp2p/service', () => ({
  libp2pService: {
    isNativePlatform: () => mock.native,
    isStarted: async () => true,
    init: async () => true,
    start: async () => true,
    pubsubPublish: async (topic: string, payload: string) => {
      mock.pubsubPublishCalls += 1;
      mock.lastPubsubTopic = topic;
      mock.lastPubsubPayload = payload;
      if (mock.failAllPubsub) {
        mock.lastError = 'network_unreachable';
        return false;
      }
      if (mock.failFirstPubsub && mock.pubsubPublishCalls === 1) {
        mock.lastError = 'topic_not_joined';
        return false;
      }
      return true;
    },
    pubsubSubscribe: async () => {
      mock.pubsubSubscribeCalls += 1;
      return true;
    },
    reconnectBootstrap: async () => {
      mock.reconnectCalls += 1;
      return true;
    },
    boostConnectivity: async () => {
      mock.boostCalls += 1;
      return true;
    },
    syncPeerstoreState: async () => {
      mock.syncCalls += 1;
      return {};
    },
    getConnectedPeers: async () => [],
    joinViaRandomBootstrap: async () => {
      mock.joinCalls += 1;
      return { ok: true, connectedCount: 1 };
    },
    vrfGenerateKeypair: async () => ({
      ok: true,
      publicKeyHex: '11'.repeat(32),
      privateKeyHex: '22'.repeat(32),
    }),
    vrfSign: async () => ({
      ok: true,
      signatureBase64: 'AQ==',
    }),
    vrfVerify: async () => ({
      ok: true,
      valid: true,
    }),
    feedPublishEntry: async (payload: Record<string, unknown>) => {
      mock.lastFeedPayload = payload;
      if (mock.failFeedPublish) {
        mock.lastError = 'feed_unreachable';
        return false;
      }
      return true;
    },
    getLocalPeerId: async () => mock.localPeerId,
    getLastError: async () => mock.lastError,
  },
}));

vi.mock('../../../utils/featureFlags', () => ({
  getFeatureFlag: () => true,
}));

import { clearVrfPublisherKeypair, publishManifest } from '../updatePublisher';

function makeManifest(sequence: number): UpdateManifestV2 {
  return {
    kind: 'manifest_v2',
    schema_version: 2,
    manifest_id: `mf-${sequence}`,
    channel: 'stable',
    platform: 'android',
    sequence,
    version: `0.0.${sequence}`,
    version_code: sequence,
    artifacts: [
      {
        platform: 'android',
        kind: 'full',
        uri: 'p2p://unimaker/updates/stable/android/full',
        sha256: 'cafebabe',
        size_bytes: 1024,
        shell_required: true,
      },
    ],
    rollout: {
      percent: 100,
      emergency: false,
      stages: [1, 10, 50, 100],
    },
    policy: {
      mandatory: false,
    },
    security: {
      mode: 'vrf_chain_v1',
      threshold: 0,
      committee_keys: [],
      signatures: [],
      attestation_threshold: 0,
    },
    metadata: {
      release_notes: {
        summary: '修复卡顿',
        details: '优化同步链路',
        published_at_ms: 1771040000000,
      },
    },
  };
}

describe('update publisher vrf', () => {
  beforeEach(() => {
    mock.lastFeedPayload = null;
    mock.lastPubsubPayload = '';
    mock.lastPubsubTopic = '';
    mock.native = false;
    mock.failFirstPubsub = false;
    mock.failAllPubsub = false;
    mock.failFeedPublish = false;
    mock.pubsubPublishCalls = 0;
    mock.pubsubSubscribeCalls = 0;
    mock.reconnectCalls = 0;
    mock.boostCalls = 0;
    mock.syncCalls = 0;
    mock.joinCalls = 0;
    mock.lastError = '';
    clearVrfPublisherKeypair();
  });

  it('rejects manifest publish when release notes are missing', async () => {
    const manifest = makeManifest(41);
    manifest.metadata = {};

    await expect(publishManifest({
      manifest,
      channel: 'stable',
      platform: 'android',
    })).rejects.toThrow('release_notes_required');
  });

  it('auto-generates vrf proof and publishes via pubsub', async () => {
    const manifest = makeManifest(42);

    const result = await publishManifest({
      manifest,
      channel: 'stable',
      platform: 'android',
    });

    expect(result.ok).toBe(true);
    expect(result.feed_ok).toBe(true);
    expect(result.pubsub_ok).toBe(true);
    expect(mock.lastPubsubTopic).toBe('/unimaker/updates/v2/stable/android/manifest');
    expect(mock.pubsubSubscribeCalls).toBeGreaterThan(0);
    expect(mock.lastFeedPayload).toMatchObject({
      topic: '/unimaker/updates/v2/stable/android/manifest',
    });

    const envelopeFromPubsub = JSON.parse(mock.lastPubsubPayload) as Record<string, unknown>;
    expect(envelopeFromPubsub.signer).toBeUndefined();
    const payload = envelopeFromPubsub.payload as Record<string, unknown>;
    const security = payload.security as Record<string, unknown>;
    expect(security.mode).toBe('vrf_chain_v1');
    const vrf = security.vrf as Record<string, unknown>;
    expect(String(vrf.publisher_peer_id ?? '')).toBe('peer-test');
    expect(String(vrf.vrf_public_key_hex ?? '').length).toBe(64);
    expect(String(vrf.vrf_input_hex ?? '').length).toBe(64);
    expect(String(vrf.vrf_output_hex ?? '').length).toBe(64);

    const verify = await verifyVrf(
      String(vrf.vrf_input_hex ?? ''),
      String(vrf.vrf_proof_base64 ?? ''),
      String(vrf.vrf_public_key_hex ?? ''),
    );
    expect(verify).toBe(true);
  });

  it('retries gossip publish on native and succeeds after warmup', async () => {
    mock.native = true;
    mock.failFirstPubsub = true;

    const result = await publishManifest({
      manifest: makeManifest(43),
      channel: 'stable',
      platform: 'android',
    });

    expect(result.ok).toBe(true);
    expect(result.pubsub_ok).toBe(true);
    expect(result.feed_ok).toBe(true);
    expect(mock.pubsubPublishCalls).toBeGreaterThan(1);
    expect(mock.reconnectCalls + mock.boostCalls + mock.syncCalls).toBeGreaterThan(0);
  });

  it('fails publish when gossip fails even if feed succeeds', async () => {
    mock.failAllPubsub = true;
    mock.failFeedPublish = false;

    const result = await publishManifest({
      manifest: makeManifest(44),
      channel: 'stable',
      platform: 'android',
    });

    expect(result.ok).toBe(false);
    expect(result.pubsub_ok).toBe(false);
    expect(result.feed_ok).toBe(true);
    expect((result.error ?? '').includes('missing_carrier:gossip') || (result.error ?? '').includes('network_unreachable')).toBe(true);
  });

  it('succeeds when gossip succeeds even if feed fails', async () => {
    mock.failAllPubsub = false;
    mock.failFeedPublish = true;

    const result = await publishManifest({
      manifest: makeManifest(45),
      channel: 'stable',
      platform: 'android',
    });

    expect(result.ok).toBe(true);
    expect(result.pubsub_ok).toBe(true);
    expect(result.feed_ok).toBe(false);
  });
});
