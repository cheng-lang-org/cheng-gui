import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateManifestV2 } from '../protocol/UpdateManifestV2';
import { canonicalize, sha256Hex } from '../protocol/UpdateCanonical';
import { generateEd25519Signer } from '../protocol/UpdateSignatureV2';
import {
  buildVrfInput,
  canonicalManifestCore,
  deriveVrfOutput,
  proveVrf,
} from '../protocol/UpdateVrfChainV1';

const {
  downloadArtifactDataMock,
  verifyArtifactHashMock,
  stageArtifactMock,
  applyStagedManifestMock,
  consumeInstallResultMock,
  getInstalledVersionMock,
  openStoreUpgradeMock,
  mockState,
} = vi.hoisted(() => ({
  downloadArtifactDataMock: vi.fn(),
  verifyArtifactHashMock: vi.fn(),
  stageArtifactMock: vi.fn(),
  applyStagedManifestMock: vi.fn(),
  consumeInstallResultMock: vi.fn(),
  getInstalledVersionMock: vi.fn(),
  openStoreUpgradeMock: vi.fn(),
  mockState: {
    transport: null as any,
    manualCheckResult: {
      connectivity_ok: true,
      connected_peers: 1,
      observed_messages: 0,
      authority_sync_ok: true,
      reason: undefined as string | undefined,
    },
  },
}));

vi.mock('../updateApplier', () => ({
  downloadArtifactData: downloadArtifactDataMock,
  verifyArtifactHash: verifyArtifactHashMock,
  stageArtifact: stageArtifactMock,
  applyStagedManifest: applyStagedManifestMock,
  consumeInstallResult: consumeInstallResultMock,
  getInstalledVersion: getInstalledVersionMock,
  openStoreUpgrade: openStoreUpgradeMock,
}));

type MockTransportMessageKind = 'manifest' | 'attestation' | 'revoke' | 'killswitch';
interface MockTransportMessage {
  kind: MockTransportMessageKind;
  raw: unknown;
  topic: string;
  received_at_ms: number;
  source: 'gossipsub' | 'feed_snapshot' | 'feed_peer';
  carrier: 'gossip' | 'feed';
}

vi.mock('../updateTransport', () => ({
  UpdateTransport: class {
    private handlers = new Set<(message: MockTransportMessage) => void>();

    constructor(_: unknown) {
      mockState.transport = this;
    }

    subscribe(handler: (message: MockTransportMessage) => void): () => void {
      this.handlers.add(handler);
      return () => this.handlers.delete(handler);
    }

    async start(): Promise<void> {
      // noop
    }

    async stop(): Promise<void> {
      this.handlers.clear();
    }

    async manualCheck(): Promise<{
      connectivity_ok: boolean;
      connected_peers: number;
      observed_messages: number;
      authority_sync_ok: boolean;
      reason?: string;
    }> {
      return { ...mockState.manualCheckResult };
    }

    emit(message: MockTransportMessage): void {
      for (const handler of this.handlers) {
        handler(message);
      }
    }
  },
}));

import { resetNonceHistoryForTests } from '../updateVerifier';
import { canShowPublisherZone, getUpdateStoreState, resetUpdateStoreForTests } from '../updateStore';
import { manualCheckForUpdates, startUpdateSync, stopUpdateSync } from '../updateSync';

interface ChainNode {
  manifest: UpdateManifestV2;
  manifestHash: string;
  outputHex: string;
}

function makeManifest(sequence: number, sha256: string | null = 'cafebabe'): UpdateManifestV2 {
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
        sha256: sha256 ?? undefined,
        size_bytes: 1024,
        shell_required: false,
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
      vrf: {
        scheme: 'ed25519_sig_vrf_v1',
        publisher_peer_id: 'peer-pub',
        vrf_public_key_hex: '',
        prev_manifest_hash: '0'.repeat(64),
        prev_vrf_output_hex: '0'.repeat(64),
        vrf_input_hex: '0'.repeat(64),
        vrf_proof_base64: '',
        vrf_output_hex: '0'.repeat(64),
      },
    },
    metadata: {
      release_notes: {
        summary: `summary-${sequence}`,
        details: `details-${sequence}`,
        published_at_ms: 1771040000000 + sequence,
      },
    },
  };
}

