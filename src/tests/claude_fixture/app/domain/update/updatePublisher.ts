import { libp2pService } from '../../libp2p/service';
import { getFeatureFlag } from '../../utils/featureFlags';
import { canonicalize, sha256Hex } from './protocol/UpdateCanonical';
import type { UpdateEnvelopeV2 } from './protocol/UpdateEnvelopeV2';
import type { UpdateKillSwitchV2 } from './protocol/UpdateKillSwitchV2';
import type { UpdateManifestV2, UpdateManifestVrfProofV2 } from './protocol/UpdateManifestV2';
import type { UpdateRevocationV2 } from './protocol/UpdateRevocationV2';
import { generateEd25519Signer } from './protocol/UpdateSignatureV2';
import { buildVrfInput, canonicalManifestCore, deriveVrfOutput, proveVrf } from './protocol/UpdateVrfChainV1';
import { buildUpdateTopics } from './updateTransport';
import { getVrfChainState, setVrfChainState } from './updateStore';

export interface UpdatePublisherSigner {
  publicKeyHex: string;
  privateKeyHex?: string;
  privateKeyPkcs8?: string;
}

export interface UpdatePublishResult {
  ok: boolean;
  pubsub_ok: boolean;
  feed_ok: boolean;
  topic: string;
  error?: string;
}

interface UpdateReleaseNotesPayload {
  summary: string;
  details: string;
  published_at_ms: number;
}

const PUBLISHER_PUBKEY_STORAGE_KEY = 'unimaker_update_vrf_pubkey';
const PUBLISHER_PRIVHEX_STORAGE_KEY = 'unimaker_update_vrf_privhex';
const PUBLISHER_PKCS8_STORAGE_KEY = 'unimaker_update_vrf_pkcs8';
const VRF_SCHEME = 'ed25519_sig_vrf_v1';
let memorySigner: UpdatePublisherSigner | null = null;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(ms)));
  });
}

function hasStorage(): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function'
  );
}

