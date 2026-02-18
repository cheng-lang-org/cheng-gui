export type SocialMessageType = 'text' | 'redPacket' | 'location' | 'voice' | 'videoCall' | 'system' | 'appInvite';

export interface SocialMessage {
  id: string;
  sender: 'me' | 'other' | 'system';
  content: string;
  type: SocialMessageType;
  timestamp: number;
  extra?: {
    redPacketAmount?: number;
    redPacketMessage?: string;
    locationName?: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    accuracyMeters?: number;
    speedMps?: number;
    headingDeg?: number;
    capturedAt?: number;
    voiceDuration?: number;
    voiceCodec?: string;
    voiceSampleRate?: number;
    voicePayloadBase64?: string;
    callType?: 'audio' | 'video';
    callAction?: 'invite' | 'accept' | 'reject' | 'end';
    callSessionId?: string;
    // App Invite Extras
    appId?: string;
    appName?: string;
    appIcon?: string;
    appRoomId?: string;
  };
}

export interface SocialConversation {
  id: string;
  name: string;
  avatar: string;
  isGroup: boolean;
  lastMessage: string;
  lastTimestamp: number;
  unread: number;
  messages: SocialMessage[];
}

interface EnsureConversationInput {
  id: string;
  name: string;
  avatar?: string;
  isGroup?: boolean;
}

const SOCIAL_STORAGE_KEY = 'social_conversations_v1';
const MOCK_PURGE_KEY = 'social_mock_purged_v2';
const MOCK_PEER_PATTERNS = ['AlphaNode', 'BravoNode', 'CharlieNode'];
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_CONVERSATION = 500;
const MAX_MESSAGE_CONTENT_CHARS = 4096;
const MAX_VOICE_PAYLOAD_BASE64_CHARS = 64 * 1024;

/**
 * One-time cleanup: detect and remove old mock conversation data
 * that was persisted by the removed `restoreMockConversations()`.
 */
export function purgeMockConversations(): void {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MOCK_PURGE_KEY)) return;

  try {
    const raw = localStorage.getItem(SOCIAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SocialConversation[];
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (item) => !MOCK_PEER_PATTERNS.some((pattern) => item.id.includes(pattern)),
        );
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(cleaned));
        }
      }
    }
    // Also clear stale node storage that may contain mock-derived nodes
    localStorage.removeItem('node_directory_v2');
  } catch {
    // ignore
  }
  localStorage.setItem(MOCK_PURGE_KEY, '1');
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parsePreview(message: SocialMessage): string {
  if (message.type === 'redPacket') return '[红包]';
  if (message.type === 'location') return `[位置] ${message.extra?.locationName ?? ''}`.trim();
  if (message.type === 'voice') return `[语音] ${message.extra?.voiceDuration ?? 0}s`;
  if (message.type === 'videoCall') {
    return message.extra?.callType === 'audio' ? '[语音通话]' : '[视频通话]';
  }
  if (message.type === 'appInvite') return `[应用邀请] ${message.extra?.appName ?? '未知应用'}`;
  if (message.type === 'system') return message.content;
  return message.content;

}

function sanitizeMessageForStorage(message: SocialMessage): SocialMessage {
  const content = message.content.length <= MAX_MESSAGE_CONTENT_CHARS
    ? message.content
    : `${message.content.slice(0, MAX_MESSAGE_CONTENT_CHARS)}...`;
  if (!message.extra) {
    return { ...message, content };
  }
  const nextExtra = { ...message.extra };
  if (
    typeof nextExtra.voicePayloadBase64 === 'string' &&
    nextExtra.voicePayloadBase64.length > MAX_VOICE_PAYLOAD_BASE64_CHARS
  ) {
    delete nextExtra.voicePayloadBase64;
  }
  if (typeof nextExtra.redPacketMessage === 'string' && nextExtra.redPacketMessage.length > MAX_MESSAGE_CONTENT_CHARS) {
    nextExtra.redPacketMessage = `${nextExtra.redPacketMessage.slice(0, MAX_MESSAGE_CONTENT_CHARS)}...`;
  }
  if (typeof nextExtra.locationName === 'string' && nextExtra.locationName.length > MAX_MESSAGE_CONTENT_CHARS) {
    nextExtra.locationName = `${nextExtra.locationName.slice(0, MAX_MESSAGE_CONTENT_CHARS)}...`;
  }
  return {
    ...message,
    content,
    extra: Object.keys(nextExtra).length > 0 ? nextExtra : undefined,
  };
}

export function createMessage(partial: Omit<SocialMessage, 'id' | 'timestamp'>): SocialMessage {
  return {
    id: nowId('msg'),
    timestamp: Date.now(),
    ...partial,
  };
}

