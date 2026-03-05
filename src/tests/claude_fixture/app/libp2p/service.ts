import { Capacitor } from '@capacitor/core';
import { Libp2pBridge } from './index';
import type {
  BridgeEventEntry,
  DiscoveredPeer,
  HostNetworkStatus,
  JsonValue,
  MsQuicSettings,
  MomentPost,
  NotificationItem,
  PresenceSnapshot,
  RwadNfcAuthorizeTransferReq,
  RwadNfcAuthorizeTransferResp,
  RwadNfcEnrollReq,
  RwadNfcEnrollResp,
  RwadNfcResolveRecipientReq,
  RwadNfcResolveRecipientResp,
  RwadNfcProof,
  RwadNfcStartReceiveReq,
  RwadNfcStartReceiveResp,
  RwadNfcStatusReq,
  RwadNfcStatusResp,
  RwadNfcStopReceiveReq,
  RwadNfcStopReceiveResp,
  SyncCastRoomState,
} from './definitions';
import type { SessionContext } from '../domain/dex/types';
import { cborValueToJsonValue, decodeCbor64, encodeCbor64, jsonValueToCborValue } from './cbor';
import { canonicalizePeerId, isCanonicalPeerId } from './peerId';
import { shouldEnableWebBridgeFallback } from './webBridgeFallback';

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
  return canonicalizePeerId(value);
}

function isLikelyPeerId(peerId: string): boolean {
  return isCanonicalPeerId(canonicalizePeerId(peerId));
}

function sanitizeRuntimePlaceholderError(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  const lower = normalized.toLowerCase();
  if (
    lower === 'node_not_initialized'
    || lower === 'node_not_initiailized'
    || lower === 'runtime_not_ready'
    || lower === 'init_pending'
    || lower === 'init_failed'
    || lower === 'start_failed'
    || lower === 'start_not_effective'
    || lower.includes('node_not_initialized')
    || lower.includes('node_not_initiailized')
    || lower.includes('runtime_not_ready')
  ) {
    return '';
  }
  return normalized;
}

const LOCAL_PEER_ID_STORAGE_KEY = 'profile_local_peer_id_v1';
const LIBP2P_RUNTIME_PROFILE_OVERRIDE_STORAGE_KEY = 'libp2p_runtime_profile_override_v1';
type RuntimeProfileId = 'standard_android' | 'huawei_family' | 'harmony_android_container';

function normalizeRuntimeProfileOverride(value: unknown): RuntimeProfileId | '' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized === 'auto' || normalized === 'default') {
    return '';
  }
  if (normalized === 'standard_android' || normalized === 'android' || normalized === 'standard') {
    return 'standard_android';
  }
  if (normalized === 'huawei_family' || normalized === 'huawei' || normalized === 'honor') {
    return 'huawei_family';
  }
  if (
    normalized === 'harmony_android_container'
    || normalized === 'harmony'
    || normalized === 'hongmeng'
    || normalized === 'ohos'
    || normalized === 'zhuoyi'
    || normalized === 'zyt'
  ) {
    return 'harmony_android_container';
  }
  return '';
}

function hasBrowserStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export class Libp2pService {
  private initialized = false;
  private ensureStartedInFlight: Promise<boolean> | null = null;
  private lastStartError = '';
  private ensureStartCooldownUntilMs = 0;
  private readonly mdnsDefaultProbeIntervalSeconds = 2;
  private readonly mdnsDiscoveryReasons: Set<string> = new Set<string>();

  private isTerminalStartError(errorText: string): boolean {
    const normalized = errorText.trim().toLowerCase();
    if (!normalized) return false;
    return normalized.includes('load_library_failed')
      || normalized.includes('native_lib_not_loaded')
      || normalized.includes('dlopen')
      || normalized.includes('unsatisfiedlinkerror')
      || normalized.includes('no such method');
  }

  private isUndetailedStartupError(errorText: string): boolean {
    const normalized = errorText.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    if (
      normalized === 'init_failed'
      || normalized === 'start_failed'
      || normalized === 'start_not_effective'
      || normalized === 'node_not_initialized'
      || normalized === 'node_not_initiailized'
      || normalized === 'runtime_not_ready'
      || normalized === 'init_pending'
      || normalized === 'runtime_health_empty_payload'
    ) {
      return true;
    }
    return /^node_(init|start)_failed_without_detail(?::.*)?$/i.test(normalized)
      || /^attempt_\d+:node_(init|start)_failed_without_detail.*$/i.test(normalized);
  }

  private pickBestStartupError(...candidates: Array<string | undefined | null>): string {
    let fallback = '';
    for (const candidate of candidates) {
      const normalized = typeof candidate === 'string' ? candidate.trim() : '';
      if (!normalized) {
        continue;
      }
      if (!this.isUndetailedStartupError(normalized)) {
        return normalized;
      }
      fallback = normalized;
    }
    return fallback;
  }

  private summarizeInitAttempt(attempt: Record<string, JsonValue>): string {
    const listen = Array.isArray(attempt.listenAddresses)
      ? attempt.listenAddresses
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
      : [];
    const automationsRaw = isJsonRecord(attempt.automations) ? attempt.automations : {};
    const enabledAutomations = Object.entries(automationsRaw)
      .filter(([, value]) => coerceBoolean(value, false))
      .map(([key]) => key)
      .sort();
    const listenText = listen.length > 0 ? listen.join(';') : 'none';
    const automationText = enabledAutomations.length > 0 ? enabledAutomations.join('+') : 'none';
    return `listen=${listenText},automations=${automationText}`;
  }

  private readRuntimeProfileOverride(): RuntimeProfileId | '' {
    const envOverride = normalizeRuntimeProfileOverride(
      (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_LIBP2P_RUNTIME_PROFILE_OVERRIDE,
    );
    if (envOverride) {
      return envOverride;
    }
    if (hasBrowserStorage()) {
      try {
        const storageOverride = normalizeRuntimeProfileOverride(
          localStorage.getItem(LIBP2P_RUNTIME_PROFILE_OVERRIDE_STORAGE_KEY),
        );
        if (storageOverride) {
          return storageOverride;
        }
      } catch {
        // ignore storage read failures
      }
    }
    return '';
  }

  private isHuaweiLikeRuntime(): boolean {
    if (!this.hasBridgeBackend()) {
      return false;
    }
    const globalNavigator = (globalThis as { navigator?: { userAgent?: string; platform?: string; vendor?: string } }).navigator;
    const marker = [
      globalNavigator?.userAgent ?? '',
      globalNavigator?.platform ?? '',
      globalNavigator?.vendor ?? '',
    ].join(' ').toLowerCase();
    if (!marker) {
      return false;
    }
    return marker.includes('huawei')
      || marker.includes('honor')
      || marker.includes('harmony')
      || marker.includes('hongmeng')
      || marker.includes('ohos')
      || marker.includes('zhuoyi')
      || marker.includes('zyt');
  }

  private setStartCooldown(ms: number): void {
    this.ensureStartCooldownUntilMs = Date.now() + Math.max(0, ms);
  }

  private persistPeerId(peerId: string): void {
    const normalized = normalizePeerIdText(peerId);
    if (!normalized || !hasBrowserStorage()) {
      return;
    }
    try {
      localStorage.setItem(LOCAL_PEER_ID_STORAGE_KEY, normalized);
    } catch {
      // ignore storage write failures
    }
  }

  private async getLocalPeerIdDirect(): Promise<string> {
    const raw = await Libp2pBridge.getLocalPeerId().catch(() => ({ peerId: '' }));
    const peerId = normalizePeerIdText(raw.peerId);
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

  private hasWebFallbackBridge(): boolean {
    return shouldEnableWebBridgeFallback();
  }

  private hasBridgeBackend(): boolean {
    return this.hasNativeBridge() || this.hasWebFallbackBridge();
  }

  private async invokeOptionalBridge(
    method: string,
    payload: Record<string, JsonValue> = {},
  ): Promise<Record<string, JsonValue>> {
    if (!this.hasBridgeBackend()) {
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

  private async invokeOptionalBridgeCbor(
    method: string,
    payload: Record<string, JsonValue> = {},
  ): Promise<Record<string, JsonValue>> {
    const wrappedPayload = encodeCbor64(jsonValueToCborValue(payload));
    const raw = await this.invokeOptionalBridge(method, { payload: wrappedPayload });
    const responsePayload = typeof raw.payload === 'string' ? raw.payload : '';
    if (!responsePayload) {
      throw new Error('invalid_cbor_payload');
    }
    const decoded = decodeCbor64(responsePayload);
    const normalized = cborValueToJsonValue(decoded);
    if (!isJsonRecord(normalized)) {
      throw new Error('invalid_cbor_payload');
    }
    return normalized;
  }

  private normalizeDiscoveryReason(reason: string): string {
    return typeof reason === 'string' ? reason.trim() : '';
  }

  private async safeBridgeCall<T>(operation: () => Promise<T>, fallback: T, operationName = 'bridgeCall'): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error(`[Libp2pService] ${operationName}`, error);
      }
      return fallback;
    }
  }

  private async applyDiscoveryPolicy(): Promise<void> {
    if (this.mdnsDiscoveryReasons.size === 0) {
      await this.mdnsSetEnabled(false);
      return;
    }
    const started = await this.ensureStarted().catch(() => false);
    if (!started) {
      return;
    }
    const health = await this.runtimeHealth().catch(() => ({
      nativeReady: false,
      started: false,
      peerId: undefined as string | undefined,
      lastError: undefined as string | undefined,
    }));
    if (!health.nativeReady || !health.started) {
      return;
    }
    await this.applyDiscoveryPolicyInternal();
  }

  private async applyDiscoveryPolicyInternal(): Promise<void> {
    if (this.mdnsDiscoveryReasons.size === 0) {
      await this.mdnsSetEnabled(false);
      return;
    }
    await this.mdnsSetInterval(this.mdnsDefaultProbeIntervalSeconds);
    await this.mdnsSetEnabled(true);
    await this.mdnsProbe();
  }

  async setDiscoveryActive(enabled: boolean, reason: string): Promise<void> {
    const normalizedReason = this.normalizeDiscoveryReason(reason);
    if (!normalizedReason) {
      return;
    }
    if (enabled) {
      const existed = this.mdnsDiscoveryReasons.has(normalizedReason);
      if (existed) {
        return;
      }
      this.mdnsDiscoveryReasons.add(normalizedReason);
      await this.applyDiscoveryPolicy();
      return;
    }
    const existed = this.mdnsDiscoveryReasons.delete(normalizedReason);
    if (!existed) {
      return;
    }
    await this.applyDiscoveryPolicy();
  }

  isNativePlatform(): boolean {
    return this.hasBridgeBackend();
  }

  async init(config?: Record<string, JsonValue> | string): Promise<boolean> {
    if (!this.isNativePlatform()) {
      this.lastStartError = 'native_platform_required';
      return false;
    }
    if (typeof config === 'string') {
      const parsed = (() => {
        try {
          const row = JSON.parse(config);
          return isJsonRecord(row) ? row : null;
        } catch {
          return null;
        }
      })();
      if (parsed) {
        return this.init(parsed);
      }
      const fallbackResult = await Libp2pBridge.init({ config }).catch((error) => {
        this.lastStartError = error instanceof Error ? error.message : `${error}`;
        return { ok: false };
      });
      this.initialized = fallbackResult.ok;
      if (!fallbackResult.ok && !this.lastStartError) {
        this.lastStartError = (await this.getLastError().catch(() => '')) || 'init_failed';
      }
      return fallbackResult.ok;
    }

    const runtimeProfileOverride = this.readRuntimeProfileOverride();
    const preferConservativeFirst = runtimeProfileOverride !== 'standard_android' && (
      runtimeProfileOverride !== ''
      || this.isHuaweiLikeRuntime()
    );

    const baseConfig: Record<string, JsonValue> = {
      listenAddresses: [
        '/ip4/0.0.0.0/udp/4001/quic-v1',
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
    if (runtimeProfileOverride) {
      baseConfig.runtimeProfile = runtimeProfileOverride;
      baseConfig.runtime_profile = runtimeProfileOverride;
    }

    const conservativeAutomations: Record<string, JsonValue> = {
      gossipsub: runtimeProfileOverride === 'harmony_android_container' ? false : true,
      directStream: false,
      rendezvous: false,
      autonat: false,
      circuitRelay: false,
      livestream: false,
      dataTransfer: false,
    };

    const conservativeFirstAttempts: Record<string, JsonValue>[] = [
      {
        ...baseConfig,
        listenAddresses: [
          '/ip4/0.0.0.0/tcp/0',
          '/ip4/127.0.0.1/tcp/0',
        ],
        automations: conservativeAutomations,
      },
      {
        ...baseConfig,
        listenAddresses: [
          '/ip4/127.0.0.1/tcp/0',
        ],
        automations: {
          ...conservativeAutomations,
          gossipsub: false,
        },
      },
      {
        ...baseConfig,
        listenAddresses: [],
        automations: {
          ...conservativeAutomations,
          gossipsub: false,
        },
      },
    ];

    const aggressiveAttempts: Record<string, JsonValue>[] = [
      baseConfig,
      {
        ...baseConfig,
        listenAddresses: [
          '/ip4/0.0.0.0/tcp/0',
          '/ip6/::/tcp/0',
          '/ip4/0.0.0.0/udp/0/quic-v1',
          '/ip6/::/udp/0/quic-v1',
        ],
      },
      {
        ...baseConfig,
        listenAddresses: [
          '/ip4/0.0.0.0/tcp/0',
          '/ip6/::/tcp/0',
        ],
        automations: {
          ...conservativeAutomations,
          directStream: true,
          livestream: true,
        },
      },
      {
        ...(config ?? {}),
        ...(runtimeProfileOverride
          ? { runtimeProfile: runtimeProfileOverride, runtime_profile: runtimeProfileOverride }
          : {}),
      },
      {
        ...(config ?? {}),
        ...(runtimeProfileOverride
          ? { runtimeProfile: runtimeProfileOverride, runtime_profile: runtimeProfileOverride }
          : {}),
        listenAddresses: [
          '/ip4/127.0.0.1/tcp/0',
        ],
      },
    ];

    const compatibilityAttempts: Record<string, JsonValue>[] = preferConservativeFirst
      ? [...conservativeFirstAttempts, ...aggressiveAttempts]
      : [...aggressiveAttempts, ...conservativeFirstAttempts];

    const initErrors: string[] = [];
    for (let index = 0; index < compatibilityAttempts.length; index += 1) {
      const attempt = compatibilityAttempts[index]!;
      const attemptTag = `attempt_${index + 1}`;
      if (index > 0) {
        await this.invokeOptionalBridge('reset').catch(() => ({} as Record<string, JsonValue>));
      }
      const result = await Libp2pBridge.init({ config: attempt }).catch((error) => {
        const text = error instanceof Error ? error.message : `${error}`;
        if (text.trim().length > 0) {
          initErrors.push(`${attemptTag}:${text.trim()}`);
        }
        return { ok: false };
      });
      if (result.ok) {
        this.initialized = true;
        this.lastStartError = '';
        return true;
      }
      const nativeError = await this.getLastError().catch(() => '');
      const normalizedNativeError = nativeError.trim();
      if (normalizedNativeError.length > 0) {
        initErrors.push(`${attemptTag}:${normalizedNativeError}`);
      } else {
        initErrors.push(`${attemptTag}:node_init_failed_without_detail(${this.summarizeInitAttempt(attempt)})`);
      }
    }

    this.initialized = false;
    this.lastStartError = this.pickBestStartupError(
      ...initErrors,
      `node_init_failed_without_detail:attempted_${compatibilityAttempts.length}`,
      'init_failed',
    );
    if (this.isTerminalStartError(this.lastStartError)) {
      this.setStartCooldown(60_000);
    } else {
      this.setStartCooldown(10_000);
    }
    return false;
  }

  async start(): Promise<boolean> {
    if (!this.hasBridgeBackend()) {
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
      this.lastStartError = this.pickBestStartupError(
        this.lastStartError,
        nativeError,
        health.lastError ?? '',
        'start_failed',
      );
    }
    return result.ok;
  }

  async stop(): Promise<boolean> {
    const result = await Libp2pBridge.stop();
    return result.ok;
  }

  async isStarted(): Promise<boolean> {
    if (!this.hasBridgeBackend()) {
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
      const nativeError = await this.getLastError().catch(() => '');
      const lastError = nativeError || bridgeError || this.lastStartError || 'runtime_health_bridge_failed';
      return {
        nativeReady: started || this.initialized,
        started,
        peerId: directPeerId || undefined,
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
    const peerId = typeof peerValue === 'string' && peerValue.trim().length > 0 ? peerValue.trim() : '';
    if (peerId) {
      this.persistPeerId(peerId);
    }
    const errorValue = (result.last_error ?? result.lastError) as unknown;
    const parsedLastErrorRaw = typeof errorValue === 'string' && errorValue.trim().length > 0 ? errorValue.trim() : '';
    const parsedLastError = sanitizeRuntimePlaceholderError(parsedLastErrorRaw) || undefined;
    const nativeBridgeError = sanitizeRuntimePlaceholderError(await this.getLastError().catch(() => ''));
    const fallbackStartError = sanitizeRuntimePlaceholderError(this.lastStartError);
    const healthPayloadMissing = !hasNativeReadyField && !hasStartedField;
    const lastError = parsedLastError
      ?? ((!effectiveNativeReady && !started)
        ? (nativeBridgeError || fallbackStartError || (healthPayloadMissing ? 'runtime_health_empty_payload' : 'runtime_not_ready'))
        : undefined);
    return {
      nativeReady: effectiveNativeReady,
      started,
      peerId: peerId || undefined,
      lastError,
    };
  }

  async getHostNetworkStatus(): Promise<HostNetworkStatus | null> {
    try {
      const result = await this.invokeOptionalBridge('getHostNetworkStatus');
      const transport = typeof result.transport === 'string' ? result.transport : 'none';
      const networkType = typeof result.networkType === 'string' ? result.networkType : 'none';
      const ssid = typeof result.ssid === 'string' ? result.ssid : '';
      const reason = typeof result.reason === 'string' ? result.reason : '';
      const timestampMs =
        typeof result.timestampMs === 'number' && Number.isFinite(result.timestampMs)
          ? result.timestampMs
          : Date.now();
      return {
        type: 'HostNetworkStatus',
        transport,
        networkType,
        ssid: ssid || undefined,
        isConnected: coerceBoolean(result.isConnected, false),
        isMetered: coerceBoolean(result.isMetered, false),
        timestampMs,
        reason: reason || undefined,
      };
    } catch {
      return null;
    }
  }

  async ensureStarted(config?: Record<string, JsonValue> | string): Promise<boolean> {
    if (!this.hasBridgeBackend()) {
      this.lastStartError = 'native_bridge_unavailable';
      return false;
    }
    const nowMs = Date.now();
    if (this.ensureStartCooldownUntilMs > nowMs) {
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
      if (healthBefore.started || await this.isStarted().catch(() => false)) {
        this.initialized = true;
        this.lastStartError = '';
        this.ensureStartCooldownUntilMs = 0;
        return true;
      }

      const mustInit = !this.initialized || !healthBefore.nativeReady;
      if (mustInit) {
        const initOk = await this.init(config).catch(() => false);
        if (!initOk) {
          this.lastStartError = this.pickBestStartupError(
            this.lastStartError,
            await this.getLastError().catch(() => ''),
            'init_failed',
          );
          this.setStartCooldown(this.isTerminalStartError(this.lastStartError) ? 60_000 : 10_000);
          return false;
        }
      }

      const started = await this.start().catch(() => false);
      if (!started) {
        this.lastStartError = this.pickBestStartupError(
          this.lastStartError,
          await this.getLastError().catch(() => ''),
          'start_failed',
        );
        this.setStartCooldown(this.isTerminalStartError(this.lastStartError) ? 60_000 : 10_000);
        return false;
      }

      const startedAfter = await this.isStarted().catch(() => false);
      if (!startedAfter) {
        this.lastStartError = this.pickBestStartupError(
          this.lastStartError,
          await this.getLastError().catch(() => ''),
          'start_not_effective',
        );
        this.setStartCooldown(this.isTerminalStartError(this.lastStartError) ? 60_000 : 10_000);
        return false;
      }

      this.initialized = true;
      this.lastStartError = '';
      this.ensureStartCooldownUntilMs = 0;
      if (this.mdnsDiscoveryReasons.size > 0) {
        await this.applyDiscoveryPolicyInternal();
      }
      return true;
    })();

    try {
      return await this.ensureStartedInFlight;
    } finally {
      this.ensureStartedInFlight = null;
    }
  }

  async ensurePeerIdentity(config?: Record<string, JsonValue> | string): Promise<string> {
    if (!this.hasBridgeBackend()) {
      return '';
    }
    const direct = await this.getLocalPeerIdDirect().catch(() => '');
    if (direct) {
      return direct;
    }
    const nowMs = Date.now();
    if (this.ensureStartCooldownUntilMs <= nowMs) {
      const started = await this.ensureStarted(config).catch(() => false);
      if (started) {
        const afterStart = await this.getLocalPeerIdDirect().catch(() => '');
        if (afterStart) {
          return afterStart;
        }
      }
    }
    const health = await this.runtimeHealth().catch(() => ({
      nativeReady: false,
      started: false,
      peerId: undefined as string | undefined,
      lastError: undefined as string | undefined,
    }));
    const fromHealth = normalizePeerIdText(health.peerId);
    if (fromHealth) {
      return fromHealth;
    }
    return '';
  }

  async generateIdentity(): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.generateIdentity();
  }

  async identityFromSeed(seed: string): Promise<Record<string, JsonValue>> {
    return Libp2pBridge.identityFromSeed({ seed });
  }

  async getLocalPeerId(): Promise<string> {
    const normalize = (value: unknown): string => normalizePeerIdText(value);
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
    return '';
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

  async setMsquicSettings(settings: Partial<MsQuicSettings> | Record<string, JsonValue>): Promise<boolean> {
    const settingsJson = JSON.stringify(settings ?? {});
    const result = await this.safeBridgeCall(
      async () => Libp2pBridge.setMsquicSettings({ settingsJson }),
      { ok: false },
      'setMsquicSettings'
    );
    return result.ok;
  }

  async getMsquicSettings(): Promise<Record<string, JsonValue>> {
    return this.safeBridgeCall(
      async () => Libp2pBridge.getMsquicSettings(),
      {},
      'getMsquicSettings',
    );
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
    return this.safeBridgeCall(async () => {
      const result = await Libp2pBridge.mdnsSetEnabled({ enabled });
      return result.ok;
    }, false, `mdnsSetEnabled(${enabled})`);
  }

  async mdnsSetInterface(ipv4: string): Promise<boolean> {
    return this.safeBridgeCall(async () => {
      const result = await Libp2pBridge.mdnsSetInterface({ ipv4 });
      return result.ok;
    }, false, `mdnsSetInterface(${ipv4})`);
  }

  async mdnsSetInterval(seconds: number): Promise<boolean> {
    return this.safeBridgeCall(async () => {
      const result = await Libp2pBridge.mdnsSetInterval({ seconds });
      return result.ok;
    }, false, `mdnsSetInterval(${seconds})`);
  }

  async mdnsProbe(): Promise<boolean> {
    return this.safeBridgeCall(async () => {
      const result = await Libp2pBridge.mdnsProbe();
      return result.ok;
    }, false, 'mdnsProbe');
  }

  async mdnsDebug(): Promise<Record<string, JsonValue>> {
    return this.safeBridgeCall(
      async () => {
        const result = await Libp2pBridge.mdnsDebug();
        return result;
      },
      {},
      'mdnsDebug',
    );
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

  async setSevenGatesReport(report: Record<string, JsonValue>): Promise<boolean> {
    if (!this.hasBridgeBackend()) {
      return false;
    }
    const dynamicBridge = Libp2pBridge as unknown as Record<string, unknown>;
    const fn = dynamicBridge.setSevenGatesReport;
    if (typeof fn !== 'function') {
      return false;
    }
    try {
      const result = await (fn as (options: { reportJson: string }) => Promise<unknown>)({
        reportJson: JSON.stringify(report ?? {}),
      });
      if (isJsonRecord(result)) {
        return coerceBoolean(result.ok, false);
      }
      if (result && typeof result === 'object') {
        return coerceBoolean((result as { ok?: unknown }).ok, false);
      }
      return false;
    } catch {
      return false;
    }
  }

  async getSevenGatesReport(): Promise<Record<string, JsonValue>> {
    if (!this.hasBridgeBackend()) {
      return {};
    }
    const dynamicBridge = Libp2pBridge as unknown as Record<string, unknown>;
    const fn = dynamicBridge.getSevenGatesReport;
    if (typeof fn !== 'function') {
      return {};
    }
    try {
      const result = await (fn as () => Promise<unknown>)();
      if (isJsonRecord(result)) {
        return result;
      }
      return {};
    } catch {
      return {};
    }
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
    return this.safeBridgeCall(async () => {
      const result = await Libp2pBridge.getLanEndpoints();
      const endpoints = Array.isArray(result.endpoints) ? result.endpoints : [];
      return endpoints as Record<string, JsonValue>[];
    }, [], 'getLanEndpoints');
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
      const nativeError = sanitizeRuntimePlaceholderError((result.error ?? '').trim());
      if (nativeError.length > 0) {
        return nativeError;
      }
      return sanitizeRuntimePlaceholderError(this.lastStartError || '');
    } catch (error) {
      const bridgeError = error instanceof Error ? error.message : `${error}`;
      return sanitizeRuntimePlaceholderError(this.lastStartError || '')
        || sanitizeRuntimePlaceholderError(bridgeError)
        || 'runtime_error_unavailable';
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

  async rwadSessionBiometricReady(): Promise<{ ok: boolean; ready?: boolean; error?: string }> {
    try {
      const result = await this.invokeOptionalBridge('rwadSessionBiometricReady');
      return {
        ok: coerceBoolean(result.ok, false),
        ready: typeof result.ready === 'boolean' ? result.ready : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadSessionCreate(options: {
    walletId: string;
    expiresAt: number;
  }): Promise<{ ok: boolean; sessionContext?: SessionContext; error?: string }> {
    try {
      const result = await this.invokeOptionalBridge('rwadSessionCreate', {
        walletId: options.walletId,
        expiresAt: options.expiresAt,
      });
      return {
        ok: coerceBoolean(result.ok, false),
        sessionContext: isJsonRecord(result.sessionContext) ? (result.sessionContext as unknown as SessionContext) : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadSessionSignChallenge(options: {
    challenge: string;
    walletId?: string;
    policyHash?: string;
    nonce?: string;
    expiresAt?: number;
  }): Promise<{ ok: boolean; signature?: string; error?: string }> {
    try {
      const result = await this.invokeOptionalBridge('rwadSessionSignChallenge', {
        challenge: options.challenge,
        walletId: options.walletId ?? '',
        policyHash: options.policyHash ?? '',
        nonce: options.nonce ?? '',
        expiresAt: typeof options.expiresAt === 'number' ? options.expiresAt : 0,
      });
      return {
        ok: coerceBoolean(result.ok, false),
        signature: typeof result.signature === 'string' ? result.signature : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadSessionSignWithSession(options: {
    sessionId: string;
    payloadBase64: string;
    policyRef?: string;
  }): Promise<{ ok: boolean; signature?: string; error?: string }> {
    try {
      const result = await this.invokeOptionalBridge('rwadSessionSignWithSession', {
        sessionId: options.sessionId,
        payloadBase64: options.payloadBase64,
        policyRef: options.policyRef ?? '',
      });
      return {
        ok: coerceBoolean(result.ok, false),
        signature: typeof result.signature === 'string' ? result.signature : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadSessionDestroy(sessionId: string): Promise<boolean> {
    try {
      const result = await this.invokeOptionalBridge('rwadSessionDestroy', { sessionId });
      return coerceBoolean(result.ok, false);
    } catch {
      return false;
    }
  }

  async rwadSessionAuthorizePayment(options: {
    walletId: string;
    reason?: string;
    timeoutMs?: number;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.invokeOptionalBridge('rwadSessionAuthorizePayment', {
        walletId: options.walletId,
        reason: options.reason ?? '',
        timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : 45_000,
      });
      return {
        ok: coerceBoolean(result.ok, false),
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadNfcStatus(options: RwadNfcStatusReq): Promise<RwadNfcStatusResp> {
    try {
      const result = await this.invokeOptionalBridgeCbor('rwadNfcStatus', {
        walletId: options.walletId,
      });
      return {
        ok: coerceBoolean(result.ok, false),
        walletId: typeof result.walletId === 'string' ? result.walletId : undefined,
        enrolled: typeof result.enrolled === 'boolean' ? result.enrolled : undefined,
        tagCommitment: typeof result.tagCommitment === 'string' ? result.tagCommitment : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        walletId: options.walletId,
        enrolled: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadNfcEnroll(options: RwadNfcEnrollReq): Promise<RwadNfcEnrollResp> {
    try {
      const result = await this.invokeOptionalBridgeCbor('rwadNfcEnroll', {
        walletId: options.walletId,
        timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : 25_000,
      });
      return {
        ok: coerceBoolean(result.ok, false),
        walletId: typeof result.walletId === 'string' ? result.walletId : undefined,
        enrolled: typeof result.enrolled === 'boolean' ? result.enrolled : undefined,
        tagCommitment: typeof result.tagCommitment === 'string' ? result.tagCommitment : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        walletId: options.walletId,
        enrolled: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadNfcAuthorizeTransfer(options: RwadNfcAuthorizeTransferReq): Promise<RwadNfcAuthorizeTransferResp> {
    try {
      const result = await this.invokeOptionalBridgeCbor('rwadNfcAuthorizeTransfer', {
        walletId: options.walletId,
        to: options.to,
        amount: options.amount,
        nonce: options.nonce ?? '',
        txDigest: options.txDigest ?? '',
        timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : 25_000,
      });
      const proofRaw = isJsonRecord(result.proof) ? result.proof : null;
      const proof: RwadNfcProof | undefined = proofRaw
        ? {
            walletId: typeof proofRaw.walletId === 'string' ? proofRaw.walletId : '',
            tagCommitment: typeof proofRaw.tagCommitment === 'string' ? proofRaw.tagCommitment : '',
            challenge: typeof proofRaw.challenge === 'string' ? proofRaw.challenge : '',
            signature: typeof proofRaw.signature === 'string' ? proofRaw.signature : '',
            ts: typeof proofRaw.ts === 'number' ? proofRaw.ts : 0,
            nonce: typeof proofRaw.nonce === 'string' ? proofRaw.nonce : '',
          }
        : undefined;
      return {
        ok: coerceBoolean(result.ok, false),
        proof: proof && proof.walletId && proof.tagCommitment && proof.challenge && proof.signature ? proof : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadNfcStartReceive(options: RwadNfcStartReceiveReq): Promise<RwadNfcStartReceiveResp> {
    try {
      const result = await this.invokeOptionalBridgeCbor('rwadNfcStartReceive', {
        walletId: options.walletId,
        ttlMs: typeof options.ttlMs === 'number' ? options.ttlMs : 180_000,
      });
      return {
        ok: coerceBoolean(result.ok, false),
        walletId: typeof result.walletId === 'string' ? result.walletId : undefined,
        expiresAt: typeof result.expiresAt === 'number' ? result.expiresAt : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        walletId: options.walletId,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadNfcStopReceive(options: RwadNfcStopReceiveReq = {}): Promise<RwadNfcStopReceiveResp> {
    try {
      const result = await this.invokeOptionalBridgeCbor('rwadNfcStopReceive', {
        walletId: typeof options.walletId === 'string' ? options.walletId : '',
      });
      return {
        ok: coerceBoolean(result.ok, false),
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async rwadNfcResolveRecipient(options: RwadNfcResolveRecipientReq = {}): Promise<RwadNfcResolveRecipientResp> {
    try {
      const result = await this.invokeOptionalBridgeCbor('rwadNfcResolveRecipient', {
        timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : 25_000,
        walletId: typeof options.walletId === 'string' ? options.walletId : '',
      });
      return {
        ok: coerceBoolean(result.ok, false),
        walletId: typeof result.walletId === 'string' ? result.walletId : undefined,
        error: typeof result.error === 'string' ? result.error : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `${error}`,
      };
    }
  }

  async openNfcSettings(): Promise<boolean> {
    try {
      const result = await this.invokeOptionalBridge('openNfcSettings');
      return coerceBoolean(result.ok, false);
    } catch {
      return false;
    }
  }

  async openNfcPaymentSettings(): Promise<boolean> {
    try {
      const result = await this.invokeOptionalBridge('openNfcPaymentSettings');
      return coerceBoolean(result.ok, false);
    } catch {
      return this.openNfcSettings();
    }
  }

  async socialListDiscoveredPeers(sourceFilter = '', limit = 64): Promise<{ peers: DiscoveredPeer[]; totalCount: number }> {
    return this.safeBridgeCall(async () => {
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
    }, {
      peers: [] as DiscoveredPeer[],
      totalCount: 0,
    }, `socialListDiscoveredPeers(${sourceFilter},${limit})`);
  }

  async networkDiscoverySnapshot(
    sourceFilter = '',
    limit = 256,
    connectCap = 7,
  ): Promise<Record<string, JsonValue>> {
    return this.safeBridgeCall(async () => {
      return await this.invokeOptionalBridge('networkDiscoverySnapshot', {
        sourceFilter,
        limit,
        connectCap,
      });
    }, {
      ok: false,
      error: 'network_discovery_snapshot_failed',
      connectedPeers: [],
      connectedPeersInfo: [],
      discoveredPeers: { peers: [], totalCount: 0 },
      mdnsDebug: {},
      autoConnect: { attempted: 0, connected: 0 },
    }, `networkDiscoverySnapshot(${sourceFilter},${limit},${connectCap})`);
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
