import { Capacitor } from '@capacitor/core';
import { canonicalize, sha256Hex } from './protocol/UpdateCanonical';
import {
  parseEnvelopeV2,
  type UpdateEnvelopeV2,
} from './protocol/UpdateEnvelopeV2';
import {
  attestationIsPositive,
  parseAttestationV2,
} from './protocol/UpdateAttestationV2';
import {
  killSwitchAppliesTo,
  killSwitchIsActive,
  parseKillSwitchV2,
} from './protocol/UpdateKillSwitchV2';
import {
  parseRevocationV2,
  revocationAppliesToManifest,
} from './protocol/UpdateRevocationV2';
import {
  manifestFromUnknown,
  parseManifestVrfSecurity,
  selectArtifact,
  type UpdateManifestArtifactV2,
  type UpdateManifestV2,
} from './protocol/UpdateManifestV2';
import {
  buildVrfInput,
  deriveVrfOutput,
  verifyVrf,
} from './protocol/UpdateVrfChainV1';
import {
  addAttestor,
  addRevokedManifest,
  clearPendingCandidates,
  clearStagedFile,
  getScopedVersionState,
  getUpdateStoreState,
  getVrfChainState,
  incrementMetric,
  isManifestRevoked,
  killSwitchActive,
  listPendingCandidates,
  markApplied,
  removePendingCandidate,
  setInstalledVersion,
  setManualCheckInflight,
  setManualCheckReason,
  setManifestDetected,
  setLastError,
  setStateOnly,
  setStagedFile,
  setVrfCandidateStatus,
  setVrfChainState,
  subscribeUpdateStore,
  upsertKillSwitch,
  upsertPendingCandidate,
  type PendingVrfCandidateState,
  type UpdateSnapshot,
} from './updateStore';
import {
  applyStagedManifest,
  consumeInstallResult,
  downloadArtifactData,
  getInstalledVersion,
  openStoreUpgrade,
  stageArtifact,
  verifyArtifactHash,
} from './updateApplier';
import {
  normalizeVrfChainHeadState,
  registerEnvelopeNonce,
  resolveSequenceConflict,
  shouldEnterRollout,
  verifyEnvelopeSecurity,
  verifyManifestSecurity,
  verifyVrfChainCandidate,
} from './updateVerifier';
import {
  UpdateTransport,
  type UpdateTransportMessage,
  type UpdateTransportManualResult,
} from './updateTransport';
import { compareVersionVector } from './updateVersion';

interface UpdateSyncOptions {
  channel?: string;
  platform?: string;
  authority_namespace?: string;
}

const DEFAULT_CHANNEL = 'stable';
const MANUAL_CHECK_TIMEOUT_MS = 8_000;
type UpdateCarrier = 'gossip' | 'feed';

function resolveRequiredCarriers(): UpdateCarrier[] {
  const fromEnv = String(import.meta.env.VITE_UPDATE_REQUIRED_PUBLISH_CARRIERS ?? import.meta.env.VITE_UPDATE_REQUIRED_CARRIERS ?? '')
    .trim()
    .toLowerCase();
  const parsed = fromEnv
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item): item is UpdateCarrier => item === 'gossip' || item === 'feed');
  if (parsed.length > 0) {
    return Array.from(new Set(parsed));
  }
  return ['gossip', 'feed'];
}

function resolveCarrierQuorum(): number {
  const keys = [
    import.meta.env.VITE_UPDATE_CARRIER_QUORUM,
    import.meta.env.VITE_UPDATE_REQUIRED_CARRIER_QUORUM,
    import.meta.env.VITE_UPDATE_CARRIER_QUORUM_MIN,
  ];
  for (const raw of keys) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const normalized = Math.trunc(parsed);
      if (normalized > 0) {
        return normalized;
      }
    }
  }
  return 1;
}

const REQUIRED_CARRIERS: UpdateCarrier[] = resolveRequiredCarriers();
const REQUIRED_CARRIER_QUORUM = Math.max(1, Math.min(resolveCarrierQuorum(), REQUIRED_CARRIERS.length));

let transport: UpdateTransport | null = null;
let stopStoreSubscription: (() => void) | null = null;
let visibilityApplyHandler: (() => void) | null = null;
let started = false;
let downloadInFlight = false;
let pendingInstallManifestId: string | null = null;
let userActionRequiredManifestId: string | null = null;

const controlCarrierSeen = new Map<string, Set<'gossip' | 'feed'>>();

