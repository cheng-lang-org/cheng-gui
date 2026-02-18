import { libp2pService } from './service';
import { libp2pEventPump } from './eventPump';
import type { BridgeEventEntry, JsonValue } from './definitions';

export interface RuntimePeer {
  peerId: string;
  multiaddrs: string[];
  source?: string;
}

export interface RuntimeFeedItem {
  id?: string;
  topic: string;
  payload: JsonValue;
  author?: string;
  ts?: number;
}

export interface RuntimeEvent {
  topic: string;
  payload: JsonValue;
  source: 'pubsub' | 'feed' | 'snapshot' | 'network' | 'web-ingress';
  peerId?: string;
  receivedAtMs: number;
}

export type RuntimeListener = (event: RuntimeEvent) => void;

export interface Libp2pRuntime {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  subscribe(topic: string, listener: RuntimeListener): () => void;
  publish(topic: string, payload: JsonValue): Promise<boolean>;
  fetchSnapshot(): Promise<RuntimeFeedItem[]>;
  discover(namespace: string, limit?: number): Promise<RuntimePeer[]>;
  isNative(): boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function decodeBase64Utf8(value: string): string {
  if (value.trim().length === 0) {
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

function decodePayload(value: unknown): JsonValue | string | null {
  const normalized = parsePayloadText(value);
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized) as JsonValue;
  } catch {
    return normalized;
  }
}

function extractBridgePayload(payload: unknown, fallback?: JsonValue | string): JsonValue | string | null {
  const decoded = decodePayload((payload as { payloadBase64?: unknown })?.payloadBase64);
  if (decoded !== null) {
    return decoded;
  }
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const row = payload as Record<string, unknown>;
    if (row.payload !== undefined) {
      const nested = decodePayload(row.payload);
      return nested ?? row.payload;
    }
  }
  return fallback ?? null;
}

function parseJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseJsonValue(item)) as JsonValue;
  }
  const record = asRecord(value);
  if (record) {
    const next: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(record)) {
      next[key] = parseJsonValue(item);
    }
    return next;
  }
  return '';
}

class NativeLibp2pRuntime implements Libp2pRuntime {
  private topicListeners = new Map<string, Set<RuntimeListener>>();
  private unsubscribePump: (() => void) | null = null;
  private started = false;

  isNative(): boolean {
    return libp2pService.isNativePlatform();
  }

  async start(): Promise<boolean> {
    if (!this.isNative()) {
      return false;
    }
    if (!this.started) {
      const inited = await libp2pService.init().catch(() => false);
      if (!inited) {
        return false;
      }
      const ok = await libp2pService.start().catch(() => false);
      if (!ok) {
        return false;
      }
      libp2pEventPump.start();
      this.started = true;
    }
    if (!this.unsubscribePump) {
      this.unsubscribePump = libp2pEventPump.subscribe((event) => {
        this.dispatchFromBridgeEvent(event);
      });
    }
    return true;
  }

  async stop(): Promise<void> {
    if (this.unsubscribePump) {
      this.unsubscribePump();
      this.unsubscribePump = null;
    }
    for (const [topic] of this.topicListeners) {
      await libp2pService.pubsubUnsubscribe(topic).catch(() => false);
    }
    this.topicListeners.clear();
  }

  subscribe(topic: string, listener: RuntimeListener): () => void {
    const normalizedTopic = topic.trim();
    if (normalizedTopic.length === 0) {
      return () => {};
    }
    let bucket = this.topicListeners.get(normalizedTopic);
    if (!bucket) {
      bucket = new Set<RuntimeListener>();
      this.topicListeners.set(normalizedTopic, bucket);
      void libp2pService.pubsubSubscribe(normalizedTopic);
    }
    bucket.add(listener);
    return () => {
      const current = this.topicListeners.get(normalizedTopic);
      current?.delete(listener);
      if (current && current.size === 0) {
        this.topicListeners.delete(normalizedTopic);
        void libp2pService.pubsubUnsubscribe(normalizedTopic);
      }
    };
  }

  async publish(topic: string, payload: JsonValue): Promise<boolean> {
    const normalizedTopic = topic.trim();
    if (normalizedTopic.length === 0) {
      return false;
    }
    const wire: Record<string, JsonValue> = {
      topic: normalizedTopic,
      payload,
      ts: Date.now(),
    };
    const [pubsub, feed] = await Promise.all([
      libp2pService.pubsubPublish(normalizedTopic, JSON.stringify(payload)).catch(() => false),
      libp2pService.feedPublishEntry(wire).catch(() => false),
    ]);
    return pubsub || feed;
  }

