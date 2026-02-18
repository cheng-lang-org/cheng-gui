import { extractManifestReleaseNotes, type UpdateManifestV2 } from './protocol/UpdateManifestV2';
import { compareVersionVector, normalizeVersionCode } from './updateVersion';

export type UpdateLifecycleState =
  | 'DETECTED'
  | 'VERIFIED'
  | 'ATTESTED'
  | 'DOWNLOADED'
  | 'STAGED'
  | 'APPLYING'
  | 'APPLIED'
  | 'FAILED'
  | 'REVOKED';

export interface UpdateSnapshot {
  state: UpdateLifecycleState;
  manifest_id?: string;
  channel: string;
  platform: string;
  sequence: number;
  version?: string;
  current_version?: string;
  current_version_code?: number;
  previous_version?: string;
  previous_version_code?: number;
  latest_version?: string;
  latest_version_code?: number;
  latest_manifest_verified: boolean;
  latest_manifest_verified_sequence: number;
  latest_manifest_source?: VerifiedLatestSource;
  update_summary?: string;
  update_details?: string;
  update_published_at_ms?: number;
  show_update_prompt: boolean;
  vrf_candidate_status: 'none' | 'waiting_carrier' | 'waiting_history' | 'confirmed';
  vrf_candidate_carriers: Array<'gossip' | 'feed'>;
  last_manual_check_reason?: string;
  last_error?: string;
  last_checked_at_ms: number;
  updated_at_ms: number;
  attestor_count: number;
  attestation_threshold: number;
  shell_required: boolean;
  emergency: boolean;
  manual_check_inflight: boolean;
}

export interface ScopedVersionState {
  sequence: number;
  manifest_id: string;
  current_version: string;
  current_version_code: number;
  previous_version?: string;
  previous_version_code?: number;
  updated_at_ms: number;
}

export type VerifiedLatestSource = 'installed_package' | 'network_manifest';

export interface VerifiedLatestScopeState {
  sequence: number;
  manifest_id: string;
  version: string;
  version_code: number;
  source: VerifiedLatestSource;
  update_summary?: string;
  update_details?: string;
  update_published_at_ms?: number;
  updated_at_ms: number;
}

export interface VrfChainScopeState {
  last_sequence: number;
  last_manifest_hash: string;
  last_vrf_output_hex: string;
  updated_at_ms: number;
}

export interface PendingVrfCandidateState {
  candidate_id: string;
  channel: string;
  platform: string;
  sequence: number;
  manifest_id: string;
  manifest_hash: string;
  vrf_output_hex: string;
  carriers: Array<'gossip' | 'feed'>;
  seen_at_ms: number;
  manifest: UpdateManifestV2;
}

export interface UpdateStoreState {
  snapshot: UpdateSnapshot;
  manifest?: UpdateManifestV2;
  staged_file_path?: string;
  trusted_publisher_pubkey?: string;
  trusted_next_pubkey_sha256?: string;
  last_manifest_sequence_seen: number;
  attestors: string[];
  revoked_manifests: string[];
  killswitches: Array<{
    channel?: string;
    platform?: string;
    enabled: boolean;
    expires_at_ms?: number;
    reason: string;
  }>;
  max_sequence_applied: Record<string, number>;
  metrics: Record<string, number>;
  applied_version_by_scope: Record<string, ScopedVersionState>;
  verified_latest_by_scope: Record<string, VerifiedLatestScopeState>;
  last_prompted_sequence_by_scope: Record<string, number>;
  last_prompted_version_code_by_scope: Record<string, number>;
  vrf_chain_by_scope: Record<string, VrfChainScopeState>;
  pending_candidates_by_scope: Record<string, Record<string, PendingVrfCandidateState>>;
}

const STORAGE_KEY = 'unimaker_update_store_v2';
const GENESIS_PREV_MANIFEST_HASH =
  String(import.meta.env.VITE_UPDATE_VRF_GENESIS_PREV_MANIFEST_HASH ?? '').trim().toLowerCase() || '0'.repeat(64);
const GENESIS_PREV_OUTPUT_HEX =
  String(import.meta.env.VITE_UPDATE_VRF_GENESIS_PREV_OUTPUT_HEX ?? '').trim().toLowerCase() || '0'.repeat(64);

const DEFAULT_STATE: UpdateStoreState = {
  snapshot: {
    state: 'DETECTED',
    channel: 'stable',
    platform: 'android',
    sequence: 0,
    latest_manifest_verified: false,
    latest_manifest_verified_sequence: 0,
    last_checked_at_ms: 0,
    updated_at_ms: Date.now(),
    show_update_prompt: false,
    vrf_candidate_status: 'none',
    vrf_candidate_carriers: [],
    last_manual_check_reason: undefined,
    attestor_count: 0,
    attestation_threshold: 0,
    shell_required: false,
    emergency: false,
    manual_check_inflight: false,
  },
  trusted_publisher_pubkey: undefined,
  trusted_next_pubkey_sha256: undefined,
  last_manifest_sequence_seen: 0,
  attestors: [],
  revoked_manifests: [],
  killswitches: [],
  max_sequence_applied: {},
  metrics: {},
  applied_version_by_scope: {},
  verified_latest_by_scope: {},
  last_prompted_sequence_by_scope: {},
  last_prompted_version_code_by_scope: {},
  vrf_chain_by_scope: {},
  pending_candidates_by_scope: {},
};

type StoreListener = (state: UpdateStoreState) => void;

let storeState: UpdateStoreState = hydrateState();
const listeners = new Set<StoreListener>();

function scopeKey(channel: string, platform: string): string {
  return `${channel.toLowerCase()}|${platform.toLowerCase()}`;
}

