import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalize } from '../protocol/UpdateCanonical';
import {
  extractManifestReleaseNotes,
  manifestFromUnknown,
  type UpdateManifestV2,
} from '../protocol/UpdateManifestV2';
import { parseKillSwitchV2, killSwitchAppliesTo, killSwitchIsActive } from '../protocol/UpdateKillSwitchV2';
import { parseRevocationV2, revocationAppliesToManifest } from '../protocol/UpdateRevocationV2';
import {
  registerEnvelopeNonce,
  resetNonceHistoryForTests,
  resolveSequenceConflict,
  verifyManifestSecurity,
} from '../updateVerifier';
import { markApplied, resetUpdateStoreForTests } from '../updateStore';
import { generateEd25519Signer } from '../protocol/UpdateSignatureV2';
import {
  buildVrfInput,
  canonicalManifestCore,
  deriveVrfOutput,
  proveVrf,
  verifyVrf,
} from '../protocol/UpdateVrfChainV1';

function makeBaseManifest(sequence: number): UpdateManifestV2 {
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
        sha256: 'abc',
        size_bytes: 123,
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
  };
}

async function signVrfManifest(
  manifest: UpdateManifestV2,
  signer: { publicKeyHex: string; privateKeyPkcs8: string },
  prevManifestHash = '0'.repeat(64),
  prevVrfOutput = '0'.repeat(64),
): Promise<UpdateManifestV2> {
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
        prev_vrf_output_hex: prevVrfOutput,
        vrf_input_hex: '0'.repeat(64),
        vrf_proof_base64: '',
        vrf_output_hex: '0'.repeat(64),
      },
    },
  };
  const input = await buildVrfInput(canonicalManifestCore(withStatic), {
    channel: withStatic.channel,
    platform: withStatic.platform,
    sequence: withStatic.sequence,
    prev_manifest_hash: prevManifestHash,
    prev_vrf_output_hex: prevVrfOutput,
  });
  const proof = await proveVrf(input, signer.privateKeyPkcs8);
  const output = await deriveVrfOutput(proof);
  return {
    ...withStatic,
    security: {
      ...withStatic.security,
      vrf: {
        ...withStatic.security.vrf!,
        vrf_input_hex: input,
        vrf_proof_base64: proof,
        vrf_output_hex: output,
      },
    },
  };
}

