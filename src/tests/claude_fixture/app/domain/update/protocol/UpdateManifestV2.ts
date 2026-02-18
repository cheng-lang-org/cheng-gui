export interface UpdateManifestArtifactV2 {
  platform: string;
  kind: string;
  uri: string;
  sha256?: string;
  size_bytes: number;
  diff_base?: string;
  shell_required: boolean;
}

export interface UpdateManifestRolloutV2 {
  percent: number;
  emergency: boolean;
  stages: number[];
}

export interface UpdateManifestPolicyV2 {
  mandatory: boolean;
  min_app_version_code?: number;
  window_start_epoch_ms?: number;
  window_end_epoch_ms?: number;
}

export interface CommitteeSignatureV2 {
  signer: string;
  signature: string;
}

export type UpdateSecurityModeV2 = 'committee_threshold' | 'single_publisher_chain' | 'vrf_chain_v1';

export interface UpdateManifestVrfProofV2 {
  scheme: 'ed25519_sig_vrf_v1';
  publisher_peer_id: string;
  vrf_public_key_hex: string;
  prev_manifest_hash: string;
  prev_vrf_output_hex: string;
  vrf_input_hex: string;
  vrf_proof_base64: string;
  vrf_output_hex: string;
}

export interface UpdateManifestSecurityV2 {
  mode: UpdateSecurityModeV2;
  threshold: number;
  committee_keys: string[];
  signatures: CommitteeSignatureV2[];
  publisher_pubkey?: string;
  next_publisher_pubkey_sha256?: string;
  attestation_threshold: number;
  vrf?: UpdateManifestVrfProofV2;
}

export interface UpdateManifestAnchorV2 {
  chain: string;
  tx_hash?: string;
  manifest_hash?: string;
}

export interface UpdateManifestV2 {
  kind: string;
  schema_version: number;
  manifest_id: string;
  channel: string;
  platform: string;
  sequence: number;
  version: string;
  version_code: number;
  artifacts: UpdateManifestArtifactV2[];
  rollout: UpdateManifestRolloutV2;
  policy: UpdateManifestPolicyV2;
  security: UpdateManifestSecurityV2;
  anchor?: UpdateManifestAnchorV2;
  metadata?: Record<string, unknown>;
}

export interface UpdateReleaseNotesV2 {
  summary: string;
  details: string;
  published_at_ms: number;
}

export interface ManifestThresholdResult {
  ok: boolean;
  required: number;
  matched_signers: string[];
}

const DEFAULT_STAGES = [1, 10, 50, 100];

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item).trim())
    .filter((item) => item.length > 0);
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asNumber(item, Number.NaN))
    .filter((item) => Number.isFinite(item));
}

function parseReleaseNotesRecord(value: unknown): UpdateReleaseNotesV2 | null {
  const obj = asObject(value);
  if (!obj) {
    return null;
  }
  const summary = asString(obj.summary).trim();
  const details = asString(obj.details).trim();
  if (!summary || !details) {
    return null;
  }
  const publishedAtMs = Math.max(0, Math.trunc(asNumber(obj.published_at_ms ?? obj.publishedAtMs ?? Date.now(), Date.now())));
  return {
    summary,
    details,
    published_at_ms: publishedAtMs,
  };
}

function normalizeMetadata(raw: unknown): Record<string, unknown> | undefined {
  const obj = asObject(raw);
  if (!obj) {
    return undefined;
  }
  const normalized: Record<string, unknown> = { ...obj };
  const releaseNotes = parseReleaseNotesRecord(obj.release_notes ?? obj.releaseNotes);
  if (releaseNotes) {
    normalized.release_notes = releaseNotes;
  }
  return normalized;
}

function parseArtifacts(raw: unknown, defaultPlatform: string): UpdateManifestArtifactV2[] {
  const out: UpdateManifestArtifactV2[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const item = asObject(row);
      if (!item) {
        continue;
      }
      const uri = asString(item.uri || item.url || item.apk_cid).trim();
      if (!uri) {
        continue;
      }
      out.push({
        platform: asString(item.platform, defaultPlatform).trim() || defaultPlatform,
        kind: asString(item.kind || item.mode, 'full').trim() || 'full',
        uri,
        sha256: asString(item.sha256).trim() || undefined,
        size_bytes: Math.max(0, Math.trunc(asNumber(item.size_bytes ?? item.size ?? item.sizeBytes, 0))),
        diff_base: asString(item.diff_base || item.base).trim() || undefined,
        shell_required: asBoolean(item.shell_required, false),
      });
    }
    return out;
  }

  const asObj = asObject(raw);
  if (!asObj) {
    return out;
  }
  for (const [platformKey, node] of Object.entries(asObj)) {
    const item = asObject(node);
    if (!item) {
      continue;
    }
    const uri = asString(item.uri || item.url || item.apk_cid).trim();
    if (!uri) {
      continue;
    }
    out.push({
      platform: asString(item.platform, platformKey).trim() || defaultPlatform,
      kind: asString(item.kind || item.mode, 'full').trim() || 'full',
      uri,
      sha256: asString(item.sha256).trim() || undefined,
      size_bytes: Math.max(0, Math.trunc(asNumber(item.size_bytes ?? item.size ?? item.sizeBytes, 0))),
      diff_base: asString(item.diff_base || item.base).trim() || undefined,
      shell_required: asBoolean(item.shell_required, false),
    });
  }
  return out;
}

