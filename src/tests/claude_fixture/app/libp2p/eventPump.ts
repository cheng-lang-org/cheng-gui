import { libp2pService } from './service';
import type { BridgeEventEntry, JsonValue } from './definitions';

export type Libp2pEventDomain =
  | 'all'
  | 'social'
  | 'dm'
  | 'groups'
  | 'contacts'
  | 'moments'
  | 'notifications'
  | 'discovery'
  | 'pubsub'
  | 'network';

type EventListener = (event: BridgeEventEntry) => void;

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
}

function normalizeEvent(event: BridgeEventEntry): BridgeEventEntry {
  if (event.topic !== 'social_event') {
    return event;
  }
  const social = asRecord(event.payload);
  if (!social) {
    return event;
  }
  const normalized: BridgeEventEntry = { ...event };
  const scalarKeys: Array<keyof BridgeEventEntry> = [
    'kind',
    'entity',
    'op',
    'traceId',
    'conversationId',
    'groupId',
    'roomId',
    'postId',
    'seq',
    'timestampMs',
    'source',
  ];
  for (const key of scalarKeys) {
    const value = social[key];
    if (normalized[key] === undefined && value !== undefined) {
      normalized[key] = value;
    }
  }
  if (social.payload !== undefined) {
    normalized.payload = social.payload;
  }
  return normalized;
}

function classifyDomain(event: BridgeEventEntry): Libp2pEventDomain {
  const topic = typeof event.topic === 'string' ? event.topic : '';
  const kind = typeof event.kind === 'string' ? event.kind : '';
  const entity = typeof event.entity === 'string' ? event.entity : '';
  if (topic === 'social_event' || kind === 'social') {
    if (entity === 'dm') return 'dm';
    if (entity === 'groups') return 'groups';
    if (entity === 'contacts') return 'contacts';
    if (entity === 'moments') return 'moments';
    if (entity === 'notifications') return 'notifications';
    if (entity === 'discovery') return 'discovery';
    return 'social';
  }
  if (topic === 'direct_text' || topic === 'chat_control') return 'dm';
  if (topic.startsWith('pubsub')) return 'pubsub';
  if (topic.includes('network')) return 'network';
  return 'all';
}

export class Libp2pEventPump {
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<EventListener>();
  private domainListeners = new Map<Libp2pEventDomain, Set<EventListener>>();
  private running = false;
  private tickInFlight = false;

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeDomain(domain: Libp2pEventDomain, listener: EventListener): () => void {
    let bucket = this.domainListeners.get(domain);
    if (!bucket) {
      bucket = new Set<EventListener>();
      this.domainListeners.set(domain, bucket);
    }
    bucket.add(listener);
    return () => {
      bucket?.delete(listener);
      if (bucket && bucket.size === 0) {
        this.domainListeners.delete(domain);
      }
    };
  }

  start(intervalMs = 400): void {
    if (this.timer) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private dispatch(event: BridgeEventEntry): void {
    const domain = classifyDomain(event);
    for (const listener of this.listeners) {
      listener(event);
    }
    const domainBucket = this.domainListeners.get(domain);
    if (domainBucket) {
      for (const listener of domainBucket) {
        listener(event);
      }
    }
    if (domain !== 'social') {
      const socialBucket = this.domainListeners.get('social');
      if (socialBucket && (event.topic === 'social_event' || event.kind === 'social')) {
        for (const listener of socialBucket) {
          listener(event);
        }
      }
    }
  }

  private async tick(): Promise<void> {
    if (!this.running || (this.listeners.size === 0 && this.domainListeners.size === 0)) {
      return;
    }
    if (this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    try {
      let rounds = 0;
      let drainedAny = false;
      while (rounds < 8) {
        let events = await libp2pService.pollEvents(64);
        if ((!Array.isArray(events) || events.length === 0) && libp2pService.isNativePlatform()) {
          events = await libp2pService.socialPollEvents(64);
        }
        if (!Array.isArray(events) || events.length === 0) {
          break;
        }
        drainedAny = true;
        for (const raw of events) {
          this.dispatch(normalizeEvent(raw));
        }
        rounds += 1;
        if (events.length < 64) {
          break;
        }
      }
      if (!drainedAny) {
        return;
      }
    } catch (error) {
      console.warn('libp2p event pump poll failed', error);
    } finally {
      this.tickInFlight = false;
    }
  }
}

export const libp2pEventPump = new Libp2pEventPump();
