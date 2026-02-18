import {
  envelopeIsExpired,
  envelopePayloadHashMatches,
  type UpdateEnvelopeV2,
} from './protocol/UpdateEnvelopeV2';
import type { UpdateManifestV2 } from './protocol/UpdateManifestV2';
import { verifyEnvelopeSignature } from './protocol/UpdateSignatureV2';
import {
  buildVrfInput,
  canonicalManifestCore,
  deriveVrfOutput,
  hashManifestForChain,
  verifyVrf,
} from './protocol/UpdateVrfChainV1';
import { sha256Hex } from './protocol/UpdateCanonical';
import { getScopedVersionState, getUpdateStoreState, maxAppliedSequence } from './updateStore';
import { compareVersionVector, normalizeVersionCode } from './updateVersion';

const NONCE_STORAGE_KEY = 'unimaker_update_nonce_history_v2';
const DEVICE_ID_STORAGE_KEY = 'unimaker_update_device_id';
const NONCE_CAPACITY = 10_000;
const NONCE_TTL_MS = 24 * 60 * 60 * 1000;
const GENESIS_PREV_MANIFEST_HASH =
  String(import.meta.env.VITE_UPDATE_VRF_GENESIS_PREV_MANIFEST_HASH ?? '').trim().toLowerCase() || '0'.repeat(64);
const GENESIS_PREV_OUTPUT_HEX =
  String(import.meta.env.VITE_UPDATE_VRF_GENESIS_PREV_OUTPUT_HEX ?? '').trim().toLowerCase() || '0'.repeat(64);

interface NonceRecord {
  nonce: string;
  seen_at_ms: number;
  expires_at_ms: number;
}

export interface VrfChainHeadState {
  last_sequence: number;
  last_manifest_hash: string;
  last_vrf_output_hex: string;
}

export interface VerifyEnvelopeSecurityOptions {
  requireSignature?: boolean;
}

export interface VerifyManifestSecurityOptions {
  legacySignatureAccept?: boolean;
}

export interface VerifyVrfChainOptions {
  strictContiguous?: boolean;
  genesisPrevManifestHash?: string;
  genesisPrevOutputHex?: string;
}

export interface VrfCandidateVerificationResult {
  ok: boolean;
  reason?: string;
  manifest_hash?: string;
  vrf_output_hex?: string;
  sequence?: number;
}

export interface VrfConflictCandidate {
  sequence: number;
  vrf_output_hex: string;
}

let memoryNonceRecords: NonceRecord[] = [];

function hasStorage(): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function'
  );
}

function readNonceRecords(): NonceRecord[] {
  if (!hasStorage()) {
    return memoryNonceRecords.map((item) => ({ ...item }));
  }
  try {
    const raw = localStorage.getItem(NONCE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }
        const row = item as Record<string, unknown>;
        const nonce = String(row.nonce ?? '').trim();
        if (!nonce) {
          return null;
        }
        const seenAt = Number(row.seen_at_ms ?? 0);
        const expiresAt = Number(row.expires_at_ms ?? 0);
        return {
          nonce,
          seen_at_ms: Number.isFinite(seenAt) ? Math.trunc(seenAt) : 0,
          expires_at_ms: Number.isFinite(expiresAt) ? Math.trunc(expiresAt) : 0,
        } as NonceRecord;
      })
      .filter((item): item is NonceRecord => item !== null);
  } catch {
    return [];
  }
}

function writeNonceRecords(records: NonceRecord[]): void {
  if (!hasStorage()) {
    memoryNonceRecords = records.map((item) => ({ ...item }));
    return;
  }
  localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify(records));
}

function pruneNonces(records: NonceRecord[], nowMs: number): NonceRecord[] {
  return records.filter((record) => {
    if (nowMs - record.seen_at_ms > NONCE_TTL_MS) {
      return false;
    }
    if (record.expires_at_ms > 0 && nowMs > record.expires_at_ms) {
      return false;
    }
    return true;
  });
}