function shouldAbortApply(manifest: UpdateManifestV2): boolean {
  const state = getUpdateStoreState();
  if (state.snapshot.state === 'REVOKED') {
    return true;
  }
  if (isManifestRevoked(manifest.manifest_id)) {
    clearStagedFile();
    setStateOnly('REVOKED', 'manifest revoked');
    return true;
  }
  if (killSwitchActive(manifest.channel, manifest.platform)) {
    clearStagedFile();
    setStateOnly('REVOKED', 'killswitch active');
    return true;
  }
  return false;
}

function currentPlatform(): string {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') {
    return platform;
  }
  return 'android';
}

async function refreshInstalledVersion(
  channel: string,
  platform: string,
): Promise<void> {
  const installedVersion = await getInstalledVersion();
  if (installedVersion.ok && installedVersion.version) {
    const scoped = getScopedVersionState(channel, platform);
    const snapshot = getUpdateStoreState().snapshot;
    const snapshotMatchesScope =
      snapshot.channel.toLowerCase() === channel.toLowerCase()
      && snapshot.platform.toLowerCase() === platform.toLowerCase();
    const hasPreviousRecorded = Boolean(
      scoped?.previous_version?.trim()
      || (snapshotMatchesScope && snapshot.previous_version?.trim()),
    );
    if (!hasPreviousRecorded && installedVersion.previousVersion) {
      setInstalledVersion(
        channel,
        platform,
        installedVersion.previousVersion,
        installedVersion.previousVersionCode,
      );
    }
    setInstalledVersion(
      channel,
      platform,
      installedVersion.version,
      installedVersion.versionCode,
    );
  }
}

function normalizePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function appIsForeground(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return !document.hidden;
}

function canApplyShellNow(manifest: UpdateManifestV2): boolean {
  if (manifest.rollout.emergency) {
    return true;
  }
  return !appIsForeground();
}

function hasRequiredCarriers(carriers: Array<'gossip' | 'feed'>): boolean {
  if (carriers.length === 0) {
    return false;
  }
  const seen = new Set(carriers);
  const matches = REQUIRED_CARRIERS.filter((carrier) => seen.has(carrier)).length;
  return matches >= REQUIRED_CARRIER_QUORUM;
}

function candidateIdForManifest(manifest: UpdateManifestV2): string {
  const vrfOutput = manifest.security.vrf?.vrf_output_hex?.trim().toLowerCase() ?? '';
  return `${manifest.channel.toLowerCase()}|${manifest.platform.toLowerCase()}|${manifest.sequence}|${manifest.manifest_id}|${vrfOutput}`;
}

async function unwrapEnvelope(
  raw: unknown,
  options: { requireSignature?: boolean; allowRawUnsigned?: boolean } = {},
): Promise<{ payload: Record<string, unknown>; envelope?: UpdateEnvelopeV2 } | null> {
  const envelope = parseEnvelopeV2(raw);
  if (!envelope) {
    if (!options.allowRawUnsigned) {
      return null;
    }
    const objectPayload = normalizePayload(raw);
    if (!objectPayload) {
      return null;
    }
    const nonce = String(objectPayload.nonce ?? '').trim();
    const expiresAt = Number(objectPayload.expires_at_ms ?? 0);
    if (nonce && !registerEnvelopeNonce(nonce, Number.isFinite(expiresAt) ? expiresAt : 0)) {
      incrementMetric('update_antireplay_drop_total');
      return null;
    }
    if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
      incrementMetric('update_antireplay_drop_total');
      return null;
    }
    return { payload: objectPayload };
  }

  const envelopeSecurity = await verifyEnvelopeSecurity(envelope, Date.now(), {
    requireSignature: options.requireSignature ?? true,
  });
  if (!envelopeSecurity.ok) {
    incrementMetric('update_antireplay_drop_total');
    return null;
  }
  return {
    payload: envelope.payload,
    envelope,
  };
}

