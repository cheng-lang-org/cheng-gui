import { Capacitor } from '@capacitor/core';
import { libp2pEventPump } from '../../libp2p/eventPump';
import type { BridgeEventEntry, JsonValue } from '../../libp2p/definitions';
import { libp2pService } from '../../libp2p/service';

export interface UpdateTopicsV2 {
  manifest: string;
  attestation: string;
  revoke: string;
  killswitch: string;
}

export interface UpdateTransportOptions {
  channel: string;
  platform: string;
  authority_namespace?: string;
  foreground_poll_ms?: number;
  background_poll_ms?: number;
}

export type UpdateMessageKind = 'manifest' | 'attestation' | 'revoke' | 'killswitch';

export interface UpdateTransportMessage {
  kind: UpdateMessageKind;
  raw: unknown;
  topic: string;
  received_at_ms: number;
  source: 'gossipsub' | 'feed_snapshot' | 'feed_peer';
  carrier: 'gossip' | 'feed';
}

export type UpdateMessageHandler = (message: UpdateTransportMessage) => void | Promise<void>;

export interface UpdateTransportManualResult {
  connectivity_ok: boolean;
  connected_peers: number;
  observed_messages: number;
  authority_sync_ok: boolean;
  reason?: string;
}

interface UpdateTransportPollResult {
  connectivity_ok: boolean;
  connected_peers: number;
  authority_sync_ok: boolean;
  reason?: string;
}

const UPDATE_TOPIC_PREFIX = '/unimaker/updates/v2';
const UPDATE_TOPIC_PREFIX_NO_SLASH = 'unimaker/updates/v2';
const FALLBACK_RENDEZVOUS_NAMESPACES = ['unimaker/nodes/v1'];
const DEFAULT_BOOTSTRAP_GOSSIP_POLICY: Record<string, JsonValue> = {
  topic: '/unimaker/bootstrap/v1',
  tick_seconds: 60,
  random_n: 7,
  candidate_ttl_ms: 180000,
  parallel_dials: 3,
  publish_peer_cap: 16,
  publish_chance_percent: 35,
  publish_min_interval_ms: 60000,
  publish_suppression_ms: 45000,
  require_trusted_publisher: false,
  trusted_publishers: [],
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const row of value) {
    if (typeof row !== 'string') {
      continue;
    }
    const normalized = row.trim();
    if (normalized) {
      out.push(normalized);
    }
  }
  return out;
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

function hasBootstrapConnectivitySignal(status: Record<string, unknown> | null): boolean {
  if (!status) {
    return false;
  }
  const connected = asNumber(status.connected ?? status.connected_peers, 0);
  const known = asNumber(status.known ?? status.known_peers, 0);
  const candidateCount = asNumber(status.candidateCount ?? status.candidate_count, 0);
  const dialConnected = asNumber(
    status.dialConnected ?? status.dial_connected ?? status.lastDialConnected,
    0,
  );
  const announcementReceived = asNumber(
    status.announcementReceived ?? status.announcement_received,
    0,
  );
  return connected > 0 || known > 0 || candidateCount > 0 || dialConnected > 0 || announcementReceived > 0;
}

function normalizePeerId(value: unknown): string {
  return asString(value).trim();
}

function decodeBase64Utf8(value: string): string {
  if (!value.trim()) {
    return '';
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (item) => item.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function normalizePayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return null;
  }
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return payload;
    }
  }
  return payload;
}

function parsePayloadText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}

