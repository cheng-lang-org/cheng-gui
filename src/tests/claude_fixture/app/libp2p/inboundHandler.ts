/**
 * Inbound message handler — routes incoming DM and chat-control events
 * from the nim-libp2p event pump into the local conversation storage.
 */
import { libp2pEventPump } from './eventPump';
import {
  appendMessageToConversation,
  createMessage,
  getConversation,
  type SocialMessage,
  type SocialMessageType,
} from '../data/socialData';
import type { BridgeEventEntry } from './definitions';
import { libp2pService } from './service';
import { socialStore } from './socialStore';

type InboundListener = () => void;
const listeners = new Set<InboundListener>();
const MAX_VOICE_PAYLOAD_BASE64_CHARS = 64 * 1024;

export function onConversationUpdate(cb: InboundListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners() {
  for (const cb of listeners) {
    cb();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
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

function normalizeConversationId(rawConversationId: string, peerId: string): string {
  const trimmed = rawConversationId.trim();
  if (trimmed.length === 0) {
    return peerId;
  }
  if (trimmed.startsWith('dm:')) {
    const directPeerId = trimmed.slice(3).trim();
    if (directPeerId.length > 0) {
      return directPeerId;
    }
  }
  return trimmed;
}

function normalizeMessageType(raw: string): SocialMessageType {
  if (raw === 'redPacket') return 'redPacket';
  if (raw === 'location') return 'location';
  if (raw === 'voice') return 'voice';
  if (raw === 'videoCall') return 'videoCall';
  if (raw === 'system') return 'system';
  return 'text';
}

function conversationHasMessage(conversationId: string, messageId: string): boolean {
  if (!conversationId || !messageId) {
    return false;
  }
  const existing = getConversation(conversationId);
  if (!existing || !Array.isArray(existing.messages)) {
    return false;
  }
  return existing.messages.some((item) => item.id === messageId);
}

function readMessageExtra(payload: Record<string, unknown>, messageType: SocialMessageType): SocialMessage['extra'] | undefined {
  const extraPayload = asRecord(payload.extra);
  const extra: SocialMessage['extra'] = {};

  const redPacketAmount = asNumber(extraPayload.redPacketAmount ?? payload.redPacketAmount, NaN);
  if (Number.isFinite(redPacketAmount) && redPacketAmount > 0) {
    extra.redPacketAmount = Number(redPacketAmount.toFixed(2));
  }
  const redPacketMessage = asString(extraPayload.redPacketMessage ?? payload.redPacketMessage);
  if (redPacketMessage.length > 0) {
    extra.redPacketMessage = redPacketMessage;
  }

  const locationName = asString(extraPayload.locationName ?? payload.locationName);
  if (locationName.length > 0) {
    extra.locationName = locationName;
  }
  const latitude = asNumber(extraPayload.latitude ?? payload.latitude, NaN);
  if (Number.isFinite(latitude)) {
    extra.latitude = latitude;
  }
  const longitude = asNumber(extraPayload.longitude ?? payload.longitude, NaN);
  if (Number.isFinite(longitude)) {
    extra.longitude = longitude;
  }
  const altitude = asNumber(extraPayload.altitude ?? payload.altitude, NaN);
  if (Number.isFinite(altitude)) {
    extra.altitude = altitude;
  }
  const accuracyMeters = asNumber(extraPayload.accuracyMeters ?? payload.accuracyMeters, NaN);
  if (Number.isFinite(accuracyMeters)) {
    extra.accuracyMeters = accuracyMeters;
  }
  const speedMps = asNumber(extraPayload.speedMps ?? payload.speedMps, NaN);
  if (Number.isFinite(speedMps)) {
    extra.speedMps = speedMps;
  }
  const headingDeg = asNumber(extraPayload.headingDeg ?? payload.headingDeg, NaN);
  if (Number.isFinite(headingDeg)) {
    extra.headingDeg = headingDeg;
  }
  const capturedAt = asNumber(extraPayload.capturedAt ?? payload.capturedAt, 0);
  if (capturedAt > 0) {
    extra.capturedAt = capturedAt;
  }

  const voiceDuration = asNumber(extraPayload.voiceDuration ?? payload.voiceDuration, NaN);
  if (Number.isFinite(voiceDuration) && voiceDuration >= 0) {
    extra.voiceDuration = Math.round(voiceDuration);
  }
  const voiceCodec = asString(extraPayload.voiceCodec ?? payload.voiceCodec);
  if (voiceCodec.length > 0) {
    extra.voiceCodec = voiceCodec;
  }
  const voiceSampleRate = asNumber(extraPayload.voiceSampleRate ?? payload.voiceSampleRate, NaN);
  if (Number.isFinite(voiceSampleRate) && voiceSampleRate > 0) {
    extra.voiceSampleRate = Math.round(voiceSampleRate);
  }
  const voicePayloadBase64 = asString(extraPayload.voicePayloadBase64 ?? payload.voicePayloadBase64);
  if (voicePayloadBase64.length > 0 && voicePayloadBase64.length <= MAX_VOICE_PAYLOAD_BASE64_CHARS) {
    extra.voicePayloadBase64 = voicePayloadBase64;
  }

  const callTypeRaw = asString(extraPayload.callType ?? payload.callType);
  if (callTypeRaw === 'audio' || callTypeRaw === 'video') {
    extra.callType = callTypeRaw;
  } else if (messageType === 'videoCall') {
    extra.callType = 'video';
  }
  const callActionRaw = asString(extraPayload.callAction ?? payload.callAction);
  if (callActionRaw === 'invite' || callActionRaw === 'accept' || callActionRaw === 'reject' || callActionRaw === 'end') {
    extra.callAction = callActionRaw;
  }
  const callSessionId = asString(extraPayload.callSessionId ?? payload.callSessionId);
  if (callSessionId.length > 0) {
    extra.callSessionId = callSessionId;
  }

  if (Object.keys(extra).length === 0) {
    return undefined;
  }
  return extra;
}

function appendDmMessage(options: {
  peerId: string;
  conversationId: string;
  messageId: string;
  sender: 'me' | 'other';
  messageType: SocialMessageType;
  content: string;
  timestamp: number;
  extra?: SocialMessage['extra'];
}) {
  const {
    peerId,
    conversationId,
    messageId,
    sender,
    messageType,
    content,
    timestamp,
    extra,
  } = options;
  if (!conversationId || !messageId) {
    return;
  }
  if (conversationHasMessage(conversationId, messageId)) {
    return;
  }
  appendMessageToConversation(
    conversationId,
    {
      ...createMessage({ sender, type: messageType, content }),
      id: messageId,
      timestamp,
      extra,
    },
    { name: `节点 ${peerId.slice(0, 6)}` }
  );
  notifyListeners();
}

function appendSystemMessage(peerId: string, conversationId: string, text: string): void {
  if (!conversationId || !text) {
    return;
  }
  appendMessageToConversation(
    conversationId,
    createMessage({
      sender: 'system',
      type: 'system',
      content: text,
    }),
    { name: `节点 ${peerId.slice(0, 6)}` }
  );
  notifyListeners();
}

function tryAckInbound(peerId: string, conversationId: string, messageId: string): void {
  if (!peerId || !conversationId || !messageId) {
    return;
  }
  void libp2pService.socialDmAck(peerId, conversationId, messageId, 'received').catch(() => {});
}

function resolveSendPayload(rawPayload: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(rawPayload.payload);
  if (Object.keys(nested).length === 0) {
    return rawPayload;
  }
  return {
    ...rawPayload,
    ...nested,
    extra: Object.keys(asRecord(rawPayload.extra)).length > 0 ? rawPayload.extra : nested.extra,
  };
}

function handleDmSendLikeEvent(
  peerIdRaw: string,
  conversationIdRaw: string,
  opRaw: string,
  payloadRaw: Record<string, unknown>,
  fallbackMid = '',
  fallbackTimestamp = Date.now()
): void {
  const peerId = peerIdRaw.trim();
  if (!peerId) {
    return;
  }
  const conversationId = normalizeConversationId(conversationIdRaw, peerId);
  const payload = resolveSendPayload(payloadRaw);
  const op = opRaw.toLowerCase();
  const messageId = asString(payload.messageId ?? payload.mid, fallbackMid || `dm_${Date.now()}`);

  if (op === 'edit' || op === 'revoke' || op === 'ack') {
    const text = op === 'edit'
      ? '对方编辑了一条消息'
      : op === 'revoke'
        ? '对方撤回了一条消息'
        : '消息已回执';
    appendSystemMessage(peerId, conversationId, text);
    return;
  }

  const senderValue = asString(payload.sender ?? payload.from).toLowerCase();
  const sender: 'me' | 'other' = senderValue === 'me' ? 'me' : 'other';
  const messageType = normalizeMessageType(asString(payload.type ?? payload.messageType));
  const content = asString(
    payload.content ?? payload.text ?? payload.body,
    messageType === 'videoCall' ? '发起了视频通话邀请' : ''
  );
  if (messageType === 'text' && content.length === 0) {
    return;
  }
  const timestamp = asNumber(payload.timestampMs ?? payload.timestamp_ms, fallbackTimestamp);
  const extra = readMessageExtra(payload, messageType);

  appendDmMessage({
    peerId,
    conversationId,
    messageId,
    sender,
    messageType,
    content,
    timestamp,
    extra,
  });

  if (sender === 'other') {
    tryAckInbound(peerId, conversationId, messageId);
  }
}

function handleNetworkEvent(networkEvent: Record<string, unknown>): void {
  const eventType = asString(networkEvent.type).toLowerCase();
  if (eventType === 'messagereceived') {
    const envelopeRaw = asRecord(networkEvent.payload);
    const bodyRaw = asString(envelopeRaw.body, asString(networkEvent.body, asString(networkEvent.payload)));
    const bodyParsed = asRecord(bodyRaw);
    const envelope = Object.keys(bodyParsed).length > 0
      ? {
        ...envelopeRaw,
        ...bodyParsed,
        body: asString(bodyParsed.body, bodyRaw),
      }
      : envelopeRaw;

    const peerId = asString(envelope.from ?? envelope.peerId ?? networkEvent.peer_id);
    const conversationId = asString(
      envelope.conversationId ?? envelope.conversation_id ?? networkEvent.conversation_id,
      peerId
    );
    const op = asString(envelope.op, 'text');
    const mid = asString(envelope.messageId ?? envelope.mid, asString(networkEvent.message_id));
    const ts = asNumber(envelope.timestampMs ?? envelope.timestamp_ms, asNumber(networkEvent.timestamp_ms, Date.now()));

    handleDmSendLikeEvent(peerId, conversationId, op, envelope, mid, ts);
    return;
  }

  if (eventType === 'directmessageack') {
    const peerId = asString(networkEvent.peer_id);
    const conversationId = normalizeConversationId(asString(networkEvent.conversationId, peerId), peerId);
    const success = networkEvent.success === true;
    appendSystemMessage(
      peerId,
      conversationId,
      success ? '消息已被对端确认' : `消息发送失败${asString(networkEvent.error) ? `: ${asString(networkEvent.error)}` : ''}`
    );
  }
}

function handleEvent(event: BridgeEventEntry) {
  const topic = asString(event.topic);
  const kind = asString(event.kind);
  const entity = asString(event.entity);

  if (kind === 'social') {
    socialStore.applyEvent(event);
  }

  if (topic === 'network_event') {
    handleNetworkEvent(asRecord(event.payload));
    return;
  }

  if (topic === 'direct_text') {
    const payload = asRecord(event.payload);
    const from = asString(payload.from ?? payload.peerId);
    const text = asString(payload.text ?? payload.body);
    const mid = asString(payload.messageId ?? payload.mid, `in_${Date.now()}`);
    if (!from || !text) return;

    appendDmMessage({
      peerId: from,
      conversationId: normalizeConversationId(asString(payload.conversationId, from), from),
      messageId: mid,
      sender: 'other',
      messageType: 'text',
      content: text,
      timestamp: asNumber(payload.timestampMs ?? payload.timestamp_ms, Date.now()),
    });
    tryAckInbound(from, normalizeConversationId(asString(payload.conversationId, from), from), mid);
    return;
  }

  if (kind === 'social' && entity === 'dm') {
    const payload = asRecord(event.payload);
    const peerId = asString(payload.peerId ?? payload.from ?? payload.to);
    const conversationId = asString(event.conversationId ?? payload.conversationId, peerId);
    const op = asString(event.op, asString(payload.op, 'send'));
    handleDmSendLikeEvent(
      peerId,
      conversationId,
      op,
      payload,
      asString(payload.messageId ?? payload.mid),
      asNumber(payload.timestampMs ?? payload.timestamp_ms, asNumber(event.timestampMs, Date.now()))
    );
    return;
  }

  if (kind === 'social' && entity === 'synccast') {
    const payload = asRecord(event.payload);
    const roomId = asString(event.groupId ?? payload.groupId ?? payload.roomId);
    if (!roomId) {
      return;
    }
    const conversationId = `group:${roomId}`;
    const op = asString(event.op, asString(payload.op, 'state'));
    let text = '[看电影] 状态已更新';
    if (op === 'upsert_program') {
      const program = asRecord(payload.program);
      const title = asString(program.title, asString(program.name, asString(program.url, '电影')));
      text = `[看电影] 已更新片源：${title}`;
    } else if (op === 'join') {
      const peer = asString(payload.peerId, '成员');
      text = `[看电影] ${peer.slice(0, 10)} 加入房间`;
    } else if (op === 'leave') {
      const peer = asString(payload.peerId, '成员');
      text = `[看电影] ${peer.slice(0, 10)} 离开房间`;
    } else if (op === 'play' || op === 'resume') {
      text = '[看电影] 已同步播放';
    } else if (op === 'pause') {
      text = '[看电影] 已同步暂停';
    } else if (op === 'sync_anchor') {
      text = '[看电影] 已同步进度锚点';
    } else if (op === 'control') {
      const control = asRecord(payload.control);
      const controlOp = asString(control.op);
      text = controlOp ? `[看电影] 控制指令：${controlOp}` : text;
    }
    appendSystemMessage(roomId, conversationId, text);
    return;
  }

  if (topic === 'chat_control') {
    const payload = asRecord(event.payload);
    const from = asString(payload.from ?? payload.peerId);
    const op = asString(payload.op);
    const body = asString(payload.body);
    if (!from) return;
    if (op === 'typing') return;

    appendSystemMessage(
      from,
      normalizeConversationId(asString(payload.conversationId, from), from),
      op === 'edit' ? `[消息已编辑] ${body}` : `[${op}] ${body}`
    );
  }
}

let unsubscribe: (() => void) | null = null;

export function startInboundHandler() {
  if (unsubscribe) return;
  unsubscribe = libp2pEventPump.subscribe(handleEvent);
}

export function stopInboundHandler() {
  unsubscribe?.();
  unsubscribe = null;
}
