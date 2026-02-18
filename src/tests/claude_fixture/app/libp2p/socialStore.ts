import type {
  BridgeEventEntry,
  Contact,
  Conversation,
  DiscoveredPeer,
  Group,
  JsonValue,
  Message,
  MomentPost,
  NotificationItem,
} from './definitions';
import { libp2pEventPump } from './eventPump';
import { libp2pService } from './service';

const STORAGE_KEY = 'libp2p_social_store_v1';

export interface SocialStoreSnapshot {
  conversations: Conversation[];
  contacts: Contact[];
  groups: Group[];
  moments: MomentPost[];
  notifications: NotificationItem[];
  discoveredPeers: DiscoveredPeer[];
  updatedAt: number;
}

type SnapshotListener = (snapshot: SocialStoreSnapshot) => void;

function nowMs(): number {
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
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

function parsePeerArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) {
      output.push(item.trim());
    }
  }
  return output;
}

function emptySnapshot(): SocialStoreSnapshot {
  return {
    conversations: [],
    contacts: [],
    groups: [],
    moments: [],
    notifications: [],
    discoveredPeers: [],
    updatedAt: nowMs(),
  };
}

function cloneSnapshot(snapshot: SocialStoreSnapshot): SocialStoreSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SocialStoreSnapshot;
}

function safeLoadSnapshot(): SocialStoreSnapshot {
  if (typeof localStorage === 'undefined') {
    return emptySnapshot();
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return emptySnapshot();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return emptySnapshot();
    }
    const snapshot = emptySnapshot();
    snapshot.conversations = Array.isArray(parsed.conversations) ? (parsed.conversations as Conversation[]) : [];
    snapshot.contacts = Array.isArray(parsed.contacts) ? (parsed.contacts as Contact[]) : [];
    snapshot.groups = Array.isArray(parsed.groups) ? (parsed.groups as Group[]) : [];
    snapshot.moments = Array.isArray(parsed.moments) ? (parsed.moments as MomentPost[]) : [];
    snapshot.notifications = Array.isArray(parsed.notifications) ? (parsed.notifications as NotificationItem[]) : [];
    // Keep node presence real-time only; do not hydrate discovered peers from local cache.
    snapshot.discoveredPeers = [];
    snapshot.updatedAt = asNumber(parsed.updatedAt, nowMs());
    return snapshot;
  } catch {
    return emptySnapshot();
  }
}

function safePersistSnapshot(snapshot: SocialStoreSnapshot): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...snapshot,
    discoveredPeers: [],
  }));
}

export class SocialStore {
  private snapshot: SocialStoreSnapshot = safeLoadSnapshot();
  private listeners = new Set<SnapshotListener>();
  private unsubscribePump: (() => void) | null = null;

  constructor() {
    this.bindEventPump();
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SocialStoreSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  clear(): void {
    this.snapshot = emptySnapshot();
    this.emit();
  }

  async refreshFromBridge(): Promise<void> {
    if (!libp2pService.isNativePlatform()) {
      return;
    }
    try {
      const [discovered, timeline, notifications] = await Promise.all([
        libp2pService.socialListDiscoveredPeers('', 256),
        libp2pService.socialMomentsTimeline('', 50),
        libp2pService.socialNotificationsList('', 100),
      ]);
      this.snapshot.discoveredPeers = discovered.peers;
      this.snapshot.moments = timeline.items;
      this.snapshot.notifications = notifications.items;
      this.snapshot.updatedAt = nowMs();
      this.emit();
    } catch (error) {
      console.warn('socialStore.refreshFromBridge failed', error);
    }
  }

  applyEvent(event: BridgeEventEntry): void {
    if (event.kind !== 'social') {
      return;
    }
    const entity = asString(event.entity);
    if (!entity) {
      return;
    }
    if (entity === 'dm') {
      this.applyDmEvent(event);
    } else if (entity === 'contacts') {
      this.applyContactEvent(event);
    } else if (entity === 'groups') {
      this.applyGroupEvent(event);
    } else if (entity === 'moments') {
      this.applyMomentEvent(event);
    } else if (entity === 'discovery') {
      this.applyDiscoveryEvent(event);
    } else if (entity === 'notifications') {
      this.applyNotificationEvent(event);
    }
  }

  private emit(): void {
    this.snapshot.updatedAt = nowMs();
    safePersistSnapshot(this.snapshot);
    const current = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(current);
    }
  }

  private bindEventPump(): void {
    if (this.unsubscribePump) {
      return;
    }
    this.unsubscribePump = libp2pEventPump.subscribeDomain('social', (event) => {
      this.applyEvent(event);
    });
  }

  private upsertConversation(conversationId: string, peerId: string): Conversation {
    let conversation = this.snapshot.conversations.find((item) => item.conversationId === conversationId);
    if (!conversation) {
      conversation = {
        conversationId,
        peerId,
        unreadCount: 0,
        lastMessage: '',
        lastTimestampMs: nowMs(),
        messages: [],
      };
      this.snapshot.conversations.unshift(conversation);
    }
    return conversation;
  }

  private upsertMessage(conversation: Conversation, next: Message): void {
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const idx = messages.findIndex((item) => item.id === next.id);
    if (idx >= 0) {
      messages[idx] = { ...messages[idx], ...next };
    } else {
      messages.push(next);
    }
    messages.sort((a, b) => asNumber(a.timestampMs) - asNumber(b.timestampMs));
    if (messages.length > 500) {
      messages.splice(0, messages.length - 500);
    }
    conversation.messages = messages;
    conversation.lastMessage = next.content ?? conversation.lastMessage ?? '';
    conversation.lastTimestampMs = asNumber(next.timestampMs, nowMs());
  }