async function applyFromStaged(
  manifest: UpdateManifestV2,
  artifact: UpdateManifestArtifactV2,
  stagedPath?: string,
): Promise<void> {
  if (artifact.shell_required && !stagedPath) {
    setStateOnly('FAILED', 'staged_path_missing');
    return;
  }

  if (artifact.shell_required && !canApplyShellNow(manifest)) {
    setStateOnly('STAGED');
    return;
  }

  setStateOnly('APPLYING');
  const applyResult = await applyStagedManifest(manifest, artifact, {
    stagedPath,
  });
  if (shouldAbortApply(manifest)) {
    return;
  }
  if (!applyResult.ok) {
    if (applyResult.requiresUserAction) {
      userActionRequiredManifestId = manifest.manifest_id;
      setStateOnly('STAGED');
      return;
    }
    if (pendingInstallManifestId === manifest.manifest_id) {
      pendingInstallManifestId = null;
    }
    if (userActionRequiredManifestId === manifest.manifest_id) {
      userActionRequiredManifestId = null;
    }
    setStateOnly('FAILED', applyResult.error ?? 'apply_failed');
    return;
  }
  if (applyResult.pendingInstall) {
    pendingInstallManifestId = manifest.manifest_id;
    userActionRequiredManifestId = null;
    setStateOnly('STAGED');
    return;
  }
  if (applyResult.requiresUserAction) {
    userActionRequiredManifestId = manifest.manifest_id;
    setStateOnly('STAGED');
    return;
  }

  markApplied(manifest);
  clearStagedFile();
  pendingInstallManifestId = null;
  userActionRequiredManifestId = null;
  incrementMetric('update_apply_success_total');
}

async function reconcileInstallResult(): Promise<void> {
  if (currentPlatform() !== 'android') {
    return;
  }
  const result = await consumeInstallResult();
  if (!result.ok || !result.status || result.status === 'none') {
    return;
  }
  const state = getUpdateStoreState();
  const manifest = state.manifest;
  const manifestId = (result.manifestId ?? '').trim();
  const currentManifestId = state.snapshot.manifest_id ?? '';
  if (manifestId && currentManifestId && manifestId !== currentManifestId) {
    return;
  }

  if (result.status === 'success') {
    if (manifest) {
      markApplied(manifest);
    } else {
      setStateOnly('APPLIED');
    }
    clearStagedFile();
    pendingInstallManifestId = null;
    userActionRequiredManifestId = null;
    incrementMetric('update_apply_success_total');
    return;
  }

  pendingInstallManifestId = null;
  if (manifestId && userActionRequiredManifestId === manifestId) {
    return;
  }
  setStateOnly('FAILED', result.message || 'install_failed');
}

async function maybeDownloadAndApply(): Promise<void> {
  if (downloadInFlight) {
    return;
  }
  await reconcileInstallResult();
  const state = getUpdateStoreState();
  const manifest = state.manifest;
  if (!manifest) {
    return;
  }
  const scoped = getScopedVersionState(manifest.channel, manifest.platform);
  const snapshotScopeMatches =
    state.snapshot.channel.toLowerCase() === manifest.channel.toLowerCase() &&
    state.snapshot.platform.toLowerCase() === manifest.platform.toLowerCase();
  const baselineVersion = scoped?.current_version ?? (snapshotScopeMatches ? state.snapshot.current_version : undefined);
  const baselineVersionCode = scoped?.current_version_code ?? (snapshotScopeMatches ? state.snapshot.current_version_code : undefined);
  const baselineSequence = scoped?.sequence ?? 0;
  const manifestAheadOfCurrent = compareVersionVector(
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
  ) > 0;
  if (!manifestAheadOfCurrent) {
    return;
  }
  if (shouldAbortApply(manifest)) {
    return;
  }

  const requiredAttestors = Math.max(0, manifest.security.attestation_threshold ?? 0);
  if (requiredAttestors > 0 && state.attestors.length < requiredAttestors) {
    return;
  }

  const artifact = selectArtifact(manifest, currentPlatform());
  if (!artifact) {
    setStateOnly('FAILED', 'artifact_missing');
    return;
  }
  if (!artifact.sha256 || artifact.sha256.trim().length === 0) {
    setStateOnly('FAILED', 'artifact_sha256_missing');
    return;
  }

  if (pendingInstallManifestId === manifest.manifest_id) {
    return;
  }
  if (userActionRequiredManifestId === manifest.manifest_id) {
    return;
  }

  if (
    state.staged_file_path &&
    state.snapshot.state === 'STAGED' &&
    state.snapshot.manifest_id === manifest.manifest_id
  ) {
    downloadInFlight = true;
    try {
      await applyFromStaged(manifest, artifact, state.staged_file_path);
    } finally {
      downloadInFlight = false;
    }
    return;
  }

  downloadInFlight = true;
  try {
    if (shouldAbortApply(manifest)) {
      return;
    }
    setStateOnly('ATTESTED');
    const preferP2P = currentPlatform() === 'android';
    const downloaded = await downloadArtifactData(manifest, artifact, { preferP2P });
    if (shouldAbortApply(manifest)) {
      return;
    }
    if (!downloaded.bytes || downloaded.bytes.length === 0) {
      setStateOnly('FAILED', 'download_failed');
      return;
    }

    const hashOk = await verifyArtifactHash(downloaded.bytes, artifact.sha256);
    if (shouldAbortApply(manifest)) {
      return;
    }
    if (!hashOk) {
      setStateOnly('FAILED', 'sha256_mismatch');
      return;
    }

    setStateOnly('DOWNLOADED');
    const staged = await stageArtifact(manifest, artifact, downloaded.bytes);
    if (shouldAbortApply(manifest)) {
      return;
    }
    if (!staged.ok) {
      setStateOnly('FAILED', staged.error ?? 'stage_failed');
      return;
    }

    setStagedFile(staged.stagedPath);
    setStateOnly('STAGED');
    await applyFromStaged(manifest, artifact, staged.stagedPath);
  } finally {
    downloadInFlight = false;
  }
}

