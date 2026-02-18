import { canonicalize, sha256Hex } from './UpdateCanonical';
import type { UpdateManifestV2 } from './UpdateManifestV2';
import { libp2pService } from '../../../libp2p/service';

export interface VrfInputBuildState {
  channel: string;
  platform: string;
  sequence: number;
  prev_manifest_hash: string;
  prev_vrf_output_hex: string;
}

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

function bytesToHex(input: Uint8Array): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    out += input[i].toString(16).padStart(2, '0');
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

function isHexString(value: string): boolean {
  return /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0;
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

export function canonicalManifestCore(manifest: UpdateManifestV2): string {
  const vrf = manifest.security.vrf;
  const securityCore = {
    mode: manifest.security.mode,
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
  return canonicalize({
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
    security: securityCore,
    anchor: manifest.anchor ?? null,
    metadata: manifest.metadata ?? null,
  });
}

export async function buildVrfInput(manifestCore: string | Record<string, unknown>, prevState: VrfInputBuildState): Promise<string> {
  const coreCanonical = typeof manifestCore === 'string' ? manifestCore : canonicalize(manifestCore);
  const manifestCoreHash = await sha256Hex(coreCanonical);
  const seed = [
    'unimaker',
    'vrf',
    'v1',
    prevState.channel,
    prevState.platform,
    String(Math.max(0, Math.trunc(prevState.sequence))),
    prevState.prev_manifest_hash.trim().toLowerCase(),
    prevState.prev_vrf_output_hex.trim().toLowerCase(),
    manifestCoreHash.toLowerCase(),
  ].join('|');
  return (await sha256Hex(seed)).toLowerCase();
}

export async function proveVrf(inputHex: string, privateKeyPkcs8: string): Promise<string> {
  const normalizedInput = inputHex.trim().toLowerCase();
  if (libp2pService.isNativePlatform()) {
    const privateKeyRaw = privateKeyPkcs8.trim();
    const privateKeyHex = privateKeyRaw.startsWith('hex:')
      ? privateKeyRaw.slice('hex:'.length).trim().toLowerCase()
      : privateKeyRaw.toLowerCase();
    if (privateKeyHex && isHexString(privateKeyHex)) {
      const native = await libp2pService.vrfSign({
        privateKeyHex,
        inputHex: normalizedInput,
      });
      if (!native.ok) {
        const message = native.error ?? 'vrf_sign_failed';
        console.warn('[updateVrf] native vrfSign failed, fallback to js sign', message);
      } else if (native.signatureBase64?.trim()) {
        return native.signatureBase64.trim();
      } else if (native.signatureHex?.trim()) {
        return bytesToBase64(hexToBytes(native.signatureHex.trim().toLowerCase()));
      } else {
        console.warn('[updateVrf] native vrfSign returned empty signature, fallback to js sign');
      }
    } else {
      console.warn('[updateVrf] native vrfSign skipped, key not hex format, fallback to js sign');
    }
  }

  const key = await importPrivateEd25519Key(privateKeyPkcs8);
  const proof = await globalThis.crypto.subtle.sign(
    { name: 'Ed25519' },
    key,
    toArrayBuffer(hexToBytes(normalizedInput)),
  );
  return bytesToBase64(new Uint8Array(proof));
}

export async function verifyVrf(
  inputHex: string,
  proofBase64: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    if (libp2pService.isNativePlatform()) {
      const native = await libp2pService.vrfVerify({
        publicKeyHex: publicKeyHex.trim().toLowerCase(),
        inputHex: inputHex.trim().toLowerCase(),
        signatureHex: bytesToHex(base64ToBytes(proofBase64)),
      });
      if (native.ok && native.valid !== undefined) {
        return Boolean(native.valid);
      }
      if (!native.ok) {
        console.warn('[updateVrf] native vrfVerify failed, fallback to js verify', native.error ?? 'vrf_verify_failed');
      } else if (native.valid === undefined) {
        console.warn('[updateVrf] native vrfVerify returned no valid field, fallback to js verify');
      }
    }

    const key = await importPublicEd25519Key(publicKeyHex);
    return globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      toArrayBuffer(base64ToBytes(proofBase64)),
      toArrayBuffer(hexToBytes(inputHex)),
    );
  } catch {
    return false;
  }
}

export async function deriveVrfOutput(proofBase64: string): Promise<string> {
  return (await sha256Hex(base64ToBytes(proofBase64))).toLowerCase();
}

export async function hashManifestForChain(manifest: UpdateManifestV2): Promise<string> {
  return (await sha256Hex(canonicalize(manifest))).toLowerCase();
}