function normalizeHash(input: unknown, fallback: string): string {
  const normalized = String(input ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function defaultVrfScopeState(): VrfChainScopeState {
  return {
    last_sequence: 0,
    last_manifest_hash: GENESIS_PREV_MANIFEST_HASH,
    last_vrf_output_hex: GENESIS_PREV_OUTPUT_HEX,
    updated_at_ms: 0,
  };
}

function installedManifestId(channel: string, platform: string, version: string, versionCode?: number): string {
  const normalizedVersion = version.trim() || 'unknown';
  const normalizedCode = normalizeVersionCode(versionCode);
  const suffix = normalizedCode !== undefined ? String(normalizedCode) : normalizedVersion;
  return `installed-${channel.toLowerCase()}-${platform.toLowerCase()}-${suffix}`;
}

function cloneState(state: UpdateStoreState): UpdateStoreState {
  return {
    ...state,
    snapshot: { ...state.snapshot },
    manifest: state.manifest ? JSON.parse(JSON.stringify(state.manifest)) as UpdateManifestV2 : undefined,
    attestors: [...state.attestors],
    revoked_manifests: [...state.revoked_manifests],
    killswitches: state.killswitches.map((item) => ({ ...item })),
    trusted_publisher_pubkey: state.trusted_publisher_pubkey,
    trusted_next_pubkey_sha256: state.trusted_next_pubkey_sha256,
    last_manifest_sequence_seen: state.last_manifest_sequence_seen,
    max_sequence_applied: { ...state.max_sequence_applied },
    metrics: { ...state.metrics },
    applied_version_by_scope: Object.fromEntries(
      Object.entries(state.applied_version_by_scope).map(([key, value]) => [key, { ...value }]),
    ),
    verified_latest_by_scope: Object.fromEntries(
      Object.entries(state.verified_latest_by_scope).map(([key, value]) => [key, { ...value }]),
    ),
    last_prompted_sequence_by_scope: { ...state.last_prompted_sequence_by_scope },
    last_prompted_version_code_by_scope: { ...state.last_prompted_version_code_by_scope },
    vrf_chain_by_scope: Object.fromEntries(
      Object.entries(state.vrf_chain_by_scope).map(([key, value]) => [key, { ...value }]),
    ),
    pending_candidates_by_scope: Object.fromEntries(
      Object.entries(state.pending_candidates_by_scope).map(([scope, scopedCandidates]) => [
        scope,
        Object.fromEntries(
          Object.entries(scopedCandidates).map(([candidateId, candidate]) => [
            candidateId,
            {
              ...candidate,
              carriers: [...candidate.carriers],
              manifest: JSON.parse(JSON.stringify(candidate.manifest)) as UpdateManifestV2,
            },
          ]),
        ),
      ]),
    ),
  };
}

function parseState(raw: string): UpdateStoreState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Partial<UpdateStoreState>;
    const parsedAppliedVersionByScope: Record<string, ScopedVersionState> =
      record.applied_version_by_scope && typeof record.applied_version_by_scope === 'object'
        ? Object.fromEntries(
            Object.entries(record.applied_version_by_scope as Record<string, unknown>)
              .map(([key, value]) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                  return null;
                }
                const row = value as Record<string, unknown>;
                const manifestId = String(row.manifest_id ?? '').trim();
                const currentVersion = String(row.current_version ?? '').trim();
                const currentVersionCode = Number(row.current_version_code ?? 0);
                const sequence = Number(row.sequence ?? 0);
                if (!manifestId || !currentVersion || !Number.isFinite(currentVersionCode) || !Number.isFinite(sequence)) {
                  return null;
                }
                const previousVersion = String(row.previous_version ?? '').trim();
                const previousVersionCodeRaw = Number(row.previous_version_code ?? Number.NaN);
                const updatedAtMs = Number(row.updated_at_ms ?? 0);
                return [
                  key,
                  {
                    sequence: Math.max(0, Math.trunc(sequence)),
                    manifest_id: manifestId,
                    current_version: currentVersion,
                    current_version_code: Math.max(0, Math.trunc(currentVersionCode)),
                    previous_version: previousVersion || undefined,
                    previous_version_code: Number.isFinite(previousVersionCodeRaw)
                      ? Math.max(0, Math.trunc(previousVersionCodeRaw))
                      : undefined,
                    updated_at_ms: Number.isFinite(updatedAtMs) ? Math.max(0, Math.trunc(updatedAtMs)) : 0,
                  } satisfies ScopedVersionState,
                ] as const;
              })
              .filter((item): item is readonly [string, ScopedVersionState] => item !== null),
          )
        : {};
    const parsedVerifiedLatestByScope: Record<string, VerifiedLatestScopeState> =
      record.verified_latest_by_scope && typeof record.verified_latest_by_scope === 'object'
        ? Object.fromEntries(
            Object.entries(record.verified_latest_by_scope as Record<string, unknown>)
              .map(([key, value]) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                  return null;
                }
                const row = value as Record<string, unknown>;
                const manifestId = String(row.manifest_id ?? '').trim();
                const version = String(row.version ?? '').trim();
                const versionCodeRaw = Number(row.version_code ?? row.versionCode ?? 0);
                const sequenceRaw = Number(row.sequence ?? 0);
                if (!manifestId || !version || !Number.isFinite(sequenceRaw)) {
                  return null;
                }
                const versionCode = Number.isFinite(versionCodeRaw)
                  ? Math.max(0, Math.trunc(versionCodeRaw))
                  : 0;
                const sequence = Math.max(0, Math.trunc(sequenceRaw));
                const sourceRaw = String(row.source ?? '').trim();
                const source: VerifiedLatestSource = sourceRaw === 'installed_package'
                  ? 'installed_package'
                  : 'network_manifest';
                if (sequence <= 0 && source !== 'installed_package') {
                  return null;
                }
                const updatedAtMs = Number(row.updated_at_ms ?? 0);
                const summary = String(row.update_summary ?? '').trim();
                const details = String(row.update_details ?? '').trim();
                const publishedAtRaw = Number(row.update_published_at_ms ?? 0);
                return [
                  key,
                  {
                    sequence,
                    manifest_id: manifestId,
                    version,
                    version_code: versionCode,
                    source,
                    update_summary: summary || undefined,
                    update_details: details || undefined,
                    update_published_at_ms: Number.isFinite(publishedAtRaw)
                      ? Math.max(0, Math.trunc(publishedAtRaw))
                      : undefined,
                    updated_at_ms: Number.isFinite(updatedAtMs) ? Math.max(0, Math.trunc(updatedAtMs)) : 0,
                  } satisfies VerifiedLatestScopeState,
                ] as const;
              })
              .filter((item): item is readonly [string, VerifiedLatestScopeState] => item !== null),
          )
        : {};
    const parsedLastPromptedByScope: Record<string, number> =
      record.last_prompted_sequence_by_scope && typeof record.last_prompted_sequence_by_scope === 'object'
        ? Object.fromEntries(
            Object.entries(record.last_prompted_sequence_by_scope as Record<string, unknown>).map(([key, value]) => [
              key,
              Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0,
            ]),
          )
        : {};
    const parsedLastPromptedVersionCodeByScope: Record<string, number> =
      record.last_prompted_version_code_by_scope && typeof record.last_prompted_version_code_by_scope === 'object'
        ? Object.fromEntries(
            Object.entries(record.last_prompted_version_code_by_scope as Record<string, unknown>).map(([key, value]) => {
              const normalized = normalizeVersionCode(value);
              return [key, normalized ?? 0];
            }),
          )
        : {};
    const parsedVrfChainByScope: Record<string, VrfChainScopeState> =
      record.vrf_chain_by_scope && typeof record.vrf_chain_by_scope === 'object'
        ? Object.fromEntries(
            Object.entries(record.vrf_chain_by_scope as Record<string, unknown>)
              .map(([key, value]) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                  return null;
                }
                const row = value as Record<string, unknown>;
                const sequenceRaw = Number(row.last_sequence ?? 0);
                const sequence = Number.isFinite(sequenceRaw) ? Math.max(0, Math.trunc(sequenceRaw)) : 0;
                if (sequence <= 0) {
                  return [key, defaultVrfScopeState()] as const;
                }
                return [
                  key,
                  {
                    last_sequence: sequence,
                    last_manifest_hash: normalizeHash(row.last_manifest_hash, GENESIS_PREV_MANIFEST_HASH),
                    last_vrf_output_hex: normalizeHash(row.last_vrf_output_hex, GENESIS_PREV_OUTPUT_HEX),
                    updated_at_ms: Number.isFinite(Number(row.updated_at_ms))
                      ? Math.max(0, Math.trunc(Number(row.updated_at_ms)))
                      : 0,
                  } satisfies VrfChainScopeState,
                ] as const;
              })
              .filter((item): item is readonly [string, VrfChainScopeState] => item !== null),
          )
        : {};
    const parsedPendingCandidatesByScope: Record<string, Record<string, PendingVrfCandidateState>> =
      record.pending_candidates_by_scope && typeof record.pending_candidates_by_scope === 'object'
        ? Object.fromEntries(
            Object.entries(record.pending_candidates_by_scope as Record<string, unknown>).map(([scope, rawScoped]) => {
              if (!rawScoped || typeof rawScoped !== 'object' || Array.isArray(rawScoped)) {
                return [scope, {}] as const;
              }
              const scopedCandidates = Object.fromEntries(
                Object.entries(rawScoped as Record<string, unknown>)
                  .map(([candidateId, rawCandidate]) => {
                    if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) {
                      return null;
                    }
                    const row = rawCandidate as Record<string, unknown>;
                    const channel = String(row.channel ?? '').trim();
                    const platform = String(row.platform ?? '').trim();
                    const manifestId = String(row.manifest_id ?? '').trim();
                    const sequenceRaw = Number(row.sequence ?? 0);
                    const sequence = Number.isFinite(sequenceRaw) ? Math.max(0, Math.trunc(sequenceRaw)) : 0;
                    const manifestHash = normalizeHash(row.manifest_hash, '');
                    const vrfOutputHex = normalizeHash(row.vrf_output_hex, '');
                    const carriers = Array.isArray(row.carriers)
                      ? row.carriers
                        .map((item) => String(item).trim().toLowerCase())
                        .filter((item): item is 'gossip' | 'feed' => item === 'gossip' || item === 'feed')
                      : [];
                    const manifest = row.manifest as UpdateManifestV2 | undefined;
                    if (!channel || !platform || !manifestId || sequence <= 0 || !manifestHash || !vrfOutputHex || !manifest) {
                      return null;
                    }
                    return [
                      candidateId,
                      {
                        candidate_id: candidateId,
                        channel,
                        platform,
                        sequence,
                        manifest_id: manifestId,
                        manifest_hash: manifestHash,
                        vrf_output_hex: vrfOutputHex,
                        carriers,
                        seen_at_ms: Number.isFinite(Number(row.seen_at_ms)) ? Math.max(0, Math.trunc(Number(row.seen_at_ms))) : 0,
                        manifest,
                      } satisfies PendingVrfCandidateState,
                    ] as const;
                  })
                  .filter((item): item is readonly [string, PendingVrfCandidateState] => item !== null),
              );
              return [scope, scopedCandidates] as const;
            }),
          )
        : {};
    const merged: UpdateStoreState = {
      ...DEFAULT_STATE,
      ...record,
      snapshot: {
        ...DEFAULT_STATE.snapshot,
        ...(record.snapshot ?? {}),
      },
      trusted_publisher_pubkey: typeof record.trusted_publisher_pubkey === 'string'
        ? record.trusted_publisher_pubkey
        : undefined,
      trusted_next_pubkey_sha256: typeof record.trusted_next_pubkey_sha256 === 'string'
        ? record.trusted_next_pubkey_sha256
        : undefined,
      last_manifest_sequence_seen: Number.isFinite(Number(record.last_manifest_sequence_seen))
        ? Math.max(0, Math.trunc(Number(record.last_manifest_sequence_seen)))
        : 0,
      attestors: Array.isArray(record.attestors) ? record.attestors.map((item) => String(item)) : [],
      revoked_manifests: Array.isArray(record.revoked_manifests)
        ? record.revoked_manifests.map((item) => String(item))
        : [],
      killswitches: Array.isArray(record.killswitches)
        ? record.killswitches.map((item) => ({
            channel: item?.channel ? String(item.channel) : undefined,
            platform: item?.platform ? String(item.platform) : undefined,
            enabled: Boolean(item?.enabled),
            expires_at_ms: item?.expires_at_ms ? Number(item.expires_at_ms) : undefined,
            reason: item?.reason ? String(item.reason) : '',
          }))
        : [],
      max_sequence_applied: record.max_sequence_applied && typeof record.max_sequence_applied === 'object'
        ? Object.fromEntries(
            Object.entries(record.max_sequence_applied as Record<string, unknown>).map(([key, value]) => [
              key,
              Number.isFinite(Number(value)) ? Number(value) : 0,
            ]),
          )
        : {},
      metrics: record.metrics && typeof record.metrics === 'object'
        ? Object.fromEntries(
            Object.entries(record.metrics as Record<string, unknown>).map(([key, value]) => [
              key,
              Number.isFinite(Number(value)) ? Number(value) : 0,
            ]),
          )
        : {},
      applied_version_by_scope: parsedAppliedVersionByScope,
      verified_latest_by_scope: parsedVerifiedLatestByScope,
      last_prompted_sequence_by_scope: parsedLastPromptedByScope,
      last_prompted_version_code_by_scope: parsedLastPromptedVersionCodeByScope,
      vrf_chain_by_scope: parsedVrfChainByScope,
      pending_candidates_by_scope: parsedPendingCandidatesByScope,
    };
    const scoped = merged.applied_version_by_scope[scopeKey(merged.snapshot.channel, merged.snapshot.platform)];
    if (scoped) {
      merged.snapshot.current_version = merged.snapshot.current_version || scoped.current_version;
      merged.snapshot.current_version_code =
        Number.isFinite(Number(merged.snapshot.current_version_code))
          ? merged.snapshot.current_version_code
          : scoped.current_version_code;
      merged.snapshot.previous_version = merged.snapshot.previous_version || scoped.previous_version;
      merged.snapshot.previous_version_code =
        Number.isFinite(Number(merged.snapshot.previous_version_code))
          ? merged.snapshot.previous_version_code
          : scoped.previous_version_code;
    }
    const verifiedLatest = merged.verified_latest_by_scope[scopeKey(merged.snapshot.channel, merged.snapshot.platform)];
    if (verifiedLatest) {
      merged.snapshot.latest_version = verifiedLatest.version;
      merged.snapshot.latest_version_code = verifiedLatest.version_code;
      merged.snapshot.update_summary = verifiedLatest.update_summary;
      merged.snapshot.update_details = verifiedLatest.update_details;
      merged.snapshot.update_published_at_ms = verifiedLatest.update_published_at_ms;
      merged.snapshot.latest_manifest_verified = true;
      merged.snapshot.latest_manifest_verified_sequence = verifiedLatest.sequence;
      merged.snapshot.latest_manifest_source = verifiedLatest.source;
    } else {
      if (!merged.snapshot.latest_version && merged.snapshot.current_version) {
        merged.snapshot.latest_version = merged.snapshot.current_version;
      }
      if (
        !Number.isFinite(Number(merged.snapshot.latest_version_code))
        && Number.isFinite(Number(merged.snapshot.current_version_code))
      ) {
        merged.snapshot.latest_version_code = merged.snapshot.current_version_code;
      }
      merged.snapshot.latest_manifest_verified = false;
      merged.snapshot.latest_manifest_verified_sequence = 0;
      merged.snapshot.latest_manifest_source = undefined;
    }
    if (!('show_update_prompt' in merged.snapshot)) {
      merged.snapshot.show_update_prompt = false;
    }
    if (!('vrf_candidate_status' in merged.snapshot)) {
      merged.snapshot.vrf_candidate_status = 'none';
    } else if (
      merged.snapshot.vrf_candidate_status !== 'none'
      && merged.snapshot.vrf_candidate_status !== 'waiting_carrier'
      && merged.snapshot.vrf_candidate_status !== 'waiting_history'
      && merged.snapshot.vrf_candidate_status !== 'confirmed'
    ) {
      merged.snapshot.vrf_candidate_status = 'none';
    }
    if (!Array.isArray(merged.snapshot.vrf_candidate_carriers)) {
      merged.snapshot.vrf_candidate_carriers = [];
    }
    if (
      merged.snapshot.last_manual_check_reason !== undefined
      && typeof merged.snapshot.last_manual_check_reason !== 'string'
    ) {
      merged.snapshot.last_manual_check_reason = undefined;
    }
    // Never keep stale inflight flag across process restarts.
    merged.snapshot.manual_check_inflight = false;
    return merged;
  } catch {
    return null;
  }
}