function normalizeHash(input: string | undefined, fallback: string): string {
  const normalized = (input ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  return fallback;
}

export function defaultVrfChainHeadState(): VrfChainHeadState {
  return {
    last_sequence: 0,
    last_manifest_hash: GENESIS_PREV_MANIFEST_HASH,
    last_vrf_output_hex: GENESIS_PREV_OUTPUT_HEX,
  };
}

export function normalizeVrfChainHeadState(input?: Partial<VrfChainHeadState> | null): VrfChainHeadState {
  if (!input) {
    return defaultVrfChainHeadState();
  }
  const sequenceRaw = Number(input.last_sequence ?? 0);
  const lastSequence = Number.isFinite(sequenceRaw) ? Math.max(0, Math.trunc(sequenceRaw)) : 0;
  if (lastSequence <= 0) {
    return defaultVrfChainHeadState();
  }
  return {
    last_sequence: lastSequence,
    last_manifest_hash: normalizeHash(input.last_manifest_hash, GENESIS_PREV_MANIFEST_HASH),
    last_vrf_output_hex: normalizeHash(input.last_vrf_output_hex, GENESIS_PREV_OUTPUT_HEX),
  };
}

export function registerEnvelopeNonce(nonce: string, expiresAtMs: number, nowMs: number = Date.now()): boolean {
  const normalized = nonce.trim();
  if (!normalized) {
    return true;
  }
  const existing = pruneNonces(readNonceRecords(), nowMs);
  if (existing.some((item) => item.nonce === normalized)) {
    return false;
  }
  existing.push({
    nonce: normalized,
    seen_at_ms: nowMs,
    expires_at_ms: expiresAtMs,
  });
  existing.sort((a, b) => b.seen_at_ms - a.seen_at_ms);
  if (existing.length > NONCE_CAPACITY) {
    existing.splice(NONCE_CAPACITY);
  }
  writeNonceRecords(existing);
  return true;
}

export function resetNonceHistoryForTests(): void {
  memoryNonceRecords = [];
  if (!hasStorage()) {
    return;
  }
  localStorage.removeItem(NONCE_STORAGE_KEY);
}

export async function verifyEnvelopeSecurity(
  envelope: UpdateEnvelopeV2,
  nowMs: number = Date.now(),
  options: VerifyEnvelopeSecurityOptions = {},
): Promise<{ ok: boolean; reason?: string }> {
  const requireSignature = options.requireSignature ?? true;
  if (envelopeIsExpired(envelope, nowMs)) {
    return { ok: false, reason: 'expired' };
  }
  if (!envelope.payload_hash) {
    return { ok: false, reason: 'payload_hash_missing' };
  }
  if (!(await envelopePayloadHashMatches(envelope))) {
    return { ok: false, reason: 'payload_hash_mismatch' };
  }
  if (requireSignature && !(await verifyEnvelopeSignature(envelope))) {
    return { ok: false, reason: 'envelope_signature_invalid' };
  }
  if (!registerEnvelopeNonce(envelope.nonce, envelope.expires_at_ms, nowMs)) {
    return { ok: false, reason: 'replayed_nonce' };
  }
  return { ok: true };
}

export async function verifyManifestSecurity(
  manifest: UpdateManifestV2,
  options: VerifyManifestSecurityOptions = {},
): Promise<{ ok: boolean; reason?: string }> {
  if (!options.legacySignatureAccept && manifest.security.mode !== 'vrf_chain_v1') {
    return { ok: false, reason: 'legacy_mode_rejected' };
  }

  const scoped = getScopedVersionState(manifest.channel, manifest.platform);
  const snapshot = getUpdateStoreState().snapshot;
  const snapshotScopeMatches =
    snapshot.channel.toLowerCase() === manifest.channel.toLowerCase() &&
    snapshot.platform.toLowerCase() === manifest.platform.toLowerCase();
  const baselineVersion = scoped?.current_version ?? (snapshotScopeMatches ? snapshot.current_version : undefined);
  const baselineVersionCode = scoped?.current_version_code ?? (snapshotScopeMatches ? snapshot.current_version_code : undefined);
  const baselineSequence = Math.max(scoped?.sequence ?? 0, maxAppliedSequence(manifest.channel, manifest.platform));
  const hasBaseline =
    normalizeVersionCode(baselineVersionCode) !== undefined ||
    Boolean((baselineVersion ?? '').trim()) ||
    baselineSequence > 0;
  if (hasBaseline) {
    const comparison = compareVersionVector(
      {
        version: manifest.version,
        versionCode: manifest.version_code,
        sequence: manifest.sequence,
      },
      {
        version: baselineVersion,
        versionCode: baselineVersionCode,
        sequence: baselineSequence,
      },
    );
    if (comparison <= 0) {
      return { ok: false, reason: 'rollback_rejected' };
    }
  }

  return { ok: true };
}

export function canAdvanceVrfSequence(head: VrfChainHeadState, candidateSequence: number): boolean {
  const normalizedHead = normalizeVrfChainHeadState(head);
  const normalizedCandidate = Math.max(0, Math.trunc(candidateSequence));
  if (normalizedHead.last_sequence <= 0) {
    return normalizedCandidate > 0;
  }
  return normalizedCandidate === normalizedHead.last_sequence + 1;
}

export function resolveSequenceConflict<T extends VrfConflictCandidate>(candidates: T[]): T | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  let winner = candidates[0];
  for (const candidate of candidates) {
    if (candidate.sequence !== winner.sequence) {
      continue;
    }
    if (candidate.vrf_output_hex.localeCompare(winner.vrf_output_hex) < 0) {
      winner = candidate;
    }
  }
  return winner;
}