async function signManifest(
  manifest: UpdateManifestV2,
  signer: { publicKeyHex: string; privateKeyPkcs8: string },
  prevManifestHash: string,
  prevOutputHex: string,
): Promise<ChainNode> {
  const withStatic: UpdateManifestV2 = {
    ...manifest,
    security: {
      ...manifest.security,
      mode: 'vrf_chain_v1',
      vrf: {
        scheme: 'ed25519_sig_vrf_v1',
        publisher_peer_id: 'peer-pub',
        vrf_public_key_hex: signer.publicKeyHex,
        prev_manifest_hash: prevManifestHash,
        prev_vrf_output_hex: prevOutputHex,
        vrf_input_hex: '0'.repeat(64),
        vrf_proof_base64: '',
        vrf_output_hex: '0'.repeat(64),
      },
    },
  };
  const inputHex = await buildVrfInput(canonicalManifestCore(withStatic), {
    channel: withStatic.channel,
    platform: withStatic.platform,
    sequence: withStatic.sequence,
    prev_manifest_hash: prevManifestHash,
    prev_vrf_output_hex: prevOutputHex,
  });
  const proof = await proveVrf(inputHex, signer.privateKeyPkcs8);
  const outputHex = await deriveVrfOutput(proof);
  const signed: UpdateManifestV2 = {
    ...withStatic,
    security: {
      ...withStatic.security,
      vrf: {
        ...withStatic.security.vrf!,
        vrf_input_hex: inputHex,
        vrf_proof_base64: proof,
        vrf_output_hex: outputHex,
      },
    },
  };
  return {
    manifest: signed,
    manifestHash: await sha256Hex(canonicalize(signed)),
    outputHex,
  };
}

async function signControl(
  payload: Record<string, unknown>,
  signer: { publicKeyHex: string; privateKeyPkcs8: string },
  prevManifestHash: string,
  prevOutputHex: string,
): Promise<Record<string, unknown>> {
  const channel = String(payload.channel ?? 'stable');
  const platform = String(payload.platform ?? 'android');
  const sequence = Number(payload.sequence ?? 1);
  const base = {
    ...payload,
    vrf: {
      scheme: 'ed25519_sig_vrf_v1',
      publisher_peer_id: 'peer-pub',
      vrf_public_key_hex: signer.publicKeyHex,
      prev_manifest_hash: prevManifestHash,
      prev_vrf_output_hex: prevOutputHex,
      vrf_input_hex: '0'.repeat(64),
      vrf_proof_base64: '',
      vrf_output_hex: '0'.repeat(64),
    },
  };
  const core = canonicalize({
    ...base,
    channel,
    platform,
    sequence,
    vrf: {
      scheme: 'ed25519_sig_vrf_v1',
      publisher_peer_id: 'peer-pub',
      vrf_public_key_hex: signer.publicKeyHex,
      prev_manifest_hash: prevManifestHash,
      prev_vrf_output_hex: prevOutputHex,
    },
  });
  const inputHex = await buildVrfInput(core, {
    channel,
    platform,
    sequence,
    prev_manifest_hash: prevManifestHash,
    prev_vrf_output_hex: prevOutputHex,
  });
  const proof = await proveVrf(inputHex, signer.privateKeyPkcs8);
  const outputHex = await deriveVrfOutput(proof);
  return {
    ...base,
    sequence,
    vrf: {
      ...(base.vrf as Record<string, unknown>),
      vrf_input_hex: inputHex,
      vrf_proof_base64: proof,
      vrf_output_hex: outputHex,
    },
  };
}

function makeEnvelope(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return sha256Hex(canonicalize(payload)).then((payloadHash) => ({
    kind: 'update_envelope_v2',
    schema_version: 2,
    nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    expires_at_ms: Date.now() + 120_000,
    payload_hash: payloadHash,
    payload,
  }));
}

function emit(
  kind: MockTransportMessageKind,
  raw: unknown,
  source: MockTransportMessage['source'] = 'gossipsub',
): void {
  if (!mockState.transport) {
    throw new Error('mock transport not started');
  }
  mockState.transport.emit({
    kind,
    raw,
    topic: `/unimaker/updates/v2/stable/android/${kind}`,
    received_at_ms: Date.now(),
    source,
    carrier: source === 'gossipsub' ? 'gossip' : 'feed',
  });
}