describe('update protocol v2 vrf', () => {
  beforeEach(() => {
    resetUpdateStoreForTests();
    resetNonceHistoryForTests();
  });

  it('canonical serialization is stable with key sorting', () => {
    const a = canonicalize({ b: 1, a: { y: 2, x: 1 } });
    const b = canonicalize({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe('{"a":{"x":1,"y":2},"b":1}');
    expect(a).toBe(b);
  });

  it('builds deterministic vrf input for same manifest core', async () => {
    const signer = await generateEd25519Signer();
    const manifest = await signVrfManifest(makeBaseManifest(1), signer);
    const inputA = await buildVrfInput(canonicalManifestCore(manifest), {
      channel: manifest.channel,
      platform: manifest.platform,
      sequence: manifest.sequence,
      prev_manifest_hash: manifest.security.vrf!.prev_manifest_hash,
      prev_vrf_output_hex: manifest.security.vrf!.prev_vrf_output_hex,
    });
    const inputB = await buildVrfInput(canonicalManifestCore(manifest), {
      channel: manifest.channel,
      platform: manifest.platform,
      sequence: manifest.sequence,
      prev_manifest_hash: manifest.security.vrf!.prev_manifest_hash,
      prev_vrf_output_hex: manifest.security.vrf!.prev_vrf_output_hex,
    });
    expect(inputA).toBe(inputB);
  });

  it('verifies vrf proof and rejects tampered proof', async () => {
    const signer = await generateEd25519Signer();
    const manifest = await signVrfManifest(makeBaseManifest(2), signer);
    const vrf = manifest.security.vrf!;
    const ok = await verifyVrf(vrf.vrf_input_hex, vrf.vrf_proof_base64, vrf.vrf_public_key_hex);
    expect(ok).toBe(true);

    const tampered = `${vrf.vrf_proof_base64.slice(0, -2)}AA`;
    const bad = await verifyVrf(vrf.vrf_input_hex, tampered, vrf.vrf_public_key_hex);
    expect(bad).toBe(false);
  });

  it('rejects replayed nonce', () => {
    const nonce = `nonce-${Date.now()}`;
    expect(registerEnvelopeNonce(nonce, Date.now() + 60_000)).toBe(true);
    expect(registerEnvelopeNonce(nonce, Date.now() + 60_000)).toBe(false);
  });

  it('rejects rollback sequence/version under vrf mode', async () => {
    const signer = await generateEd25519Signer();
    const applied = await signVrfManifest(makeBaseManifest(10), signer);
    markApplied(applied);
    const rollback = await signVrfManifest(
      {
        ...makeBaseManifest(9),
        version: '0.0.9',
        version_code: 9,
      },
      signer,
    );
    const result = await verifyManifestSecurity(rollback);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('rollback_rejected');
  });

  it('resolves same-sequence conflicts by smallest vrf_output', () => {
    const winner = resolveSequenceConflict([
      { sequence: 7, vrf_output_hex: 'f0' },
      { sequence: 7, vrf_output_hex: '0a' },
      { sequence: 7, vrf_output_hex: 'aa' },
    ]);
    expect(winner?.vrf_output_hex).toBe('0a');
  });

  it('maps legacy v1 payload into manifest v2', () => {
    const legacy = {
      versionCode: 12,
      versionName: '1.2.0',
      url: 'https://example.com/full.apk',
      sha256: 'cafebabe',
      channel: 'stable',
      percent: 50,
    };
    const manifest = manifestFromUnknown(legacy);
    expect(manifest).not.toBeNull();
    expect(manifest?.schema_version).toBe(2);
    expect(manifest?.artifacts[0].uri).toBe('https://example.com/full.apk');
    expect(manifest?.rollout.percent).toBe(50);
  });

  it('extracts release notes from manifest metadata', () => {
    const manifest = manifestFromUnknown({
      ...makeBaseManifest(30),
      metadata: {
        release_notes: {
          summary: '修复卡顿',
          details: '优化同步和下载路径',
          published_at_ms: 1771040000000,
        },
      },
    });
    expect(manifest).not.toBeNull();
    expect(extractManifestReleaseNotes(manifest)).toEqual({
      summary: '修复卡顿',
      details: '优化同步和下载路径',
      published_at_ms: 1771040000000,
    });
  });

  it('parses revoke and killswitch messages and applies scope checks', () => {
    const manifest = makeBaseManifest(20);
    const revoke = parseRevocationV2({
      kind: 'update_revoke_v2',
      manifest_id: 'mf-20',
      channel: 'stable',
      platform: 'android',
      sequence: 21,
      reason: 'drill',
      vrf: {
        scheme: 'ed25519_sig_vrf_v1',
        publisher_peer_id: 'peer-a',
        vrf_public_key_hex: '1'.repeat(64),
        prev_manifest_hash: '0'.repeat(64),
        prev_vrf_output_hex: '0'.repeat(64),
        vrf_input_hex: '2'.repeat(64),
        vrf_proof_base64: 'AA==',
        vrf_output_hex: '3'.repeat(64),
      },
    });
    const kill = parseKillSwitchV2({
      kind: 'update_killswitch_v2',
      channel: 'stable',
      platform: 'android',
      enabled: true,
      issued_at_ms: Date.now(),
      sequence: 22,
      vrf: {
        scheme: 'ed25519_sig_vrf_v1',
        publisher_peer_id: 'peer-a',
        vrf_public_key_hex: '1'.repeat(64),
        prev_manifest_hash: '0'.repeat(64),
        prev_vrf_output_hex: '0'.repeat(64),
        vrf_input_hex: '2'.repeat(64),
        vrf_proof_base64: 'AA==',
        vrf_output_hex: '3'.repeat(64),
      },
    });

    expect(revoke).not.toBeNull();
    expect(kill).not.toBeNull();
    expect(revocationAppliesToManifest(revoke!, manifest)).toBe(true);
    expect(killSwitchAppliesTo(kill!, manifest.channel, manifest.platform)).toBe(true);
    expect(killSwitchIsActive(kill!)).toBe(true);
  });
});