export async function verifyVrfChainCandidate(
  manifest: UpdateManifestV2,
  chainHead: VrfChainHeadState,
  options: VerifyVrfChainOptions = {},
): Promise<VrfCandidateVerificationResult> {
  if (manifest.security.mode !== 'vrf_chain_v1') {
    return { ok: false, reason: 'mode_not_vrf_chain' };
  }
  const vrf = manifest.security.vrf;
  if (!vrf) {
    return { ok: false, reason: 'vrf_payload_missing' };
  }
  if (vrf.scheme !== 'ed25519_sig_vrf_v1') {
    return { ok: false, reason: 'vrf_scheme_unsupported' };
  }

  const normalizedHead = normalizeVrfChainHeadState(chainHead);
  const strictContiguous = options.strictContiguous ?? true;
  if (strictContiguous && !canAdvanceVrfSequence(normalizedHead, manifest.sequence)) {
    return { ok: false, reason: 'sequence_gap_or_reorder' };
  }

  const expectedPrevManifestHash = normalizedHead.last_sequence > 0
    ? normalizedHead.last_manifest_hash
    : normalizeHash(options.genesisPrevManifestHash, GENESIS_PREV_MANIFEST_HASH);
  const expectedPrevOutputHex = normalizedHead.last_sequence > 0
    ? normalizedHead.last_vrf_output_hex
    : normalizeHash(options.genesisPrevOutputHex, GENESIS_PREV_OUTPUT_HEX);

  if (vrf.prev_manifest_hash.toLowerCase() !== expectedPrevManifestHash) {
    return { ok: false, reason: 'prev_manifest_hash_mismatch' };
  }
  if (vrf.prev_vrf_output_hex.toLowerCase() !== expectedPrevOutputHex) {
    return { ok: false, reason: 'prev_vrf_output_mismatch' };
  }

  const expectedInput = await buildVrfInput(canonicalManifestCore(manifest), {
    channel: manifest.channel,
    platform: manifest.platform,
    sequence: manifest.sequence,
    prev_manifest_hash: vrf.prev_manifest_hash,
    prev_vrf_output_hex: vrf.prev_vrf_output_hex,
  });
  if (expectedInput.toLowerCase() !== vrf.vrf_input_hex.toLowerCase()) {
    return { ok: false, reason: 'vrf_input_mismatch' };
  }

  const proofOk = await verifyVrf(vrf.vrf_input_hex, vrf.vrf_proof_base64, vrf.vrf_public_key_hex);
  if (!proofOk) {
    return { ok: false, reason: 'vrf_proof_invalid' };
  }

  const derivedOutput = await deriveVrfOutput(vrf.vrf_proof_base64);
  if (derivedOutput.toLowerCase() !== vrf.vrf_output_hex.toLowerCase()) {
    return { ok: false, reason: 'vrf_output_mismatch' };
  }

  return {
    ok: true,
    manifest_hash: await hashManifestForChain(manifest),
    vrf_output_hex: derivedOutput.toLowerCase(),
    sequence: manifest.sequence,
  };
}

function randomDeviceId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDeviceId(): string {
  if (!hasStorage()) {
    return 'ephemeral-device';
  }
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }
  const generated = randomDeviceId();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

export async function rolloutBucket(deviceId: string, manifestId: string): Promise<number> {
  const seed = `${deviceId}${manifestId}`;
  const hash = await sha256Hex(seed);
  const head = hash.slice(0, 8);
  const value = Number.parseInt(head, 16);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value % 100;
}

export async function shouldEnterRollout(manifest: UpdateManifestV2, deviceId: string = getDeviceId()): Promise<boolean> {
  if (manifest.rollout.emergency) {
    return true;
  }
  const percent = Math.max(0, Math.min(100, Math.trunc(manifest.rollout.percent)));
  if (percent >= 100) {
    return true;
  }
  const bucket = await rolloutBucket(deviceId, manifest.manifest_id);
  return bucket < percent;
}