function randomNonce(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `nonce-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function normalizeReleaseNotes(input: unknown): UpdateReleaseNotesPayload | null {
  const row = asRecord(input);
  if (!row) {
    return null;
  }
  const summary = asString(row.summary).trim();
  const details = asString(row.details).trim();
  if (!summary || !details) {
    return null;
  }
  const publishedAtRaw = Number(row.published_at_ms ?? row.publishedAtMs ?? Date.now());
  const publishedAt = Number.isFinite(publishedAtRaw) ? Math.max(0, Math.trunc(publishedAtRaw)) : Date.now();
  return {
    summary,
    details,
    published_at_ms: publishedAt,
  };
}

function ensureManifestReleaseNotes(manifest: UpdateManifestV2): UpdateManifestV2 {
  const metadata = asRecord(manifest.metadata) ?? {};
  const releaseNotes = normalizeReleaseNotes(metadata.release_notes ?? metadata.releaseNotes);
  if (!releaseNotes) {
    throw new Error('release_notes_required');
  }
  return {
    ...manifest,
    metadata: {
      ...metadata,
      release_notes: releaseNotes,
    },
  };
}

async function ensureLibp2pStarted(): Promise<boolean> {
  if (!libp2pService.isNativePlatform()) {
    return true;
  }

  const attempts = 12;
  let lastError = '';
  for (let index = 0; index < attempts; index += 1) {
    const started = await libp2pService.isStarted().catch(() => false);
    if (started) {
      return true;
    }

    if (index > 0) {
      await waitMs(Math.min(300, 40 * index));
    }

    const isStarted = await libp2pService.isStarted().catch(() => false);
    if (!isStarted) {
      await libp2pService.init().catch(() => false);
      const startedByManual = await libp2pService.start().catch(() => false);
      if (!startedByManual) {
        const startError = await libp2pService.getLastError().catch(() => 'start_failed');
        if (startError) {
          lastError = String(startError);
        }
      }
      await waitMs(120 + index * 80);
      continue;
    }

    const confirmStarted = await libp2pService.isStarted().catch(() => false);
    if (confirmStarted) {
      return true;
    }

    await waitMs(Math.min(500, 80 * (index + 1)));
  }

  if (lastError.length > 0) {
    console.warn('[updatePublisher] ensureLibp2pStarted failed', lastError);
    return false;
  }
  console.warn('[updatePublisher] ensureLibp2pStarted failed', 'native_not_ready');
  return false;
}

async function ensureNativePublishContext(): Promise<void> {
  if (!libp2pService.isNativePlatform()) {
    return;
  }
  const nativeService = libp2pService as unknown as {
    reconnectBootstrap?: () => Promise<unknown>;
    boostConnectivity?: () => Promise<unknown>;
    syncPeerstoreState?: () => Promise<unknown>;
  };
  const warmups: Promise<unknown>[] = [];
  if (typeof nativeService.reconnectBootstrap === 'function') {
    warmups.push(nativeService.reconnectBootstrap());
  }
  if (typeof nativeService.boostConnectivity === 'function') {
    warmups.push(nativeService.boostConnectivity());
  }
  if (typeof nativeService.syncPeerstoreState === 'function') {
    warmups.push(nativeService.syncPeerstoreState());
  }
  if (warmups.length > 0) {
    await Promise.allSettled(warmups);
  }

  await libp2pService.subscribeToLocalPeers?.catch?.(() => false);
  const connectedPeers = await libp2pService.getConnectedPeers().catch(() => [] as string[]);
  if (connectedPeers.length === 0) {
    await libp2pService.joinViaRandomBootstrap(3).catch(() => ({} as Record<string, unknown>));
    await libp2pService.reconnectBootstrap().catch(() => false);
  }
}

export function updatePublisherEnabled(): boolean {
  return getFeatureFlag('update_publisher_enabled', false);
}

export function loadVrfPublisherKeypair(): UpdatePublisherSigner | null {
  if (!hasStorage()) {
    return memorySigner ? { ...memorySigner } : null;
  }
  const publicKeyHex = (localStorage.getItem(PUBLISHER_PUBKEY_STORAGE_KEY) ?? '').trim();
  const privateKeyHex = (localStorage.getItem(PUBLISHER_PRIVHEX_STORAGE_KEY) ?? '').trim();
  const privateKeyPkcs8 = (localStorage.getItem(PUBLISHER_PKCS8_STORAGE_KEY) ?? '').trim();
  if (!publicKeyHex || (!privateKeyHex && !privateKeyPkcs8)) {
    return null;
  }
  const out: UpdatePublisherSigner = {
    publicKeyHex,
    ...(privateKeyHex ? { privateKeyHex } : {}),
    ...(privateKeyPkcs8 ? { privateKeyPkcs8 } : {}),
  };
  return out;
}

function saveVrfPublisherKeypair(input: UpdatePublisherSigner): void {
  const publicKeyHex = input.publicKeyHex.trim();
  const privateKeyHex = input.privateKeyHex?.trim() ?? '';
  const privateKeyPkcs8 = input.privateKeyPkcs8?.trim() ?? '';
  if (!publicKeyHex || (!privateKeyHex && !privateKeyPkcs8)) {
    throw new Error('publisher_signer_invalid');
  }
  if (!hasStorage()) {
    memorySigner = {
      publicKeyHex,
      ...(privateKeyHex ? { privateKeyHex } : {}),
      ...(privateKeyPkcs8 ? { privateKeyPkcs8 } : {}),
    };
    return;
  }
  localStorage.setItem(PUBLISHER_PUBKEY_STORAGE_KEY, publicKeyHex);
  if (privateKeyHex) {
    localStorage.setItem(PUBLISHER_PRIVHEX_STORAGE_KEY, privateKeyHex);
    localStorage.removeItem(PUBLISHER_PKCS8_STORAGE_KEY);
    return;
  }
  localStorage.setItem(PUBLISHER_PKCS8_STORAGE_KEY, privateKeyPkcs8);
  localStorage.removeItem(PUBLISHER_PRIVHEX_STORAGE_KEY);
}

export async function loadOrCreateVrfPublisherKeypair(): Promise<UpdatePublisherSigner> {
  const isNative = libp2pService.isNativePlatform();
  const existing = loadVrfPublisherKeypair();
  if (existing && (existing.privateKeyHex || existing.privateKeyPkcs8)) {
    return existing;
  }

  if (isNative) {
    try {
      const native = await libp2pService.vrfGenerateKeypair();
      const publicKeyHex = native.publicKeyHex?.trim().toLowerCase() ?? '';
      const privateKeyHex = native.privateKeyHex?.trim().toLowerCase() ?? '';
      if (!native.ok || !publicKeyHex || !privateKeyHex) {
        throw new Error(native.error ?? 'vrf_keypair_generate_failed');
      }
      const signer: UpdatePublisherSigner = {
        publicKeyHex,
        privateKeyHex,
      };
      saveVrfPublisherKeypair(signer);
      return signer;
    } catch (error) {
      console.warn(
        '[updatePublisher] native keypair generation failed, fallback to js signer',
        error instanceof Error ? error.message : 'native_generate_failed',
      );
    }
  }

  const generated = await generateEd25519Signer();
  const signer: UpdatePublisherSigner = {
    publicKeyHex: generated.publicKeyHex,
    privateKeyPkcs8: generated.privateKeyPkcs8,
  };
  saveVrfPublisherKeypair(signer);
  return signer;
}

export function clearVrfPublisherKeypair(): void {
  if (!hasStorage()) {
    memorySigner = null;
    return;
  }
  localStorage.removeItem(PUBLISHER_PUBKEY_STORAGE_KEY);
  localStorage.removeItem(PUBLISHER_PRIVHEX_STORAGE_KEY);
  localStorage.removeItem(PUBLISHER_PKCS8_STORAGE_KEY);
}

function resolveSignerPrivateKeyMaterial(signer: UpdatePublisherSigner): string {
  const privateKeyHex = signer.privateKeyHex?.trim();
  if (privateKeyHex) {
    return `hex:${privateKeyHex.toLowerCase()}`;
  }
  const privateKeyPkcs8 = signer.privateKeyPkcs8?.trim();
  if (privateKeyPkcs8) {
    return privateKeyPkcs8;
  }
  throw new Error('publisher_private_key_missing');
}

async function buildEnvelope(
  payload: Record<string, unknown>,
  expiresInMs: number,
): Promise<UpdateEnvelopeV2> {
  const expiresAt = Date.now() + Math.max(30_000, expiresInMs);
  const payloadHash = await sha256Hex(canonicalize(payload));
  return {
    kind: 'update_envelope_v2',
    schema_version: 2,
    nonce: randomNonce(),
    expires_at_ms: expiresAt,
    payload_hash: payloadHash,
    signer: undefined,
    signature: undefined,
    payload,
  };
}

async function resolvePublisherPeerId(): Promise<string> {
  const peerId = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
  if (peerId) {
    return peerId;
  }
  return 'local-node';
}

async function buildManifestVrf(
  manifest: UpdateManifestV2,
  signer: UpdatePublisherSigner,
  publisherPeerId: string,
  channel: string,
  platform: string,
): Promise<{ manifest: UpdateManifestV2; vrf: UpdateManifestVrfProofV2; manifestHash: string }> {
  const head = getVrfChainState(channel, platform);
  const prevManifestHash = head.last_manifest_hash;
  const prevVrfOutputHex = head.last_vrf_output_hex;
  const candidateSecurityVrf: UpdateManifestVrfProofV2 = {
    scheme: VRF_SCHEME,
    publisher_peer_id: publisherPeerId,
    vrf_public_key_hex: signer.publicKeyHex.toLowerCase(),
    prev_manifest_hash: prevManifestHash,
    prev_vrf_output_hex: prevVrfOutputHex,
    vrf_input_hex: '0'.repeat(64),
    vrf_proof_base64: '',
    vrf_output_hex: '0'.repeat(64),
  };

  const normalized: UpdateManifestV2 = {
    ...manifest,
    channel,
    platform,
    security: {
      ...manifest.security,
      mode: 'vrf_chain_v1',
      threshold: 0,
      committee_keys: [],
      signatures: [],
      publisher_pubkey: undefined,
      next_publisher_pubkey_sha256: undefined,
      attestation_threshold: Math.max(0, Math.trunc(Number(manifest.security.attestation_threshold ?? 0))),
      vrf: candidateSecurityVrf,
    },
  };

  const inputHex = await buildVrfInput(canonicalManifestCore(normalized), {
    channel,
    platform,
    sequence: normalized.sequence,
    prev_manifest_hash: prevManifestHash,
    prev_vrf_output_hex: prevVrfOutputHex,
  });
  const proofBase64 = await proveVrf(inputHex, resolveSignerPrivateKeyMaterial(signer));
  const outputHex = await deriveVrfOutput(proofBase64);
  const signedManifest: UpdateManifestV2 = {
    ...normalized,
    security: {
      ...normalized.security,
      vrf: {
        ...candidateSecurityVrf,
        vrf_input_hex: inputHex,
        vrf_proof_base64: proofBase64,
        vrf_output_hex: outputHex,
      },
    },
  };

  return {
    manifest: signedManifest,
    vrf: signedManifest.security.vrf!,
    manifestHash: await sha256Hex(canonicalize(signedManifest)),
  };
}

async function buildControlVrfPayload<T extends Record<string, unknown>>(
  payload: T,
  signer: UpdatePublisherSigner,
  publisherPeerId: string,
  channel: string,
  platform: string,
): Promise<T> {
  const head = getVrfChainState(channel, platform);
  const nextSequenceRaw = Number(payload.sequence ?? (head.last_sequence + 1));
  const sequence = Number.isFinite(nextSequenceRaw)
    ? Math.max(head.last_sequence + 1, Math.trunc(nextSequenceRaw))
    : head.last_sequence + 1;
  const basePayload = {
    ...payload,
    channel,
    platform,
    sequence,
  } as Record<string, unknown>;

  const vrfWithoutRuntime: UpdateManifestVrfProofV2 = {
    scheme: VRF_SCHEME,
    publisher_peer_id: publisherPeerId,
    vrf_public_key_hex: signer.publicKeyHex.toLowerCase(),
    prev_manifest_hash: head.last_manifest_hash,
    prev_vrf_output_hex: head.last_vrf_output_hex,
    vrf_input_hex: '0'.repeat(64),
    vrf_proof_base64: '',
    vrf_output_hex: '0'.repeat(64),
  };
  const core = canonicalize({
    ...basePayload,
    vrf: {
      scheme: vrfWithoutRuntime.scheme,
      publisher_peer_id: vrfWithoutRuntime.publisher_peer_id,
      vrf_public_key_hex: vrfWithoutRuntime.vrf_public_key_hex,
      prev_manifest_hash: vrfWithoutRuntime.prev_manifest_hash,
      prev_vrf_output_hex: vrfWithoutRuntime.prev_vrf_output_hex,
    },
  });
  const inputHex = await buildVrfInput(core, {
    channel,
    platform,
    sequence,
    prev_manifest_hash: head.last_manifest_hash,
    prev_vrf_output_hex: head.last_vrf_output_hex,
  });
  const proofBase64 = await proveVrf(inputHex, resolveSignerPrivateKeyMaterial(signer));
  const outputHex = await deriveVrfOutput(proofBase64);

  return {
    ...basePayload,
    vrf: {
      ...vrfWithoutRuntime,
      vrf_input_hex: inputHex,
      vrf_proof_base64: proofBase64,
      vrf_output_hex: outputHex,
    },
  } as T;
}

async function publishEnvelope(topic: string, envelope: UpdateEnvelopeV2): Promise<UpdatePublishResult> {
  const wire = JSON.stringify(envelope);

  const publishGossipWithRetry = async (): Promise<{ ok: boolean; lastError?: string }> => {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await libp2pService.pubsubSubscribe(topic).catch(() => false);
      const ok = await libp2pService.pubsubPublish(topic, wire).catch(() => false);
      if (ok) {
        return { ok: true };
      }
      const currentError = (await libp2pService.getLastError().catch(() => '')).trim();
      if (currentError.toLowerCase().includes('topic_not_joined')) {
        await libp2pService.pubsubSubscribe(topic).catch(() => false);
      }
      if (currentError && !currentError.includes('native_not_ready') && !currentError.includes('node not started')) {
        lastError = currentError;
      }
      if (attempt < 2) {
        if (libp2pService.isNativePlatform()) {
          await ensureLibp2pStarted().catch(() => false);
          await ensureNativePublishContext();
        }
        await waitMs(120 * (attempt + 1));
      }
    }
    return { ok: false, lastError: lastError || 'pubsub_publish_failed' };
  };

  const publishFeedWithRetry = async (): Promise<{ ok: boolean; lastError?: string }> => {
    let lastError = '';
    const feedEntry = {
      type: 'content_feed_item',
      topic,
      payload: wire,
      ts: Date.now(),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ok = await libp2pService.feedPublishEntry(feedEntry).catch(() => false);
      if (ok) {
        return { ok: true };
      }
      const currentError = (await libp2pService.getLastError().catch(() => '')).trim();
      if (currentError && !currentError.includes('native_not_ready') && !currentError.includes('node not started')) {
        lastError = currentError;
      }
      if (attempt < 2) {
        if (libp2pService.isNativePlatform()) {
          await ensureLibp2pStarted().catch(() => false);
          await ensureNativePublishContext();
        }
        await waitMs(120 * (attempt + 1));
      }
    }
    return { ok: false, lastError: lastError || 'feed_publish_failed' };
  };

  if (libp2pService.isNativePlatform()) {
    try {
      await ensureLibp2pStarted().catch(() => false);
      await ensureNativePublishContext();
    } catch (error) {
      const reason = error instanceof Error ? error.message : `${error}`;
      return {
        ok: false,
        pubsub_ok: false,
        feed_ok: false,
        topic,
        error: `native_not_ready${reason ? ` (${reason})` : ''}`,
      };
    }
  }

  const [gossipResult, feedResult] = await Promise.all([
    publishGossipWithRetry(),
    publishFeedWithRetry(),
  ]);
  const pubsub = gossipResult.ok;
  const feed = feedResult.ok;

  const errors: string[] = [];
  if (!pubsub && gossipResult.lastError) {
    errors.push(`gossip:${gossipResult.lastError}`);
  }
  if (!feed && feedResult.lastError) {
    errors.push(`feed:${feedResult.lastError}`);
  }
  const errorSuffix = errors.length > 0 ? ` (${errors.join('; ')})` : '';

  const strictCarrierOk = pubsub;
  let normalizedError: string | undefined;
  if (!strictCarrierOk) {
    const normalizedErrorText = errors.join(' ').toLowerCase();
    const connectedPeers = await libp2pService.getConnectedPeers().catch(() => [] as string[]);
    if (normalizedErrorText.includes('native_not_ready') || normalizedErrorText.includes('node not started')) {
      normalizedError = `native_not_ready${errorSuffix}`;
    } else if (
      connectedPeers.length === 0
      || normalizedErrorText.includes('network')
      || normalizedErrorText.includes('unreachable')
      || normalizedErrorText.includes('dial')
      || normalizedErrorText.includes('bootstrap')
    ) {
      normalizedError = `network_unreachable${errorSuffix}`;
    } else {
      normalizedError = `missing_carrier:gossip${errorSuffix}`;
    }
  }

  return {
    ok: strictCarrierOk,
    pubsub_ok: pubsub,
    feed_ok: feed,
    topic,
    error: normalizedError,
  };
}

export async function publishManifest(options: {
  manifest: UpdateManifestV2;
  channel?: string;
  platform?: string;
  expiresInMs?: number;
}): Promise<UpdatePublishResult> {
  const channel = options.channel?.trim() || options.manifest.channel;
  const platform = options.platform?.trim() || options.manifest.platform;
  const topic = buildUpdateTopics(channel, platform).manifest;
  const manifestWithReleaseNotes = ensureManifestReleaseNotes(options.manifest);
  const signer = await loadOrCreateVrfPublisherKeypair();
  const publisherPeerId = await resolvePublisherPeerId();
  const vrfResult = await buildManifestVrf(manifestWithReleaseNotes, signer, publisherPeerId, channel, platform);
  const envelope = await buildEnvelope(vrfResult.manifest as unknown as Record<string, unknown>, options.expiresInMs ?? 5 * 60_000);
  const result = await publishEnvelope(topic, envelope);
  if (result.ok) {
    setVrfChainState(channel, platform, {
      last_sequence: vrfResult.manifest.sequence,
      last_manifest_hash: vrfResult.manifestHash,
      last_vrf_output_hex: vrfResult.vrf.vrf_output_hex,
    });
  }
  return result;
}

export async function publishRevoke(options: {
  payload: UpdateRevocationV2;
  channel?: string;
  platform?: string;
  expiresInMs?: number;
}): Promise<UpdatePublishResult> {
  const channel = options.channel?.trim() || options.payload.channel?.trim() || 'stable';
  const platform = options.platform?.trim() || options.payload.platform?.trim() || 'android';
  const topic = buildUpdateTopics(channel, platform).revoke;
  const signer = await loadOrCreateVrfPublisherKeypair();
  const publisherPeerId = await resolvePublisherPeerId();
  const payload = await buildControlVrfPayload(options.payload as unknown as Record<string, unknown>, signer, publisherPeerId, channel, platform);
  const envelope = await buildEnvelope(payload, options.expiresInMs ?? 2 * 60_000);
  return publishEnvelope(topic, envelope);
}

export async function publishKillSwitch(options: {
  payload: UpdateKillSwitchV2;
  channel?: string;
  platform?: string;
  expiresInMs?: number;
}): Promise<UpdatePublishResult> {
  const channel = options.channel?.trim() || options.payload.channel?.trim() || 'stable';
  const platform = options.platform?.trim() || options.payload.platform?.trim() || 'android';
  const topic = buildUpdateTopics(channel, platform).killswitch;
  const signer = await loadOrCreateVrfPublisherKeypair();
  const publisherPeerId = await resolvePublisherPeerId();
  const payload = await buildControlVrfPayload(options.payload as unknown as Record<string, unknown>, signer, publisherPeerId, channel, platform);
  const envelope = await buildEnvelope(payload, options.expiresInMs ?? 2 * 60_000);
  return publishEnvelope(topic, envelope);
}