function hasStorage(): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function'
  );
}

function hydrateState(): UpdateStoreState {
  if (!hasStorage()) {
    return cloneState(DEFAULT_STATE);
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return cloneState(DEFAULT_STATE);
  }
  const parsed = parseState(raw);
  return parsed ?? cloneState(DEFAULT_STATE);
}

function persistState(): void {
  if (!hasStorage()) {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storeState));
}

function emit(): void {
  const cloned = cloneState(storeState);
  for (const listener of listeners) {
    listener(cloned);
  }
}

function mutate(mutator: (state: UpdateStoreState) => void): void {
  mutator(storeState);
  storeState.snapshot.updated_at_ms = Date.now();
  persistState();
  emit();
}

export function subscribeUpdateStore(listener: StoreListener): () => void {
  listeners.add(listener);
  listener(cloneState(storeState));
  return () => {
    listeners.delete(listener);
  };
}

export function getUpdateStoreState(): UpdateStoreState {
  return cloneState(storeState);
}

function scopeMatchesSnapshot(state: UpdateStoreState, channel: string, platform: string): boolean {
  return (
    state.snapshot.channel.toLowerCase() === channel.toLowerCase()
    && state.snapshot.platform.toLowerCase() === platform.toLowerCase()
  );
}

function syncSnapshotLatestFromScope(state: UpdateStoreState, channel: string, platform: string): void {
  if (!scopeMatchesSnapshot(state, channel, platform)) {
    return;
  }
  const key = scopeKey(channel, platform);
  const verified = state.verified_latest_by_scope[key];
  if (verified) {
    state.snapshot.latest_version = verified.version;
    state.snapshot.latest_version_code = verified.version_code;
    state.snapshot.update_summary = verified.update_summary;
    state.snapshot.update_details = verified.update_details;
    state.snapshot.update_published_at_ms = verified.update_published_at_ms;
    state.snapshot.latest_manifest_verified = true;
    state.snapshot.latest_manifest_verified_sequence = verified.sequence;
    state.snapshot.latest_manifest_source = verified.source;
    return;
  }
  state.snapshot.latest_version = state.snapshot.current_version;
  state.snapshot.latest_version_code = state.snapshot.current_version_code;
  state.snapshot.update_summary = undefined;
  state.snapshot.update_details = undefined;
  state.snapshot.update_published_at_ms = undefined;
  state.snapshot.latest_manifest_verified = false;
  state.snapshot.latest_manifest_verified_sequence = 0;
  state.snapshot.latest_manifest_source = undefined;
}

