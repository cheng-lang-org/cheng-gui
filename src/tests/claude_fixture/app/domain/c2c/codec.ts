import { C2C_SCHEMAS, C2C_TOPICS, isC2CSchema, isC2CTopic, type C2CEnvelope, type C2CSchema, type C2CTopic } from './types';
import type { JsonValue } from '../../libp2p/definitions';

const NONCE_STORAGE_KEY = 'unimaker_c2c_seen_nonces_v2';
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_CLOCK_DRIFT_MS = 2 * 60 * 1000;

interface EscrowParts {
  assetId: string;
  qty: number;
  seller: string;
  buyer: string;
  nonce: string;
}

interface EnvelopeSignPayload<TPayload extends JsonValue> {
  schema: C2CSchema;
  topic: C2CTopic;
  payload: TPayload;
  signer: string;
  privateKeyPkcs8: string;
  ttlMs?: number;
  ts?: number;
  nonce?: string;
  traceId?: string;
}

interface EnvelopeVerifyOptions {
  nowMs?: number;
  checkReplay?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim().toLowerCase();
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error('invalid hex data');
  }
  const output = new Uint8Array(normalized.length / 2);
  for (let idx = 0; idx < output.length; idx += 1) {
    output[idx] = Number.parseInt(normalized.slice(idx * 2, idx * 2 + 2), 16);
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let idx = 0; idx < bytes.length; idx += 1) {
    binary += String.fromCharCode(bytes[idx]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let idx = 0; idx < binary.length; idx += 1) {
    output[idx] = binary.charCodeAt(idx);
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function normalizePkcs8(privateKeyPkcs8: string): string {
  const trimmed = privateKeyPkcs8.trim();
  if (trimmed.startsWith('pkcs8:')) {
    return trimmed.slice('pkcs8:'.length).trim();
  }
  return trimmed;
}

function quoteJsonString(value: string): string {
  return JSON.stringify(value);
}

function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return quoteJsonString(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('non-finite number in canonical json');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (!isRecord(value)) {
    throw new Error('unsupported canonical json value');
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${quoteJsonString(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function parseNonceMap(raw: string | null): Record<string, number> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    const output: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key !== 'string') {
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        continue;
      }
      output[key] = value;
    }
    return output;
  } catch {
    return {};
  }
}

function saveNonceMap(map: Record<string, number>): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(NONCE_STORAGE_KEY, JSON.stringify(map));
}

function loadNonceMap(): Record<string, number> {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  return parseNonceMap(localStorage.getItem(NONCE_STORAGE_KEY));
}

function consumeNonce(nonce: string, expiresAtMs: number, nowMs: number): boolean {
  const map = loadNonceMap();
  const compacted: Record<string, number> = {};
  for (const [key, expiry] of Object.entries(map)) {
    if (expiry > nowMs) {
      compacted[key] = expiry;
    }
  }
  if (compacted[nonce] && compacted[nonce] > nowMs) {
    return false;
  }
  compacted[nonce] = expiresAtMs;
  saveNonceMap(compacted);
  return true;
}

function schemaMatchesTopic(schema: C2CSchema, topic: C2CTopic): boolean {
  return schema === topic;
}

function signingView<TPayload extends JsonValue>(envelope: Omit<C2CEnvelope<TPayload>, 'sig'>): string {
  return canonicalize(envelope);
}

function normalizeTraceId(traceId?: string): string {
  const trimmed = traceId?.trim() ?? '';
  if (trimmed.length > 0) {
    return trimmed;
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNonce(nonce?: string): string {
  const trimmed = nonce?.trim() ?? '';
  if (trimmed.length > 0) {
    return trimmed;
  }
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(stringToBytes(value)));
  return bytesToHex(new Uint8Array(digest));
}

export function buildEscrowId(parts: EscrowParts): string {
  if (!parts.assetId || !parts.seller || !parts.buyer || !parts.nonce) {
    throw new Error('invalid escrow parts');
  }
  if (!Number.isInteger(parts.qty) || parts.qty <= 0) {
    throw new Error('qty must be a positive integer');
  }
  return `mkt1:${parts.assetId}:${parts.qty}:${parts.seller}:${parts.buyer}:${parts.nonce}`;
}

export function parseEscrowId(escrowId: string): EscrowParts | null {
  const normalized = escrowId.trim();
  if (!normalized.startsWith('mkt1:')) {
    return null;
  }
  const parts = normalized.split(':');
  if (parts.length !== 6) {
    return null;
  }
  const qty = Number.parseInt(parts[2], 10);
  if (!Number.isInteger(qty) || qty <= 0) {
    return null;
  }
  return {
    assetId: parts[1],
    qty,
    seller: parts[3],
    buyer: parts[4],
    nonce: parts[5],
  };
}

export function decodeEnvelope(value: unknown): C2CEnvelope<JsonValue> | null {
  if (!isRecord(value)) {
    return null;
  }
  const schema = typeof value.schema === 'string' ? value.schema : '';
  const topic = typeof value.topic === 'string' ? value.topic : '';
  if (!isC2CSchema(schema) || !isC2CTopic(topic)) {
    return null;
  }
  if (typeof value.version !== 'string' || value.version !== 'v2') {
    return null;
  }
  if (typeof value.ts !== 'number' || !Number.isFinite(value.ts)) {
    return null;
  }
  if (typeof value.ttlMs !== 'number' || !Number.isFinite(value.ttlMs) || value.ttlMs <= 0) {
    return null;
  }
  if (typeof value.nonce !== 'string' || value.nonce.trim().length === 0) {
    return null;
  }
  if (typeof value.signer !== 'string' || value.signer.trim().length === 0) {
    return null;
  }
  if (typeof value.sig !== 'string' || value.sig.trim().length === 0) {
    return null;
  }
  if (typeof value.traceId !== 'string' || value.traceId.trim().length === 0) {
    return null;
  }
  const payload = value.payload as JsonValue;
  return {
    schema,
    topic,
    version: 'v2',
    ts: value.ts,
    ttlMs: value.ttlMs,
    nonce: value.nonce,
    signer: value.signer,
    sig: value.sig,
    traceId: value.traceId,
    payload,
  };
}

async function importPrivateEd25519Key(privateKeyPkcs8: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64ToBytes(normalizePkcs8(privateKeyPkcs8))),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

async function importPublicEd25519Key(publicKeyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(hexToBytes(publicKeyHex)), { name: 'Ed25519' }, false, ['verify']);
}

export async function signEnvelopePayload<TPayload extends JsonValue>(
  input: EnvelopeSignPayload<TPayload>,
): Promise<C2CEnvelope<TPayload>> {
  const ts = typeof input.ts === 'number' ? input.ts : Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const nonce = normalizeNonce(input.nonce);
  const unsigned: Omit<C2CEnvelope<TPayload>, 'sig'> = {
    schema: input.schema,
    topic: input.topic,
    version: 'v2',
    ts,
    nonce,
    ttlMs,
    signer: input.signer,
    traceId: normalizeTraceId(input.traceId),
    payload: input.payload,
  };
  const key = await importPrivateEd25519Key(input.privateKeyPkcs8);
  const payloadBytes = stringToBytes(signingView(unsigned));
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, toArrayBuffer(payloadBytes));
  return {
    ...unsigned,
    sig: bytesToBase64(new Uint8Array(signature)),
  };
}

