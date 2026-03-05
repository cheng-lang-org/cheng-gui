import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrencyLabel } from '../utils/region';
import { useLocale } from '../i18n/LocaleContext';
import { sanitizeContent } from '../utils/sanitize';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import {
    ArrowLeft,
    Mic,
    Smile,
    Plus,
    Send,
    Gift,
    MapPin,
    Video,
    Film,
    X,
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import {
    appendMessageToConversation,
    createMessage,
    ensureConversation,
    getConversation,
    markConversationRead,
    type SocialMessage,
} from '../data/socialData';
import { libp2pService } from '../libp2p/service';
import { decideSevenGateAction } from '../libp2p/sevenGatesPolicy';
import { sevenGatesRuntime } from '../libp2p/sevenGatesRuntime';
import { getStoredPeerMultiaddrs, storePeerMultiaddrs } from '../libp2p/peerMultiaddrStore';
import { onConversationUpdate } from '../libp2p/inboundHandler';
import {
    getDistributedContents,
    resolveDistributedContentDetail,
    syncDistributedContentFromNetwork,
    type DistributedContent,
} from '../data/distributedContent';
import { mockApps } from '../data/appList';
import { getSocialApps } from '../data/appStore';
import { isEdgeSpeechSupported, transcribeOnce } from '../services/edge/speechRecognition';

interface ChatPageProps {
    chatId: string;
    chatName: string;
    chatAvatar: string;
    isGroup?: boolean;
    initialAction?: 'dm' | 'redPacket' | 'location' | 'voice' | 'videoCall';
    onBack: () => void;
    onOpenApp?: (appId: string, roomId?: string) => void;
}

interface CapturedLocation {
    coords: {
        latitude: number;
        longitude: number;
        altitude: number | null;
        accuracy: number;
        speed: number | null;
        heading: number | null;
    };
    timestamp: number;
}

function formatCoordinateLabel(latitude: number, longitude: number): string {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function isLikelyVideoMedia(media: string): boolean {
    const normalized = media.trim().toLowerCase();
    if (normalized.length === 0) {
        return false;
    }
    if (normalized.startsWith('data:video/')) {
        return true;
    }
    return (
        normalized.includes('.mp4') ||
        normalized.includes('.m3u8') ||
        normalized.includes('.webm') ||
        normalized.includes('/video/')
    );
}

function isMovieCandidate(item: DistributedContent): boolean {
    if (item.type !== 'video') {
        return false;
    }
    const media = (item.media ?? item.coverMedia ?? '').trim();
    return isLikelyVideoMedia(media);
}

function formatMovieSource(peerId: string, selfPeerId: string): string {
    if (!peerId) {
        return '未知来源';
    }
    if (selfPeerId && peerId === selfPeerId) {
        return '我发布的';
    }
    return `节点 ${peerId.slice(0, 12)}`;
}

function normalizeMultiaddrForPeer(addr: string, peerId: string): string {
    const trimmed = typeof addr === 'string' ? addr.trim() : '';
    if (!trimmed) {
        return '';
    }
    if (trimmed.includes('/p2p/')) {
        return trimmed;
    }
    if (!peerId) {
        return trimmed;
    }
    return `${trimmed.replace(/\/+$/, '')}/p2p/${peerId}`;
}

function isDialablePeerMultiaddr(addr: string): boolean {
    const normalized = addr.trim();
    if (!normalized) return false;
    if (!normalized.includes('/p2p/')) return false;
    if (normalized.includes('/ip4/0.0.0.0/')) return false;
    if (normalized.includes('/ip6/::/')) return false;
    return true;
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        output.push(value);
    }
    return output;
}

function prioritizePeerDialMultiaddrs(peerId: string, addresses: string[]): string[] {
    const normalized = uniqueStrings(
        addresses
            .map((item) => normalizeMultiaddrForPeer(item, peerId))
            .filter((item) => isDialablePeerMultiaddr(item))
    );
    const quicV1 = normalized.filter((item) => item.includes('/quic-v1'));
    const quicOther = normalized.filter((item) => item.includes('/quic') && !item.includes('/quic-v1'));
    const tcp = normalized.filter((item) => item.includes('/tcp/'));
    const rest = normalized.filter(
        (item) => !item.includes('/quic') && !item.includes('/tcp/')
    );
    return uniqueStrings([...quicV1, ...quicOther, ...tcp, ...rest]);
}

interface RealtimeRouteResult {
    secureReady: boolean;
    connected: boolean;
    connectedViaQuic: boolean;
    connectedAddr: string;
    candidates: string[];
}

export default function ChatPage({
    chatId,
    chatName,
    chatAvatar,
    isGroup = false,
    initialAction,
    onBack,
    onOpenApp,
}: ChatPageProps) {
    const { t } = useLocale();
    const [messages, setMessages] = useState<SocialMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [speechSupported, setSpeechSupported] = useState(false);
    const [speechBusy, setSpeechBusy] = useState(false);
    const [speechHint, setSpeechHint] = useState('');
    const speechHintTimerRef = useRef<number | null>(null);
    const [showMorePanel, setShowMorePanel] = useState(false);
    const [showRedPacketModal, setShowRedPacketModal] = useState(false);
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [showMovieModal, setShowMovieModal] = useState(false);
    const [deliveryState, setDeliveryState] = useState<Record<string, 'pending' | 'sent' | 'acked' | 'failed'>>({});
    const [locationFetching, setLocationFetching] = useState(false);
    const [locationHint, setLocationHint] = useState('');
    const [actionBlockHint, setActionBlockHint] = useState('');
    const [locationPreview, setLocationPreview] = useState('');
    const [bootActionDone, setBootActionDone] = useState(false);
    const [movieTitle, setMovieTitle] = useState('');
    const [movieStatusHint, setMovieStatusHint] = useState('');
    const [movieSubmitting, setMovieSubmitting] = useState(false);
    const [movieRoomState, setMovieRoomState] = useState<any>(null);
    const [socialApps, setSocialApps] = useState<string[]>([]);

    useEffect(() => {
        if (showMorePanel) {
            setSocialApps(getSocialApps());
        }
    }, [showMorePanel]);

    useEffect(() => {
        let cancelled = false;
        void isEdgeSpeechSupported()
            .then((supported) => {
                if (!cancelled) {
                    setSpeechSupported(supported);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSpeechSupported(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => () => {
        if (speechHintTimerRef.current) {
            window.clearTimeout(speechHintTimerRef.current);
            speechHintTimerRef.current = null;
        }
    }, []);
    const [movieCandidates, setMovieCandidates] = useState<DistributedContent[]>([]);
    const [movieCandidateId, setMovieCandidateId] = useState('');
    const [movieLoading, setMovieLoading] = useState(false);
    const [movieSourceType, setMovieSourceType] = useState<'network' | 'local'>('network');
    const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);



    const [localPeerId, setLocalPeerId] = useState('');

    const [redPacketAmount, setRedPacketAmount] = useState('');
    const [redPacketMessage, setRedPacketMessage] = useState(t.chat_defaultGreeting);
    const [locationName, setLocationName] = useState('');

    const refreshMessagesFromStore = useCallback(() => {
        const latest = getConversation(chatId);
        if (!latest) {
            return;
        }
        setMessages(latest.messages);
        markConversationRead(chatId);
    }, [chatId]);

    useEffect(() => {
        const conversation = ensureConversation({
            id: chatId,
            name: chatName,
            avatar: chatAvatar,
            isGroup,
        });

        setMessages(conversation.messages);
        markConversationRead(chatId);
        setBootActionDone(false);
    }, [chatAvatar, chatId, chatName, isGroup]);

    useEffect(() => {
        const unsubscribe = onConversationUpdate(() => {
            refreshMessagesFromStore();
        });
        return () => {
            unsubscribe();
        };
    }, [refreshMessagesFromStore]);

    useEffect(() => {
        let disposed = false;
        if (!libp2pService.isNativePlatform()) {
            return;
        }
        void libp2pService.getLocalPeerId()
            .then((peerId) => {
                if (!disposed) {
                    setLocalPeerId(peerId.trim());
                }
            })
            .catch(() => {
                if (!disposed) {
                    setLocalPeerId('');
                }
            });
        return () => {
            disposed = true;
        };
    }, [chatId]);

    const sortedMessages = useMemo(
        () => [...messages].sort((a, b) => a.timestamp - b.timestamp),
        [messages],
    );

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    const pushMessage = useCallback((message: SocialMessage) => {
        const updated = appendMessageToConversation(chatId, message, {
            name: chatName,
            avatar: chatAvatar,
            isGroup,
        });
        setMessages(updated.messages);
        markConversationRead(chatId);
    }, [chatAvatar, chatId, chatName, isGroup]);

    const resolvePeerId = (): string => {
        if (isGroup) {
            return '';
        }
        const trimmed = chatId.trim();
        if (trimmed.startsWith('dm:')) {
            return trimmed.slice(3).trim();
        }
        if (trimmed.startsWith('group:')) {
            return '';
        }
        if (trimmed.endsWith(':group')) {
            return trimmed.slice(0, -6).trim();
        }
        return trimmed;
    };

    const resolveGroupId = (): string => {
        if (chatId.startsWith('group:')) {
            return chatId.slice('group:'.length);
        }
        if (chatId.endsWith(':group')) {
            return chatId.slice(0, -6);
        }
        return chatId.trim();
    };

    const resolveSynccastRoomId = (): string => {
        if (!isGroup) {
            const remotePeerId = resolvePeerId();
            const local = localPeerId.trim();
            if (remotePeerId.length === 0) {
                return chatId.trim();
            }
            if (local.length === 0) {
                return `dm-${remotePeerId}`;
            }
            const pair = [local, remotePeerId].sort((a, b) => a.localeCompare(b));
            return `dm-${pair[0]}-${pair[1]}`;
        }
        const gid = resolveGroupId().trim();
        return gid.length > 0 ? gid : chatId.trim();
    };

    const resolveSynccastTargetPeerId = (): string => {
        if (isGroup) {
            return '';
        }
        return resolvePeerId();
    };

    const resolveDirectConversationId = (): string => {
        if (isGroup) {
            return chatId;
        }
        const peerId = resolvePeerId();
        if (chatId.startsWith('dm:') && peerId.length > 0) {
            return peerId;
        }
        return chatId.trim();
    };

    const canRunAction = useCallback((actionId: 'send_dm' | 'video_call' | 'synccast_control'): boolean => {
        const decision = decideSevenGateAction(sevenGatesRuntime.getSnapshot(), actionId);
        if (decision.allowed) {
            setActionBlockHint('');
            return true;
        }
        setActionBlockHint(decision.reason);
        return false;
    }, []);

    const ensureRealtimeRoute = useCallback(async (
        peerIdRaw: string,
        _source: 'dm' | 'video' | 'synccast'
    ): Promise<RealtimeRouteResult> => {
        const peerId = peerIdRaw.trim();
        if (!peerId || !libp2pService.isNativePlatform()) {
            return {
                secureReady: false,
                connected: false,
                connectedViaQuic: false,
                connectedAddr: '',
                candidates: [],
            };
        }

        const cachedAddrs = getStoredPeerMultiaddrs(peerId);
        const knownAddrs = await libp2pService.getPeerMultiaddrs(peerId).catch(() => [] as string[]);
        let candidates = prioritizePeerDialMultiaddrs(peerId, [...cachedAddrs, ...knownAddrs]);
        if (candidates.length > 0) {
            candidates = prioritizePeerDialMultiaddrs(peerId, storePeerMultiaddrs(peerId, candidates));
        }

        const preferredDial = candidates.find((item) => item.includes('/quic-v1')) ?? candidates[0] ?? '';
        let connectedAddr = '';
        let connected = await libp2pService.socialConnectPeer(peerId, preferredDial).catch(() => false);
        if (connected && preferredDial) {
            connectedAddr = preferredDial;
        }
        if (!connected) {
            connected = await libp2pService.socialConnectPeer(peerId).catch(() => false);
        }

        const secureReady = await libp2pService.waitSecureChannel(peerId, 5000).catch(() => false);
        const connectedViaQuic = connectedAddr.includes('/quic-v1')
            || (connectedAddr.length === 0 && candidates.some((item) => item.includes('/quic-v1')) && connected);
        return {
            secureReady,
            connected,
            connectedViaQuic,
            connectedAddr,
            candidates,
        };
    }, []);

    const sendDirectThroughLibp2p = useCallback(async (
        peerId: string,
        message: SocialMessage,
    ): Promise<'sent' | 'acked' | 'failed'> => {
        const conversationId = resolveDirectConversationId();
        const payload = {
            kind: 'social',
            entity: 'dm',
            op: 'send',
            type: message.type,
            messageType: message.type,
            messageId: message.id,
            mid: message.id,
            conversationId,
            content: message.content,
            text: message.content,
            body: message.content,
            timestampMs: message.timestamp,
            timestamp_ms: message.timestamp,
            sender: 'me',
            from: 'me',
            extra: message.extra ?? {},
        } as const;

        try {
            const route = await ensureRealtimeRoute(peerId, 'dm');
            const secureReady = route.secureReady
                || await libp2pService.waitSecureChannel(peerId, 5000).catch(() => false);
            const socialSent = secureReady
                ? await libp2pService.socialDmSend(peerId, conversationId, payload).catch(() => false)
                : false;
            const acked = secureReady
                ? await libp2pService.sendWithAck(peerId, payload, 9000).catch(() => false)
                : false;
            const directSent = secureReady
                ? await libp2pService.sendDirectText(peerId, JSON.stringify(payload), message.id).catch(() => false)
                : false;
            const ackSent = (acked || directSent || socialSent)
                ? await libp2pService.sendChatAck(peerId, message.id, true, '').catch(() => false)
                : false;

            const dmGatePassed = acked && directSent && ackSent;
            sevenGatesRuntime.setGateStatus('gate.dm_message_roundtrip', dmGatePassed ? 'passed' : (secureReady ? 'failed' : 'blocked'), {
                error: dmGatePassed
                    ? undefined
                    : (secureReady ? 'dm_roundtrip_incomplete' : 'secure_channel_not_ready'),
                evidence: [
                    {
                        check: 'chat.waitSecureChannel',
                        status: secureReady ? 'passed' : 'blocked',
                        detail: secureReady ? undefined : 'waitSecureChannel failed',
                    },
                    {
                        check: 'chat.sendWithAck',
                        status: secureReady ? (acked ? 'passed' : 'failed') : 'blocked',
                        detail: secureReady && !acked ? 'sendWithAck failed' : undefined,
                        data: { peerId },
                    },
                    {
                        check: 'chat.sendDirectText',
                        status: secureReady ? (directSent ? 'passed' : 'failed') : 'blocked',
                        detail: secureReady && !directSent ? 'sendDirectText failed' : undefined,
                        data: { peerId },
                    },
                    {
                        check: 'chat.sendChatAck',
                        status: (acked || directSent || socialSent)
                            ? (ackSent ? 'passed' : 'failed')
                            : 'blocked',
                        detail: (acked || directSent || socialSent) && !ackSent
                            ? 'sendChatAck failed'
                            : undefined,
                        data: { peerId },
                    },
                    {
                        check: 'chat.quicDirectPreferred',
                        status: route.connectedViaQuic ? 'passed' : (route.connected ? 'blocked' : 'failed'),
                        detail: route.connectedViaQuic
                            ? 'connected via /quic-v1 preferred path'
                            : (route.connected
                                ? 'connected without confirmed /quic-v1 path'
                                : 'unable to establish direct route before dm send'),
                        data: {
                            peerId,
                            connectedAddr: route.connectedAddr,
                            candidateCount: route.candidates.length,
                        },
                    },
                ],
                ttlMs: 12 * 60 * 60 * 1000,
            });

            if (dmGatePassed) {
                return 'acked';
            }
            if (socialSent || directSent || acked) {
                return 'sent';
            }
            return 'failed';
        } catch (error) {
            console.warn('send direct message over libp2p failed', error);
            sevenGatesRuntime.setGateStatus('gate.dm_message_roundtrip', 'failed', {
                error: error instanceof Error ? error.message : 'dm_send_exception',
                evidence: [{
                    check: 'chat.send_dm_exception',
                    status: 'failed',
                    detail: error instanceof Error ? error.message : `${error}`,
                }],
                ttlMs: 12 * 60 * 60 * 1000,
            });
            return 'failed';
        }
    }, [chatId, ensureRealtimeRoute, isGroup]);

    const sendGroupThroughLibp2p = useCallback(async (
        message: SocialMessage,
    ): Promise<'sent' | 'failed'> => {
        const groupId = resolveGroupId();
        const payload = {
            id: message.id,
            messageId: message.id,
            type: message.type,
            messageType: message.type,
            content: message.content,
            text: message.content,
            timestampMs: message.timestamp,
            sender: 'me',
            extra: message.extra ?? {},
        } as const;
        try {
            const sent = await libp2pService.socialGroupsSend(groupId, payload);
            return sent ? 'sent' : 'failed';
        } catch (error) {
            console.warn('send group message over libp2p failed', error);
            return 'failed';
        }
    }, [chatId]);

    const dispatchOutbound = useCallback((message: SocialMessage) => {
        if (!isGroup && !canRunAction('send_dm')) {
            return;
        }
        pushMessage(message);
        setDeliveryState((prev) => ({ ...prev, [message.id]: 'pending' }));

        void (async () => {
            if (isGroup) {
                const status = await sendGroupThroughLibp2p(message);
                setDeliveryState((prev) => ({ ...prev, [message.id]: status }));
                return;
            }
            const peerId = resolvePeerId();
            if (!peerId) {
                setDeliveryState((prev) => ({ ...prev, [message.id]: 'sent' }));
                return;
            }
            const status = await sendDirectThroughLibp2p(peerId, message);
            setDeliveryState((prev) => ({ ...prev, [message.id]: status }));
        })();
    }, [canRunAction, isGroup, pushMessage, sendDirectThroughLibp2p, sendGroupThroughLibp2p]);

    const handleLaunchApp = (appId: string) => {
        const app = mockApps.find(a => a.id === appId);
        if (!app) return;

        // specific handling for "movie" which is built-in
        if (appId === 'movie') {
            setShowMorePanel(false);
            setShowMovieModal(true);
            return;
        }

        // Generate a unique room ID for this session
        const roomId = `${appId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const inviteText = `邀请你一起来玩 ${app.name}`;

        dispatchOutbound(createMessage({
            sender: 'me',
            type: 'appInvite',
            content: inviteText,
            extra: {
                appId: app.id,
                appName: app.name,
                appIcon: app.icon,
                appRoomId: roomId
            }
        }));

        setShowMorePanel(false);

        // Open app immediately for the sender
        onOpenApp?.(appId, roomId);
    };

    const handleSendText = () => {
        const content = inputText.trim();
        if (!content) return;
        dispatchOutbound(createMessage({
            sender: 'me',
            type: 'text',
            content,
        }));
        setInputText('');
        setShowMorePanel(false);
    };

    const sendSystemNotice = (content: string) => {
        pushMessage(createMessage({
            sender: 'system',
            type: 'system',
            content,
        }));
    };

    const pushSpeechHint = (hint: string, timeoutMs = 2600) => {
        setSpeechHint(hint);
        if (speechHintTimerRef.current) {
            window.clearTimeout(speechHintTimerRef.current);
        }
        speechHintTimerRef.current = window.setTimeout(() => {
            setSpeechHint('');
            speechHintTimerRef.current = null;
        }, timeoutMs);
    };

    const handleSendRedPacket = () => {
        const amount = Number(redPacketAmount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        dispatchOutbound(createMessage({
            sender: 'me',
            type: 'redPacket',
            content: redPacketMessage.trim() || t.chat_defaultGreeting,
            extra: {
                redPacketAmount: Number(amount.toFixed(2)),
                redPacketMessage: redPacketMessage.trim() || t.chat_defaultGreeting,
            },
        }));
        setRedPacketAmount('');
        setRedPacketMessage(t.chat_defaultGreeting);
        setShowRedPacketModal(false);
        setShowMorePanel(false);
    };

    const handleSendVoiceMessage = (durationSec = 8) => {
        dispatchOutbound(createMessage({
            sender: 'me',
            type: 'voice',
            content: `${t.chat_voiceMessage}`,
            extra: {
                voiceDuration: Math.max(1, Math.round(durationSec)),
                voiceCodec: 'opus',
                voiceSampleRate: 16000,
            },
        }));
        setShowMorePanel(false);
    };

    const handleStartSpeechInput = async () => {
        if (speechBusy) {
            return;
        }
        if (!speechSupported) {
            handleSendVoiceMessage(8);
            pushSpeechHint('当前设备语音识别不可用，已发送语音消息占位');
            return;
        }
        setSpeechBusy(true);
        pushSpeechHint('正在语音识别，请说话...', 6000);
        try {
            const result = await transcribeOnce({
                language: 'zh-CN',
                maxResults: 1,
                timeoutMs: 10_000,
                onPartial: (partial) => {
                    setSpeechHint(`识别中：${partial}`);
                },
            });
            const transcript = result.transcript.trim();
            if (!transcript) {
                pushSpeechHint('未识别到有效语音');
                return;
            }
            setInputText((previous) => {
                if (!previous.trim()) {
                    return transcript;
                }
                return `${previous.trim()} ${transcript}`;
            });
            pushSpeechHint(`识别完成（${result.provider}）`);
            setShowMorePanel(false);
        } catch (error) {
            pushSpeechHint(error instanceof Error ? `语音识别失败：${error.message}` : '语音识别失败');
        } finally {
            setSpeechBusy(false);
        }
    };

    const handleSendVideoInvite = async (callType: 'audio' | 'video' = 'video') => {
        if (!canRunAction('video_call')) {
            return;
        }
        const targetPeerId = isGroup ? '' : resolvePeerId();
        let route: RealtimeRouteResult | null = null;
        if (targetPeerId) {
            route = await ensureRealtimeRoute(targetPeerId, 'video');
        }
        const content = callType === 'audio' ? t.chat_voiceCallInvite : t.chat_videoCallInvite;
        dispatchOutbound(createMessage({
            sender: 'me',
            type: 'videoCall',
            content,
            extra: {
                callType,
                callAction: 'invite',
                callSessionId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            },
        }));
        setShowMorePanel(false);
        if (!libp2pService.isNativePlatform()) {
            return;
        }
        const streamKey = `video-call-${Date.now()}`;
        const txStartedAt = Date.now();
        const txOk = await libp2pService.publishLivestreamFrame(streamKey, `video-frame-${Date.now()}`).catch(() => false);
        const txLatencyMs = Date.now() - txStartedAt;
        const events = await libp2pService.pollEvents(64).catch(() => []);
        const rxFrames = events.some((event) => {
            const topic = typeof event.topic === 'string' ? event.topic : '';
            const payloadText = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload ?? {});
            const text = `${topic}|${payloadText}`.toLowerCase();
            return text.includes('live/') || text.includes('livestream') || text.includes('video-frame');
        }) ? 1 : 0;
        const txFrames = txOk ? 1 : 0;
        const videoPassed = txFrames >= 1 && rxFrames >= 1 && txLatencyMs <= 2000;
        sevenGatesRuntime.setGateStatus('gate.video_call_media_stream', videoPassed ? 'passed' : 'failed', {
            error: videoPassed ? undefined : 'video_media_threshold_unmet',
            evidence: [
                {
                    check: 'chat.video_call_media_stream',
                    status: videoPassed ? 'passed' : 'failed',
                    detail: videoPassed ? 'video stream thresholds met' : 'video stream thresholds unmet',
                    data: { txFrames, rxFrames, txLatencyMs },
                },
                {
                    check: 'chat.video_call_quic_route',
                    status: route
                        ? (route.connectedViaQuic ? 'passed' : (route.connected ? 'blocked' : 'failed'))
                        : 'blocked',
                    detail: route
                        ? (route.connectedViaQuic
                            ? 'quic direct route ready'
                            : (route.connected ? 'route ready without confirmed /quic-v1' : 'route not ready'))
                        : 'group/no target peer',
                    data: route
                        ? {
                            connectedAddr: route.connectedAddr,
                            candidateCount: route.candidates.length,
                        }
                        : undefined,
                },
            ],
            ttlMs: 12 * 60 * 60 * 1000,
        });
    };

    const refreshMovieCandidates = useCallback(async () => {
        setMovieLoading(true);
        try {
            if (libp2pService.isNativePlatform()) {
                await syncDistributedContentFromNetwork().catch(() => undefined);
            }
            const candidates = getDistributedContents()
                .filter(isMovieCandidate)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 60);
            setMovieCandidates(candidates);
            setMovieCandidateId((current) => {
                if (current && candidates.some((item) => item.id === current)) {
                    return current;
                }
                return candidates[0]?.id ?? '';
            });
            if (candidates.length === 0) {
                setMovieStatusHint('暂无可用电影，请先发布视频内容并完成网络同步');
            }
        } finally {
            setMovieLoading(false);
        }
    }, []);

    const ensureSynccastTopicSubscribed = useCallback(async (roomId: string) => {
        if (!roomId || !libp2pService.isNativePlatform()) {
            return;
        }
        await libp2pService.pubsubSubscribe(`unimaker/group/${roomId}/v1`).catch(() => false);
    }, []);

    const refreshSynccastState = useCallback(async () => {
        const roomId = resolveSynccastRoomId();
        if (!roomId) {
            return;
        }
        try {
            await ensureSynccastTopicSubscribed(roomId);
            const state = await libp2pService.socialSynccastGetState(roomId);
            if (typeof state.room === 'object' && state.room) {
                setMovieRoomState(state.room as Record<string, unknown>);
            } else {
                setMovieRoomState(null);
            }
        } catch (error) {
            console.warn('refresh synccast state failed', error);
        }
    }, [chatId, ensureSynccastTopicSubscribed, isGroup, localPeerId]);

    useEffect(() => {
        if (!showMovieModal) {
            return;
        }
        void refreshMovieCandidates();
        void refreshSynccastState();
    }, [refreshMovieCandidates, refreshSynccastState, showMovieModal]);

    const handleSynccastControl = useCallback(async (op: 'play' | 'pause' | 'sync_anchor') => {
        if (!canRunAction('synccast_control')) {
            setMovieStatusHint('七门禁未通过，已阻断同步控制');
            return;
        }
        const roomId = resolveSynccastRoomId();
        if (!roomId) {
            return;
        }
        const targetPeerId = resolveSynccastTargetPeerId();
        const route = targetPeerId
            ? await ensureRealtimeRoute(targetPeerId, 'synccast')
            : null;
        if (targetPeerId && route && !route.connected) {
            sevenGatesRuntime.setGateStatus('gate.synccast_live_stream', 'blocked', {
                error: 'synccast_direct_route_not_ready',
                evidence: [
                    {
                        check: 'chat.synccast.quic_route',
                        status: 'failed',
                        detail: 'unable to establish direct route before synccast control',
                        data: {
                            peerId: targetPeerId,
                            candidateCount: route.candidates.length,
                        },
                    },
                ],
                ttlMs: 12 * 60 * 60 * 1000,
            });
            setMovieStatusHint('同步控制失败，请先建立节点直连');
            return;
        }
        await ensureSynccastTopicSubscribed(roomId);
        const payload = {
            op,
            timestampMs: Date.now(),
            anchorTsMs: Date.now(),
        };
        const ok = await libp2pService.socialSynccastControl(roomId, payload).catch(() => false);
        const state = ok ? await libp2pService.socialSynccastGetState(roomId).catch(() => ({} as Record<string, unknown>)) : {};
        const rooms = ok
            ? await libp2pService.socialSynccastListRooms(20).catch(() => ({ items: [] as unknown[], totalCount: 0 }))
            : { items: [] as unknown[], totalCount: 0 };
        const hasState = !!state && typeof state === 'object' && Object.keys(state).length > 0;
        const roomItems = Array.isArray((rooms as { items?: unknown[] }).items)
            ? ((rooms as { items?: unknown[] }).items ?? [])
            : [];
        const totalCount = typeof (rooms as { totalCount?: unknown }).totalCount === 'number'
            ? ((rooms as { totalCount?: number }).totalCount ?? 0)
            : roomItems.length;
        const hasRooms = roomItems.length > 0 || totalCount > 0;
        const synccastPassed = ok && hasState && hasRooms;
        sevenGatesRuntime.setGateStatus(
            'gate.synccast_live_stream',
            synccastPassed ? 'passed' : (ok ? 'failed' : 'blocked'),
            {
                error: synccastPassed ? undefined : (ok ? 'synccast_state_incomplete' : 'synccast_control_failed'),
                evidence: [
                    {
                        check: 'chat.synccast.control',
                        status: ok ? 'passed' : 'blocked',
                        detail: ok ? undefined : 'socialSynccastControl failed',
                        data: { roomId, op },
                    },
                    {
                        check: 'chat.synccast.getState',
                        status: ok ? (hasState ? 'passed' : 'failed') : 'blocked',
                        detail: ok && !hasState ? 'socialSynccastGetState empty' : undefined,
                    },
                    {
                        check: 'chat.synccast.listRooms',
                        status: ok ? (hasRooms ? 'passed' : 'failed') : 'blocked',
                        detail: ok && !hasRooms ? 'socialSynccastListRooms empty' : undefined,
                    },
                    {
                        check: 'chat.synccast.quic_route',
                        status: route
                            ? (route.connectedViaQuic ? 'passed' : (route.connected ? 'blocked' : 'failed'))
                            : 'blocked',
                        detail: route
                            ? (route.connectedViaQuic
                                ? 'quic direct route ready'
                                : (route.connected ? 'route ready without confirmed /quic-v1' : 'route not ready'))
                            : 'group/no target peer',
                        data: route
                            ? {
                                peerId: targetPeerId,
                                connectedAddr: route.connectedAddr,
                                candidateCount: route.candidates.length,
                            }
                            : undefined,
                    },
                ],
                ttlMs: 12 * 60 * 60 * 1000,
            }
        );
        if (!ok) {
            setMovieStatusHint('同步控制失败，请检查网络连接');
            return;
        }
        setMovieStatusHint(op === 'pause' ? '已同步暂停' : '已同步播放');
        void refreshSynccastState();
    }, [canRunAction, chatId, ensureRealtimeRoute, ensureSynccastTopicSubscribed, isGroup, localPeerId, refreshSynccastState]);

    const handleStartMovieWatchParty = useCallback(async () => {
        if (isGroup) {
            setMovieStatusHint('看电影当前仅支持双人会话');
            return;
        }
        if (!canRunAction('synccast_control')) {
            setMovieStatusHint('七门禁未通过，已阻断发起看电影');
            return;
        }
        const roomId = resolveSynccastRoomId();
        if (!roomId) {
            setMovieStatusHint('无法创建看电影房间');
            return;
        }

        let mediaUrl = '';
        let title = movieTitle.trim();
        let contentId = '';
        let sourcePeerId = '';
        let source: 'libp2p-content' | 'local-file' = 'libp2p-content';
        let upsertOk = false;
        let joined = false;
        let playOk = false;
        const targetPeerId = resolveSynccastTargetPeerId();
        let route: RealtimeRouteResult | null = null;

        const updateSynccastGate = async () => {
            const state = playOk
                ? await libp2pService.socialSynccastGetState(roomId).catch(() => ({} as Record<string, unknown>))
                : {};
            const rooms = playOk
                ? await libp2pService.socialSynccastListRooms(20).catch(() => ({ items: [] as unknown[], totalCount: 0 }))
                : { items: [] as unknown[], totalCount: 0 };
            const hasState = !!state && typeof state === 'object' && Object.keys(state).length > 0;
            const roomItems = Array.isArray((rooms as { items?: unknown[] }).items)
                ? ((rooms as { items?: unknown[] }).items ?? [])
                : [];
            const totalCount = typeof (rooms as { totalCount?: unknown }).totalCount === 'number'
                ? ((rooms as { totalCount?: number }).totalCount ?? 0)
                : roomItems.length;
            const hasRooms = roomItems.length > 0 || totalCount > 0;
            const passed = upsertOk && joined && playOk && hasState && hasRooms;
            sevenGatesRuntime.setGateStatus(
                'gate.synccast_live_stream',
                passed ? 'passed' : (playOk ? 'failed' : 'blocked'),
                {
                    error: passed ? undefined : (playOk ? 'synccast_state_incomplete' : 'synccast_control_flow_failed'),
                    evidence: [
                        {
                            check: 'chat.synccast.upsertProgram',
                            status: upsertOk ? 'passed' : 'failed',
                            detail: upsertOk ? undefined : 'socialSynccastUpsertProgram failed',
                        },
                        {
                            check: 'chat.synccast.join',
                            status: upsertOk ? (joined ? 'passed' : 'failed') : 'blocked',
                            detail: upsertOk && !joined ? 'socialSynccastJoin failed' : undefined,
                        },
                        {
                            check: 'chat.synccast.control',
                            status: joined ? (playOk ? 'passed' : 'failed') : 'blocked',
                            detail: joined && !playOk ? 'socialSynccastControl(play) failed' : undefined,
                        },
                        {
                            check: 'chat.synccast.getState',
                            status: playOk ? (hasState ? 'passed' : 'failed') : 'blocked',
                            detail: playOk && !hasState ? 'socialSynccastGetState empty' : undefined,
                        },
                        {
                            check: 'chat.synccast.listRooms',
                            status: playOk ? (hasRooms ? 'passed' : 'failed') : 'blocked',
                            detail: playOk && !hasRooms ? 'socialSynccastListRooms empty' : undefined,
                        },
                        {
                            check: 'chat.synccast.quic_route',
                            status: route
                                ? (route.connectedViaQuic ? 'passed' : (route.connected ? 'blocked' : 'failed'))
                                : 'blocked',
                            detail: route
                                ? (route.connectedViaQuic
                                    ? 'quic direct route ready'
                                    : (route.connected ? 'route ready without confirmed /quic-v1' : 'route not ready'))
                                : 'group/no target peer',
                            data: route
                                ? {
                                    peerId: targetPeerId,
                                    connectedAddr: route.connectedAddr,
                                    candidateCount: route.candidates.length,
                                }
                                : undefined,
                        },
                    ],
                    ttlMs: 12 * 60 * 60 * 1000,
                }
            );
            return passed;
        };

        if (movieSourceType === 'network') {
            const selected = movieCandidates.find((item) => item.id === movieCandidateId) ?? null;
            if (!selected) {
                setMovieStatusHint('请先选择已发布在 libp2p 网络的电影');
                return;
            }
            setMovieSubmitting(true);
            setMovieStatusHint('');

            try {
                await syncDistributedContentFromNetwork(selected.userId).catch(() => undefined);
                const resolved = await resolveDistributedContentDetail(selected.id, selected.userId).catch(() => null);
                const movie = resolved ?? selected;
                mediaUrl = (movie.media ?? movie.coverMedia ?? '').trim();

                if (!isLikelyVideoMedia(mediaUrl)) {
                    setMovieStatusHint('所选内容不是可播放视频');
                    return;
                }
                title = title || movie.content.trim() || '未命名电影';
                contentId = movie.id;
                sourcePeerId = movie.userId;
                source = 'libp2p-content';
            } catch (err) {
                setMovieStatusHint('无法解析网络资源');
                setMovieSubmitting(false);
                return;
            }
        } else {
            // Local File Mode
            if (!localVideoFile) {
                setMovieStatusHint('请先选择本地视频文件');
                return;
            }
            mediaUrl = URL.createObjectURL(localVideoFile); // This URL works only locally
            title = title || localVideoFile.name;
            contentId = `local-${Date.now()}`;
            sourcePeerId = localPeerId;
            source = 'local-file';
        }

        try {
            if (targetPeerId) {
                route = await ensureRealtimeRoute(targetPeerId, 'synccast');
                if (!route.connected) {
                    await updateSynccastGate();
                    setMovieStatusHint('节点直连未建立，无法发起同步播放');
                    return;
                }
            }
            await ensureSynccastTopicSubscribed(roomId);
            const program = {
                programId: `movie-${contentId}`,
                id: `movie-${contentId}`,
                title,
                url: mediaUrl,
                mode: 'realtime_program',
                allowSeek: false,
                allowRateChange: false,
                timestampMs: Date.now(),
                contentId,
                sourcePeerId,
                source,
            } as any; // Cast to any to bypass strict type check if types aren't updated yet

            const upsert = await libp2pService.socialSynccastUpsertProgram(roomId, program);
            upsertOk = Boolean(upsert.ok !== false);
            if (!upsertOk) {
                await updateSynccastGate();
                setMovieStatusHint('片源写入失败');
                return;
            }
            joined = await libp2pService.socialSynccastJoin(roomId, targetPeerId);
            if (!joined) {
                await updateSynccastGate();
                setMovieStatusHint('加入看电影房间失败');
                return;
            }
            playOk = await libp2pService.socialSynccastControl(roomId, {
                op: 'play',
                positionMs: 0,
                anchorTsMs: Date.now(),
                title,
                url: mediaUrl,
                contentId,
                sourcePeerId,
            });
            if (!playOk) {
                await updateSynccastGate();
                setMovieStatusHint('开始同步播放失败');
                return;
            }
            const synccastPassed = await updateSynccastGate();
            sendSystemNotice(`[看电影] 已发起：${title}（${source === 'local-file' ? '本地文件' : formatMovieSource(sourcePeerId, localPeerId)}）`);
            setMovieStatusHint(synccastPassed ? '已发起同步播放' : '已发起播放，但同步状态证据不完整');
            setShowMovieModal(false);
        } catch (error) {
            console.warn('start movie watch party failed', error);
            await updateSynccastGate();
            setMovieStatusHint('发起失败，请稍后重试');
        } finally {
            setMovieSubmitting(false);
        }
    }, [canRunAction, ensureRealtimeRoute, isGroup, resolveSynccastRoomId, movieSourceType, movieCandidates, movieCandidateId, movieTitle, localVideoFile, ensureSynccastTopicSubscribed, localPeerId, resolveSynccastTargetPeerId, sendSystemNotice]);


    const captureHighAccuracyLocation = useCallback(async (): Promise<CapturedLocation> => {
        if (Capacitor.isNativePlatform()) {
            const permissions = await Geolocation.checkPermissions().catch(() => null);
            const coarseBefore = (permissions as { coarseLocation?: string } | null)?.coarseLocation ?? '';
            const locationBefore = permissions?.location ?? 'prompt';
            const grantedBefore = locationBefore === 'granted' || coarseBefore === 'granted';
            if (!grantedBefore) {
                const requested = await Geolocation.requestPermissions().catch(() => null);
                const coarseAfter = (requested as { coarseLocation?: string } | null)?.coarseLocation ?? '';
                const locationAfter = requested?.location ?? 'denied';
                const grantedAfter = locationAfter === 'granted' || coarseAfter === 'granted';
                if (!grantedAfter) {
                    throw new Error('定位权限未开启，请在系统设置中授权后重试');
                }
            }
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: 15_000,
                maximumAge: 0,
            });
            return {
                coords: {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    altitude: position.coords.altitude ?? null,
                    accuracy: position.coords.accuracy,
                    speed: position.coords.speed ?? null,
                    heading: position.coords.heading ?? null,
                },
                timestamp: position.timestamp,
            };
        }

        if (!navigator.geolocation) {
            throw new Error('当前设备不支持 GPS 定位');
        }
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        coords: {
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                            altitude: position.coords.altitude ?? null,
                            accuracy: position.coords.accuracy,
                            speed: position.coords.speed ?? null,
                            heading: position.coords.heading ?? null,
                        },
                        timestamp: position.timestamp,
                    });
                },
                (error) => reject(error),
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 0,
                }
            );
        });
    }, []);

    useEffect(() => {
        if (!showLocationModal) {
            return;
        }
        let cancelled = false;
        setLocationPreview('定位中...');
        void (async () => {
            try {
                const live = await captureHighAccuracyLocation();
                if (cancelled) {
                    return;
                }
                const label = formatCoordinateLabel(live.coords.latitude, live.coords.longitude);
                setLocationPreview(label);
                setLocationName((prev) => (prev.trim().length > 0 ? prev : label));
            } catch {
                if (cancelled) {
                    return;
                }
                setLocationPreview('未获取到定位，发送时将重试');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [captureHighAccuracyLocation, showLocationModal]);

    const handleSendLocation = async () => {
        const fallbackName = locationName.trim();
        if (locationFetching) return;
        setLocationFetching(true);
        setLocationHint('');
        try {
            const position = await captureHighAccuracyLocation();
            const { latitude, longitude, altitude, accuracy, speed, heading } = position.coords;
            const liveLabel = formatCoordinateLabel(latitude, longitude);
            const locationText = fallbackName || liveLabel;
            dispatchOutbound(createMessage({
                sender: 'me',
                type: 'location',
                content: locationText,
                extra: {
                    locationName: locationText,
                    latitude,
                    longitude,
                    altitude: Number.isFinite(altitude ?? NaN) ? Number(altitude) : undefined,
                    accuracyMeters: Number.isFinite(accuracy) ? Number(accuracy) : undefined,
                    speedMps: Number.isFinite(speed ?? NaN) ? Number(speed) : undefined,
                    headingDeg: Number.isFinite(heading ?? NaN) ? Number(heading) : undefined,
                    capturedAt: Date.now(),
                },
            }));
            setLocationPreview(liveLabel);
            setLocationHint(`已采集 GPS 精度 ±${Math.max(1, Math.round(accuracy))}m`);
            setShowLocationModal(false);
            setShowMorePanel(false);
        } catch (error) {
            if (!fallbackName) {
                setLocationHint(error instanceof Error ? error.message : 'GPS 定位失败，请检查定位权限');
                return;
            }
            dispatchOutbound(createMessage({
                sender: 'me',
                type: 'location',
                content: fallbackName,
                extra: {
                    locationName: fallbackName,
                    capturedAt: Date.now(),
                },
            }));
            setLocationHint('GPS 定位失败，已发送手动位置');
            setShowLocationModal(false);
            setShowMorePanel(false);
        } finally {
            setLocationFetching(false);
            window.setTimeout(() => setLocationHint(''), 2800);
        }
    };

    useEffect(() => {
        if (bootActionDone) {
            return;
        }
        if (initialAction === 'redPacket') {
            setShowMorePanel(true);
            setShowRedPacketModal(true);
            setBootActionDone(true);
            return;
        }
        if (initialAction === 'location') {
            setShowMorePanel(true);
            setShowLocationModal(true);
            setBootActionDone(true);
            return;
        }
        if (initialAction === 'voice') {
            void handleStartSpeechInput();
            setBootActionDone(true);
            return;
        }
        if (initialAction === 'videoCall') {
            handleSendVideoInvite('video');
            setBootActionDone(true);
            return;
        }
        setBootActionDone(true);
    }, [bootActionDone, initialAction, speechSupported]);

    return (
        <div className="h-full flex flex-col bg-gray-100">
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
                <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded-full" aria-label={t.chat_backToList}>
                    <ArrowLeft size={24} />
                </button>
                <ImageWithFallback
                    src={chatAvatar}
                    alt={chatName}
                    className="w-10 h-10 rounded-full object-cover"
                />
                <div className="flex-1 min-w-0">
                    <h1 className="font-semibold truncate">{chatName}</h1>
                    <span className="text-xs text-gray-500">{isGroup ? t.chat_groupChat : t.chat_directChat}</span>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {sortedMessages.length === 0 && (
                    <div className="text-center text-sm text-gray-400 py-10">{t.chat_noMessages}</div>
                )}

                {sortedMessages.map((msg) => {
                    if (msg.sender === 'system') {
                        return (
                            <div key={msg.id} className="flex justify-center">
                                <div className="text-xs text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
                                    {msg.content}
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={msg.id}
                            className={`flex gap-2 ${msg.sender === 'me' ? 'flex-row-reverse' : ''}`}
                        >
                            <ImageWithFallback
                                src={msg.sender === 'me'
                                    ? 'https://images.unsplash.com/photo-1617409122337-594499222247?w=100'
                                    : chatAvatar}
                                alt="avatar"
                                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                            />
                            <div className="max-w-[72%]">
                                {msg.type === 'text' && (
                                    <div className={`p-3 rounded-2xl ${msg.sender === 'me'
                                        ? 'bg-purple-500 text-white rounded-tr-sm'
                                        : 'bg-white rounded-tl-sm'}`}
                                    >
                                        <p className="text-sm break-words">{sanitizeContent(msg.content)}</p>
                                    </div>
                                )}

                                {msg.type === 'redPacket' && (
                                    <div className="p-4 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl text-white min-w-[180px]">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Gift size={24} />
                                            <span className="font-medium">{t.chat_redPacket}</span>
                                        </div>
                                        <p className="text-sm opacity-95">{sanitizeContent(msg.extra?.redPacketMessage || msg.content)}</p>
                                        <p className="text-xs mt-2 opacity-90">{t.chat_amount}: {msg.extra?.redPacketAmount?.toFixed(2) ?? '0.00'} {getCurrencyLabel()}</p>
                                    </div>
                                )}

                                {msg.type === 'location' && (
                                    <div className="bg-white rounded-xl overflow-hidden min-w-[220px] border border-gray-100">
                                        <div className="h-24 bg-gradient-to-br from-blue-100 to-green-100 flex items-center justify-center">
                                            <MapPin size={32} className="text-red-500" />
                                        </div>
                                        <div className="p-3">
                                            <p className="text-sm font-medium text-gray-900">{sanitizeContent(msg.extra?.locationName || msg.content)}</p>
                                            <p className="text-xs text-gray-500 mt-1">{t.chat_locationShare}</p>
                                            {typeof msg.extra?.latitude === 'number' && typeof msg.extra?.longitude === 'number' && (
                                                <p className="text-[11px] text-gray-500 mt-1">
                                                    GPS: {msg.extra.latitude.toFixed(6)}, {msg.extra.longitude.toFixed(6)}
                                                </p>
                                            )}
                                            {typeof msg.extra?.accuracyMeters === 'number' && (
                                                <p className="text-[11px] text-gray-500 mt-1">精度: ±{Math.max(1, Math.round(msg.extra.accuracyMeters))}m</p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {msg.type === 'voice' && (
                                    <div className={`p-3 rounded-2xl ${msg.sender === 'me'
                                        ? 'bg-purple-500 text-white rounded-tr-sm'
                                        : 'bg-white rounded-tl-sm'}`}
                                    >
                                        <p className="text-sm">{t.chat_voiceMessage} {msg.extra?.voiceDuration ?? 0}s</p>
                                    </div>
                                )}

                                {msg.type === 'videoCall' && (
                                    <div className={`p-3 rounded-2xl ${msg.sender === 'me'
                                        ? 'bg-purple-500 text-white rounded-tr-sm'
                                        : 'bg-white rounded-tl-sm'}`}
                                    >
                                        <p className="text-sm">
                                            {sanitizeContent(
                                                msg.content ||
                                                (msg.extra?.callType === 'audio' ? t.chat_voiceCallInvite : t.chat_startedVideoCall)
                                            )}
                                        </p>
                                    </div>
                                )}

                                {msg.type === 'appInvite' && (
                                    <div className="bg-white rounded-xl overflow-hidden min-w-[220px] border border-gray-100 shadow-sm">
                                        <div className="h-20 bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
                                            <span className="text-4xl">{msg.extra?.appIcon || '🎮'}</span>
                                        </div>
                                        <div className="p-3">
                                            <p className="text-sm font-medium text-gray-900 mb-1">{msg.extra?.appName || '未知应用'}</p>
                                            <p className="text-xs text-gray-500 mb-3">{msg.content}</p>
                                            <button
                                                onClick={() => onOpenApp?.(msg.extra?.appId || '', msg.extra?.appRoomId)}
                                                className="w-full py-2 bg-purple-500 text-white text-xs font-medium rounded-lg hover:bg-purple-600 transition-colors flex items-center justify-center gap-1"
                                            >
                                                <span>立即加入</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <p className="text-xs text-gray-400 mt-1 px-1">{formatTime(msg.timestamp)}</p>
                                {msg.sender === 'me' && (
                                    <p className="text-[10px] text-gray-400 px-1">
                                        {deliveryState[msg.id] ?? 'sent'}
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="bg-white border-t border-gray-200 p-3 shrink-0">
                <div className="flex items-center gap-2">
                    <button
                        className="p-2 hover:bg-gray-100 rounded-full"
                        onClick={() => void handleStartSpeechInput()}
                        disabled={speechBusy}
                        aria-label={t.chat_voiceInput}
                    >
                        <Mic size={24} className="text-gray-600" />
                    </button>
                    <input
                        type="text"
                        value={inputText}
                        onChange={(event) => setInputText(event.target.value)}
                        placeholder={t.chat_inputPlaceholder}
                        className="flex-1 px-4 py-2 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button
                        className="p-2 hover:bg-gray-100 rounded-full"
                        onClick={() => sendSystemNotice(t.chat_emojiFunctionDev)}
                        aria-label={t.chat_emojiPanel}
                    >
                        <Smile size={24} className="text-gray-600" />
                    </button>
                    {inputText.trim() ? (
                        <button
                            onClick={() => handleSendText()}
                            className="p-2 bg-purple-500 rounded-full hover:bg-purple-600"
                            aria-label={t.chat_sendMessage}
                        >
                            <Send size={20} className="text-white" />
                        </button>
                    ) : (
                        <button
                            onClick={() => setShowMorePanel(!showMorePanel)}
                            className="p-2 hover:bg-gray-100 rounded-full"
                            aria-label={t.chat_moreFeatures}
                        >
                            <Plus size={24} className="text-gray-600" />
                        </button>
                    )}
                </div>
                {locationHint && (
                    <div className="mt-2 text-xs text-gray-500">{locationHint}</div>
                )}
                {speechHint && (
                    <div className="mt-1 text-xs text-indigo-600">{speechHint}</div>
                )}
                {movieStatusHint && (
                    <div className="mt-1 text-xs text-purple-600">{movieStatusHint}</div>
                )}
                {actionBlockHint && (
                    <div className="mt-1 text-xs text-red-600">{actionBlockHint}</div>
                )}

                {showMorePanel && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="grid grid-cols-4 gap-4">
                            <button
                                onClick={() => setShowRedPacketModal(true)}
                                className="flex flex-col items-center gap-2"
                            >
                                <div className="w-14 h-14 bg-red-100 rounded-xl flex items-center justify-center">
                                    <Gift size={28} className="text-red-500" />
                                </div>
                                <span className="text-xs text-gray-600">{t.chat_redPacket}</span>
                            </button>
                            <button
                                onClick={() => setShowLocationModal(true)}
                                className="flex flex-col items-center gap-2"
                            >
                                <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center">
                                    <MapPin size={28} className="text-green-500" />
                                </div>
                                <span className="text-xs text-gray-600">{t.chat_location}</span>
                            </button>
                            <button
                                className="flex flex-col items-center gap-2"
                                onClick={() => void handleStartSpeechInput()}
                            >
                                <div className="w-14 h-14 bg-indigo-100 rounded-xl flex items-center justify-center">
                                    <Mic size={28} className="text-indigo-500" />
                                </div>
                                <span className="text-xs text-gray-600">{t.chat_voiceMessage}</span>
                            </button>
                            <button
                                className="flex flex-col items-center gap-2"
                                onClick={() => handleSendVideoInvite('video')}
                            >
                                <div className="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <Video size={28} className="text-blue-500" />
                                </div>
                                <span className="text-xs text-gray-600">{t.chat_videoCall}</span>
                            </button>
                            <button
                                className="flex flex-col items-center gap-2"
                                onClick={() => {
                                    setShowMorePanel(false);
                                    setShowMovieModal(true);
                                }}
                            >
                                <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center">
                                    <Film size={28} className="text-orange-500" />
                                </div>
                                <span className="text-xs text-gray-600">{t.chat_movieApp}</span>
                            </button>

                            {socialApps.map(appId => {
                                const app = mockApps.find(a => a.id === appId);
                                if (!app || app.id === 'movie') return null;
                                return (
                                    <button
                                        key={app.id}
                                        onClick={() => handleLaunchApp(app.id)}
                                        className="flex flex-col items-center gap-2"
                                    >
                                        <div className="w-14 h-14 bg-gray-100 rounded-xl flex items-center justify-center text-2xl">
                                            {app.icon}
                                        </div>
                                        <span className="text-xs text-gray-600 truncate max-w-full px-1">{app.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {showRedPacketModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
                        <div className="bg-gradient-to-br from-red-500 to-orange-500 p-4 text-white flex items-center justify-between">
                            <h3 className="font-semibold text-lg">{t.chat_sendRedPacket}</h3>
                            <button onClick={() => setShowRedPacketModal(false)} aria-label={t.chat_closeRedPacket}>
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="text-sm text-gray-600 block mb-2">{t.chat_amount} ({getCurrencyLabel()})</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={redPacketAmount}
                                    onChange={(event) => setRedPacketAmount(event.target.value)}
                                    placeholder={t.chat_enterAmount}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-600 block mb-2">{t.chat_greeting}</label>
                                <input
                                    type="text"
                                    value={redPacketMessage}
                                    onChange={(event) => setRedPacketMessage(event.target.value)}
                                    placeholder={t.chat_greetingPlaceholder}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>
                            <button
                                onClick={handleSendRedPacket}
                                className="w-full py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-lg font-medium"
                            >
                                {t.chat_sendRedPacketBtn}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showLocationModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
                    <div className="bg-white w-full rounded-t-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="font-semibold">{t.chat_sendLocation}</h3>
                            <button onClick={() => setShowLocationModal(false)} aria-label={t.chat_closeLocation}>
                                <X size={24} className="text-gray-600" />
                            </button>
                        </div>
                        <div className="h-56 bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center">
                            <div className="text-center px-4">
                                <MapPin size={48} className="text-red-500 mx-auto mb-2" />
                                <p className="text-gray-600">{t.chat_locationPreview}</p>
                                <input
                                    value={locationName}
                                    onChange={(event) => setLocationName(event.target.value)}
                                    className="mt-3 w-full max-w-xs px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg"
                                    placeholder="可选：位置备注（默认发送实时坐标）"
                                />
                                <p className="mt-2 text-xs text-gray-500">{locationPreview || '等待定位'}</p>
                            </div>
                        </div>
                        <div className="p-4">
                            <button
                                onClick={() => void handleSendLocation()}
                                disabled={locationFetching}
                                className="w-full py-3 bg-purple-500 text-white rounded-lg font-medium disabled:opacity-60"
                            >
                                {locationFetching ? '正在采集高精度GPS...' : t.chat_sendCurrentLocation}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showMovieModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
                    <div className="bg-white w-full rounded-t-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="font-semibold">看电影</h3>
                            <button onClick={() => setShowMovieModal(false)} aria-label="close movie modal">
                                <X size={24} className="text-gray-600" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div>
                                <label className="text-sm text-gray-600 block mb-1">片名</label>
                                <input
                                    value={movieTitle}
                                    onChange={(event) => setMovieTitle(event.target.value)}
                                    placeholder="可选：自定义播放标题（默认使用发布内容标题）"

                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                                />
                            </div>

                            {/* Source Selection Tabs */}
                            <div className="flex rounded-lg bg-gray-100 p-1">
                                <button
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${movieSourceType === 'network' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                                    onClick={() => setMovieSourceType('network')}
                                >
                                    网络片源 (libp2p)
                                </button>
                                <button
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${movieSourceType === 'local' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                                    onClick={() => setMovieSourceType('local')}
                                >
                                    本地视频
                                </button>
                            </div>

                            {movieSourceType === 'network' ? (
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-sm text-gray-600">选择 libp2p 已发布电影</label>
                                        <button
                                            onClick={() => void refreshMovieCandidates()}
                                            className="text-xs text-purple-600"
                                        >
                                            {movieLoading ? '刷新中...' : '刷新片源'}
                                        </button>
                                    </div>
                                    <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                                        {movieCandidates.length === 0 && (
                                            <div className="px-3 py-6 text-xs text-gray-500 text-center">
                                                暂无可用电影，先在首页发布视频内容后再发起同步播放
                                            </div>
                                        )}
                                        {movieCandidates.map((item) => {
                                            const active = movieCandidateId === item.id;
                                            return (
                                                <button
                                                    key={item.id}
                                                    onClick={() => setMovieCandidateId(item.id)}
                                                    className={`w-full text-left px-3 py-2 transition-colors ${active ? 'bg-purple-50' : 'bg-white hover:bg-gray-50'}`}
                                                >
                                                    <div className="text-sm font-medium text-gray-900 truncate">
                                                        {item.content || '未命名'}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-0.5">
                                                        {formatMovieSource(item.userId, localPeerId)}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label className="text-sm text-gray-600 block mb-1">选择本地视频文件</label>
                                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:bg-gray-50 transition-colors">
                                        <input
                                            type="file"
                                            accept="video/*"
                                            className="hidden"
                                            id="movie-local-file"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    setLocalVideoFile(file);
                                                    if (!movieTitle) {
                                                        setMovieTitle(file.name.replace(/\.[^/.]+$/, ""));
                                                    }
                                                }
                                            }}
                                        />
                                        <label htmlFor="movie-local-file" className="cursor-pointer flex flex-col items-center">
                                            {localVideoFile ? (
                                                <>
                                                    <Film size={32} className="text-purple-500 mb-2" />
                                                    <span className="text-sm font-medium text-gray-900 break-all px-4">{localVideoFile.name}</span>
                                                    <span className="text-xs text-gray-500 mt-1">{(localVideoFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                                                    <span className="text-xs text-purple-600 mt-2">点击更换</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Film size={32} className="text-gray-300 mb-2" />
                                                    <span className="text-sm text-gray-600">点击选择视频文件</span>
                                                    <span className="text-xs text-gray-400 mt-1">支持 MP4, WebM 等常见格式</span>
                                                </>
                                            )}
                                        </label>
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-2 px-1">
                                        注意：本地视频仅在您的设备上播放，对方需要拥有相同文件或手动加载才能同步观看。
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className="p-4 space-y-3 border-t border-gray-100">
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    disabled={movieSubmitting || (!movieCandidateId && movieSourceType === 'network') || (!localVideoFile && movieSourceType === 'local')}
                                    onClick={() => void handleStartMovieWatchParty()}
                                    className="py-2 bg-purple-500 text-white rounded-lg disabled:opacity-60"
                                >
                                    {movieSubmitting ? '发起中...' : '发起同步播放'}
                                </button>
                                <button
                                    onClick={() => void handleSynccastControl('pause')}
                                    className="py-2 border border-purple-300 text-purple-600 rounded-lg"
                                >
                                    同步暂停
                                </button>
                                <button
                                    onClick={() => void handleSynccastControl('play')}
                                    className="py-2 border border-purple-300 text-purple-600 rounded-lg"
                                >
                                    同步播放
                                </button>
                                <button
                                    onClick={() => void refreshSynccastState()}
                                    className="py-2 border border-gray-300 text-gray-700 rounded-lg"
                                >
                                    刷新状态
                                </button>
                            </div>
                            {
                                movieRoomState && (
                                    <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 break-all">
                                        {JSON.stringify(movieRoomState)}
                                    </div>
                                )
                            }
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