async function flushAsync(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

describe('update sync vrf state machine', () => {
  let signer: { publicKeyHex: string; privateKeyPkcs8: string };

  beforeEach(async () => {
    await stopUpdateSync();
    resetUpdateStoreForTests();
    resetNonceHistoryForTests();
    mockState.transport = null;
    mockState.manualCheckResult = {
      connectivity_ok: true,
      connected_peers: 1,
      observed_messages: 0,
      authority_sync_ok: true,
      reason: undefined,
    };
    vi.clearAllMocks();
    signer = await generateEd25519Signer();

    downloadArtifactDataMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      source: 'https',
    });
    verifyArtifactHashMock.mockResolvedValue(true);
    stageArtifactMock.mockResolvedValue({ ok: true, stagedPath: '/tmp/staged.bin' });
    applyStagedManifestMock.mockResolvedValue({ ok: true });
    consumeInstallResultMock.mockResolvedValue({ ok: false, status: 'none' });
    getInstalledVersionMock.mockResolvedValue({ ok: false });
    openStoreUpgradeMock.mockResolvedValue({ ok: true });
  });

  afterEach(async () => {
    await stopUpdateSync();
  });

  it('uses installed package as verified latest baseline when no manifest arrives', async () => {
    getInstalledVersionMock.mockResolvedValue({
      ok: true,
      version: '0.0.16',
      versionCode: 22,
    });
    await startUpdateSync({ channel: 'stable', platform: 'android' });
    await flushAsync(2);

    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.sequence).toBe(0);
    expect(snapshot.current_version).toBe('0.0.16');
    expect(snapshot.latest_version).toBe('0.0.16');
    expect(snapshot.latest_manifest_verified).toBe(true);
    expect(snapshot.latest_manifest_source).toBe('installed_package');
    expect(snapshot.vrf_candidate_status).toBe('none');
    expect(canShowPublisherZone('stable', 'android')).toBe(false);
  });

  it('advances when gossip carrier arrives (feed is optional)', async () => {
    const m1 = await signManifest(makeManifest(1), signer, '0'.repeat(64), '0'.repeat(64));
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'gossipsub');
    await flushAsync();

    const state = getUpdateStoreState().snapshot;
    expect(state.sequence).toBe(1);
    expect(state.vrf_candidate_status).toBe('confirmed');
    expect(state.state).toBe('APPLIED');
    expect(downloadArtifactDataMock).toHaveBeenCalledTimes(1);
  });

  it('advances when feed carrier arrives (gossip is optional)', async () => {
    const m1 = await signManifest(makeManifest(1), signer, '0'.repeat(64), '0'.repeat(64));
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync();

    const state = getUpdateStoreState().snapshot;
    expect(state.sequence).toBe(1);
    expect(state.vrf_candidate_status).toBe('confirmed');
    expect(state.state).toBe('APPLIED');
    expect(downloadArtifactDataMock).toHaveBeenCalledTimes(1);
  });

  it('advances and applies after dual carrier confirmation', async () => {
    const m1 = await signManifest(makeManifest(1), signer, '0'.repeat(64), '0'.repeat(64));
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'gossipsub');
    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync(5);

    const state = getUpdateStoreState().snapshot;
    expect(state.sequence).toBe(1);
    expect(state.state).toBe('APPLIED');
    expect(downloadArtifactDataMock).toHaveBeenCalledTimes(1);
  });

  it('blocks sequence gap until missing manifest arrives, then catches up in order', async () => {
    const m1 = await signManifest(makeManifest(1), signer, '0'.repeat(64), '0'.repeat(64));
    const m2 = await signManifest(makeManifest(2), signer, m1.manifestHash, m1.outputHex);
    const m3 = await signManifest(makeManifest(3), signer, m2.manifestHash, m2.outputHex);
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'gossipsub');
    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync(4);
    let state = getUpdateStoreState().snapshot;
    expect(state.sequence).toBe(1);

    emit('manifest', await makeEnvelope(m3.manifest as unknown as Record<string, unknown>), 'gossipsub');
    emit('manifest', await makeEnvelope(m3.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync(4);

    expect((getUpdateStoreState().metrics.update_vrf_gap_block_total ?? 0)).toBeGreaterThan(0);
    expect(getUpdateStoreState().snapshot.vrf_candidate_status).toBe('waiting_history');

    emit('manifest', await makeEnvelope(m2.manifest as unknown as Record<string, unknown>), 'gossipsub');
    emit('manifest', await makeEnvelope(m2.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync(8);

    state = getUpdateStoreState().snapshot;
    expect(state.sequence).toBe(3);
    expect(state.state).toBe('APPLIED');
    expect(downloadArtifactDataMock).toHaveBeenCalledTimes(3);
  });

  it('manual check marks network_unreachable when no connectivity and no candidates', async () => {
    mockState.manualCheckResult = {
      connectivity_ok: false,
      connected_peers: 0,
      observed_messages: 0,
      authority_sync_ok: false,
      reason: 'network_unreachable',
    };
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    await manualCheckForUpdates();

    const state = getUpdateStoreState().snapshot;
    expect(state.last_error).toBe('network_unreachable');
    expect(state.last_manual_check_reason).toBe('network_unreachable');
  });

  it('manual check keeps waiting_history when candidate already exists', async () => {
    const m1 = await signManifest(makeManifest(1), signer, '0'.repeat(64), '0'.repeat(64));
    const m2 = await signManifest(makeManifest(2), signer, m1.manifestHash, m1.outputHex);
    const m3 = await signManifest(makeManifest(3), signer, m2.manifestHash, m2.outputHex);
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'gossipsub');
    await flushAsync(3);

    emit('manifest', await makeEnvelope(m3.manifest as unknown as Record<string, unknown>), 'gossipsub');
    await flushAsync(3);
    expect(getUpdateStoreState().snapshot.vrf_candidate_status).toBe('waiting_history');

    mockState.manualCheckResult = {
      connectivity_ok: false,
      connected_peers: 0,
      observed_messages: 0,
      authority_sync_ok: false,
      reason: 'network_unreachable',
    };

    await manualCheckForUpdates();

    const state = getUpdateStoreState().snapshot;
    expect(state.vrf_candidate_status).toBe('waiting_history');
    expect(state.last_error).toBeUndefined();
    expect(state.last_manual_check_reason).toBe('waiting_history');
  });

  it('accepts first manifest when first received sequence is >1', async () => {
    const m10 = await signManifest(makeManifest(10), signer, '0'.repeat(64), '0'.repeat(64));
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m10.manifest as unknown as Record<string, unknown>), 'gossipsub');
    emit('manifest', await makeEnvelope(m10.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync(4);

    const state = getUpdateStoreState().snapshot;
    expect(state.sequence).toBe(10);
    expect(state.state).toBe('APPLIED');
  });

  it('applies revoke after dual-carrier vrf control validation', async () => {
    const m1 = await signManifest(makeManifest(1), signer, '0'.repeat(64), '0'.repeat(64));
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'gossipsub');
    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync(5);

    const revoke = await signControl(
      {
        kind: 'update_revoke_v2',
        schema_version: 2,
        sequence: 2,
        channel: 'stable',
        platform: 'android',
        manifest_id: m1.manifest.manifest_id,
        reason: 'drill',
        timestamp_ms: Date.now(),
      },
      signer,
      m1.manifestHash,
      m1.outputHex,
    );

    emit('revoke', await makeEnvelope(revoke), 'gossipsub');
    emit('revoke', await makeEnvelope(revoke), 'feed_snapshot');
    await flushAsync(4);
    expect(getUpdateStoreState().snapshot.state).toBe('REVOKED');
  });

  it('fails manifest apply when artifact sha256 is missing', async () => {
    const m1 = await signManifest(makeManifest(1, null), signer, '0'.repeat(64), '0'.repeat(64));
    await startUpdateSync({ channel: 'stable', platform: 'android' });

    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'gossipsub');
    emit('manifest', await makeEnvelope(m1.manifest as unknown as Record<string, unknown>), 'feed_snapshot');
    await flushAsync(5);

    const state = getUpdateStoreState().snapshot;
    expect(state.state).toBe('FAILED');
    expect(['artifact_sha256_missing', 'vrf_input_mismatch']).toContain(state.last_error);
    expect(downloadArtifactDataMock).not.toHaveBeenCalled();
  });
});