export async function verifyEnvelopeSignature(
  envelope: C2CEnvelope<JsonValue>,
  options: EnvelopeVerifyOptions = {},
): Promise<{ ok: boolean; reason?: string }> {
  const nowMs = options.nowMs ?? Date.now();
  if (!schemaMatchesTopic(envelope.schema, envelope.topic)) {
    return { ok: false, reason: 'schema_topic_mismatch' };
  }
  if (!Object.values(C2C_SCHEMAS).includes(envelope.schema) || !Object.values(C2C_TOPICS).includes(envelope.topic)) {
    return { ok: false, reason: 'unsupported_schema_or_topic' };
  }
  if (envelope.ts - MAX_CLOCK_DRIFT_MS > nowMs) {
    return { ok: false, reason: 'future_timestamp' };
  }
  if (envelope.ts + envelope.ttlMs < nowMs) {
    return { ok: false, reason: 'expired' };
  }
  if (options.checkReplay !== false) {
    const consumed = consumeNonce(envelope.nonce, envelope.ts + envelope.ttlMs, nowMs);
    if (!consumed) {
      return { ok: false, reason: 'replayed_nonce' };
    }
  }
  if (!/^[0-9a-fA-F]{64}$/.test(envelope.signer)) {
    return { ok: false, reason: 'invalid_signer_pubkey' };
  }
  try {
    const publicKey = await importPublicEd25519Key(envelope.signer);
    const signature = base64ToBytes(envelope.sig);
    const unsigned: Omit<C2CEnvelope<JsonValue>, 'sig'> = {
      schema: envelope.schema,
      topic: envelope.topic,
      version: envelope.version,
      ts: envelope.ts,
      nonce: envelope.nonce,
      ttlMs: envelope.ttlMs,
      signer: envelope.signer,
      traceId: envelope.traceId,
      payload: envelope.payload,
    };
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(stringToBytes(signingView(unsigned))),
    );
    return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'verify_failed',
    };
  }
}

export function c2cDefaultTtlMs(): number {
  return DEFAULT_TTL_MS;
}