function parseSignatures(raw: unknown): CommitteeSignatureV2[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: CommitteeSignatureV2[] = [];
  for (const row of raw) {
    const item = asObject(row);
    if (!item) {
      continue;
    }
    const signer = asString(item.signer || item.key_id).trim();
    const signature = asString(item.signature || item.sig).trim();
    if (!signer || !signature) {
      continue;
    }
    out.push({ signer, signature });
  }
  return out;
}

export function parseManifestVrfSecurity(raw: unknown): UpdateManifestVrfProofV2 | undefined {
  const obj = asObject(raw);
  if (!obj) {
    return undefined;
  }
  const schemeRaw = asString(obj.scheme, 'ed25519_sig_vrf_v1').trim().toLowerCase();
  const scheme = schemeRaw === 'ed25519_sig_vrf_v1' ? 'ed25519_sig_vrf_v1' : '';
  const publisherPeerId = asString(obj.publisher_peer_id ?? obj.publisherPeerId).trim();
  const vrfPublicKeyHex = asString(obj.vrf_public_key_hex ?? obj.vrfPublicKeyHex).trim().toLowerCase();
  const prevManifestHash = asString(obj.prev_manifest_hash ?? obj.prevManifestHash).trim().toLowerCase();
  const prevVrfOutputHex = asString(obj.prev_vrf_output_hex ?? obj.prevVrfOutputHex).trim().toLowerCase();
  const vrfInputHex = asString(obj.vrf_input_hex ?? obj.vrfInputHex).trim().toLowerCase();
  const vrfProofBase64 = asString(obj.vrf_proof_base64 ?? obj.vrfProofBase64).trim();
  const vrfOutputHex = asString(obj.vrf_output_hex ?? obj.vrfOutputHex).trim().toLowerCase();
  if (
    scheme !== 'ed25519_sig_vrf_v1' ||
    !publisherPeerId ||
    !vrfPublicKeyHex ||
    !prevManifestHash ||
    !prevVrfOutputHex ||
    !vrfInputHex ||
    !vrfProofBase64 ||
    !vrfOutputHex
  ) {
    return undefined;
  }
  return {
    scheme,
    publisher_peer_id: publisherPeerId,
    vrf_public_key_hex: vrfPublicKeyHex,
    prev_manifest_hash: prevManifestHash,
    prev_vrf_output_hex: prevVrfOutputHex,
    vrf_input_hex: vrfInputHex,
    vrf_proof_base64: vrfProofBase64,
    vrf_output_hex: vrfOutputHex,
  };
}

function mapLegacyV1ToV2(value: Record<string, unknown>): UpdateManifestV2 | null {
  const url = asString(value.url || value.apk_cid).trim();
  if (!url) {
    return null;
  }
  const versionCode = Math.max(0, Math.trunc(asNumber(value.versionCode ?? value.version_code, 0)));
  const version = asString(value.version || value.versionName, String(versionCode || 0)).trim() || String(versionCode || 0);
  const channel = asString(value.channel, 'stable').trim() || 'stable';
  const platform = asString(value.platform, 'android').trim() || 'android';
  const sequence = Math.max(0, Math.trunc(asNumber(value.sequence, versionCode)));
  const manifestId = asString(value.manifest_id).trim() || `mf_${channel}_${platform}_${sequence || versionCode || 0}`;
  const percent = Math.max(0, Math.min(100, Math.trunc(asNumber(value.percent, 100))));

  return {
    kind: 'manifest_v2',
    schema_version: 2,
    manifest_id: manifestId,
    channel,
    platform,
    sequence,
    version,
    version_code: versionCode,
    artifacts: [
      {
        platform,
        kind: asString(value.mode, 'full').trim() || 'full',
        uri: url,
        sha256: asString(value.sha256).trim() || undefined,
        size_bytes: Math.max(0, Math.trunc(asNumber(value.size || value.sizeBytes, 0))),
        diff_base: asString(value.base).trim() || undefined,
        shell_required: false,
      },
    ],
    rollout: {
      percent,
      emergency: false,
      stages: DEFAULT_STAGES,
    },
    policy: {
      mandatory: asBoolean(value.mandatory, false),
      min_app_version_code: Number.isFinite(asNumber(value.minAppVersionCode, Number.NaN))
        ? Math.trunc(asNumber(value.minAppVersionCode, 0))
        : undefined,
      window_start_epoch_ms: Number.isFinite(asNumber(value.windowStartEpochMs, Number.NaN))
        ? Math.trunc(asNumber(value.windowStartEpochMs, 0))
        : undefined,
      window_end_epoch_ms: Number.isFinite(asNumber(value.windowEndEpochMs, Number.NaN))
        ? Math.trunc(asNumber(value.windowEndEpochMs, 0))
        : undefined,
    },
    security: {
      mode: 'committee_threshold',
      threshold: 0,
      committee_keys: [],
      signatures: [],
      attestation_threshold: 0,
    },
    metadata: {
      legacy_v1_mapped: true,
    },
  };
}