function shouldShowUpdatePromptForScope(state: UpdateStoreState, channel: string, platform: string): boolean {
  const key = scopeKey(channel, platform);
  const verified = state.verified_latest_by_scope[key];
  if (!verified) {
    return false;
  }
  const scoped = state.applied_version_by_scope[key];
  const currentVersion = scoped?.current_version ?? (scopeMatchesSnapshot(state, channel, platform) ? state.snapshot.current_version : undefined);
  const currentVersionCode = scoped?.current_version_code ?? (scopeMatchesSnapshot(state, channel, platform) ? state.snapshot.current_version_code : undefined);
  const currentSequence = scoped?.sequence ?? 0;
  const latestAhead = compareVersionVector(
    {
      version: verified.version,
      versionCode: verified.version_code,
      sequence: verified.sequence,
    },
    {
      version: currentVersion,
      versionCode: currentVersionCode,
      sequence: currentSequence,
    },
  ) > 0;
  if (!latestAhead) {
    return false;
  }
  const promptedSequence = state.last_prompted_sequence_by_scope[key] ?? 0;
  if (verified.sequence > 0 && verified.sequence <= promptedSequence) {
    return false;
  }
  const promptedVersionCode = state.last_prompted_version_code_by_scope[key] ?? 0;
  const normalizedVersionCode = normalizeVersionCode(verified.version_code);
  if (normalizedVersionCode !== undefined && promptedVersionCode >= normalizedVersionCode) {
    return false;
  }
  return true;
}

