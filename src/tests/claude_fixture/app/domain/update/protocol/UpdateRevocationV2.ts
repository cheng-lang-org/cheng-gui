import type { UpdateManifestV2, UpdateManifestVrfProofV2 } from './UpdateManifestV2';
import { parseManifestVrfSecurity } from './UpdateManifestV2';

export interface UpdateRevocationV2 {
  kind: string;
  schema_version: number;
  sequence?: number;
  manifest_id?: string;
  channel?: string;
  platform?: string;
  max_sequence?: number;
  reason: string;
  timestamp_ms: number;
  signer?: string;
  signature?: string;
  targets: string[];
  vrf?: UpdateManifestVrfProofV2;
}

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

function parseTargets(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item).trim()).filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return [];
}

export function isLikelyRevocationV2(value: unknown): boolean {
  const obj = asObject(value);
  if (!obj) {
    return false;
  }
  const kind = asString(obj.kind).toLowerCase();
  if (kind.includes('revoke') || kind.includes('revocation')) {
    return true;
  }
  return obj.manifest_id !== undefined || obj.max_sequence !== undefined;
}

export function parseRevocationV2(value: unknown): UpdateRevocationV2 | null {
  const obj = asObject(value);
  if (!obj || !isLikelyRevocationV2(obj)) {
    return null;
  }
  const maxSequenceSource = obj.max_sequence ?? obj.sequence;
  const hasMaxSequence = maxSequenceSource !== undefined && maxSequenceSource !== null && String(maxSequenceSource).length > 0;
  const sequenceSource = obj.sequence;
  const hasSequence = sequenceSource !== undefined && sequenceSource !== null && String(sequenceSource).length > 0;
  return {
    kind: asString(obj.kind, 'revocation_v2') || 'revocation_v2',
    schema_version: Math.max(2, Math.trunc(asNumber(obj.schema_version, 2))),
    sequence: hasSequence ? Math.max(0, Math.trunc(asNumber(sequenceSource, 0))) : undefined,
    manifest_id: asString(obj.manifest_id || obj.manifestId).trim() || undefined,
    channel: asString(obj.channel).trim() || undefined,
    platform: asString(obj.platform).trim() || undefined,
    max_sequence: hasMaxSequence ? Math.trunc(asNumber(maxSequenceSource, 0)) : undefined,
    reason: asString(obj.reason, 'revoked') || 'revoked',
    timestamp_ms: Math.trunc(asNumber(obj.timestamp_ms, Date.now())),
    signer: asString(obj.signer).trim() || undefined,
    signature: asString(obj.signature).trim() || undefined,
    targets: parseTargets(obj.targets),
    vrf: parseManifestVrfSecurity(obj.vrf),
  };
}

export function revocationAppliesToManifest(revocation: UpdateRevocationV2, manifest: UpdateManifestV2): boolean {
  if (revocation.channel && revocation.channel.toLowerCase() !== manifest.channel.toLowerCase()) {
    return false;
  }
  if (revocation.platform && revocation.platform.toLowerCase() !== manifest.platform.toLowerCase()) {
    return false;
  }
  if (revocation.manifest_id && revocation.manifest_id !== manifest.manifest_id) {
    return false;
  }
  if (revocation.max_sequence !== undefined && manifest.sequence > revocation.max_sequence) {
    return false;
  }
  return true;
}
