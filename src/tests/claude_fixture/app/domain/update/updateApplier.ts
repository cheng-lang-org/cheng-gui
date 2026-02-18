import { Capacitor, registerPlugin } from '@capacitor/core';
import { libp2pService } from '../../libp2p/service';
import type { UpdateManifestArtifactV2, UpdateManifestV2 } from './protocol/UpdateManifestV2';
import { sha256Hex } from './protocol/UpdateCanonical';
import { incrementMetric } from './updateStore';

interface SystemUpdatePlugin {
  stageResourceDelta(options: {
    manifestId: string;
    version: string;
    payloadBase64: string;
  }): Promise<{ ok: boolean; stagedPath?: string; error?: string }>;
  stageShellPackage(options: {
    manifestId: string;
    payloadBase64: string;
  }): Promise<{ ok: boolean; stagedPath?: string; error?: string }>;
  applyShellPackage(options: {
    manifestId: string;
    filePath?: string;
    payloadBase64?: string;
  }): Promise<{ ok: boolean; pendingInstall?: boolean; requiresUserAction?: boolean; error?: string }>;
  openStoreUpgrade(options: {
    appStoreUrl?: string;
    testFlightUrl?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  consumeInstallResult(): Promise<{
    ok: boolean;
    status?: 'success' | 'failed' | 'none';
    manifestId?: string;
    message?: string;
  }>;
  getInstalledVersion(): Promise<{
    ok: boolean;
    version?: string;
    versionCode?: number;
    previousVersion?: string;
    previousVersionCode?: number;
    error?: string;
  }>;
}

const SystemUpdate = registerPlugin<SystemUpdatePlugin>('SystemUpdate');

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toGatewayUrl(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    return normalized;
  }
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }
  const gateway = 'https://ipfs.io';
  if (normalized.startsWith('ipfs://')) {
    return `${gateway}/ipfs/${normalized.slice('ipfs://'.length).replace(/^\/+/, '')}`;
  }
  if (normalized.startsWith('ipns://')) {
    return `${gateway}/ipns/${normalized.slice('ipns://'.length).replace(/^\/+/, '')}`;
  }
  if (normalized.startsWith('/ipfs/') || normalized.startsWith('/ipns/')) {
    return `${gateway}${normalized}`;
  }
  return normalized;
}