function upsertVerifiedLatestForManifest(state: UpdateStoreState, manifest: UpdateManifestV2): VerifiedLatestScopeState {
  const key = scopeKey(manifest.channel, manifest.platform);
  const releaseNotes = extractManifestReleaseNotes(manifest);
  const existing = state.verified_latest_by_scope[key];
  const candidateComparison = compareVersionVector(
    {
      version: manifest.version,
      versionCode: manifest.version_code,
      sequence: manifest.sequence,
    },
    {
      version: existing?.version,
      versionCode: existing?.version_code,
      sequence: existing?.sequence ?? 0,
    },
  );
  if (!existing || candidateComparison > 0 || (candidateComparison === 0 && manifest.sequence >= existing.sequence)) {
    const next: VerifiedLatestScopeState = {
      sequence: manifest.sequence,
      manifest_id: manifest.manifest_id,
      version: manifest.version,
      version_code: manifest.version_code,
      source: 'network_manifest',
      update_summary: releaseNotes?.summary,
      update_details: releaseNotes?.details,
      update_published_at_ms: releaseNotes?.published_at_ms,
      updated_at_ms: Date.now(),
    };
    state.verified_latest_by_scope[key] = next;
    return next;
  }
  return existing;
}

function upsertVerifiedLatestFromInstalledVersion(
  state: UpdateStoreState,
  channel: string,
  platform: string,
  version: string,
  versionCode?: number,
): VerifiedLatestScopeState {
  const key = scopeKey(channel, platform);
  const normalizedVersion = version.trim();
  const normalizedVersionCode = normalizeVersionCode(versionCode) ?? 0;
  const manifestId = installedManifestId(channel, platform, normalizedVersion, normalizedVersionCode);
  const existing = state.verified_latest_by_scope[key];
  const candidateComparison = compareVersionVector(
    {
      version: normalizedVersion,
      versionCode: normalizedVersionCode,
      sequence: 0,
    },
    {
      version: existing?.version,
      versionCode: existing?.version_code,
      sequence: existing?.sequence ?? 0,
    },
  );
  if (existing) {
    if (candidateComparison < 0) {
      return existing;
    }
    if (candidateComparison === 0 && existing.source === 'network_manifest') {
      return existing;
    }
  }
  const next: VerifiedLatestScopeState = {
    sequence: 0,
    manifest_id: manifestId,
    version: normalizedVersion,
    version_code: normalizedVersionCode,
    source: 'installed_package',
    update_summary: undefined,
    update_details: undefined,
    update_published_at_ms: undefined,
    updated_at_ms: Date.now(),
  };
  state.verified_latest_by_scope[key] = next;
  return next;
}

export function setManualCheckInflight(inflight: boolean): void {
  mutate((state) => {
    state.snapshot.manual_check_inflight = inflight;
    if (inflight) {
      state.snapshot.last_checked_at_ms = Date.now();
      state.snapshot.last_manual_check_reason = undefined;
    }
  });
}

export function setManualCheckReason(reason?: string): void {
  mutate((state) => {
    const normalized = reason?.trim();
    state.snapshot.last_manual_check_reason = normalized || undefined;
  });
}

export function setVrfCandidateStatus(
  status: UpdateSnapshot['vrf_candidate_status'],
  carriers: Array<'gossip' | 'feed'> = [],
): void {
  mutate((state) => {
    state.snapshot.vrf_candidate_status = status;
    state.snapshot.vrf_candidate_carriers = [...new Set(carriers)];
  });
}

export function setInstalledVersion(
  channel: string,
  platform: string,
  version: string,
  versionCode?: number,
): void {
  const normalizedVersion = version.trim();
  if (!normalizedVersion) {
    return;
  }
  const normalizedVersionCode = normalizeVersionCode(versionCode);
  mutate((state) => {
    const key = scopeKey(channel, platform);
    const scoped = state.applied_version_by_scope[key];
    const scopedComparison = compareVersionVector(
      {
        version: normalizedVersion,
        versionCode: normalizedVersionCode,
        sequence: scoped?.sequence ?? 0,
      },
      {
        version: scoped?.current_version,
        versionCode: scoped?.current_version_code,
        sequence: scoped?.sequence ?? 0,
      },
    );
    if (!scoped) {
      state.applied_version_by_scope[key] = {
        sequence: 0,
        manifest_id: installedManifestId(channel, platform, normalizedVersion, normalizedVersionCode),
        current_version: normalizedVersion,
        current_version_code: normalizedVersionCode ?? 0,
        previous_version: undefined,
        previous_version_code: undefined,
        updated_at_ms: Date.now(),
      };
    } else if (scopedComparison > 0 || (scopedComparison < 0 && scoped.sequence <= 0)) {
      state.applied_version_by_scope[key] = {
        ...scoped,
        manifest_id: installedManifestId(channel, platform, normalizedVersion, normalizedVersionCode),
        current_version: normalizedVersion,
        current_version_code: normalizedVersionCode ?? scoped.current_version_code,
        previous_version: scoped.current_version,
        previous_version_code: scoped.current_version_code,
        updated_at_ms: Date.now(),
      };
    }

    const snapshotMatchesScope = scopeMatchesSnapshot(state, channel, platform);
    if (snapshotMatchesScope) {
      state.snapshot.current_version = normalizedVersion;
      if (normalizedVersionCode !== undefined) {
        state.snapshot.current_version_code = normalizedVersionCode;
      }
    }
    upsertVerifiedLatestFromInstalledVersion(
      state,
      channel,
      platform,
      normalizedVersion,
      normalizedVersionCode,
    );
    syncSnapshotLatestFromScope(state, channel, platform);
    if (snapshotMatchesScope) {
      state.snapshot.show_update_prompt = shouldShowUpdatePromptForScope(state, channel, platform);
    }
  });
}