function recordControlCarrier(key: string, carrier: 'gossip' | 'feed'): boolean {
  const set = controlCarrierSeen.get(key) ?? new Set<'gossip' | 'feed'>();
  set.add(carrier);
  controlCarrierSeen.set(key, set);
  return hasRequiredCarriers(Array.from(set));
}

function clearControlCarrier(key: string): void {
  controlCarrierSeen.delete(key);
}

async function verifyControlVrf(
  payload: Record<string, unknown>,
  channel: string,
  platform: string,
): Promise<{ ok: boolean; reason?: string; sequence?: number; payloadHash?: string; outputHex?: string }> {
  const vrf = parseManifestVrfSecurity(payload.vrf);
  if (!vrf) {
    return { ok: false, reason: 'vrf_missing' };
  }
  const sequenceRaw = Number(payload.sequence ?? 0);
  const sequence = Number.isFinite(sequenceRaw) ? Math.max(0, Math.trunc(sequenceRaw)) : 0;
  if (sequence <= 0) {
    return { ok: false, reason: 'sequence_missing' };
  }

  const chainHead = normalizeVrfChainHeadState(getVrfChainState(channel, platform));
  if (chainHead.last_sequence <= 0) {
    if (sequence <= 0) {
      return { ok: false, reason: 'sequence_not_contiguous' };
    }
  } else if (sequence !== chainHead.last_sequence + 1) {
    return { ok: false, reason: 'sequence_not_contiguous' };
  }
  if (vrf.prev_manifest_hash !== chainHead.last_manifest_hash) {
    return { ok: false, reason: 'prev_manifest_hash_mismatch' };
  }
  if (vrf.prev_vrf_output_hex !== chainHead.last_vrf_output_hex) {
    return { ok: false, reason: 'prev_vrf_output_mismatch' };
  }

  const core = canonicalize({
    ...payload,
    channel,
    platform,
    sequence,
    vrf: {
      scheme: vrf.scheme,
      publisher_peer_id: vrf.publisher_peer_id,
      vrf_public_key_hex: vrf.vrf_public_key_hex,
      prev_manifest_hash: vrf.prev_manifest_hash,
      prev_vrf_output_hex: vrf.prev_vrf_output_hex,
    },
  });
  const inputHex = await buildVrfInput(core, {
    channel,
    platform,
    sequence,
    prev_manifest_hash: vrf.prev_manifest_hash,
    prev_vrf_output_hex: vrf.prev_vrf_output_hex,
  });
  if (inputHex !== vrf.vrf_input_hex) {
    return { ok: false, reason: 'vrf_input_mismatch' };
  }
  const proofOk = await verifyVrf(vrf.vrf_input_hex, vrf.vrf_proof_base64, vrf.vrf_public_key_hex);
  if (!proofOk) {
    return { ok: false, reason: 'vrf_proof_invalid' };
  }
  const outputHex = await deriveVrfOutput(vrf.vrf_proof_base64);
  if (outputHex !== vrf.vrf_output_hex) {
    return { ok: false, reason: 'vrf_output_mismatch' };
  }

  return {
    ok: true,
    sequence,
    outputHex,
    payloadHash: await sha256Hex(canonicalize(payload)),
  };
}