async function fetchViaHttps(uri: string): Promise<Uint8Array | null> {
  const response = await fetch(toGatewayUrl(uri), { method: 'GET' });
  if (!response.ok) {
    return null;
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function fetchViaP2P(artifact: UpdateManifestArtifactV2, manifest: UpdateManifestV2): Promise<Uint8Array | null> {
  if (!libp2pService.isNativePlatform()) {
    return null;
  }
  const key = artifact.uri;
  const providersResult = await libp2pService.fetchFileProviders({ key, limit: 8 });
  const providers = providersResult.providers;
  if (!providers || providers.length === 0) {
    return null;
  }

  const timeoutAt = Date.now() + 15_000;
  for (const peerId of providers) {
    if (Date.now() > timeoutAt) {
      break;
    }
    const request = {
      kind: 'artifact',
      manifest_id: manifest.manifest_id,
      uri: artifact.uri,
      sha256: artifact.sha256,
    };
    const chunk = await libp2pService.requestFileChunk({
      peerId,
      request,
      maxBytes: 1024 * 1024,
    });
    if (!chunk.ok || !chunk.payloadBase64) {
      continue;
    }
    try {
      const bytes = base64ToBytes(chunk.payloadBase64);
      if (bytes.length > 0) {
        return bytes;
      }
    } catch {
      // keep trying providers
    }
  }

  return null;
}

function platformName(): string {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') {
    return platform;
  }
  return 'web';
}

export async function downloadArtifactData(
  manifest: UpdateManifestV2,
  artifact: UpdateManifestArtifactV2,
  options: { preferP2P: boolean },
): Promise<{ bytes?: Uint8Array; source: 'p2p' | 'https' | 'none' }> {
  if (options.preferP2P) {
    const p2p = await fetchViaP2P(artifact, manifest).catch(() => null);
    if (p2p && p2p.length > 0) {
      const hashOk = await verifyArtifactHash(p2p, artifact.sha256).catch(() => false);
      if (hashOk) {
        return { bytes: p2p, source: 'p2p' };
      }
    }
    incrementMetric('update_download_fallback_total');
  }

  const https = await fetchViaHttps(artifact.uri).catch(() => null);
  if (https && https.length > 0) {
    return { bytes: https, source: 'https' };
  }
  return { source: 'none' };
}

export async function verifyArtifactHash(data: Uint8Array, expectedSha256?: string): Promise<boolean> {
  if (!expectedSha256 || expectedSha256.trim().length === 0) {
    return true;
  }
  const actual = await sha256Hex(data);
  return actual.toLowerCase() === expectedSha256.trim().toLowerCase();
}

export async function stageArtifact(
  manifest: UpdateManifestV2,
  artifact: UpdateManifestArtifactV2,
  bytes: Uint8Array,
): Promise<{ ok: boolean; stagedPath?: string; error?: string }> {
  const currentPlatform = platformName();
  if (currentPlatform === 'web') {
    return {
      ok: true,
      stagedPath: `memory://${manifest.manifest_id}/${artifact.kind}`,
    };
  }

  try {
    if (artifact.kind === 'resource' || artifact.kind === 'delta' || !artifact.shell_required) {
      const staged = await SystemUpdate.stageResourceDelta({
        manifestId: manifest.manifest_id,
        version: manifest.version,
        payloadBase64: bytesToBase64(bytes),
      });
      return staged;
    }

    const staged = await SystemUpdate.stageShellPackage({
      manifestId: manifest.manifest_id,
      payloadBase64: bytesToBase64(bytes),
    });
    return {
      ok: staged.ok,
      stagedPath: staged.stagedPath,
      error: staged.error,
    };
  } catch (error) {
    return {
      ok: false,
      error: `${error}`,
    };
  }
}

export async function applyStagedManifest(
  manifest: UpdateManifestV2,
  artifact: UpdateManifestArtifactV2,
  options: { stagedPath?: string },
): Promise<{ ok: boolean; pendingInstall?: boolean; requiresUserAction?: boolean; error?: string }> {
  const currentPlatform = platformName();
  if (currentPlatform === 'web') {
    return { ok: true };
  }

  if (!artifact.shell_required) {
    return { ok: true };
  }

  try {
    const result = await SystemUpdate.applyShellPackage({
      manifestId: manifest.manifest_id,
      filePath: options.stagedPath,
    });
    return result;
  } catch (error) {
    return { ok: false, error: `${error}` };
  }
}

export async function openStoreUpgrade(options: { appStoreUrl?: string; testFlightUrl?: string }): Promise<boolean> {
  try {
    const result = await SystemUpdate.openStoreUpgrade(options);
    return result.ok;
  } catch {
    return false;
  }
}

export async function consumeInstallResult(): Promise<{
  ok: boolean;
  status?: 'success' | 'failed' | 'none';
  manifestId?: string;
  message?: string;
}> {
  try {
    return await SystemUpdate.consumeInstallResult();
  } catch {
    return { ok: false, status: 'none' };
  }
}

export async function getInstalledVersion(): Promise<{
  ok: boolean;
  version?: string;
  versionCode?: number;
  previousVersion?: string;
  previousVersionCode?: number;
}> {
  const fallback = { ok: false as const };
  try {
    const result = await SystemUpdate.getInstalledVersion();
    const version = (result.version ?? '').trim();
    const parsedCode = Number(result.versionCode ?? 0);
    const versionCode = Number.isFinite(parsedCode) ? Math.max(0, Math.trunc(parsedCode)) : 0;
    const previousVersion = (result.previousVersion ?? '').trim() || undefined;
    const parsedPreviousCode = Number(result.previousVersionCode ?? 0);
    const previousVersionCode = Number.isFinite(parsedPreviousCode)
      ? Math.max(0, Math.trunc(parsedPreviousCode))
      : undefined;
    if (!result.ok || !version) {
      return fallback;
    }
    return {
      ok: true,
      version,
      versionCode,
      previousVersion,
      previousVersionCode,
    };
  } catch {
    return fallback;
  }
}