export function setManifestDetected(manifest: UpdateManifestV2): void {
  mutate((state) => {
    const previousSnapshot = { ...state.snapshot };
    const key = scopeKey(manifest.channel, manifest.platform);
    const scoped = state.applied_version_by_scope[key];
    const channelMatches = previousSnapshot.channel.toLowerCase() === manifest.channel.toLowerCase();
    const platformMatches = previousSnapshot.platform.toLowerCase() === manifest.platform.toLowerCase();
    const scopedCurrentVersion = (channelMatches && platformMatches && previousSnapshot.current_version)
      ? previousSnapshot.current_version
      : scoped?.current_version;
    const scopedCurrentVersionCode = (channelMatches && platformMatches && normalizeVersionCode(previousSnapshot.current_version_code) !== undefined)
      ? normalizeVersionCode(previousSnapshot.current_version_code)
      : scoped?.current_version_code;
    const scopedPreviousVersion = (channelMatches && platformMatches && previousSnapshot.previous_version)
      ? previousSnapshot.previous_version
      : scoped?.previous_version;
    const scopedPreviousVersionCode = (channelMatches && platformMatches && normalizeVersionCode(previousSnapshot.previous_version_code) !== undefined)
      ? normalizeVersionCode(previousSnapshot.previous_version_code)
      : scoped?.previous_version_code;
    const appliedSequence = scoped?.sequence ?? 0;
    const manifestComparisonToApplied = compareVersionVector(
      {
        version: manifest.version,
        versionCode: manifest.version_code,
        sequence: manifest.sequence,
      },
      {
        version: scopedCurrentVersion,
        versionCode: scopedCurrentVersionCode,
        sequence: appliedSequence,
      },
    );

    state.manifest = manifest;
    if (manifest.sequence > (state.last_manifest_sequence_seen ?? 0)) {
      state.last_manifest_sequence_seen = manifest.sequence;
    }
    state.snapshot.state = 'DETECTED';
    state.snapshot.manifest_id = manifest.manifest_id;
    state.snapshot.channel = manifest.channel;
    state.snapshot.platform = manifest.platform;
    state.snapshot.sequence = manifest.sequence;
    state.snapshot.version = manifest.version;
    state.snapshot.attestor_count = 0;
    state.snapshot.attestation_threshold = manifest.security.attestation_threshold;
    state.snapshot.shell_required = Boolean(manifest.artifacts.some((item) => item.shell_required));
    state.snapshot.emergency = Boolean(manifest.rollout.emergency);
    state.snapshot.current_version = scopedCurrentVersion;
    state.snapshot.current_version_code = scopedCurrentVersionCode;
    state.snapshot.previous_version = scopedPreviousVersion;
    state.snapshot.previous_version_code = scopedPreviousVersionCode;
    const verifiedLatest = upsertVerifiedLatestForManifest(state, manifest);
    syncSnapshotLatestFromScope(state, manifest.channel, manifest.platform);
    const manifestIsLatestVerified = compareVersionVector(
      {
        version: manifest.version,
        versionCode: manifest.version_code,
        sequence: manifest.sequence,
      },
      {
        version: verifiedLatest.version,
        versionCode: verifiedLatest.version_code,
        sequence: verifiedLatest.sequence,
      },
    ) === 0;
    state.snapshot.show_update_prompt = manifestComparisonToApplied > 0
      && manifestIsLatestVerified
      && shouldShowUpdatePromptForScope(state, manifest.channel, manifest.platform);
    state.attestors = [];
  });
}

export function setStateOnly(nextState: UpdateLifecycleState, error?: string): void {
  mutate((state) => {
    state.snapshot.state = nextState;
    state.snapshot.last_error = error;
  });
}

export function setLastError(error?: string): void {
  mutate((state) => {
    state.snapshot.last_error = error;
  });
}

export function addAttestor(peerId: string): number {
  let count = 0;
  mutate((state) => {
    const normalized = peerId.trim();
    if (!normalized) {
      count = state.attestors.length;
      return;
    }
    if (!state.attestors.includes(normalized)) {
      state.attestors.push(normalized);
    }
    state.snapshot.attestor_count = state.attestors.length;
    count = state.attestors.length;
  });
  return count;
}

export function setStagedFile(path: string | undefined): void {
  mutate((state) => {
    state.staged_file_path = path;
  });
}

export function clearStagedFile(): void {
  setStagedFile(undefined);
}

export function markApplied(manifest: UpdateManifestV2): void {
  mutate((state) => {
    state.snapshot.state = 'APPLIED';
    state.snapshot.last_error = undefined;
    const key = scopeKey(manifest.channel, manifest.platform);
    const current = state.max_sequence_applied[key] ?? 0;
    if (manifest.sequence > current) {
      state.max_sequence_applied[key] = manifest.sequence;
    }
    const scoped = state.applied_version_by_scope[key];
    const shouldUpdateScoped =
      !scoped || compareVersionVector(
        {
          version: manifest.version,
          versionCode: manifest.version_code,
          sequence: manifest.sequence,
        },
        {
          version: scoped.current_version,
          versionCode: scoped.current_version_code,
          sequence: scoped.sequence,
        },
      ) > 0;
    if (shouldUpdateScoped) {
      const nextScoped: ScopedVersionState = {
        sequence: manifest.sequence,
        manifest_id: manifest.manifest_id,
        current_version: manifest.version,
        current_version_code: manifest.version_code,
        previous_version: scoped?.current_version,
        previous_version_code: scoped?.current_version_code,
        updated_at_ms: Date.now(),
      };
      state.applied_version_by_scope[key] = nextScoped;
      state.snapshot.current_version = nextScoped.current_version;
      state.snapshot.current_version_code = nextScoped.current_version_code;
      state.snapshot.previous_version = nextScoped.previous_version;
      state.snapshot.previous_version_code = nextScoped.previous_version_code;
    } else {
      state.snapshot.current_version = scoped.current_version;
      state.snapshot.current_version_code = scoped.current_version_code;
      state.snapshot.previous_version = scoped.previous_version;
      state.snapshot.previous_version_code = scoped.previous_version_code;
    }
    upsertVerifiedLatestForManifest(state, manifest);
    syncSnapshotLatestFromScope(state, manifest.channel, manifest.platform);
    state.snapshot.show_update_prompt = shouldShowUpdatePromptForScope(state, manifest.channel, manifest.platform);
    const prompted = state.last_prompted_sequence_by_scope[key] ?? 0;
    if (manifest.sequence > prompted) {
      state.last_prompted_sequence_by_scope[key] = manifest.sequence;
    }
    const normalizedVersionCode = normalizeVersionCode(manifest.version_code);
    if (normalizedVersionCode !== undefined) {
      const promptedVersionCode = state.last_prompted_version_code_by_scope[key] ?? 0;
      if (normalizedVersionCode > promptedVersionCode) {
        state.last_prompted_version_code_by_scope[key] = normalizedVersionCode;
      }
    }
  });
}