async function tryPromoteCandidates(channel: string, platform: string): Promise<boolean> {
  const head = getVrfChainState(channel, platform);
  const scopedCandidatesAll = listPendingCandidates(channel, platform).filter((candidate) => hasRequiredCarriers(candidate.carriers));
  let nextSequence = head.last_sequence + 1;
  if (head.last_sequence <= 0) {
    const positiveSequences = scopedCandidatesAll
      .map((candidate) => candidate.sequence)
      .filter((sequence) => sequence > 0);
    if (positiveSequences.length === 0) {
      return false;
    }
    nextSequence = Math.min(...positiveSequences);
  }
  const scopedCandidates = listPendingCandidates(channel, platform)
    .filter((candidate) => candidate.sequence === nextSequence)
    .filter((candidate) => hasRequiredCarriers(candidate.carriers));
  if (scopedCandidates.length === 0) {
    const gapCandidates = head.last_sequence > 0
      ? listPendingCandidates(channel, platform)
        .filter((candidate) => hasRequiredCarriers(candidate.carriers) && candidate.sequence > nextSequence)
      : [];
    if (gapCandidates.length > 0) {
      const carriers = Array.from(
        new Set(gapCandidates.flatMap((candidate) => candidate.carriers)),
      );
      setVrfCandidateStatus('waiting_history', carriers);
      incrementMetric('update_vrf_gap_block_total');
    }
    return false;
  }

  const winner = resolveSequenceConflict(scopedCandidates);
  if (!winner) {
    return false;
  }
  for (const candidate of scopedCandidates) {
    if (candidate.candidate_id !== winner.candidate_id) {
      removePendingCandidate(channel, platform, candidate.candidate_id);
      incrementMetric('update_vrf_conflict_resolved_total');
    }
  }

  const verifyResult = await verifyVrfChainCandidate(winner.manifest, head, { strictContiguous: true });
  if (!verifyResult.ok) {
    removePendingCandidate(channel, platform, winner.candidate_id);
    incrementMetric('update_vrf_verify_fail_total');
    setStateOnly('FAILED', verifyResult.reason ?? 'vrf_verify_failed');
    return false;
  }

  const securityResult = await verifyManifestSecurity(winner.manifest, { legacySignatureAccept: false });
  if (!securityResult.ok) {
    removePendingCandidate(channel, platform, winner.candidate_id);
    if (securityResult.reason === 'rollback_rejected') {
      incrementMetric('update_sequence_regress_total');
    }
    return false;
  }

  if (isManifestRevoked(winner.manifest.manifest_id)) {
    clearStagedFile();
    setStateOnly('REVOKED', 'manifest revoked');
    removePendingCandidate(channel, platform, winner.candidate_id);
    return true;
  }
  if (killSwitchActive(winner.manifest.channel, winner.manifest.platform)) {
    clearStagedFile();
    setStateOnly('REVOKED', 'killswitch active');
    removePendingCandidate(channel, platform, winner.candidate_id);
    return true;
  }

  setVrfCandidateStatus('confirmed', winner.carriers);
  setManifestDetected(winner.manifest);
  setStateOnly('VERIFIED');
  setVrfChainState(channel, platform, {
    last_sequence: winner.sequence,
    last_manifest_hash: verifyResult.manifest_hash ?? winner.manifest_hash,
    last_vrf_output_hex: verifyResult.vrf_output_hex ?? winner.vrf_output_hex,
  });
  clearPendingCandidates(channel, platform, { upToSequence: winner.sequence });
  incrementMetric('update_vrf_manifest_accepted_total');

  const rolloutAllowed = await shouldEnterRollout(winner.manifest);
  if (!rolloutAllowed && !winner.manifest.rollout.emergency) {
    setStateOnly('VERIFIED', 'rollout_not_hit');
    return true;
  }

  await maybeDownloadAndApply();
  return true;
}