export function isLikelyManifestV2(value: unknown): boolean {
  const obj = asObject(value);
  if (!obj) {
    return false;
  }
  const kind = asString(obj.kind).toLowerCase();
  if (asNumber(obj.schema_version, 0) === 2) {
    return true;
  }
  if (kind.includes('manifest_v2')) {
    return true;
  }
  return obj.sequence !== undefined && obj.artifacts !== undefined && obj.platform !== undefined && obj.channel !== undefined;
}

export function parseManifestV2(value: unknown): UpdateManifestV2 | null {
  const obj = asObject(value);
  if (!obj) {
    return null;
  }

  if (!isLikelyManifestV2(obj)) {
    return mapLegacyV1ToV2(obj);
  }

  const channel = asString(obj.channel, 'stable').trim() || 'stable';
  const platform = asString(obj.platform, 'android').trim() || 'android';
  const sequence = Math.max(0, Math.trunc(asNumber(obj.sequence, 0)));
  const version = asString(obj.version || obj.version_name || obj.versionName, '0.0.0').trim() || '0.0.0';
  const versionCode = Math.max(0, Math.trunc(asNumber(obj.version_code ?? obj.versionCode, sequence)));

  const artifacts = parseArtifacts(obj.artifacts, platform);
  if (artifacts.length === 0) {
    return null;
  }

  const rolloutObj = asObject(obj.rollout);
  const policyObj = asObject(obj.policy);
  const securityObj = asObject(obj.security);
  const anchorObj = asObject(obj.anchor);
  const metadata = normalizeMetadata(obj.metadata);
  const parsedStages = asNumberArray(rolloutObj?.stages)
    .map((item) => Math.max(0, Math.min(100, Math.trunc(item))))
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort((a, b) => a - b);

  const manifestId = asString(obj.manifest_id).trim() || `mf_${channel}_${platform}_${sequence || versionCode || 0}`;

  const securityModeRaw = asString(securityObj?.mode).trim().toLowerCase();
  const parsedVrf = parseManifestVrfSecurity(securityObj?.vrf ?? obj.vrf);
  let securityMode: UpdateSecurityModeV2;
  if (securityModeRaw === 'vrf_chain_v1' || securityModeRaw === 'vrf') {
    securityMode = 'vrf_chain_v1';
  } else if (securityModeRaw === 'single_publisher_chain' || securityModeRaw === 'single') {
    securityMode = 'single_publisher_chain';
  } else if (securityModeRaw === 'committee_threshold') {
    securityMode = 'committee_threshold';
  } else if (parsedVrf) {
    securityMode = 'vrf_chain_v1';
  } else if (asString(securityObj?.publisher_pubkey).trim().length > 0) {
    securityMode = 'single_publisher_chain';
  } else {
    securityMode = 'committee_threshold';
  }

  return {
    kind: asString(obj.kind, 'manifest_v2').trim() || 'manifest_v2',
    schema_version: Math.max(2, Math.trunc(asNumber(obj.schema_version, 2))),
    manifest_id: manifestId,
    channel,
    platform,
    sequence,
    version,
    version_code: versionCode,
    artifacts,
    rollout: {
      percent: Math.max(0, Math.min(100, Math.trunc(asNumber(rolloutObj?.percent ?? obj.percent, 100)))),
      emergency: asBoolean(rolloutObj?.emergency, false),
      stages: parsedStages.length > 0 ? parsedStages : DEFAULT_STAGES,
    },
    policy: {
      mandatory: asBoolean(policyObj?.mandatory ?? obj.mandatory, false),
      min_app_version_code: policyObj?.minAppVersionCode !== undefined
        ? Math.trunc(asNumber(policyObj.minAppVersionCode, 0))
        : policyObj?.min_app_version_code !== undefined
          ? Math.trunc(asNumber(policyObj.min_app_version_code, 0))
          : undefined,
      window_start_epoch_ms: policyObj?.windowStartEpochMs !== undefined
        ? Math.trunc(asNumber(policyObj.windowStartEpochMs, 0))
        : policyObj?.window_start_epoch_ms !== undefined
          ? Math.trunc(asNumber(policyObj.window_start_epoch_ms, 0))
          : undefined,
      window_end_epoch_ms: policyObj?.windowEndEpochMs !== undefined
        ? Math.trunc(asNumber(policyObj.windowEndEpochMs, 0))
        : policyObj?.window_end_epoch_ms !== undefined
          ? Math.trunc(asNumber(policyObj.window_end_epoch_ms, 0))
          : undefined,
    },
    security: {
      mode: securityMode,
      threshold: Math.max(0, Math.trunc(asNumber(securityObj?.threshold ?? obj.min_signatures, 3))),
      committee_keys: asStringArray(securityObj?.committee_keys ?? securityObj?.committee ?? obj.committee_keys),
      signatures: parseSignatures(securityObj?.signatures ?? obj.signatures),
      publisher_pubkey: asString(
        securityObj?.publisher_pubkey ?? securityObj?.publisherPubkey ?? obj.publisher_pubkey,
      ).trim() || undefined,
      next_publisher_pubkey_sha256: asString(
        securityObj?.next_publisher_pubkey_sha256 ??
          securityObj?.nextPublisherPubkeySha256 ??
          obj.next_publisher_pubkey_sha256,
      ).trim() || undefined,
      attestation_threshold: Math.max(0, Math.trunc(asNumber(securityObj?.attestation_threshold, 0))),
      vrf: parsedVrf,
    },
    anchor: anchorObj || obj.anchor_chain || obj.anchor_tx_hash
      ? {
          chain: asString(anchorObj?.chain ?? obj.anchor_chain, ''),
          tx_hash: asString(anchorObj?.tx_hash ?? obj.anchor_tx_hash).trim() || undefined,
          manifest_hash: asString(anchorObj?.manifest_hash ?? obj.manifest_hash).trim() || undefined,
        }
      : undefined,
    metadata,
  };
}

