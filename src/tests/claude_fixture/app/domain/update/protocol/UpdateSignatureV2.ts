import type { UpdateEnvelopeV2 } from './UpdateEnvelopeV2';
import { envelopeSigningCanonical } from './UpdateEnvelopeV2';
import { canonicalize } from './UpdateCanonical';
import type { UpdateManifestV2 } from './UpdateManifestV2';

function normalizePkcs8(input: string): string {
  let trimmed = input.trim();
  if (trimmed.startsWith('pkcs8:')) {
    trimmed = trimmed.slice('pkcs8:'.length).trim();
  }
  if (trimmed.includes('BEGIN PRIVATE KEY')) {
    return trimmed
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');
  }
  return trimmed.replace(/\s+/g, '');
}

function base64ToBytes(input: string): Uint8Array {
  const trimmed = input.trim();
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(padLen)}`;
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToBase64(input: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < input.length; i += 1) {
    binary += String.fromCharCode(input[i]);
  }
  return btoa(binary);
}

function bytesToHex(input: Uint8Array): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    out += input[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(input: string): Uint8Array {
  const normalized = input.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('invalid_hex');
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const offset = i * 2;
    out[i] = Number.parseInt(normalized.slice(offset, offset + 2), 16);
  }
  return out;
}

function toArrayBuffer(input: Uint8Array): ArrayBuffer {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
}

async function importPrivateEd25519Key(pkcs8: string): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto_subtle_unavailable');
  }
  return globalThis.crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64ToBytes(normalizePkcs8(pkcs8))),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

async function importPublicEd25519Key(publicKeyHex: string): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto_subtle_unavailable');
  }
  return globalThis.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(hexToBytes(publicKeyHex)),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
}

export async function signCanonicalTextEd25519(signingText: string, privateKeyPkcs8: string): Promise<string> {
  const key = await importPrivateEd25519Key(privateKeyPkcs8);
  const payload = new TextEncoder().encode(signingText);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, toArrayBuffer(payload));
  return bytesToBase64(new Uint8Array(signature));
}

export interface GeneratedEd25519Signer {
  publicKeyHex: string;
  privateKeyPkcs8: string;
}

export async function generateEd25519Signer(): Promise<GeneratedEd25519Signer> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto_subtle_unavailable');
  }
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey));
  const privatePkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  return {
    publicKeyHex: bytesToHex(publicRaw),
    privateKeyPkcs8: bytesToBase64(privatePkcs8),
  };
}

export async function verifyCanonicalTextEd25519(
  signingText: string,
  signerPublicKeyHex: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const key = await importPublicEd25519Key(signerPublicKeyHex);
    const payload = new TextEncoder().encode(signingText);
    const signature = base64ToBytes(signatureBase64);
    return crypto.subtle.verify({ name: 'Ed25519' }, key, toArrayBuffer(signature), toArrayBuffer(payload));
  } catch {
    return false;
  }
}

export function manifestSigningPayload(manifest: UpdateManifestV2): Record<string, unknown> {
  const vrf = manifest.security.vrf;
  const security = {
    mode: manifest.security.mode,
    threshold: manifest.security.threshold,
    committee_keys: manifest.security.committee_keys,
    publisher_pubkey: manifest.security.publisher_pubkey ?? null,
    next_publisher_pubkey_sha256: manifest.security.next_publisher_pubkey_sha256 ?? null,
    attestation_threshold: manifest.security.attestation_threshold,
    vrf: vrf
      ? {
          scheme: vrf.scheme,
          publisher_peer_id: vrf.publisher_peer_id,
          vrf_public_key_hex: vrf.vrf_public_key_hex,
          prev_manifest_hash: vrf.prev_manifest_hash,
          prev_vrf_output_hex: vrf.prev_vrf_output_hex,
        }
      : null,
  };
  return {
    kind: manifest.kind,
    schema_version: manifest.schema_version,
    manifest_id: manifest.manifest_id,
    channel: manifest.channel,
    platform: manifest.platform,
    sequence: manifest.sequence,
    version: manifest.version,
    version_code: manifest.version_code,
    artifacts: manifest.artifacts,
    rollout: manifest.rollout,
    policy: manifest.policy,
    security,
    anchor: manifest.anchor ?? null,
    metadata: manifest.metadata ?? null,
  };
}

export async function verifyEnvelopeSignature(envelope: UpdateEnvelopeV2): Promise<boolean> {
  const signer = envelope.signer?.trim() ?? '';
  const signature = envelope.signature?.trim() ?? '';
  if (signer.length === 0 || signature.length === 0) {
    return false;
  }
  return verifyCanonicalTextEd25519(envelopeSigningCanonical(envelope), signer, signature);
}

export interface ManifestSignatureVerification {
  valid_signers: string[];
  invalid_signers: string[];
}

export async function verifyManifestSignatures(manifest: UpdateManifestV2): Promise<ManifestSignatureVerification> {
  const valid = new Set<string>();
  const invalid = new Set<string>();
  const signingText = canonicalize(manifestSigningPayload(manifest));
  for (const entry of manifest.security.signatures) {
    const signer = entry.signer.trim();
    const signature = entry.signature.trim();
    if (!signer || !signature) {
      continue;
    }
    const ok = await verifyCanonicalTextEd25519(signingText, signer, signature);
    if (ok) {
      valid.add(signer);
    } else {
      invalid.add(signer);
    }
  }
  return {
    valid_signers: Array.from(valid.values()),
    invalid_signers: Array.from(invalid.values()),
  };
}
