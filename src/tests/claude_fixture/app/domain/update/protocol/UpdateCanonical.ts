import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function asCanonical(value: unknown): CanonicalValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => asCanonical(item));
  }
  if (typeof value === 'object') {
    const out: { [key: string]: CanonicalValue } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = asCanonical(item);
    }
    return out;
  }
  return String(value);
}

export function canonicalize(value: unknown): string {
  const normalized = asCanonical(value);
  return canonicalizeNormalized(normalized);
}

function canonicalizeNormalized(value: CanonicalValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeNormalized(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeNormalized(value[key])}`);
  return `{${pairs.join(',')}}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(digest));
  }
  return bytesToHex(nobleSha256(bytes));
}