  private applyDmEvent(event: BridgeEventEntry): void {
    const payload = isRecord(event.payload) ? event.payload : {};
    const conversationId = asString(event.conversationId, asString(payload.conversationId));
    const peerId = asString(payload.peerId, asString(payload.to, asString(payload.from)));
    if (!conversationId) {
      return;
    }
    const conversation = this.upsertConversation(conversationId, peerId);
    const messageId = asString(payload.messageId, asString(payload.mid, `msg-${nowMs()}`));
    const op = asString(event.op);
    const message: Message = {
      id: messageId,
      conversationId,
      peerId,
      content: asString(payload.content, asString(payload.text, asString(payload.body))),
      status: asString(payload.status, op === 'ack' ? 'acked' : 'sent'),
      ackStatus: op === 'ack' ? asString(payload.status, 'acked') : undefined,
      timestampMs: asNumber(payload.timestampMs, asNumber(event.timestampMs, nowMs())),
      payload: payload as unknown as Message['payload'],
      edited: op === 'edit' ? true : undefined,
      revoked: op === 'revoke' ? true : undefined,
    };
    this.upsertMessage(conversation, message);
    if (op === 'send' && asString(payload.sender) !== 'me') {
      conversation.unreadCount = asNumber(conversation.unreadCount, 0) + 1;
    }
    this.emit();
  }

  private applyContactEvent(event: BridgeEventEntry): void {
    const payload = isRecord(event.payload) ? event.payload : {};
    const peerId = asString(payload.peerId);
    if (!peerId) {
      return;
    }
    const idx = this.snapshot.contacts.findIndex((item) => item.peerId === peerId);
    const next: Contact = {
      peerId,
      status: asString(payload.status, asString(event.op)),
      helloText: asString(payload.helloText),
      reason: asString(payload.reason),
      updatedAt: asNumber(payload.updatedAt, asNumber(event.timestampMs, nowMs())),
    };
    if (idx >= 0) {
      this.snapshot.contacts[idx] = { ...this.snapshot.contacts[idx], ...next };
    } else {
      this.snapshot.contacts.unshift(next);
    }
    this.emit();
  }

  private applyGroupEvent(event: BridgeEventEntry): void {
    const payload = isRecord(event.payload) ? event.payload : {};
    const groupId = asString(event.groupId, asString(payload.groupId));
    if (!groupId) {
      return;
    }
    const idx = this.snapshot.groups.findIndex((item) => item.groupId === groupId);
    const next: Group = {
      groupId,
      name: asString(payload.name),
      ownerPeerId: asString(payload.ownerPeerId),
      members: parsePeerArray(payload.members),
      updatedAt: asNumber(payload.updatedAt, asNumber(event.timestampMs, nowMs())),
      createdAt: asNumber(payload.createdAt, nowMs()),
    };
    if (idx >= 0) {
      this.snapshot.groups[idx] = { ...this.snapshot.groups[idx], ...next };
    } else {
      this.snapshot.groups.unshift(next);
    }
    this.emit();
  }

  private applyMomentEvent(event: BridgeEventEntry): void {
    const payload = isRecord(event.payload) ? event.payload : {};
    const postId = asString(event.postId, asString(payload.postId, asString(payload.id)));
    if (!postId) {
      return;
    }
    const idx = this.snapshot.moments.findIndex((item) => item.postId === postId || item.id === postId);
    const next: MomentPost = {
      postId,
      id: postId,
      authorPeerId: asString(payload.authorPeerId, asString(payload.peerId)),
      content: asString(payload.content, asString(payload.body)),
      likes: parsePeerArray(payload.likes),
      comments: Array.isArray(payload.comments) ? (payload.comments as Record<string, JsonValue>[]) : undefined,
      timestampMs: asNumber(payload.timestampMs, asNumber(event.timestampMs, nowMs())),
      deleted: asString(event.op) === 'delete' ? true : undefined,
    };
    if (idx >= 0) {
      this.snapshot.moments[idx] = { ...this.snapshot.moments[idx], ...next };
    } else {
      this.snapshot.moments.unshift(next);
    }
    this.emit();
  }

  private applyNotificationEvent(event: BridgeEventEntry): void {
    const payload = isRecord(event.payload) ? event.payload : {};
    const item: NotificationItem = {
      id: asString(payload.id, `${event.traceId ?? 'evt'}-${nowMs()}`),
      type: asString(payload.type, asString(event.op)),
      title: asString(payload.title),
      body: asString(payload.body),
      timestampMs: asNumber(payload.timestampMs, asNumber(event.timestampMs, nowMs())),
      payload: payload as unknown as NotificationItem['payload'],
    };
    this.snapshot.notifications.unshift(item);
    this.snapshot.notifications = this.snapshot.notifications.slice(0, 200);
    this.emit();
  }

  private applyDiscoveryEvent(event: BridgeEventEntry): void {
    const payload = isRecord(event.payload) ? event.payload : {};
    const peerId = asString(payload.peerId);
    if (!peerId) {
      return;
    }
    const idx = this.snapshot.discoveredPeers.findIndex((item) => item.peerId === peerId);
    const next: DiscoveredPeer = {
      peerId,
      multiaddrs: parsePeerArray(payload.multiaddrs),
      sources: parsePeerArray(payload.sources),
      lastSeenAt: asNumber(payload.lastSeenAt, asNumber(event.timestampMs, nowMs())),
    };
    if (idx >= 0) {
      this.snapshot.discoveredPeers[idx] = { ...this.snapshot.discoveredPeers[idx], ...next };
    } else {
      this.snapshot.discoveredPeers.unshift(next);
    }
    this.emit();
  }
}

export const socialStore = new SocialStore();