async function handleManifestMessage(message: UpdateTransportMessage): Promise<void> {
  incrementMetric('update_manifest_received_total');
  const normalizedRaw = normalizePayload(message.raw);
  const maybeEnvelope = parseEnvelopeV2(normalizedRaw);
  const envelopePayload = maybeEnvelope?.payload ?? normalizedRaw;

  if (!envelopePayload) {
    return;
  }

  const previewManifest = manifestFromUnknown(envelopePayload);
  const manifestFromPayload = previewManifest ? manifestFromUnknown(envelopePayload) : null;

  let manifest: UpdateManifestV2 | null;
  if (maybeEnvelope) {
    const requireSignature = previewManifest?.security.mode !== 'vrf_chain_v1';
    const unwrapped = await unwrapEnvelope(message.raw, { requireSignature });
    if (!unwrapped?.envelope) {
      return;
    }
    manifest = manifestFromUnknown(unwrapped.payload) ?? previewManifest;
  } else {
    // Backward-compatible path: some feed implementations may put manifest directly in snapshot.
    if (manifestFromPayload) {
      manifest = manifestFromPayload;
    } else if (normalizedRaw && typeof normalizedRaw === 'object') {
      const rawRecord = normalizedRaw as Record<string, unknown>;
      const nonce = String(rawRecord.nonce ?? '').trim();
      const expiresAt = Number(rawRecord.expires_at_ms ?? 0);
      if (nonce) {
        if (!registerEnvelopeNonce(nonce, Number.isFinite(expiresAt) ? expiresAt : 0)) {
          incrementMetric('update_antireplay_drop_total');
          return;
        }
      }
      if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
        incrementMetric('update_antireplay_drop_total');
        return;
      }
      manifest = previewManifest;
    } else {
      return;
    }
  }

  if (!manifest) {
    return;
  }

  if (!manifest) {
    return;
  }
  if (manifest.security.mode !== 'vrf_chain_v1' || !manifest.security.vrf) {
    incrementMetric('update_vrf_verify_fail_total');
    return;
  }

  const vrfOutputHex = manifest.security.vrf.vrf_output_hex.trim().toLowerCase();
  const manifestHash = await sha256Hex(canonicalize(manifest));
  const candidateId = candidateIdForManifest(manifest);
  const previous = listPendingCandidates(manifest.channel, manifest.platform)
    .find((candidate) => candidate.candidate_id === candidateId);
  const carriers = Array.from(new Set([...(previous?.carriers ?? []), message.carrier]));
  const candidate: PendingVrfCandidateState = {
    candidate_id: candidateId,
    channel: manifest.channel,
    platform: manifest.platform,
    sequence: manifest.sequence,
    manifest_id: manifest.manifest_id,
    manifest_hash: manifestHash,
    vrf_output_hex: vrfOutputHex,
    carriers,
    seen_at_ms: Date.now(),
    manifest,
  };
  upsertPendingCandidate(candidate);

  if (!hasRequiredCarriers(carriers)) {
    setVrfCandidateStatus('waiting_carrier', carriers);
    incrementMetric('update_vrf_carrier_wait_total');
    return;
  }
  setVrfCandidateStatus('confirmed', carriers);

  let progressed = false;
  do {
    progressed = await tryPromoteCandidates(manifest.channel, manifest.platform);
  } while (progressed);
}

async function handleAttestationMessage(message: UpdateTransportMessage): Promise<void> {
  const unwrapped = await unwrapEnvelope(message.raw, { allowRawUnsigned: true });
  if (!unwrapped) {
    return;
  }
  const attestation = parseAttestationV2(unwrapped.payload);
  if (!attestation || !attestationIsPositive(attestation)) {
    return;
  }

  const state = getUpdateStoreState();
  if (!state.manifest || state.manifest.manifest_id !== attestation.manifest_id) {
    return;
  }
  if ((state.manifest.security.attestation_threshold ?? 0) <= 0) {
    return;
  }

  addAttestor(attestation.attestor_peer_id);
  incrementMetric('update_attestation_verified_total');
  await maybeDownloadAndApply();
}

