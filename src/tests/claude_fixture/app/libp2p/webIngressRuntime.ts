import type { JsonValue } from './definitions';
import type { Libp2pRuntime, RuntimeEvent, RuntimeFeedItem, RuntimeListener, RuntimePeer } from './runtime';

const DEFAULT_INGRESS_URL = 'http://127.0.0.1:8788';

function baseUrl(): string {
  const envUrl = (import.meta.env.VITE_LIBP2P_INGRESS_URL as string | undefined)?.trim();
  if (envUrl && envUrl.length > 0) {
    return envUrl.replace(/\/$/, '');
  }
  return DEFAULT_INGRESS_URL;
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`web_ingress_http_${response.status}: ${text || response.statusText}`);
  }
  return (await response.json()) as T;
}

class WebIngressRuntime implements Libp2pRuntime {
  private topicListeners = new Map<string, Set<RuntimeListener>>();
  private streams = new Map<string, EventSource>();

  isNative(): boolean {
    return false;
  }

  async start(): Promise<boolean> {
    try {
      await requestJson('/v1/libp2p/start', { method: 'POST', body: '{}' });
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    for (const stream of this.streams.values()) {
      stream.close();
    }
    this.streams.clear();
    this.topicListeners.clear();
    await requestJson('/v1/libp2p/stop', { method: 'POST', body: '{}' }).catch(() => undefined);
  }

  subscribe(topic: string, listener: RuntimeListener): () => void {
    const normalized = topic.trim();
    if (normalized.length === 0) {
      return () => {};
    }
    let bucket = this.topicListeners.get(normalized);
    if (!bucket) {
      bucket = new Set<RuntimeListener>();
      this.topicListeners.set(normalized, bucket);
      this.openStreamForTopic(normalized);
    }
    bucket.add(listener);

    return () => {
      const current = this.topicListeners.get(normalized);
      current?.delete(listener);
      if (current && current.size === 0) {
        this.topicListeners.delete(normalized);
        const stream = this.streams.get(normalized);
        if (stream) {
          stream.close();
          this.streams.delete(normalized);
        }
      }
    };
  }

  async publish(topic: string, payload: JsonValue): Promise<boolean> {
    const normalized = topic.trim();
    if (normalized.length === 0) {
      return false;
    }
    const result = await requestJson<{ ok?: boolean }>('/v1/libp2p/publish', {
      method: 'POST',
      body: JSON.stringify({ topic: normalized, payload }),
    }).catch(() => ({ ok: false }));
    return Boolean(result.ok);
  }

  async fetchSnapshot(): Promise<RuntimeFeedItem[]> {
    const result = await requestJson<{ items?: RuntimeFeedItem[] }>('/v1/libp2p/feed/snapshot').catch(() => ({ items: [] }));
    return Array.isArray(result.items) ? result.items : [];
  }

  async discover(namespace: string, limit = 64): Promise<RuntimePeer[]> {
    const encodedNs = encodeURIComponent(namespace);
    const result = await requestJson<{ peers?: RuntimePeer[] }>(
      `/v1/libp2p/rendezvous/discover?namespace=${encodedNs}&limit=${Math.max(1, limit)}`,
    ).catch(() => ({ peers: [] }));
    return Array.isArray(result.peers) ? result.peers : [];
  }

  private openStreamForTopic(topic: string): void {
    if (typeof EventSource === 'undefined') {
      return;
    }
    const stream = new EventSource(`${baseUrl()}/v1/libp2p/stream?topic=${encodeURIComponent(topic)}`);
    stream.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as unknown;
        const root = asRecord(parsed);
        if (!root) {
          return;
        }
        const streamTopic = asString(root.topic) || topic;
        const payload = (root.payload ?? null) as JsonValue;
        this.dispatch(streamTopic, payload, asString(root.peerId));
      } catch {
        // ignore malformed events
      }
    };
    stream.onerror = () => {
      stream.close();
      this.streams.delete(topic);
      if (this.topicListeners.has(topic)) {
        setTimeout(() => {
          if (!this.streams.has(topic) && this.topicListeners.has(topic)) {
            this.openStreamForTopic(topic);
          }
        }, 1500);
      }
    };
    this.streams.set(topic, stream);
  }

  private dispatch(topic: string, payload: JsonValue, peerId = ''): void {
    const listeners = this.topicListeners.get(topic);
    if (!listeners || listeners.size === 0) {
      return;
    }
    const event: RuntimeEvent = {
      topic,
      payload,
      source: 'web-ingress',
      peerId: peerId || undefined,
      receivedAtMs: Date.now(),
    };
    for (const listener of listeners) {
      listener(event);
    }
  }
}

export function createWebIngressRuntime(): Libp2pRuntime {
  return new WebIngressRuntime();
}