export function maxAppliedSequence(channel: string, platform: string): number {
  const key = scopeKey(channel, platform);
  return getUpdateStoreState().max_sequence_applied[key] ?? 0;
}

export function maxAppliedVersionCode(channel: string, platform: string): number {
  const scoped = getScopedVersionState(channel, platform);
  return normalizeVersionCode(scoped?.current_version_code) ?? 0;
}

export function addRevokedManifest(manifestId: string): void {
  mutate((state) => {
    const normalized = manifestId.trim();
    if (!normalized) {
      return;
    }
    if (!state.revoked_manifests.includes(normalized)) {
      state.revoked_manifests.push(normalized);
    }
  });
}

export function isManifestRevoked(manifestId: string): boolean {
  const normalized = manifestId.trim();
  if (!normalized) {
    return false;
  }
  return getUpdateStoreState().revoked_manifests.includes(normalized);
}

export function upsertKillSwitch(entry: {
  channel?: string;
  platform?: string;
  enabled: boolean;
  expires_at_ms?: number;
  reason: string;
}): void {
  mutate((state) => {
    const key = `${(entry.channel ?? '*').toLowerCase()}|${(entry.platform ?? '*').toLowerCase()}`;
    const next = state.killswitches.filter((item) => {
      const itemKey = `${(item.channel ?? '*').toLowerCase()}|${(item.platform ?? '*').toLowerCase()}`;
      return itemKey !== key;
    });
    next.push({ ...entry });
    state.killswitches = next;
  });
}

export function killSwitchActive(channel: string, platform: string, nowMs: number = Date.now()): boolean {
  const normalizedChannel = channel.toLowerCase();
  const normalizedPlatform = platform.toLowerCase();
  return getUpdateStoreState().killswitches.some((item) => {
    if (!item.enabled) {
      return false;
    }
    if (item.expires_at_ms !== undefined && nowMs > item.expires_at_ms) {
      return false;
    }
    if (item.channel && item.channel.toLowerCase() !== normalizedChannel) {
      return false;
    }
    if (item.platform && item.platform.toLowerCase() !== normalizedPlatform) {
      return false;
    }
    return true;
  });
}

export function incrementMetric(name: string, delta = 1): void {
  mutate((state) => {
    const current = state.metrics[name] ?? 0;
    state.metrics[name] = current + delta;
  });
}

export function getScopedVersionState(channel: string, platform: string): ScopedVersionState | null {
  const key = scopeKey(channel, platform);
  const scoped = getUpdateStoreState().applied_version_by_scope[key];
  return scoped ? { ...scoped } : null;
}

export function canShowPublisherZone(channel: string, platform: string): boolean {
  const state = getUpdateStoreState();
  const key = scopeKey(channel, platform);
  const scopedCurrent = state.applied_version_by_scope[key];
  const verifiedLatest = state.verified_latest_by_scope[key];
  const snapshotMatchesScope = scopeMatchesSnapshot(state, channel, platform);
  const currentVersion = scopedCurrent?.current_version ?? (snapshotMatchesScope ? state.snapshot.current_version : undefined);
  const currentVersionCode = scopedCurrent?.current_version_code ?? (snapshotMatchesScope ? state.snapshot.current_version_code : undefined);
  const currentSequence = scopedCurrent?.sequence ?? 0;
  const latestVersion = verifiedLatest?.version ?? (snapshotMatchesScope ? state.snapshot.latest_version : undefined);
  const latestVersionCode = verifiedLatest?.version_code ?? (snapshotMatchesScope ? state.snapshot.latest_version_code : undefined);
  const latestSequence = verifiedLatest?.sequence ?? (snapshotMatchesScope ? state.snapshot.latest_manifest_verified_sequence : 0);
  const latestSource = verifiedLatest?.source ?? (snapshotMatchesScope ? state.snapshot.latest_manifest_source : undefined);
  const latestVerified = Boolean(verifiedLatest) || (snapshotMatchesScope && state.snapshot.latest_manifest_verified);
  const networkHealthy = !(
    snapshotMatchesScope
    && (
      state.snapshot.last_error === 'network_unreachable'
      || state.snapshot.last_manual_check_reason === 'network_unreachable'
    )
  );
  if (!networkHealthy) {
    return false;
  }
  if (!latestVerified) {
    return false;
  }
  // Publisher tools must be unlocked only by network-verified manifests.
  if (latestSource !== 'network_manifest') {
    return false;
  }
  if (!String(currentVersion ?? '').trim() && normalizeVersionCode(currentVersionCode) === undefined && currentSequence <= 0) {
    return false;
  }
  const comparison = compareVersionVector(
    {
      version: latestVersion,
      versionCode: latestVersionCode,
      sequence: latestSequence,
    },
    {
      version: currentVersion,
      versionCode: currentVersionCode,
      sequence: currentSequence,
    },
  );
  return comparison > 0;
}

export function ackUpdatePrompt(channel: string, platform: string, sequence: number, versionCode?: number): void {
  mutate((state) => {
    const key = scopeKey(channel, platform);
    const normalizedSequence = Math.max(0, Math.trunc(sequence));
    const currentPrompted = state.last_prompted_sequence_by_scope[key] ?? 0;
    if (normalizedSequence > currentPrompted) {
      state.last_prompted_sequence_by_scope[key] = normalizedSequence;
    }
    const normalizedVersionCode = normalizeVersionCode(versionCode ?? state.snapshot.latest_version_code);
    if (normalizedVersionCode !== undefined) {
      const currentPromptedVersionCode = state.last_prompted_version_code_by_scope[key] ?? 0;
      if (normalizedVersionCode > currentPromptedVersionCode) {
        state.last_prompted_version_code_by_scope[key] = normalizedVersionCode;
      }
    }
    if (
      state.snapshot.channel.toLowerCase() === channel.toLowerCase() &&
      state.snapshot.platform.toLowerCase() === platform.toLowerCase() &&
      (
        state.snapshot.sequence <= normalizedSequence ||
        (
          normalizedVersionCode !== undefined &&
          (
            normalizeVersionCode(state.snapshot.latest_version_code) ?? 0
          ) <= normalizedVersionCode
        )
      )
    ) {
      state.snapshot.show_update_prompt = false;
    }
  });
}