async function handleRevocationMessage(message: UpdateTransportMessage): Promise<void> {
  const unwrapped = await unwrapEnvelope(message.raw, { requireSignature: false });
  if (!unwrapped) {
    return;
  }
  const payload = normalizePayload(unwrapped.payload);
  if (!payload) {
    return;
  }
  const revoke = parseRevocationV2(payload);
  if (!revoke) {
    return;
  }
  const channel = revoke.channel?.trim() || getUpdateStoreState().snapshot.channel;
  const platform = revoke.platform?.trim() || getUpdateStoreState().snapshot.platform;
  const dedupeHash = await sha256Hex(canonicalize(revoke));
  const controlKey = `revoke|${channel}|${platform}|${revoke.sequence ?? 0}|${dedupeHash}`;
  if (!recordControlCarrier(controlKey, message.carrier)) {
    incrementMetric('update_vrf_carrier_wait_total');
    return;
  }

  const verify = await verifyControlVrf(payload, channel, platform);
  if (!verify.ok || !verify.sequence || !verify.outputHex || !verify.payloadHash) {
    incrementMetric('update_vrf_verify_fail_total');
    clearControlCarrier(controlKey);
    return;
  }

  setVrfChainState(channel, platform, {
    last_sequence: verify.sequence,
    last_manifest_hash: verify.payloadHash,
    last_vrf_output_hex: verify.outputHex,
  });
  clearControlCarrier(controlKey);

  if (revoke.manifest_id) {
    addRevokedManifest(revoke.manifest_id);
  }

  const state = getUpdateStoreState();
  if (state.manifest && revocationAppliesToManifest(revoke, state.manifest)) {
    clearStagedFile();
    setStateOnly('REVOKED', `revocation:${revoke.reason}`);
    incrementMetric('update_vrf_control_applied_total');
    incrementMetric('update_revoke_applied_total');
  }
}

async function handleKillSwitchMessage(message: UpdateTransportMessage): Promise<void> {
  const unwrapped = await unwrapEnvelope(message.raw, { requireSignature: false });
  if (!unwrapped) {
    return;
  }
  const payload = normalizePayload(unwrapped.payload);
  if (!payload) {
    return;
  }
  const killSwitch = parseKillSwitchV2(payload);
  if (!killSwitch) {
    return;
  }

  const channel = killSwitch.channel?.trim() || getUpdateStoreState().snapshot.channel;
  const platform = killSwitch.platform?.trim() || getUpdateStoreState().snapshot.platform;
  const dedupeHash = await sha256Hex(canonicalize(killSwitch));
  const controlKey = `killswitch|${channel}|${platform}|${killSwitch.sequence ?? 0}|${dedupeHash}`;
  if (!recordControlCarrier(controlKey, message.carrier)) {
    incrementMetric('update_vrf_carrier_wait_total');
    return;
  }

  const verify = await verifyControlVrf(payload, channel, platform);
  if (!verify.ok || !verify.sequence || !verify.outputHex || !verify.payloadHash) {
    incrementMetric('update_vrf_verify_fail_total');
    clearControlCarrier(controlKey);
    return;
  }

  setVrfChainState(channel, platform, {
    last_sequence: verify.sequence,
    last_manifest_hash: verify.payloadHash,
    last_vrf_output_hex: verify.outputHex,
  });
  clearControlCarrier(controlKey);

  upsertKillSwitch({
    channel: killSwitch.channel,
    platform: killSwitch.platform,
    enabled: killSwitch.enabled,
    expires_at_ms: killSwitch.expires_at_ms,
    reason: killSwitch.reason,
  });

  const state = getUpdateStoreState();
  if (
    state.manifest &&
    killSwitchIsActive(killSwitch) &&
    killSwitchAppliesTo(killSwitch, state.manifest.channel, state.manifest.platform)
  ) {
    clearStagedFile();
    setStateOnly('REVOKED', `killswitch:${killSwitch.reason}`);
    incrementMetric('update_vrf_control_applied_total');
    incrementMetric('update_revoke_applied_total');
  }
}

async function handleTransportMessage(message: UpdateTransportMessage): Promise<void> {
  // Any inbound control/data message means transport is alive; clear stale unreachable hints.
  const snapshot = getUpdateStoreState().snapshot;
  if (snapshot.last_error === 'network_unreachable') {
    setLastError(undefined);
  }
  if (snapshot.last_manual_check_reason === 'network_unreachable') {
    setManualCheckReason(undefined);
  }
  switch (message.kind) {
    case 'manifest':
      await handleManifestMessage(message);
      break;
    case 'attestation':
      await handleAttestationMessage(message);
      break;
    case 'revoke':
      await handleRevocationMessage(message);
      break;
    case 'killswitch':
      await handleKillSwitchMessage(message);
      break;
    default:
      break;
  }
}

