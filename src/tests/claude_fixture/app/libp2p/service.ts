import { Capacitor } from '@capacitor/core';
import { Libp2pBridge } from './index';
import type {
  BridgeEventEntry,
  DiscoveredPeer,
  JsonValue,
  MomentPost,
  NotificationItem,
  PresenceSnapshot,
  SyncCastRoomState,
} from './definitions';

function toJsonString(value: string | Record<string, JsonValue>): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function nowMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coerceBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  return fallback;
}

function normalizePeerIdText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLikelyPeerId(peerId: string): boolean {
  const value = peerId.trim();
  if (!value) return false;
  if (value.startsWith('did:')) {
    if (value.length < 8 || value.length > 192) return false;
    return /^[A-Za-z0-9:._%-]+$/.test(value);
  }
  if (value.length < 8 || value.length >= 63) return false;
  if ((value.startsWith('12D3Koo') || value.startsWith('16Uiu2')) && value.length >= 24) {
    return true;
  }
  if (value.startsWith('Qm') && value.length >= 30) {
    return true;
  }
  return false;
}

const LOCAL_PEER_ID_STORAGE_KEY = 'profile_local_peer_id_v1';
const FALLBACK_DEVICE_DID_STORAGE_KEY = 'unimaker_device_did_v1';
const FALLBACK_DEVICE_SEED_STORAGE_KEY = 'unimaker_device_seed_v1';
const UPDATE_DEVICE_ID_STORAGE_KEY = 'unimaker_update_device_id';
const FALLBACK_DID_PREFIX = 'did:unimaker:device:';

function hasBrowserStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function normalizeDidText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  if (lowered.includes('stub')) return '';
  if (lowered.startsWith('did:')) {
    return lowered;
  }
  const normalized = lowered.replace(/[^a-z0-9._-]/g, '');
  if (!normalized) return '';
  return `${FALLBACK_DID_PREFIX}${normalized}`;
}