function decodePayloadAsJson(value: unknown): unknown | null {
  const normalized = parsePayloadText(value);
  if (normalized === null) {
    return null;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

function parseBridgePayload(eventPayload: unknown, fallback: unknown): unknown {
  if (eventPayload === null || eventPayload === undefined) {
    return fallback;
  }
  const maybeParsed = decodePayloadAsJson(eventPayload);
  if (maybeParsed !== null) {
    return maybeParsed;
  }

  const obj = asObject(eventPayload);
  if (!obj) {
    return fallback;
  }
  const encodedPayload = parsePayloadText(obj.payloadBase64);
  if (encodedPayload !== null) {
    const decodedText = decodeBase64Utf8(encodedPayload);
    const decodedJson = decodePayloadAsJson(decodedText);
    if (decodedJson !== null) {
      return decodedJson;
    }
    if (decodedText) {
      return decodedText;
    }
  }
  const directPayload = obj.payload;
  const parsedPayload = decodePayloadAsJson(directPayload);
  if (parsedPayload !== null) {
    return parsedPayload;
  }
  return directPayload ?? fallback;
}

function asLower(value: unknown): string {
  return asString(value).toLowerCase();
}

function normalizeFeedCandidatePayload(payload: unknown): unknown {
  const normalized = normalizePayload(payload);
  if (typeof normalized === 'string') {
    const decoded = decodeBase64Utf8(normalized);
    return decoded ? decodeBase64Utf8(decoded) || decoded : normalized;
  }
  return normalized;
}

function flattenEventPayload(value: unknown): unknown[] {
  const payload = normalizePayload(value);
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizePayload(item)).filter((item): item is Record<string, unknown> | string => item !== null);
  }
  return [payload];
}

function extractFeedCandidates(payload: unknown): unknown[] {
  const row = asObject(payload);
  if (!row) {
    const fallback = normalizeFeedCandidatePayload(payload);
    return fallback ? [fallback] : [];
  }
  const candidates: unknown[] = [];
  const push = (value: unknown) => {
    const normalized = normalizeFeedCandidatePayload(value);
    if (normalized === null || normalized === undefined) {
      return;
    }
    if (Array.isArray(normalized)) {
      for (const item of normalized) {
        push(item);
      }
      return;
    }
    candidates.push(normalized);
  };
  push(row);
  push(row.payload);
  push((row as Record<string, unknown>).entry);
  push((row as Record<string, unknown>).data);
  push((row as Record<string, unknown>).item);
  push((row as Record<string, unknown>).content);
  push((row as Record<string, unknown>).message);
  return candidates;
}

function looksLikeUpdatePayload(payload: unknown): boolean {
  const row = asObject(payload);
  if (!row) {
    return false;
  }
  if (row.topic && isUpdateTopic(asLower(row.topic))) {
    return true;
  }

  if (row.kind === 'update_envelope_v2') {
    return true;
  }

  if (
    row.kind &&
    (asLower(row.kind) === 'manifest_v2' ||
      asLower(row.kind) === 'attestation_v2' ||
      asLower(row.kind) === 'revoke_v2' ||
      asLower(row.kind) === 'killswitch_v2')
  ) {
    return true;
  }

  const candidateSequence = row.sequence;
  const candidateManifest = ('manifest_id' in row && 'channel' in row && 'platform' in row);
  const candidateAttestation = ('attestation_id' in row || ('attestor_peer_id' in row && 'verdict' in row));
  const candidateControl = ('enabled' in row && (asString(row.enabled).toLowerCase() === 'true' || asString(row.enabled).toLowerCase() === 'false'));
  return Boolean(candidateManifest && candidateSequence !== undefined) || candidateAttestation || candidateControl;
}

function isContentFeedItemPayload(payload: unknown): boolean {
  const row = asObject(payload);
  if (!row) {
    return false;
  }
  const type = asLower(row.type);
  if (!type) {
    return true;
  }
  return type === 'contentfeeditem' || type === 'content_feed_item' || type === 'feeditem';
}