export function getVrfChainState(channel: string, platform: string): VrfChainScopeState {
  const key = scopeKey(channel, platform);
  const state = getUpdateStoreState().vrf_chain_by_scope[key];
  if (!state) {
    return defaultVrfScopeState();
  }
  const sequence = Number.isFinite(Number(state.last_sequence))
    ? Math.max(0, Math.trunc(Number(state.last_sequence)))
    : 0;
  if (sequence <= 0) {
    return defaultVrfScopeState();
  }
  return {
    last_sequence: sequence,
    last_manifest_hash: normalizeHash(state.last_manifest_hash, GENESIS_PREV_MANIFEST_HASH),
    last_vrf_output_hex: normalizeHash(state.last_vrf_output_hex, GENESIS_PREV_OUTPUT_HEX),
    updated_at_ms: Number.isFinite(Number(state.updated_at_ms))
      ? Math.max(0, Math.trunc(Number(state.updated_at_ms)))
      : 0,
  };
}

export function setVrfChainState(channel: string, platform: string, next: {
  last_sequence: number;
  last_manifest_hash: string;
  last_vrf_output_hex: string;
}): void {
  mutate((state) => {
    const key = scopeKey(channel, platform);
    const sequence = Number.isFinite(Number(next.last_sequence))
      ? Math.max(0, Math.trunc(Number(next.last_sequence)))
      : 0;
    if (sequence <= 0) {
      state.vrf_chain_by_scope[key] = defaultVrfScopeState();
      return;
    }
    state.vrf_chain_by_scope[key] = {
      last_sequence: sequence,
      last_manifest_hash: normalizeHash(next.last_manifest_hash, GENESIS_PREV_MANIFEST_HASH),
      last_vrf_output_hex: normalizeHash(next.last_vrf_output_hex, GENESIS_PREV_OUTPUT_HEX),
      updated_at_ms: Date.now(),
    };
  });
}

export function listPendingCandidates(channel: string, platform: string): PendingVrfCandidateState[] {
  const key = scopeKey(channel, platform);
  const scoped = getUpdateStoreState().pending_candidates_by_scope[key] ?? {};
  return Object.values(scoped).map((item) => ({
    ...item,
    carriers: [...item.carriers],
    manifest: JSON.parse(JSON.stringify(item.manifest)) as UpdateManifestV2,
  }));
}

export function upsertPendingCandidate(candidate: PendingVrfCandidateState): PendingVrfCandidateState {
  const normalized: PendingVrfCandidateState = {
    ...candidate,
    candidate_id: candidate.candidate_id.trim(),
    channel: candidate.channel.trim().toLowerCase(),
    platform: candidate.platform.trim().toLowerCase(),
    manifest_id: candidate.manifest_id.trim(),
    manifest_hash: normalizeHash(candidate.manifest_hash, ''),
    vrf_output_hex: normalizeHash(candidate.vrf_output_hex, ''),
    sequence: Math.max(0, Math.trunc(candidate.sequence)),
    carriers: Array.from(new Set(candidate.carriers)),
    seen_at_ms: Number.isFinite(Number(candidate.seen_at_ms))
      ? Math.max(0, Math.trunc(Number(candidate.seen_at_ms)))
      : Date.now(),
    manifest: JSON.parse(JSON.stringify(candidate.manifest)) as UpdateManifestV2,
  };
  mutate((state) => {
    const key = scopeKey(normalized.channel, normalized.platform);
    const scoped = { ...(state.pending_candidates_by_scope[key] ?? {}) };
    const existing = scoped[normalized.candidate_id];
    if (existing) {
      scoped[normalized.candidate_id] = {
        ...existing,
        ...normalized,
        carriers: Array.from(new Set([...(existing.carriers ?? []), ...normalized.carriers])),
        manifest: JSON.parse(JSON.stringify(normalized.manifest)) as UpdateManifestV2,
        seen_at_ms: Math.max(existing.seen_at_ms, normalized.seen_at_ms),
      };
    } else {
      scoped[normalized.candidate_id] = normalized;
    }
    state.pending_candidates_by_scope[key] = scoped;
  });
  return normalized;
}

export function removePendingCandidate(channel: string, platform: string, candidateId: string): void {
  const normalizedId = candidateId.trim();
  if (!normalizedId) {
    return;
  }
  mutate((state) => {
    const key = scopeKey(channel, platform);
    const scoped = { ...(state.pending_candidates_by_scope[key] ?? {}) };
    if (!scoped[normalizedId]) {
      return;
    }
    delete scoped[normalizedId];
    state.pending_candidates_by_scope[key] = scoped;
  });
}

export function clearPendingCandidates(channel: string, platform: string, options?: { upToSequence?: number }): void {
  mutate((state) => {
    const key = scopeKey(channel, platform);
    const scoped = { ...(state.pending_candidates_by_scope[key] ?? {}) };
    if (!options?.upToSequence) {
      state.pending_candidates_by_scope[key] = {};
      return;
    }
    const boundary = Math.max(0, Math.trunc(options.upToSequence));
    for (const [candidateId, candidate] of Object.entries(scoped)) {
      if (candidate.sequence <= boundary) {
        delete scoped[candidateId];
      }
    }
    state.pending_candidates_by_scope[key] = scoped;
  });
}

export function setTrustedPublisherChain(
  publisherPubkey?: string,
  nextPublisherPubkeySha256?: string,
  sequenceSeen?: number,
): void {
  mutate((state) => {
    state.trusted_publisher_pubkey = publisherPubkey?.trim() || undefined;
    state.trusted_next_pubkey_sha256 = nextPublisherPubkeySha256?.trim() || undefined;
    if (Number.isFinite(sequenceSeen) && Number(sequenceSeen) > state.last_manifest_sequence_seen) {
      state.last_manifest_sequence_seen = Math.max(0, Math.trunc(Number(sequenceSeen)));
    }
  });
}

export function resetUpdateStoreForTests(): void {
  storeState = cloneState(DEFAULT_STATE);
  persistState();
  emit();
}