function randomSeed(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `seed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class Libp2pService {
  private initialized = false;
  private ensureStartedInFlight: Promise<boolean> | null = null;
  private lastStartError = '';

  private buildRecoveryConfig(config?: Record<string, JsonValue> | string): Record<string, JsonValue> | string {
    if (typeof config === 'string') {
      return config;
    }
    return {
      listenAddresses: [
        '/ip4/0.0.0.0/tcp/0',
      ],
      automations: {
        gossipsub: true,
        directStream: false,
        rendezvous: false,
        autonat: false,
        circuitRelay: false,
        livestream: false,
        dataTransfer: false,
      },
      ...(config ?? {}),
    };
  }

  private async resetNative(): Promise<boolean> {
    if (!this.hasNativeBridge()) {
      return false;
    }
    try {
      const resetResult = await this.invokeOptionalBridge('reset');
      if (coerceBoolean(resetResult.ok as unknown, false)) {
        this.initialized = false;
        return true;
      }
    } catch {
      // ignore and fallback to stop
    }
    const stopped = await this.stop().catch(() => false);
    if (stopped) {
      this.initialized = false;
    }
    return stopped;
  }

  private readPersistedPeerId(): string {
    if (!hasBrowserStorage()) {
      return '';
    }
    try {
      return (localStorage.getItem(LOCAL_PEER_ID_STORAGE_KEY) ?? '').trim();
    } catch {
      return '';
    }
  }

  private persistPeerId(peerId: string): void {
    const normalized = peerId.trim();
    if (!normalized || !hasBrowserStorage()) {
      return;
    }
    try {
      localStorage.setItem(LOCAL_PEER_ID_STORAGE_KEY, normalized);
    } catch {
      // ignore storage write failures
    }
  }

  private readPersistedDid(): string {
    if (!hasBrowserStorage()) {
      return '';
    }
    try {
      const raw = localStorage.getItem(FALLBACK_DEVICE_DID_STORAGE_KEY) ?? '';
      return normalizeDidText(raw);
    } catch {
      return '';
    }
  }

  private persistDid(didText: string): void {
    if (!hasBrowserStorage()) {
      return;
    }
    const normalized = normalizeDidText(didText);
    if (!normalized) {
      return;
    }
    try {
      localStorage.setItem(FALLBACK_DEVICE_DID_STORAGE_KEY, normalized);
    } catch {
      // ignore storage write failures
    }
  }

  private createFallbackDid(): string {
    if (!hasBrowserStorage()) {
      return `${FALLBACK_DID_PREFIX}ephemeral`;
    }
    const legacySeed = (localStorage.getItem(UPDATE_DEVICE_ID_STORAGE_KEY) ?? '').trim();
    const persistedSeed = (localStorage.getItem(FALLBACK_DEVICE_SEED_STORAGE_KEY) ?? '').trim();
    const seed = legacySeed || persistedSeed || randomSeed();
    const normalizedSeed = seed.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 64) || randomSeed().replace(/[^a-z0-9]/gi, '').slice(0, 32);
    try {
      localStorage.setItem(FALLBACK_DEVICE_SEED_STORAGE_KEY, normalizedSeed);
    } catch {
      // ignore storage write failures
    }
    const did = `${FALLBACK_DID_PREFIX}${normalizedSeed}`;
    this.persistDid(did);
    return did;
  }

  private async derivePeerIdFromDid(didText: string): Promise<string> {
    const normalizedDid = normalizeDidText(didText);
    if (!normalizedDid) {
      return '';
    }
    const seed = `did-peer:v1:${normalizedDid}`;
    let digestHex = '';
    try {
      const subtle = globalThis.crypto?.subtle;
      if (subtle) {
        const payload = new TextEncoder().encode(seed);
        const digest = await subtle.digest('SHA-256', payload);
        const bytes = new Uint8Array(digest);
        digestHex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      }
    } catch {
      digestHex = '';
    }
    if (!digestHex) {
      digestHex = [
        fnv1aHex(seed),
        fnv1aHex(`${seed}|1`),
        fnv1aHex(`${seed}|2`),
        fnv1aHex(`${seed}|3`),
        fnv1aHex(`${seed}|4`),
        fnv1aHex(`${seed}|5`),
      ].join('');
    }
    const body = digestHex.slice(0, 44).padEnd(44, '0');
    return `12D3KooW${body}`;
  }

  private async fallbackPeerId(): Promise<string> {
    const persisted = this.readPersistedPeerId();
    if (persisted) {
      return persisted;
    }
    const did = this.readPersistedDid() || this.createFallbackDid();
    const derived = (await this.derivePeerIdFromDid(did)).trim();
    if (derived) {
      this.persistPeerId(derived);
    }
    return derived;
  }

  private async getLocalPeerIdDirect(): Promise<string> {
    const raw = await Libp2pBridge.getLocalPeerId().catch(() => ({ peerId: '' }));
    const peerId = typeof raw.peerId === 'string' ? raw.peerId.trim() : '';
    if (peerId.length > 0) {
      this.persistPeerId(peerId);
    }
    return peerId;
  }

  private hasNativeBridge(): boolean {
    const cap = Capacitor as unknown as {
      getPlatform?: () => string;
      isPluginAvailable?: (name: string) => boolean;
    };
    const pluginAvailable =
      typeof cap.isPluginAvailable === 'function'
        ? cap.isPluginAvailable('Libp2pBridge')
        : undefined;
    const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
    if (platform) {
      if (platform === 'android' || platform === 'ios') {
        return true;
      }
      return platform !== 'web';
    }
    if (pluginAvailable === false) {
      return false;
    }
    if (pluginAvailable === true) {
      return true;
    }
    return Capacitor.isNativePlatform() && pluginAvailable !== false;
  }

  private async invokeOptionalBridge(
    method: string,
    payload: Record<string, JsonValue> = {},
  ): Promise<Record<string, JsonValue>> {
    if (!this.hasNativeBridge()) {
      throw new Error('native_platform_required');
    }
    const dynamicBridge = Libp2pBridge as unknown as Record<string, unknown>;
    const fn = dynamicBridge[method];
    if (typeof fn !== 'function') {
      throw new Error(`bridge_method_unavailable:${method}`);
    }
    const raw = await (fn as (args: Record<string, JsonValue>) => Promise<unknown>)(payload);
    return isJsonRecord(raw) ? raw : {};
  }

  isNativePlatform(): boolean {
    return this.hasNativeBridge();
  }

  async init(config?: Record<string, JsonValue> | string): Promise<boolean> {
    if (!this.isNativePlatform()) {
      this.lastStartError = 'native_platform_required';
      return false;
    }
    if (typeof config === 'string') {
      const result = await Libp2pBridge.init({ config }).catch((error) => {
        this.lastStartError = error instanceof Error ? error.message : `${error}`;
        return { ok: false };
      });
      this.initialized = result.ok;
      if (!result.ok && !this.lastStartError) {
        this.lastStartError = (await this.getLastError().catch(() => '')) || 'init_failed';
      }
      return result.ok;
    }

    const baseConfig: Record<string, JsonValue> = {
      listenAddresses: [
        '/ip4/0.0.0.0/tcp/4001',
        '/ip4/0.0.0.0/udp/4001/quic-v1',
        '/ip6/::/tcp/4001',
        '/ip6/::/udp/4001/quic-v1',
      ],
      automations: {
        gossipsub: true,
        directStream: true,
        rendezvous: true,
        autonat: true,
        circuitRelay: true,
        livestream: true,
        dataTransfer: false,
      },
      ...(config ?? {}),
    };

    const compatibilityConfig1: Record<string, JsonValue> = {
      ...baseConfig,
      listenAddresses: [
        '/ip4/0.0.0.0/tcp/0',
        '/ip4/0.0.0.0/udp/0/quic-v1',
      ],
    };
    const compatibilityConfig2: Record<string, JsonValue> = {
      ...baseConfig,
      listenAddresses: [
        '/ip4/0.0.0.0/tcp/0',
      ],
      automations: {
        gossipsub: true,
        directStream: true,
        rendezvous: false,
        autonat: false,
        circuitRelay: false,
        livestream: true,
        dataTransfer: false,
      },
    };
    const compatibilityConfig3: Record<string, JsonValue> = {
      ...compatibilityConfig2,
      automations: {
        gossipsub: true,
        directStream: false,
        rendezvous: false,
        autonat: false,
        circuitRelay: false,
        livestream: false,
        dataTransfer: false,
      },
    };
    const attempts: Record<string, JsonValue>[] = [
      baseConfig,
      compatibilityConfig1,
      compatibilityConfig2,
      compatibilityConfig3,
    ];
    const errors: string[] = [];
    for (const attemptConfig of attempts) {
      const result = await Libp2pBridge.init({ config: attemptConfig }).catch((error) => {
        const bridgeError = error instanceof Error ? error.message : `${error}`;
        if (bridgeError) {
          errors.push(bridgeError);
        }
        return { ok: false };
      });
      if (result.ok) {
        this.initialized = true;
        this.lastStartError = '';
        return true;
      }
      const nativeError = await this.getLastError().catch(() => '');
      if (nativeError) {
        errors.push(nativeError);
      }
    }
    this.initialized = false;
    this.lastStartError = errors.find((item) => item.trim().length > 0) || 'init_failed';
    return false;
  }

  async start(): Promise<boolean> {
    if (!this.hasNativeBridge()) {
      this.lastStartError = 'native_platform_required';
      return false;
    }
    const result = await Libp2pBridge.start().catch(() => ({ ok: false }));
    if (!result.ok) {
      const nativeError = await this.getLastError().catch(() => '');
      const health = await this.runtimeHealth().catch(() => ({
        nativeReady: false,
        started: false,
        peerId: undefined as string | undefined,
        lastError: undefined as string | undefined,
      }));
      this.lastStartError = nativeError || (health.lastError ?? '') || this.lastStartError || 'start_failed';
    }
    return result.ok;
  }

  async stop(): Promise<boolean> {
    const result = await Libp2pBridge.stop();
    return result.ok;
  }

  async isStarted(): Promise<boolean> {
    if (!this.hasNativeBridge()) {
      return false;
    }
    const result = await Libp2pBridge.isStarted().catch(() => ({ started: false }));
    return result.started;
  }

  async runtimeHealth(): Promise<{ nativeReady: boolean; started: boolean; peerId?: string; lastError?: string }> {
    let result: Record<string, JsonValue> = {};
    try {
      result = await this.invokeOptionalBridge('runtimeHealth');
    } catch (error) {
      const bridgeError = error instanceof Error ? error.message : `${error}`;
      const started = await this.isStarted().catch(() => false);
      const directPeerId = await this.getLocalPeerIdDirect().catch(() => '');
      const peerId = directPeerId || await this.fallbackPeerId().catch(() => '');
      const nativeError = await this.getLastError().catch(() => '');
      const lastError = nativeError || bridgeError || this.lastStartError || 'runtime_health_bridge_failed';
      return {
        nativeReady: started || this.initialized,
        started,
        peerId: peerId || undefined,
        lastError,
      };
    }
    const hasNativeReadyField = Object.prototype.hasOwnProperty.call(result, 'native_ready')
      || Object.prototype.hasOwnProperty.call(result, 'nativeReady');
    const hasStartedField = Object.prototype.hasOwnProperty.call(result, 'started')
      || Object.prototype.hasOwnProperty.call(result, 'isStarted');
    const started = hasStartedField
      ? coerceBoolean((result.started ?? result.isStarted) as unknown, false)
      : await this.isStarted().catch(() => false);
    const nativeReady = hasNativeReadyField
      ? coerceBoolean((result.native_ready ?? result.nativeReady) as unknown, false)
      : false;
    const effectiveNativeReady = nativeReady || started;
    const peerValue = (result.peer_id ?? result.peerId) as unknown;
    const parsedPeerId = typeof peerValue === 'string' && peerValue.trim().length > 0 ? peerValue.trim() : '';
    const peerId = parsedPeerId || await this.fallbackPeerId().catch(() => '');
    if (peerId) {
      this.persistPeerId(peerId);
    }
    const errorValue = (result.last_error ?? result.lastError) as unknown;
    const parsedLastError = typeof errorValue === 'string' && errorValue.trim().length > 0 ? errorValue.trim() : undefined;
    const nativeBridgeError = await this.getLastError().catch(() => '');
    const healthPayloadMissing = !hasNativeReadyField && !hasStartedField;
    const lastError = parsedLastError
      ?? ((!effectiveNativeReady && !started)
        ? (nativeBridgeError || this.lastStartError || (healthPayloadMissing ? 'runtime_health_empty_payload' : 'runtime_not_ready'))
        : undefined);
    return {
      nativeReady: effectiveNativeReady,
      started,
      peerId: peerId || undefined,
      lastError,
    };
  }

  async ensureStarted(config?: Record<string, JsonValue> | string): Promise<boolean> {
    if (!this.hasNativeBridge()) {
      this.lastStartError = 'native_bridge_unavailable';
      return false;
    }
    if (this.ensureStartedInFlight) {
      return this.ensureStartedInFlight;
    }
    this.ensureStartedInFlight = (async () => {
      const healthBefore = await this.runtimeHealth().catch(() => ({
        nativeReady: false,
        started: false,
        peerId: undefined as string | undefined,
        lastError: undefined as string | undefined,
      }));
      const alreadyStarted = healthBefore.started || await this.isStarted().catch(() => false);
      if (alreadyStarted) {
        this.initialized = true;
        this.lastStartError = '';
        return true;
      }

      const mustInit = !this.initialized || !healthBefore.nativeReady;
      if (mustInit) {
        const initOk = await this.init(config).catch(() => false);
        if (!initOk) {
          this.initialized = false;
          this.lastStartError = (await this.getLastError().catch(() => '')) || this.lastStartError || 'init_failed';
        }
      }

      await this.start().catch(() => false);
      let startedAfterInit = await this.isStarted().catch(() => false);
      if (!startedAfterInit) {
        // Force one recovery re-init when JS/native state drifts.
        this.initialized = false;
        await this.resetNative().catch(() => false);
        const recoveryConfig = this.buildRecoveryConfig(config);
        const recoveryInitOk = await this.init(recoveryConfig).catch(() => false);
        if (recoveryInitOk) {
          await this.start().catch(() => false);
          startedAfterInit = await this.isStarted().catch(() => false);
        } else {
          this.lastStartError = (await this.getLastError().catch(() => '')) || this.lastStartError || 'reinit_failed';
        }
      }
      if (startedAfterInit) {
        this.initialized = true;
        this.lastStartError = '';
        return true;
      }
      const healthAfter = await this.runtimeHealth().catch(() => ({
        nativeReady: false,
        started: false,
        peerId: undefined as string | undefined,
        lastError: undefined as string | undefined,
      }));
      if (healthAfter.nativeReady && healthAfter.started) {
        this.initialized = true;
        this.lastStartError = '';
        return true;
      }
      if (healthAfter.nativeReady && !healthAfter.started) {
        await this.start().catch(() => false);
        const postStartHealth = await this.runtimeHealth().catch(() => ({
          nativeReady: false,
          started: false,
          peerId: undefined as string | undefined,
          lastError: undefined as string | undefined,
        }));
        if (postStartHealth.nativeReady && postStartHealth.started) {
          this.initialized = true;
          this.lastStartError = '';
          return true;
        }
        this.lastStartError = postStartHealth.lastError ?? this.lastStartError ?? 'start_retry_failed';
        return false;
      }
      this.lastStartError = healthAfter.lastError ?? this.lastStartError ?? 'runtime_not_ready';
      return false;
    })();

    try {
      return await this.ensureStartedInFlight;
    } finally {
      this.ensureStartedInFlight = null;
    }
  }

  async ensurePeerIdentity(config?: Record<string, JsonValue> | string): Promise<string> {
    if (!this.hasNativeBridge()) {
      return this.fallbackPeerId();
    }
    const direct = await this.getLocalPeerIdDirect().catch(() => '');
    if (direct) {
      return direct;
    }
    await this.init(config).catch(() => false);
    const afterInit = await this.getLocalPeerIdDirect().catch(() => '');
    if (afterInit) {
      return afterInit;
    }
    const health = await this.runtimeHealth().catch(() => ({
      nativeReady: false,
      started: false,
      peerId: undefined as string | undefined,
      lastError: undefined as string | undefined,
    }));
    const fromHealth = typeof health.peerId === 'string' ? health.peerId.trim() : '';
    if (fromHealth) {
      return fromHealth;
    }
    return this.fallbackPeerId();
  }

  async generateIdentity(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.generateIdentity();
  }

  async identityFromSeed(seed: string): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.identityFromSeed({ seed });
  }

  async getLocalPeerId(): Promise<string> {
    const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
    const direct = await this.getLocalPeerIdDirect().catch(() => '');
    if (direct) return direct;

    const identityReady = await this.ensurePeerIdentity().catch(() => '');
    if (identityReady) return identityReady;

    const started = await this.ensureStarted().catch(() => false);
    const afterStart = await this.getLocalPeerIdDirect().catch(() => '');
    if (afterStart) return afterStart;

    const health = await this.runtimeHealth().catch(() => ({
      nativeReady: false,
      started: false,
      peerId: undefined as string | undefined,
      lastError: undefined as string | undefined,
    }));
    if (!started && health.lastError) {
      this.lastStartError = health.lastError;
    }
    const fromHealth = normalize(health.peerId);
    if (fromHealth) {
      this.persistPeerId(fromHealth);
      return fromHealth;
    }
    return this.fallbackPeerId();
  }

  async getListenAddresses(): Promise<string[]> {
    const result = await Libp2pBridge.getListenAddresses();
    return result.addresses ?? [];
  }

  async getDialableAddresses(): Promise<string[]> {
    const result = await Libp2pBridge.getDialableAddresses();
    return result.addresses ?? [];
  }

  async connectPeer(peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.connectPeer({ peerId });
    return result.ok;
  }

  async connectMultiaddr(multiaddr: string): Promise<boolean> {
    const result = await Libp2pBridge.connectMultiaddr({ multiaddr });
    return result.ok;
  }

  async addExternalAddress(multiaddr: string): Promise<boolean> {
    const result = await Libp2pBridge.addExternalAddress({ multiaddr });
    return result.ok;
  }

  async disconnectPeer(peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.disconnectPeer({ peerId });
    return result.ok;
  }

  async reconnectBootstrap(): Promise<boolean> {
    const result = await Libp2pBridge.reconnectBootstrap();
    return result.ok;
  }

  async getRandomBootstrapPeers(limit = 8): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.getRandomBootstrapPeers({ limit });
  }

  async joinViaRandomBootstrap(limit = 3): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.joinViaRandomBootstrap({ limit });
  }

  async bootstrapSetPolicy(policy: string | Record<string, JsonValue>): Promise<boolean> {
    const payload = typeof policy === 'string' ? { policy } : { policy };
    const result = await Libp2pBridge.bootstrapSetPolicy(payload);
    return result.ok;
  }

  async bootstrapTick(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.bootstrapTick();
  }

  async bootstrapGetStatus(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.bootstrapGetStatus();
  }

  async bootstrapPublishSnapshot(): Promise<boolean> {
    const result = await Libp2pBridge.bootstrapPublishSnapshot();
    return result.ok;
  }

  async boostConnectivity(): Promise<boolean> {
    const result = await Libp2pBridge.boostConnectivity();
    return result.ok;
  }

  async reserveOnRelay(relayAddr: string): Promise<boolean> {
    const result = await Libp2pBridge.reserveOnRelay({ relayAddr });
    return result.ok;
  }

  async reserveOnAllRelays(): Promise<number> {
    const result = await Libp2pBridge.reserveOnAllRelays();
    return result.ok ? result.count : -1;
  }

  async getConnectedPeers(): Promise<string[]> {
    const result = await Libp2pBridge.getConnectedPeers();
    const peers = Array.isArray(result.peers) ? result.peers : [];
    return Array.from(
      new Set(
        peers
          .map((entry) => normalizePeerIdText(entry))
          .filter((peerId) => isLikelyPeerId(peerId))
      )
    );
  }

  async getConnectedPeersInfo(): Promise<Record<string, JsonValue>[]> {
    const result = await Libp2pBridge.getConnectedPeersInfo();
    const peers = Array.isArray(result.peers) ? result.peers : [];
    return peers.filter((entry): entry is Record<string, JsonValue> => {
      if (!isJsonRecord(entry)) return false;
      const peerId = normalizePeerIdText(entry.peerId ?? entry.peer_id);
      return isLikelyPeerId(peerId);
    });
  }

  async measurePeerBandwidth(peerId: string, durationMs = 2500, chunkBytes = 12288): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.measurePeerBandwidth({ peerId, durationMs, chunkBytes });
  }

  async getDiagnostics(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.getDiagnostics();
  }

  async getBootstrapStatus(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.getBootstrapStatus();
  }

  async getPeerMultiaddrs(peerId: string): Promise<string[]> {
    const result = await Libp2pBridge.getPeerMultiaddrs({ peerId });
    return result.multiaddrs ?? [];
  }

  async isPeerConnected(peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.isPeerConnected({ peerId });
    return result.connected;
  }

  async registerPeerHints(peerId: string, addresses: string[], source = 'ui'): Promise<boolean> {
    const result = await Libp2pBridge.registerPeerHints({ peerId, addresses, source });
    return result.ok;
  }

  async mdnsSetEnabled(enabled: boolean): Promise<boolean> {
    const result = await Libp2pBridge.mdnsSetEnabled({ enabled });
    return result.ok;
  }

  async mdnsSetInterface(ipv4: string): Promise<boolean> {
    const result = await Libp2pBridge.mdnsSetInterface({ ipv4 });
    return result.ok;
  }

  async mdnsSetInterval(seconds: number): Promise<boolean> {
    const result = await Libp2pBridge.mdnsSetInterval({ seconds });
    return result.ok;
  }

  async mdnsProbe(): Promise<boolean> {
    const result = await Libp2pBridge.mdnsProbe();
    return result.ok;
  }

  async mdnsDebug(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.mdnsDebug();
  }

  async rendezvousAdvertise(namespace: string, ttlMs = 120_000): Promise<boolean> {
    const result = await Libp2pBridge.rendezvousAdvertise({ namespace, ttlMs });
    return result.ok;
  }

  async rendezvousDiscover(namespace: string, limit = 20): Promise<Record<string, JsonValue>[]> {
    const result = await Libp2pBridge.rendezvousDiscover({ namespace, limit });
    return result.peers;
  }

  async rendezvousUnregister(namespace: string): Promise<boolean> {
    const result = await Libp2pBridge.rendezvousUnregister({ namespace });
    return result.ok;
  }

  async pubsubPublish(topic: string, payload: string): Promise<boolean> {
    const result = await Libp2pBridge.pubsubPublish({ topic, payload });
    return result.ok;
  }

  async pubsubSubscribe(topic: string): Promise<boolean> {
    const result = await Libp2pBridge.pubsubSubscribe({ topic });
    return result.ok;
  }

  async pubsubUnsubscribe(topic: string): Promise<boolean> {
    const result = await Libp2pBridge.pubsubUnsubscribe({ topic });
    return result.ok;
  }

  async sendDirectText(peerId: string, text: string, messageId = nowMessageId('dm')): Promise<boolean> {
    const result = await Libp2pBridge.sendDirectText({
      peerId,
      text,
      messageId,
      requestAck: false,
      timeoutMs: 5000,
    });
    return result.ok;
  }

  async sendWithAck(peerId: string, payload: Record<string, JsonValue>, timeoutMs = 8000): Promise<boolean> {
    const result = await Libp2pBridge.sendWithAck({
      peerId,
      payload,
      timeoutMs,
    });
    return result.ok;
  }

  async sendChatControl(peerId: string, op: string, messageId: string, body: string, target = ''): Promise<boolean> {
    const result = await Libp2pBridge.sendChatControl({
      peerId,
      op,
      messageId,
      body,
      target,
      requestAck: true,
      timeoutMs: 8000,
    });
    return result.ok;
  }

  async sendChatAck(peerId: string, messageId: string, success: boolean, error = ''): Promise<boolean> {
    const result = await Libp2pBridge.sendChatAck({ peerId, messageId, success, error });
    return result.ok;
  }

  async waitSecureChannel(peerId: string, timeoutMs = 5000): Promise<boolean> {
    const result = await Libp2pBridge.waitSecureChannel({ peerId, timeoutMs });
    return result.ok;
  }

  async getLastDirectError(): Promise<string> {
    const result = await Libp2pBridge.getLastDirectError();
    return result.error ?? '';
  }

  async fetchFeedSnapshot(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.fetchFeedSnapshot();
  }

  async feedSubscribePeer(peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.feedSubscribePeer({ peerId });
    return result.ok;
  }

  async feedUnsubscribePeer(peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.feedUnsubscribePeer({ peerId });
    return result.ok;
  }

  async feedPublishEntry(payload: Record<string, JsonValue>): Promise<boolean> {
    const result = await Libp2pBridge.feedPublishEntry({ payload: toJsonString(payload) });
    return result.ok;
  }

  async syncPeerstoreState(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.syncPeerstoreState();
  }

  async loadStoredPeers(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.loadStoredPeers();
  }

  async fetchFileProviders(options: { key: string; limit?: number }): Promise<{ providers: string[] }> {
    const result = await Libp2pBridge.fetchFileProviders({
      key: options.key,
      limit: options.limit ?? 8,
    });
    return {
      providers: Array.isArray(result.providers) ? result.providers : [],
    };
  }

  async requestFileChunk(options: {
    peerId: string;
    requestJson?: string;
    request?: Record<string, JsonValue>;
    maxBytes?: number;
  }): Promise<{ ok: boolean; payloadBase64?: string; chunkSize?: number; error?: string }> {
    const requestJson = options.requestJson ?? (options.request ? toJsonString(options.request) : '{}');
    const result = await Libp2pBridge.requestFileChunk({
      peerId: options.peerId,
      requestJson,
      maxBytes: options.maxBytes ?? 1024 * 1024,
    });
    return {
      ok: Boolean(result.ok),
      payloadBase64: typeof result.payloadBase64 === 'string' ? result.payloadBase64 : undefined,
      chunkSize: typeof result.chunkSize === 'number' ? result.chunkSize : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
    };
  }

  async lastChunkSize(): Promise<{ size: number }> {
    const result = await Libp2pBridge.lastChunkSize();
    return {
      size: typeof result.size === 'number' ? result.size : 0,
    };
  }

  async resolveIpns(nameOrUri: string): Promise<{ value?: string; error?: string }> {
    const result = await Libp2pBridge.resolveIpns({ nameOrUri });
    return {
      value: typeof result.value === 'string' ? result.value : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
    };
  }

  async vrfGenerateKeypair(): Promise<{ ok: boolean; publicKeyHex?: string; privateKeyHex?: string; error?: string }> {
    const result = await this.invokeOptionalBridge('vrfGenerateKeypair');
    return {
      ok: Boolean(result.ok),
      publicKeyHex: typeof result.publicKeyHex === 'string' ? result.publicKeyHex : undefined,
      privateKeyHex: typeof result.privateKeyHex === 'string' ? result.privateKeyHex : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
    };
  }

  async vrfSign(options: {
    privateKeyHex: string;
    inputHex: string;
  }): Promise<{ ok: boolean; signatureHex?: string; signatureBase64?: string; error?: string }> {
    const result = await this.invokeOptionalBridge('vrfSign', {
      privateKeyHex: options.privateKeyHex,
      inputHex: options.inputHex,
    });
    return {
      ok: Boolean(result.ok),
      signatureHex: typeof result.signatureHex === 'string' ? result.signatureHex : undefined,
      signatureBase64: typeof result.signatureBase64 === 'string' ? result.signatureBase64 : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
    };
  }

  async vrfVerify(options: {
    publicKeyHex: string;
    inputHex: string;
    signatureHex: string;
  }): Promise<{ ok: boolean; valid?: boolean; error?: string }> {
    const result = await this.invokeOptionalBridge('vrfVerify', {
      publicKeyHex: options.publicKeyHex,
      inputHex: options.inputHex,
      signatureHex: options.signatureHex,
    });
    return {
      ok: Boolean(result.ok),
      valid: typeof result.valid === 'boolean' ? result.valid : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
    };
  }

  async getLanEndpoints(): Promise<Record<string, JsonValue>[]> {
    const result = await Libp2pBridge.getLanEndpoints();
    return (result.endpoints as Record<string, JsonValue>[]) ?? [];
  }

  async lanGroupJoin(groupId: string): Promise<boolean> {
    const result = await Libp2pBridge.lanGroupJoin({ groupId });
    return result.ok;
  }

  async lanGroupLeave(groupId: string): Promise<boolean> {
    const result = await Libp2pBridge.lanGroupLeave({ groupId });
    return result.ok;
  }

  async lanGroupSend(groupId: string, message: string): Promise<boolean> {
    const result = await Libp2pBridge.lanGroupSend({ groupId, message });
    return result.ok;
  }

  async upsertLivestreamConfig(streamKey: string, config: Record<string, JsonValue>): Promise<boolean> {
    const result = await Libp2pBridge.upsertLivestreamConfig({ streamKey, configJson: toJsonString(config) });
    return result.ok;
  }

  async publishLivestreamFrame(streamKey: string, payload: string): Promise<boolean> {
    const result = await Libp2pBridge.publishLivestreamFrame({ streamKey, payload });
    return result.ok;
  }

  async getLastError(): Promise<string> {
    try {
      const result = await Libp2pBridge.getLastError();
      const nativeError = (result.error ?? '').trim();
      if (nativeError.length > 0) {
        return nativeError;
      }
      return this.lastStartError || '';
    } catch (error) {
      const bridgeError = error instanceof Error ? error.message : `${error}`;
      return this.lastStartError || bridgeError || 'runtime_error_unavailable';
    }
  }

  async pollEvents(maxEvents = 64): Promise<BridgeEventEntry[]> {
    const result = await Libp2pBridge.pollEvents({ maxEvents });
    return result.events ?? [];
  }

  async rwadSubmitTx(tx: Record<string, JsonValue> | string): Promise<Record<string, JsonValue>> {
    const payload: Record<string, JsonValue> = { tx: typeof tx === 'string' ? tx : tx };
    return this.invokeOptionalBridge('rwadSubmitTx', payload);
  }

  async rwadGetAccount(address: string): Promise<Record<string, JsonValue>> {
    return this.invokeOptionalBridge('rwadGetAccount', { address });
  }

  async rwadGetAssetBalance(assetId: string, owner: string): Promise<Record<string, JsonValue>> {
    return this.invokeOptionalBridge('rwadGetAssetBalance', { assetId, owner });
  }

  async rwadGetEscrow(escrowId: string): Promise<Record<string, JsonValue>> {
    return this.invokeOptionalBridge('rwadGetEscrow', { escrowId });
  }

  async rwadGetTx(txHash: string): Promise<Record<string, JsonValue>> {
    return this.invokeOptionalBridge('rwadGetTx', { txHash });
  }

  async rwadListMarketEvents(options: {
    limit?: number;
    cursor?: string;
    partyAddress?: string;
  } = {}): Promise<Record<string, JsonValue>> {
    const payload: Record<string, JsonValue> = {
      category: 'market',
      limit: Math.max(1, Math.min(options.limit ?? 50, 200)),
    };
    if (options.cursor) {
      payload.cursor = options.cursor;
      payload.after_event_id = options.cursor;
    }
    if (options.partyAddress) {
      payload.partyAddress = options.partyAddress;
      payload.party_address = options.partyAddress;
    }
    return this.invokeOptionalBridge('rwadListMarketEvents', payload);
  }

  async socialListDiscoveredPeers(sourceFilter = '', limit = 64): Promise<{ peers: DiscoveredPeer[]; totalCount: number }> {
    const result = await Libp2pBridge.socialListDiscoveredPeers({ sourceFilter, limit });
    const peers = Array.isArray(result.peers)
      ? result.peers.filter((entry): entry is DiscoveredPeer => {
          if (!isJsonRecord(entry)) return false;
          const peerId = normalizePeerIdText(entry.peerId ?? entry.peer_id);
          return isLikelyPeerId(peerId);
        })
      : [];
    return {
      peers,
      totalCount: typeof result.totalCount === 'number' ? result.totalCount : peers.length,
    };
  }

  async socialConnectPeer(peerId: string, multiaddr = ''): Promise<boolean> {
    const result = await Libp2pBridge.socialConnectPeer({ peerId, multiaddr });
    return result.ok;
  }

  async socialDmSend(peerId: string, conversationId: string, messageJson: string | Record<string, JsonValue>): Promise<boolean> {
    const result = await Libp2pBridge.socialDmSend({
      peerId,
      conversationId,
      messageJson: toJsonString(messageJson),
    });
    return result.ok;
  }

  async socialDmEdit(
    peerId: string,
    conversationId: string,
    messageId: string,
    patchJson: string | Record<string, JsonValue>
  ): Promise<boolean> {
    const result = await Libp2pBridge.socialDmEdit({
      peerId,
      conversationId,
      messageId,
      patchJson: toJsonString(patchJson),
    });
    return result.ok;
  }

  async socialDmRevoke(peerId: string, conversationId: string, messageId: string, reason = ''): Promise<boolean> {
    const result = await Libp2pBridge.socialDmRevoke({
      peerId,
      conversationId,
      messageId,
      reason,
    });
    return result.ok;
  }

  async socialDmAck(peerId: string, conversationId: string, messageId: string, status = 'acked'): Promise<boolean> {
    const result = await Libp2pBridge.socialDmAck({
      peerId,
      conversationId,
      messageId,
      status,
    });
    return result.ok;
  }

  async socialContactsSendRequest(peerId: string, helloText = ''): Promise<boolean> {
    const result = await Libp2pBridge.socialContactsSendRequest({ peerId, helloText });
    return result.ok;
  }

  async socialContactsAccept(peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.socialContactsAccept({ peerId });
    return result.ok;
  }

  async socialContactsReject(peerId: string, reason = ''): Promise<boolean> {
    const result = await Libp2pBridge.socialContactsReject({ peerId, reason });
    return result.ok;
  }

  async socialContactsRemove(peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.socialContactsRemove({ peerId });
    return result.ok;
  }

  async socialGroupsCreate(groupMetaJson: string | Record<string, JsonValue>): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.socialGroupsCreate({ groupMetaJson: toJsonString(groupMetaJson) });
  }

  async socialGroupsUpdate(groupId: string, patchJson: string | Record<string, JsonValue>): Promise<boolean> {
    const result = await Libp2pBridge.socialGroupsUpdate({
      groupId,
      patchJson: toJsonString(patchJson),
    });
    return result.ok;
  }

  async socialGroupsInvite(groupId: string, peerIds: string[]): Promise<boolean> {
    const result = await Libp2pBridge.socialGroupsInvite({ groupId, peerIds });
    return result.ok;
  }

  async socialGroupsKick(groupId: string, peerId: string): Promise<boolean> {
    const result = await Libp2pBridge.socialGroupsKick({ groupId, peerId });
    return result.ok;
  }

  async socialGroupsLeave(groupId: string): Promise<boolean> {
    const result = await Libp2pBridge.socialGroupsLeave({ groupId });
    return result.ok;
  }

  async socialGroupsSend(groupId: string, messageJson: string | Record<string, JsonValue>): Promise<boolean> {
    const result = await Libp2pBridge.socialGroupsSend({
      groupId,
      messageJson: toJsonString(messageJson),
    });
    return result.ok;
  }

  async socialSynccastUpsertProgram(
    roomId: string,
    programJson: string | Record<string, JsonValue>,
  ): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.socialSynccastUpsertProgram({
      roomId,
      programJson: toJsonString(programJson),
    });
  }

  async socialSynccastJoin(roomId: string, peerId = ''): Promise<boolean> {
    const result = await Libp2pBridge.socialSynccastJoin({ roomId, peerId });
    return result.ok;
  }

  async socialSynccastLeave(roomId: string): Promise<boolean> {
    const result = await Libp2pBridge.socialSynccastLeave({ roomId });
    return result.ok;
  }

  async socialSynccastControl(roomId: string, controlJson: string | Record<string, JsonValue>): Promise<boolean> {
    const result = await Libp2pBridge.socialSynccastControl({
      roomId,
      controlJson: toJsonString(controlJson),
    });
    return result.ok;
  }

  async socialSynccastGetState(roomId: string): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.socialSynccastGetState({ roomId });
  }

  async socialSynccastListRooms(limit = 20): Promise<{ items: SyncCastRoomState[]; totalCount: number }> {
    const result = await Libp2pBridge.socialSynccastListRooms({ limit });
    return {
      items: Array.isArray(result.items) ? result.items : [],
      totalCount:
        typeof result.totalCount === 'number'
          ? result.totalCount
          : Array.isArray(result.items)
            ? result.items.length
            : 0,
    };
  }

  async socialMomentsPublish(postJson: string | Record<string, JsonValue>): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.socialMomentsPublish({ postJson: toJsonString(postJson) });
  }

  async socialMomentsDelete(postId: string): Promise<boolean> {
    const result = await Libp2pBridge.socialMomentsDelete({ postId });
    return result.ok;
  }

  async socialMomentsLike(postId: string, like: boolean): Promise<boolean> {
    const result = await Libp2pBridge.socialMomentsLike({ postId, like });
    return result.ok;
  }

  async socialMomentsComment(postId: string, commentJson: string | Record<string, JsonValue>): Promise<boolean> {
    const result = await Libp2pBridge.socialMomentsComment({
      postId,
      commentJson: toJsonString(commentJson),
    });
    return result.ok;
  }

  async socialMomentsTimeline(cursor = '', limit = 20): Promise<{ items: MomentPost[]; nextCursor: string; hasMore: boolean }> {
    const result = await Libp2pBridge.socialMomentsTimeline({ cursor, limit });
    return {
      items: Array.isArray(result.items) ? result.items : [],
      nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : '',
      hasMore: Boolean(result.hasMore),
    };
  }

  async socialNotificationsList(
    cursor = '',
    limit = 20
  ): Promise<{ items: NotificationItem[]; nextCursor: string; hasMore: boolean }> {
    const result = await Libp2pBridge.socialNotificationsList({ cursor, limit });
    return {
      items: Array.isArray(result.items) ? result.items : [],
      nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : '',
      hasMore: Boolean(result.hasMore),
    };
  }

  async socialQueryPresence(peerIds: string[]): Promise<PresenceSnapshot[]> {
    const result = await Libp2pBridge.socialQueryPresence({ peerIds });
    return Array.isArray(result.peers) ? result.peers : [];
  }

  async socialPollEvents(maxEvents = 64): Promise<BridgeEventEntry[]> {
    const result = await Libp2pBridge.socialPollEvents({ maxEvents });
    return result.events ?? [];
  }
}

export const libp2pService = new Libp2pService();
