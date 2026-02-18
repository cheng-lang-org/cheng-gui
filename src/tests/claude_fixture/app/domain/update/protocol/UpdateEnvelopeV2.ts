import { canonicalize, sha256Hex } from './UpdateCanonical';

export interface UpdateEnvelopeV2 {
  kind: string;
  schema_version: number;
  nonce: string;
  expires_at_ms: number;
  // Optional in vrf_chain_v1 mode.
  signer?: string;
  // Optional in vrf_chain_v1 mode.
  signature?: string;
  payload_hash?: string;
  payload: Record<string, unknown>;
}

export interface EnvelopeVerifyResult {
  ok: boolean;
  reason?: string;
}

const DEFAULT_KIND = 'update_envelope_v2';

export function isLikelyEnvelope(value: unknown): value is UpdateEnvelopeV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.nonce === 'string' && record.payload !== undefined;
}

export function parseEnvelopeV2(value: unknown): UpdateEnvelopeV2 | null {
  if (!isLikelyEnvelope(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const payloadRaw = record.payload;
  let payload: Record<string, unknown> | null = null;
  if (payloadRaw && typeof payloadRaw === 'object' && !Array.isArray(payloadRaw)) {
    payload = payloadRaw as Record<string, unknown>;
  } else if (typeof payloadRaw === 'string') {
    try {
      const parsed = JSON.parse(payloadRaw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }
  if (!payload) {
    return null;
  }

  const nonce = String(record.nonce ?? '').trim();
  if (nonce.length === 0) {
    return null;
  }

  const expires = Number(record.expires_at_ms ?? 0);
  const signer = String(record.signer ?? '').trim();
  const signature = String(record.signature ?? '').trim();
  return {
    kind: String(record.kind ?? DEFAULT_KIND) || DEFAULT_KIND,
    schema_version: Number(record.schema_version ?? 2),
    nonce,
    expires_at_ms: Number.isFinite(expires) ? expires : 0,
    signer: signer || undefined,
    signature: signature || undefined,
    payload_hash: String(record.payload_hash ?? '').trim() || undefined,
    payload,
  };
}

export function envelopeIsExpired(envelope: UpdateEnvelopeV2, nowMs: number = Date.now()): boolean {
  return envelope.expires_at_ms > 0 && nowMs > envelope.expires_at_ms;
}

export async function envelopePayloadHashMatches(envelope: UpdateEnvelopeV2): Promise<boolean> {
  if (!envelope.payload_hash) {
    return false;
  }
  const actual = await sha256Hex(canonicalize(envelope.payload));
  return actual.toLowerCase() === envelope.payload_hash.toLowerCase();
}

export function envelopeSigningCanonical(envelope: UpdateEnvelopeV2): string {
  return canonicalize({
    kind: envelope.kind,
    schema_version: envelope.schema_version,
    nonce: envelope.nonce,
    expires_at_ms: envelope.expires_at_ms,
    signer: envelope.signer ?? null,
    payload_hash: envelope.payload_hash ?? null,
  });
}