export function loadConversations(): SocialConversation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SOCIAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SocialConversation[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_CONVERSATIONS)
      .map((item) => {
        const rawMessages = Array.isArray(item.messages) ? item.messages : [];
        const messages = rawMessages
          .slice(-MAX_MESSAGES_PER_CONVERSATION)
          .map((row) => sanitizeMessageForStorage(row));
        return {
          ...item,
          messages,
          unread: Number.isFinite(item.unread) ? item.unread : 0,
          lastTimestamp: Number.isFinite(item.lastTimestamp) ? item.lastTimestamp : 0,
          lastMessage: item.lastMessage ?? '',
          avatar: item.avatar ?? '',
          isGroup: Boolean(item.isGroup),
          name: item.name ?? item.id,
        };
      });
  } catch {
    return [];
  }
}

export function saveConversations(conversations: SocialConversation[]): void {
  if (typeof localStorage === 'undefined') return;
  const sanitized = conversations
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => ({
      ...conversation,
      messages: Array.isArray(conversation.messages)
        ? conversation.messages
          .slice(-MAX_MESSAGES_PER_CONVERSATION)
          .map((message) => sanitizeMessageForStorage(message))
        : [],
    }));
  localStorage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(sanitized));
}

export function getConversation(chatId: string): SocialConversation | null {
  const all = loadConversations();
  return all.find((item) => item.id === chatId) ?? null;
}

export function ensureConversation(input: EnsureConversationInput): SocialConversation {
  const all = loadConversations();
  const idx = all.findIndex((item) => item.id === input.id);

  if (idx >= 0) {
    const existing = all[idx];
    const updated: SocialConversation = {
      ...existing,
      name: input.name || existing.name,
      avatar: input.avatar ?? existing.avatar,
      isGroup: input.isGroup ?? existing.isGroup,
    };
    all[idx] = updated;
    saveConversations(all);
    return updated;
  }

  const created: SocialConversation = {
    id: input.id,
    name: input.name,
    avatar: input.avatar ?? '',
    isGroup: Boolean(input.isGroup),
    lastMessage: '',
    lastTimestamp: 0,
    unread: 0,
    messages: [],
  };

  all.unshift(created);
  saveConversations(all);
  return created;
}

export function upsertConversationMeta(input: EnsureConversationInput): void {
  ensureConversation(input);
}

export function appendMessageToConversation(
  chatId: string,
  message: SocialMessage,
  meta?: Omit<EnsureConversationInput, 'id'>,
): SocialConversation {
  const all = loadConversations();
  let idx = all.findIndex((item) => item.id === chatId);

  if (idx < 0) {
    const created: SocialConversation = {
      id: chatId,
      name: meta?.name ?? chatId,
      avatar: meta?.avatar ?? '',
      isGroup: Boolean(meta?.isGroup),
      lastMessage: '',
      lastTimestamp: 0,
      unread: 0,
      messages: [],
    };
    all.unshift(created);
    idx = 0;
  }

  const current = all[idx];
  const normalizedMessage = sanitizeMessageForStorage(message);
  const nextMessages = [...current.messages, normalizedMessage].slice(-MAX_MESSAGES_PER_CONVERSATION);
  const unreadIncrement = normalizedMessage.sender === 'other' ? 1 : 0;

  const updated: SocialConversation = {
    ...current,
    name: meta?.name ?? current.name,
    avatar: meta?.avatar ?? current.avatar,
    isGroup: meta?.isGroup ?? current.isGroup,
    messages: nextMessages,
    lastMessage: parsePreview(normalizedMessage),
    lastTimestamp: normalizedMessage.timestamp,
    unread: current.unread + unreadIncrement,
  };

  all[idx] = updated;
  all.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  if (all.length > MAX_CONVERSATIONS) {
    all.splice(MAX_CONVERSATIONS);
  }
  saveConversations(all);

  return updated;
}

export function markConversationRead(chatId: string): void {
  const all = loadConversations();
  const idx = all.findIndex((item) => item.id === chatId);
  if (idx < 0) return;
  all[idx] = {
    ...all[idx],
    unread: 0,
  };
  saveConversations(all);
}

export function clearAllConversations(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(SOCIAL_STORAGE_KEY);
}

export const ASI_BOT_ID = 'ASI_BOT';

export function ensureASIConversation(name: string, greeting: string): SocialConversation {
  const all = loadConversations();
  const existing = all.find((c) => c.id === ASI_BOT_ID);

  if (existing) {
    // Ensure name is up to date (in case language changed, though name stored in DB might be static)
    // For now we just return existing. If we want to support switching lang for bot name, we might update it here.
    if (existing.name !== name) {
      existing.name = name;
      saveConversations(all);
    }
    return existing;
  }

  // Create new
  const created: SocialConversation = {
    id: ASI_BOT_ID,
    name: name,
    avatar: '🤖', // Use a robot emoji or specific icon for now
    isGroup: false,
    lastMessage: greeting,
    lastTimestamp: Date.now(),
    unread: 1, // Make it look new
    messages: [
      createMessage({
        sender: 'other',
        content: greeting,
        type: 'text',
      })
    ],
  };

  all.unshift(created);
  saveConversations(all);
  return created;
}