function inferUpdateMessageKind(payload: unknown): UpdateMessageKind | null {
  const row = asObject(payload);
  if (!row) {
    return null;
  }
  if (row.kind === 'update_envelope_v2') {
    const nestedPayload = asObject(row.payload) ? row.payload : normalizePayload(row.payload);
    return inferUpdateMessageKind(nestedPayload);
  }

  const kind = asLower(row.kind);
  if (kind.includes('manifest')) {
    return 'manifest';
  }
  if (kind.includes('attestation')) {
    return 'attestation';
  }
  if (kind.includes('kill') && kind.includes('switch')) {
    return 'killswitch';
  }
  if (kind.includes('revoke') || kind.includes('revocation')) {
    return 'revoke';
  }

  if (asObject(row.security)) {
    return 'manifest';
  }
  if (Array.isArray(row.targets) || 'manifest_id' in row && 'targets' in row) {
    return 'revoke';
  }
  if (typeof row.attestor_peer_id === 'string' && row.attestor_peer_id.trim().length > 0) {
    return 'attestation';
  }
  if (typeof row.enabled === 'boolean' && 'reason' in row) {
    return 'killswitch';
  }
  if ('manifest_id' in row && ('reason' in row || 'max_sequence' in row || 'targets' in row)) {
    return 'revoke';
  }
  if (Array.isArray(row.artifacts) && asNumber(row.sequence, 0) > 0 && 'version' in row) {
    return 'manifest';
  }
  if (
    ('manifest_id' in row && 'channel' in row && 'platform' in row)
    && 'sequence' in row
    && asNumber((row as Record<string, unknown>).sequence, 0) > 0
    && 'version' in row
  ) {
    return 'manifest';
  }
  return null;
}

function isUpdateTopic(topic: string): boolean {
  return topic.trim().replace(/^\/+/, '').startsWith(UPDATE_TOPIC_PREFIX_NO_SLASH);
}

function namespaceVariants(namespace: string): string[] {
  const normalized = namespace.trim().replace(/^\/+/, '');
  if (!normalized) {
    return [];
  }
  return [normalized, `/${normalized}`];
}

function inferUpdateMessageTopic(
  payload: unknown,
  fallbackChannel: string,
  fallbackPlatform: string,
): string {
  const row = asObject(payload);
  if (!row) {
    return '';
  }
  const explicitTopic = asString(row.topic).trim();
  if (isUpdateTopic(explicitTopic)) {
    return explicitTopic;
  }

  const envelopePayload = row.kind === 'update_envelope_v2' ? (row.payload as unknown) : payload;
  const basePayload = Object.prototype.hasOwnProperty.call(row, 'payload') ? envelopePayload : payload;
  const kind = inferUpdateMessageKind(basePayload);
  if (!kind) {
    return '';
  }

  const rawBase = asObject(basePayload) ? asObject(basePayload) as Record<string, unknown> : row;
  const channel = asString(rawBase.channel, fallbackChannel);
  const platform = asString(rawBase.platform, fallbackPlatform);
  const topics = buildUpdateTopics(channel || fallbackChannel, platform || fallbackPlatform);
  if (kind === 'manifest') {
    return topics.manifest;
  }
  if (kind === 'attestation') {
    return topics.attestation;
  }
  if (kind === 'revoke') {
    return topics.revoke;
  }
  return topics.killswitch;
}

function parseTopicKind(topic: string): UpdateMessageKind | null {
  if (!isUpdateTopic(topic)) {
    return null;
  }
  if (topic.endsWith('/manifest')) {
    return 'manifest';
  }
  if (topic.endsWith('/attestation')) {
    return 'attestation';
  }
  if (topic.endsWith('/revoke')) {
    return 'revoke';
  }
  if (topic.endsWith('/killswitch')) {
    return 'killswitch';
  }
  return null;
}

export function buildUpdateTopics(channel: string, platform: string): UpdateTopicsV2 {
  const base = `${UPDATE_TOPIC_PREFIX}/${channel}/${platform}`;
  return {
    manifest: `${base}/manifest`,
    attestation: `${base}/attestation`,
    revoke: `${base}/revoke`,
    killswitch: `${base}/killswitch`,
  };
}

function defaultPlatformName(): string {
  const platform = Capacitor.getPlatform();
  if (platform === 'android' || platform === 'ios') {
    return platform;
  }
  if (platform === 'web') {
    return 'android';
  }
  return platform || 'android';
}

export class UpdateTransport {
  private readonly options: UpdateTransportOptions;
  private readonly topics: UpdateTopicsV2;
  private readonly handlers = new Set<UpdateMessageHandler>();
  private readonly subscribedFeedPeers = new Set<string>();
  private unsubscribePump: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private observedMessagesTotal = 0;