  async fetchSnapshot(): Promise<RuntimeFeedItem[]> {
    if (!this.isNative()) {
      return [];
    }
    const snapshot = await libp2pService.fetchFeedSnapshot().catch(() => ({} as Record<string, JsonValue>));
    const root = asRecord(snapshot);
    if (!root) {
      return [];
    }
    const rawItems = Array.isArray(root.items) ? root.items : [];
    const items: RuntimeFeedItem[] = [];
    for (const row of rawItems) {
      const entry = asRecord(row);
      if (!entry) {
        continue;
      }
      const payload = parseJsonValue(entry.payload);
      const payloadObj = asRecord(payload);
      const topic = asString(payloadObj?.topic);
      if (topic.length === 0) {
        continue;
      }
      items.push({
        id: asString(entry.id),
        topic,
        payload,
        author: asString(entry.author),
        ts: typeof entry.ts === 'number' ? entry.ts : undefined,
      });
    }
    return items;
  }

  async discover(namespace: string, limit = 64): Promise<RuntimePeer[]> {
    if (!this.isNative()) {
      return [];
    }
    const peers = await libp2pService.rendezvousDiscover(namespace, limit).catch(() => [] as Record<string, JsonValue>[]);
    return peers
      .map((item) => ({
        peerId: asString((item as Record<string, unknown>).peerId),
        multiaddrs: Array.isArray((item as Record<string, unknown>).multiaddrs)
          ? ((item as Record<string, unknown>).multiaddrs as unknown[]).map((value) => asString(value)).filter((value) => value.length > 0)
          : [],
        source: 'native-rendezvous',
      }))
      .filter((item) => item.peerId.length > 0);
  }

  private dispatch(topic: string, payload: JsonValue, source: RuntimeEvent['source'], peerId = ''): void {
    const listeners = this.topicListeners.get(topic);
    if (!listeners || listeners.size === 0) {
      return;
    }
    const event: RuntimeEvent = {
      topic,
      payload,
      source,
      peerId: peerId || undefined,
      receivedAtMs: Date.now(),
    };
    for (const listener of listeners) {
      listener(event);
    }
  }

  private dispatchFromBridgeEvent(event: BridgeEventEntry): void {
    const topic = asString(event.topic);
    if (topic === 'pubsub.message') {
      const payload = asRecord(event.payload);
      if (!payload) {
        return;
      }
      const messageTopic = asString(payload.topic);
      if (!messageTopic) {
        return;
      }
      const parsed = extractBridgePayload(payload, parseJsonValue(payload.payload));
      if (parsed === null) {
        return;
      }
      const normalizedPayload = parseJsonValue(parsed);
      this.dispatch(messageTopic, normalizedPayload, 'pubsub', asString(payload.peer_id));
      return;
    }

    if (topic === 'network_event') {
      const payload = asRecord(event.payload);
      if (!payload) {
        return;
      }
      if (asString(payload.type) === 'ContentFeedItem') {
        const itemPayload = extractBridgePayload(payload.payload, parseJsonValue(payload.payload));
        if (itemPayload === null) {
          return;
        }
        const itemRecord = asRecord(itemPayload);
        const itemTopic = asString(itemRecord?.topic);
        if (itemTopic) {
          this.dispatch(itemTopic, itemPayload, 'feed', asString(payload.peer_id));
        }
      }
      return;
    }

    if (topic.startsWith('/unimaker/updates/v2/')) {
      const messageTopic = topic;
      const updatePayload = extractBridgePayload(event.payload, event.payload as JsonValue | undefined);
      if (updatePayload !== null) {
        this.dispatch(messageTopic, parseJsonValue(updatePayload), 'network', asString(asRecord(event.payload)?.peer_id));
      }
      return;
    }

    if (this.topicListeners.has(topic)) {
      this.dispatch(topic, parseJsonValue(event.payload), 'network');
    }
  }
}

class UnsupportedRuntime implements Libp2pRuntime {
  private warned = false;

  isNative(): boolean {
    return false;
  }

  async start(): Promise<boolean> {
    if (!this.warned) {
      this.warned = true;
      console.warn('[libp2p-runtime] native cheng-libp2p required; web ingress is disabled');
    }
    return false;
  }

  async stop(): Promise<void> {}

  subscribe(_topic: string, _listener: RuntimeListener): () => void {
    return () => {};
  }

  async publish(_topic: string, _payload: JsonValue): Promise<boolean> {
    return false;
  }

  async fetchSnapshot(): Promise<RuntimeFeedItem[]> {
    return [];
  }

  async discover(_namespace: string, _limit = 64): Promise<RuntimePeer[]> {
    return [];
  }
}

let cachedRuntime: Libp2pRuntime | null = null;

export function getLibp2pRuntime(): Libp2pRuntime {
  if (cachedRuntime) {
    return cachedRuntime;
  }
  if (libp2pService.isNativePlatform()) {
    cachedRuntime = new NativeLibp2pRuntime();
    return cachedRuntime;
  }
  cachedRuntime = new UnsupportedRuntime();
  return cachedRuntime;
}