export function verifyManifestThreshold(manifest: UpdateManifestV2, defaultThreshold = 3): ManifestThresholdResult {
  if (manifest.security.mode === 'vrf_chain_v1') {
    return {
      ok: Boolean(manifest.security.vrf),
      required: 0,
      matched_signers: [],
    };
  }

  if (manifest.security.mode === 'single_publisher_chain') {
    const publisher = manifest.security.publisher_pubkey?.trim() ?? '';
    const matched = manifest.security.signatures
      .filter((item) => item.signature.trim().length > 0 && item.signer.trim().length > 0)
      .map((item) => item.signer.trim())
      .filter((item, index, arr) => arr.indexOf(item) === index);
    const requiresPublisher = publisher.length > 0;
    const publisherMatched = requiresPublisher ? matched.includes(publisher) : matched.length > 0;
    return {
      ok: publisherMatched,
      required: 1,
      matched_signers: matched,
    };
  }

  const required = manifest.security.threshold > 0 ? manifest.security.threshold : defaultThreshold;
  if (required <= 0) {
    return { ok: true, required: 0, matched_signers: [] };
  }
  const committee = new Set(manifest.security.committee_keys.map((item) => item.trim()).filter((item) => item.length > 0));
  const matched = new Set<string>();
  for (const signature of manifest.security.signatures) {
    if (!signature.signer || !signature.signature) {
      continue;
    }
    if (committee.size === 0 || committee.has(signature.signer)) {
      matched.add(signature.signer);
    }
  }
  const matchedSigners = Array.from(matched.values());
  return {
    ok: matchedSigners.length >= required,
    required,
    matched_signers: matchedSigners,
  };
}

export function selectArtifact(manifest: UpdateManifestV2, preferredPlatform: string): UpdateManifestArtifactV2 | null {
  const preferred = preferredPlatform.trim().toLowerCase();
  if (preferred) {
    const matched = manifest.artifacts.find((item) => item.platform.toLowerCase() === preferred);
    if (matched) {
      return matched;
    }
  }
  const fallback = manifest.artifacts.find((item) => item.platform.toLowerCase() === manifest.platform.toLowerCase());
  return fallback ?? manifest.artifacts[0] ?? null;
}

export function manifestFromUnknown(value: unknown): UpdateManifestV2 | null {
  return parseManifestV2(value);
}

export function extractManifestReleaseNotes(manifest: UpdateManifestV2 | null | undefined): UpdateReleaseNotesV2 | null {
  if (!manifest) {
    return null;
  }
  return parseReleaseNotesRecord(manifest.metadata?.release_notes ?? manifest.metadata?.releaseNotes);
}