  constructor(options?: Partial<UpdateTransportOptions>) {
    const channel = options?.channel?.trim() || 'stable';
    const platform = options?.platform?.trim() || defaultPlatformName();
    this.options = {
      channel,
      platform,
      authority_namespace: options?.authority_namespace?.trim() || `unimaker/updates/v2/${channel}/${platform}`,
      foreground_poll_ms: options?.foreground_poll_ms ?? 60_000,
      background_poll_ms: options?.background_poll_ms ?? 300_000,
    };
    this.topics = buildUpdateTopics(channel, platform);
  }

  getTopics(): UpdateTopicsV2 {
    return { ...this.topics };
  }

  getScope(): { channel: string; platform: string } {
    return {
      channel: this.options.channel,
      platform: this.options.platform,
    };
  }

  subscribe(handler: UpdateMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async start(): Promise<void> {
    if (libp2pService.isNativePlatform()) {
      await this.warmupConnectivity();
      await Promise.all([
        libp2pService.pubsubSubscribe(this.topics.manifest).catch(() => false),
        libp2pService.pubsubSubscribe(this.topics.attestation).catch(() => false),
        libp2pService.pubsubSubscribe(this.topics.revoke).catch(() => false),
        libp2pService.pubsubSubscribe(this.topics.killswitch).catch(() => false),
      ]);
      if (this.options.authority_namespace) {
        void libp2pService.rendezvousAdvertise(this.options.authority_namespace, 300_000);
      }
    }

    if (!this.unsubscribePump) {
      this.unsubscribePump = libp2pEventPump.subscribe((event) => {
        this.handleBridgeEvent(event);
      });
    }

    if (!this.visibilityHandler && typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        this.scheduleNextPoll();
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    this.scheduleNextPoll();
    await this.pollFromAuthority();
  }

  async stop(): Promise<void> {
    if (this.unsubscribePump) {
      this.unsubscribePump();
      this.unsubscribePump = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (libp2pService.isNativePlatform()) {
      await Promise.all([
        libp2pService.pubsubUnsubscribe(this.topics.manifest).catch(() => false),
        libp2pService.pubsubUnsubscribe(this.topics.attestation).catch(() => false),
        libp2pService.pubsubUnsubscribe(this.topics.revoke).catch(() => false),
        libp2pService.pubsubUnsubscribe(this.topics.killswitch).catch(() => false),
      ]);
      const unsubscribeTasks: Promise<boolean>[] = [];
      for (const peerId of this.subscribedFeedPeers) {
        unsubscribeTasks.push(libp2pService.feedUnsubscribePeer(peerId).catch(() => false));
      }
      if (unsubscribeTasks.length > 0) {
        await Promise.all(unsubscribeTasks);
      }
      this.subscribedFeedPeers.clear();
    }
  }

  async manualCheck(): Promise<UpdateTransportManualResult> {
    const observedBefore = this.observedMessagesTotal;
    if (libp2pService.isNativePlatform()) {
      await this.warmupConnectivity({ ensureBootstrap: true });
      await Promise.all([
        libp2pService.pubsubSubscribe(this.topics.manifest).catch(() => false),
        libp2pService.pubsubSubscribe(this.topics.attestation).catch(() => false),
        libp2pService.pubsubSubscribe(this.topics.revoke).catch(() => false),
        libp2pService.pubsubSubscribe(this.topics.killswitch).catch(() => false),
      ]);
    }
    const poll = await this.pollFromAuthority({ strict: true });
    this.scheduleNextPoll();
    return {
      ...poll,
      observed_messages: Math.max(0, this.observedMessagesTotal - observedBefore),
    };
  }

  private nextPollDelayMs(): number {
    if (typeof document === 'undefined') {
      return this.options.foreground_poll_ms ?? 60_000;
    }
    if (document.hidden) {
      return this.options.background_poll_ms ?? 300_000;
    }
    return this.options.foreground_poll_ms ?? 60_000;
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    const delay = Math.max(1_000, this.nextPollDelayMs());
    this.pollTimer = setTimeout(() => {
      void this.pollFromAuthority().finally(() => {
        this.scheduleNextPoll();
      });
    }, delay);
  }

  private dispatch(message: UpdateTransportMessage): void {
    this.observedMessagesTotal += 1;
    for (const handler of this.handlers) {
      handler(message);
    }
  }

  private dispatchPayload(topic: string, payload: unknown, source: UpdateTransportMessage['source']): void {
    const kind = parseTopicKind(topic);
    if (!kind) {
      return;
    }
    const carrier: UpdateTransportMessage['carrier'] = source === 'gossipsub' ? 'gossip' : 'feed';
    this.dispatch({
      kind,
      raw: normalizePayload(payload),
      topic,
      received_at_ms: Date.now(),
      source,
      carrier,
    });
  }

  private dispatchFeedEntry(
    entryPayload: unknown,
    source: Extract<UpdateTransportMessage['source'], 'feed_snapshot' | 'feed_peer'>,
  ): boolean {
    const normalized = normalizePayload(entryPayload);
    const entry = asObject(normalized);
    if (!entry && !Array.isArray(normalized)) {
      return false;
    }
    const hasPayloadField = entry !== null && Object.prototype.hasOwnProperty.call(entry as Record<string, unknown>, 'payload');
    const payload = hasPayloadField
      ? normalizePayload((entry as Record<string, unknown>).payload)
      : normalizePayload(normalized);
    const topic = inferUpdateMessageTopic(
      payload ?? normalized,
      this.options.channel,
      this.options.platform,
    );
    if (!isUpdateTopic(topic)) {
      return false;
    }
    this.dispatchPayload(topic, payload, source);
    return true;
  }

  private dispatchFeedCandidates(
    payload: unknown,
    source: Extract<UpdateTransportMessage['source'], 'feed_snapshot' | 'feed_peer'>,
  ): boolean {
    let dispatched = false;
    const candidates = extractFeedCandidates(payload);
    for (const candidate of candidates) {
      if (!isContentFeedItemPayload(candidate)) {
        continue;
      }
      dispatched = this.dispatchFeedEntry(candidate, source) || dispatched;
    }
    return dispatched;
  }

  private handleBridgeEvent(event: BridgeEventEntry): void {
    const directTopic = asString(event.topic).trim();
    if (
      event.topic === 'pubsub.message'
      || directTopic.startsWith(UPDATE_TOPIC_PREFIX)
      || isUpdateTopic(directTopic)
    ) {
      const payloadObj = asObject(event.payload as JsonValue | undefined) ?? {};
      const topic = asString(payloadObj.topic).trim() || directTopic;
      if (!isUpdateTopic(topic)) {
        return;
      }
      const eventPayload = parseBridgePayload(payloadObj.payload, event.payload);
      const payload = parseBridgePayload(payloadObj.payloadBase64, eventPayload);
      this.dispatchPayload(topic, payload, 'gossipsub');
      return;
    }

    if (event.topic === 'network_event') {
      const flattened = flattenEventPayload(event.payload as JsonValue | undefined);
      let dispatched = false;
      for (const entry of flattened) {
        if (!looksLikeUpdatePayload(entry)) {
          continue;
        }
        dispatched = this.dispatchFeedCandidates(entry, 'feed_peer') || dispatched;
      }
      if (dispatched) {
        return;
      }
      const payloadObj = asObject(event.payload as JsonValue | undefined);
      if (payloadObj && looksLikeUpdatePayload(payloadObj)) {
        this.dispatchFeedCandidates(payloadObj, 'feed_peer');
      }
      return;
    }
  }

  private async warmupConnectivity(options?: { ensureBootstrap?: boolean }): Promise<void> {
    if (!libp2pService.isNativePlatform()) {
      return;
    }
    const runtimeReady = await libp2pService.ensureStarted().catch(() => false);
    if (!runtimeReady) {
      return;
    }
    const warmups: Promise<unknown>[] = [
      libp2pService.mdnsSetEnabled(true).catch(() => false),
      libp2pService.mdnsSetInterval(2).catch(() => false),
      libp2pService.mdnsProbe().catch(() => false),
    ];
    await Promise.allSettled(warmups);
    let connected = await libp2pService.getConnectedPeers().catch(() => [] as string[]);
    if (connected.length === 0 && options?.ensureBootstrap) {
      await libp2pService.joinViaRandomBootstrap(3).catch(() => ({} as Record<string, unknown>));
      connected = await libp2pService.getConnectedPeers().catch(() => [] as string[]);
    }
    if (connected.length === 0) {
      // Best-effort nudge for discovery-only networks.
      const advertiseNamespaces = new Set<string>([
        ...namespaceVariants(this.options.authority_namespace ?? 'unimaker/updates/v2'),
      ]);
      for (const fallbackNamespace of FALLBACK_RENDEZVOUS_NAMESPACES) {
        for (const candidate of namespaceVariants(fallbackNamespace)) {
          advertiseNamespaces.add(candidate);
        }
      }
      for (const namespace of advertiseNamespaces) {
        await libp2pService.rendezvousAdvertise(namespace, 300_000).catch(() => false);
      }
    }
  }

  private async pollFromAuthority(options?: { strict?: boolean }): Promise<UpdateTransportPollResult> {
    if (!libp2pService.isNativePlatform()) {
      return {
        connectivity_ok: true,
        connected_peers: 0,
        authority_sync_ok: true,
      };
    }
    await this.warmupConnectivity({ ensureBootstrap: Boolean(options?.strict) });
    const [snapshotHit, peerSyncHit] = await Promise.all([
      this.refreshFeedSnapshot(),
      this.refreshRendezvousPeers(),
    ]);
    const nativeService = libp2pService as unknown as {
      isStarted?: () => Promise<boolean>;
      getLocalPeerId?: () => Promise<string>;
      runtimeHealth?: () => Promise<{ nativeReady: boolean; started: boolean; peerId?: string; lastError?: string }>;
      bootstrapGetStatus?: () => Promise<Record<string, JsonValue>>;
      getBootstrapStatus?: () => Promise<Record<string, JsonValue>>;
    };
    const [connected, started, localPeerId, runtimeHealth, bootstrapStatus] = await Promise.all([
      libp2pService.getConnectedPeers().catch(() => [] as string[]),
      typeof nativeService.isStarted === 'function'
        ? nativeService.isStarted().catch(() => false)
        : Promise.resolve(false),
      typeof nativeService.getLocalPeerId === 'function'
        ? nativeService.getLocalPeerId().catch(() => '')
        : Promise.resolve(''),
      typeof nativeService.runtimeHealth === 'function'
        ? nativeService.runtimeHealth().catch(() => ({ nativeReady: false, started: false } as {
            nativeReady: boolean;
            started: boolean;
            peerId?: string;
            lastError?: string;
          }))
        : Promise.resolve({ nativeReady: false, started: false } as {
            nativeReady: boolean;
            started: boolean;
            peerId?: string;
            lastError?: string;
          }),
      typeof nativeService.bootstrapGetStatus === 'function'
        ? nativeService.bootstrapGetStatus().catch(() => ({} as Record<string, JsonValue>))
        : typeof nativeService.getBootstrapStatus === 'function'
          ? nativeService.getBootstrapStatus().catch(() => ({} as Record<string, JsonValue>))
          : Promise.resolve({} as Record<string, JsonValue>),
    ]);
    const authoritySyncOk = snapshotHit || peerSyncHit;
    const runtimeNativeReady = Boolean(runtimeHealth.nativeReady);
    const runtimeReady = runtimeNativeReady && (
      Boolean(runtimeHealth.started)
      || (runtimeHealth.peerId ?? '').trim().length > 0
      || Boolean(started)
      || localPeerId.trim().length > 0
    );
    const bootstrapHealthy = hasBootstrapConnectivitySignal(asObject(bootstrapStatus));
    const connectivityOk = connected.length > 0 || authoritySyncOk || (runtimeReady && bootstrapHealthy);
    const reason = connectivityOk
      ? undefined
      : (!runtimeNativeReady ? 'native_not_ready' : (runtimeReady ? 'no_remote_peers' : 'network_unreachable'));
    if (options?.strict && !connectivityOk) {
      console.warn('[updateTransport] strict connectivity check failed:', reason);
      return {
        connectivity_ok: false,
        connected_peers: connected.length,
        authority_sync_ok: authoritySyncOk,
        reason,
      };
    }
    return {
      connectivity_ok: connectivityOk,
      connected_peers: connected.length,
      authority_sync_ok: authoritySyncOk,
      reason,
    };
  }

  private async refreshFeedSnapshot(): Promise<boolean> {
    if (!libp2pService.isNativePlatform()) {
      return false;
    }
    try {
      let dispatched = false;
      const snapshot = await libp2pService.fetchFeedSnapshot();
      const root = asObject(snapshot);
      const items = Array.isArray(root?.items) ? root.items : [];
      for (const row of items) {
        const item = asObject(row);
        if (!item) {
          continue;
        }
        dispatched = this.dispatchFeedCandidates(item, 'feed_snapshot') || dispatched;
      }
      return dispatched;
    } catch {
      // Silent retry on next poll.
      return false;
    }
  }

  private async refreshRendezvousPeers(): Promise<boolean> {
    if (!libp2pService.isNativePlatform() || !this.options.authority_namespace) {
      return false;
    }
    try {
      const localPeerId = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
      const discovered = new Set<string>();
      const peerHintMap = new Map<string, string[]>();
      const namespaceCandidates = new Set<string>();
      for (const value of namespaceVariants(this.options.authority_namespace)) {
        namespaceCandidates.add(value);
      }
      for (const fallbackNamespace of FALLBACK_RENDEZVOUS_NAMESPACES) {
        for (const value of namespaceVariants(fallbackNamespace)) {
          namespaceCandidates.add(value);
        }
      }
      for (const namespace of namespaceCandidates) {
        const peers = await libp2pService.rendezvousDiscover(namespace, 64).catch(() => []);
        for (const peer of peers) {
          const row = asObject(peer);
          const peerId = normalizePeerId(row?.peerId ?? row?.peer_id);
          if (peerId) {
            discovered.add(peerId);
            const hints = asStringArray(row?.multiaddrs ?? row?.addresses);
            if (hints.length > 0) {
              peerHintMap.set(peerId, hints);
            }
          }
        }
      }

      // If rendezvous returns empty, pull from real-time discovered peers first (non-localStorage path).
      if (discovered.size === 0) {
        const realtime = await libp2pService.socialListDiscoveredPeers('', 64).catch(() => ({
          peers: [] as Array<Record<string, unknown>>,
          totalCount: 0,
        }));
        for (const peer of realtime.peers ?? []) {
          const row = asObject(peer);
          const peerId = normalizePeerId(row?.peerId ?? row?.peer_id);
          if (peerId) {
            discovered.add(peerId);
            const hints = asStringArray(row?.multiaddrs ?? row?.addresses);
            if (hints.length > 0) {
              peerHintMap.set(peerId, hints);
            }
          }
        }
      }

      // If still empty, only use currently connected peers to avoid cached/stale peers.
      if (discovered.size === 0) {
        const connected = await libp2pService.getConnectedPeers().catch(() => []);
        for (const peerId of connected) {
          const normalized = peerId.trim();
          if (normalized) {
            discovered.add(normalized);
          }
        }
      }

      for (const peerId of discovered) {
        if (!peerId || peerId === localPeerId || this.subscribedFeedPeers.has(peerId)) {
          continue;
        }
        const hints = peerHintMap.get(peerId) ?? [];
        if (hints.length > 0) {
          await libp2pService.registerPeerHints(peerId, hints, 'update-transport').catch(() => false);
          const dial = hints[0] ?? '';
          if (dial) {
            await libp2pService.socialConnectPeer(peerId, dial).catch(() => false);
          }
        } else {
          await libp2pService.socialConnectPeer(peerId).catch(() => false);
        }
        const ok = await libp2pService.feedSubscribePeer(peerId).catch(() => false);
        if (ok) {
          this.subscribedFeedPeers.add(peerId);
        }
      }
      return discovered.size > 0 || this.subscribedFeedPeers.size > 0;
    } catch {
      // Silent retry on next poll.
      return false;
    }
  }
}