export async function startUpdateSync(options?: UpdateSyncOptions): Promise<void> {
  if (started) {
    return;
  }
  const resolvedChannel = options?.channel || DEFAULT_CHANNEL;
  const resolvedPlatform = options?.platform || currentPlatform();
  await refreshInstalledVersion(resolvedChannel, resolvedPlatform);
  clearPendingCandidates(resolvedChannel, resolvedPlatform);
  setVrfCandidateStatus('none', []);
  transport = new UpdateTransport({
    channel: resolvedChannel,
    platform: resolvedPlatform,
    authority_namespace: options?.authority_namespace,
  });
  transport.subscribe((message) => {
    void handleTransportMessage(message);
  });
  if (!visibilityApplyHandler && typeof document !== 'undefined') {
    visibilityApplyHandler = () => {
      if (document.hidden) {
        void maybeDownloadAndApply();
      }
    };
    document.addEventListener('visibilitychange', visibilityApplyHandler);
  }
  await transport.start();
  await reconcileInstallResult();
  stopStoreSubscription = subscribeUpdateStore(() => {
    // keep snapshot hot for UI observers
  });
  void maybeDownloadAndApply();
  started = true;
}

export async function stopUpdateSync(): Promise<void> {
  if (!started) {
    return;
  }
  if (stopStoreSubscription) {
    stopStoreSubscription();
    stopStoreSubscription = null;
  }
  if (transport) {
    await transport.stop();
    transport = null;
  }
  if (visibilityApplyHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityApplyHandler);
    visibilityApplyHandler = null;
  }
  controlCarrierSeen.clear();
  started = false;
}

export async function manualCheckForUpdates(): Promise<void> {
  setManualCheckInflight(true);
  try {
    if (!transport) {
      await startUpdateSync();
    }
    if (!transport) {
      throw new Error('update_sync_not_started');
    }
    const beforeState = getUpdateStoreState();
    const pendingBefore = listPendingCandidates(beforeState.snapshot.channel, beforeState.snapshot.platform)
      .filter((candidate) => hasRequiredCarriers(candidate.carriers));
    if (pendingBefore.length > 0) {
      const carriersBefore = Array.from(
        new Set(pendingBefore.flatMap((candidate) => candidate.carriers)),
      );
      setVrfCandidateStatus('waiting_history', carriersBefore);
    }
    const diagnostics = await Promise.race<UpdateTransportManualResult>([
      transport.manualCheck(),
      new Promise<UpdateTransportManualResult>((_, reject) => {
        setTimeout(() => {
          reject(new Error('manual_check_timeout'));
        }, MANUAL_CHECK_TIMEOUT_MS);
      }),
    ]);

    const state = getUpdateStoreState();
    let progressed = false;
    do {
      progressed = await tryPromoteCandidates(state.snapshot.channel, state.snapshot.platform);
    } while (progressed);
    const pendingReady = listPendingCandidates(state.snapshot.channel, state.snapshot.platform)
      .filter((candidate) => hasRequiredCarriers(candidate.carriers));
    if (!diagnostics.connectivity_ok && diagnostics.observed_messages === 0 && pendingReady.length === 0) {
      const reason = (diagnostics.reason ?? 'network_unreachable').trim() || 'network_unreachable';
      setManualCheckReason(reason);
      if (reason === 'network_unreachable' || reason === 'native_not_ready') {
        setLastError(reason);
      } else {
        setLastError(undefined);
      }
      return;
    }
    if (pendingReady.length > 0) {
      const carriers = Array.from(
        new Set(pendingReady.flatMap((candidate) => candidate.carriers)),
      );
      setVrfCandidateStatus('waiting_history', carriers);
      setManualCheckReason('waiting_history');
      setLastError(undefined);
      return;
    }
    setManualCheckReason(undefined);
    setLastError(undefined);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error ?? 'unknown');
    setManualCheckReason(reason);
    setLastError(`manual_check_failed:${reason}`);
  } finally {
    setManualCheckInflight(false);
  }
}

export async function syncInstalledVersionNow(options?: {
  channel?: string;
  platform?: string;
}): Promise<void> {
  const channel = options?.channel || getUpdateStoreState().snapshot.channel || DEFAULT_CHANNEL;
  const platform = options?.platform || getUpdateStoreState().snapshot.platform || currentPlatform();
  await refreshInstalledVersion(channel, platform);
}

export function subscribeUpdateSnapshot(listener: (snapshot: UpdateSnapshot) => void): () => void {
  return subscribeUpdateStore((state) => {
    listener({ ...state.snapshot });
  });
}

export function getUpdateSnapshot(): UpdateSnapshot {
  return { ...getUpdateStoreState().snapshot };
}

export async function triggerStoreUpgrade(options: {
  appStoreUrl?: string;
  testFlightUrl?: string;
}): Promise<boolean> {
  return openStoreUpgrade(options);
}
