export interface UpdateAttestationV2 {
  kind: string;
  schema_version: number;
  manifest_id: string;
  attestor_peer_id: string;
  verdict: string;
  timestamp_ms: number;
  signer: string;
  signature: string;
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

export function isLikelyAttestationV2(value: unknown): boolean {
  const obj = asObject(value);
  if (!obj) {
    return false;
  }
  const kind = asString(obj.kind).toLowerCase();
  if (kind.includes('attestation_v2')) {
    return true;
  }
  return obj.manifest_id !== undefined && obj.attestor_peer_id !== undefined;
}

export function parseAttestationV2(value: unknown): UpdateAttestationV2 | null {
  const obj = asObject(value);
  if (!obj || !isLikelyAttestationV2(obj)) {
    return null;
  }
  const manifestId = asString(obj.manifest_id || obj.manifestId).trim();
  const attestor = asString(obj.attestor_peer_id || obj.attestor).trim();
  if (!manifestId || !attestor) {
    return null;
  }
  return {
    kind: asString(obj.kind, 'attestation_v2') || 'attestation_v2',
    schema_version: Math.max(2, Math.trunc(asNumber(obj.schema_version, 2))),
    manifest_id: manifestId,
    attestor_peer_id: attestor,
    verdict: asString(obj.verdict, 'ok') || 'ok',
    timestamp_ms: Math.trunc(asNumber(obj.timestamp_ms, Date.now())),
    signer: asString(obj.signer, attestor) || attestor,
    signature: asString(obj.signature),
  };
}

export function attestationIsPositive(value: UpdateAttestationV2): boolean {
  return value.verdict.trim().toLowerCase() === 'ok';
}
