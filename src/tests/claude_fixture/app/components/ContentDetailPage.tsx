/**
 * ContentDetailPage — Xiaohongshu-style fullscreen content detail view.
 * Supports image carousel, fullscreen video playback, comments, likes, and report.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    ArrowLeft,
    Heart,
    Flag,
    ChevronLeft,
    ChevronRight,
    Play,
    Pause,
    Maximize2,
    MapPin,
    UserPlus,
    Send,
    Lock,
    X,
    AlertTriangle,
    Loader2,
} from 'lucide-react';
import { Content } from './HomePage';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useLocale } from '../i18n/LocaleContext';
import { getFeatureFlag } from '../utils/featureFlags';
import { formatContentLocationLabel, openContentLocationInMap } from '../utils/contentLocation';
import { getCurrentPolicyGroupId } from '../utils/region';
import {
    acceptUnifiedOrder,
    createUnifiedOrder,
    extractLegacyPaymentFields,
    getLatestByopProof,
    isOrderUnlockReady,
    resolveActorId,
    resolvePaymentProfileRefFromContentExtra,
    revealPaymentForOrder,
    submitByopProof,
} from '../domain/payment/paymentApi';
import { bindOrderTarget, getOrderSnapshotForTarget, saveOrderSnapshot } from '../domain/payment/orderStore';
import { trackPaymentEvent } from '../domain/payment/paymentTelemetry';
import type { ByopChannel, ProofVerification, RevealPaymentResult, UnifiedOrder } from '../domain/payment/types';

interface Comment {
    id: string;
    userName: string;
    content: string;
    timestamp: number;
}

interface ContentDetailPageProps {
    content: Content;
    onClose: () => void;
}

function normalizeContentExtra(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function toLocalDateTimeInputValue(date: Date): string {
    const next = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
    return next.toISOString().slice(0, 16);
}

async function hashDataUrlSha256(dataUrl: string): Promise<string | undefined> {
    const marker = ';base64,';
    const idx = dataUrl.indexOf(marker);
    if (idx <= 5 || !dataUrl.startsWith('data:')) {
        return undefined;
    }
    const base64 = dataUrl.slice(idx + marker.length);
    if (!base64) {
        return undefined;
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
}

export default function ContentDetailPage({ content, onClose }: ContentDetailPageProps) {
    const { locale, t } = useLocale();
    const [isLiked, setIsLiked] = useState(false);
    const [likeCount, setLikeCount] = useState(content.likes);
    const [commentText, setCommentText] = useState('');
    const [comments, setComments] = useState<Comment[]>([]);
    const [isFollowed, setIsFollowed] = useState(false);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [imageIndex, setImageIndex] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const proofScreenshotInputRef = useRef<HTMLInputElement>(null);

    // Paid content logic
    const contentExtra = useMemo(() => normalizeContentExtra(content.extra), [content.extra]);
    const isPaid = Boolean(contentExtra?.isPaid);
    const price = typeof contentExtra?.price === 'number' ? contentExtra.price : 0;
    const sellerId = (typeof content.userId === 'string' && content.userId.trim().length > 0) ? content.userId : content.userName;
    const buyerId = useMemo(() => resolveActorId(), []);
    const targetKey = useMemo(() => `content:${content.id}`, [content.id]);

    const [activeOrder, setActiveOrder] = useState<UnifiedOrder | null>(() => getOrderSnapshotForTarget(targetKey));
    const [revealedPayment, setRevealedPayment] = useState<RevealPaymentResult | null>(null);
    const [paymentProfileRef, setPaymentProfileRef] = useState<string | null>(
        typeof contentExtra?.paymentProfileRef === 'string' ? contentExtra.paymentProfileRef : null,
    );
    const [proofChannel, setProofChannel] = useState<ByopChannel>('WECHAT');
    const [proofTradeNo, setProofTradeNo] = useState('');
    const [proofPaidAmountCny, setProofPaidAmountCny] = useState(price > 0 ? price.toFixed(2) : '');
    const [proofPaidAt, setProofPaidAt] = useState(toLocalDateTimeInputValue(new Date()));
    const [proofScreenshotDataUrl, setProofScreenshotDataUrl] = useState('');
    const [proofVerification, setProofVerification] = useState<ProofVerification | null>(null);
    const [orderBusy, setOrderBusy] = useState(false);
    const [orderError, setOrderError] = useState('');
    const [showPayQr, setShowPayQr] = useState(false);

    const legacyPayment = useMemo(() => extractLegacyPaymentFields(contentExtra), [contentExtra]);
    const sellerWechatQr = revealedPayment?.paymentProfile.rails.wechatQr ?? legacyPayment.wechatQr;
    const sellerAlipayQr = revealedPayment?.paymentProfile.rails.alipayQr ?? legacyPayment.alipayQr;
    const sellerWalletAddress = (
        revealedPayment?.paymentProfile.rails.walletAddress
        ?? (typeof contentExtra?.walletAddress === 'string' ? contentExtra.walletAddress : undefined)
    )?.trim();
    const sellerCreditCardEnabled = Boolean(
        revealedPayment?.paymentProfile.rails.creditCardEnabled
        ?? (typeof contentExtra?.creditCardEnabled === 'boolean' ? contentExtra.creditCardEnabled : false),
    );
    const policyGroupId = getCurrentPolicyGroupId();
    const isDomestic = policyGroupId === 'CN';

    const isPurchased = !isPaid || isOrderUnlockReady(activeOrder);
    const needsPaywall = isPaid && !isPurchased;
    const devManualUnlockEnabled = getFeatureFlag('payment_dev_manual_unlock', false);

    const handleLike = () => {
        if (isLiked) {
            setLikeCount((prev) => prev - 1);
        } else {
            setLikeCount((prev) => prev + 1);
        }
        setIsLiked(!isLiked);
    };

    const handleVideoToggle = () => {
        if (videoRef.current) {
            if (isVideoPlaying) {
                videoRef.current.pause();
            } else {
                void videoRef.current.play();
            }
            setIsVideoPlaying(!isVideoPlaying);
        }
    };

    const handleFullscreen = () => {
        if (containerRef.current) {
            if (!document.fullscreenElement) {
                void containerRef.current.requestFullscreen?.();
            } else {
                void document.exitFullscreen?.();
            }
        }
    };

    const handleSendComment = () => {
        const text = commentText.trim();
        if (text.length === 0) return;
        const newComment: Comment = {
            id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userName: '我',
            content: text,
            timestamp: Date.now(),
        };
        setComments((prev) => [newComment, ...prev]);
        setCommentText('');
    };

    const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSendComment();
        }
    };

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };

    const formatNumber = (num: number) => {
        if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
        return num.toString();
    };

    const formatCommentTime = (timestamp: number) => {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / (1000 * 60));
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        if (hours < 24) return `${hours}小时前`;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        return `${days}天前`;
    };

    const images = useMemo(() => {
        const out: string[] = [];
        const pushUnique = (value?: string) => {
            if (!value || value.trim().length === 0 || out.includes(value)) {
                return;
            }
            out.push(value);
        };
        for (const media of content.mediaItems ?? []) {
            pushUnique(media);
        }
        pushUnique(content.coverMedia);
        pushUnique(content.media);
        return out;
    }, [content.media, content.coverMedia, content.mediaItems]);
    const contentType: Content['type'] = content.type === 'text' && images.length > 0 ? 'image' : content.type;
    const locationLabel = useMemo(() => formatContentLocationLabel(content.location, locale), [content.location, locale]);
    const handleLocationClick = useCallback(() => {
        void (async () => {
            try {
                const result = await openContentLocationInMap(content.location, locale);
                if (result === 'no_coordinates' && typeof window !== 'undefined') {
                    window.alert(t.content_location_noCoordinates);
                }
            } catch {
                if (typeof window !== 'undefined') {
                    window.alert(t.content_location_openFailed);
                }
            }
        })();
    }, [content.location, locale, t]);

    const preparePaymentFlow = useCallback(async () => {
        if (!needsPaywall) {
            return;
        }
        setOrderBusy(true);
        setOrderError('');

        try {
            let nextOrder = activeOrder;
            let profileRef = paymentProfileRef;

            if (!profileRef) {
                const resolvedRef = await resolvePaymentProfileRefFromContentExtra(contentExtra, sellerId);
                if (resolvedRef) {
                    profileRef = resolvedRef;
                    setPaymentProfileRef(resolvedRef);
                }
            }

            if (!nextOrder) {
                if (!profileRef) {
                    throw new Error('seller_payment_profile_missing');
                }
                if (!(price > 0)) {
                    throw new Error('invalid_order_amount');
                }

                const created = await createUnifiedOrder({
                    scene: 'CONTENT_PAYWALL',
                    buyerId,
                    sellerId,
                    paymentProfileId: profileRef,
                    amountCny: price,
                    preferredRail: isDomestic
                        ? (legacyPayment.wechatQr ? 'BYOP_WECHAT' : 'BYOP_ALIPAY')
                        : 'RWAD_ESCROW',
                    policyGroupId,
                    metadata: {
                        targetKey,
                        contentId: content.id,
                        publishCategory: content.publishCategory,
                        purchaseSnapshot: {
                            scene: 'CONTENT_PAYWALL',
                            contentId: content.id,
                            targetKey,
                            publishCategory: content.publishCategory,
                        },
                    },
                    buyerKycTier: 'L1',
                    sellerKycTier: 'L1',
                });
                bindOrderTarget(targetKey, created.orderId);
                saveOrderSnapshot(created);
                setActiveOrder(created);
                nextOrder = created;
                trackPaymentEvent('content_order_created', {
                    contentId: content.id,
                    orderId: created.orderId,
                    amountCny: created.amountCny,
                });
            }

            if (nextOrder.orderState === 'CREATED') {
                const accepted = await acceptUnifiedOrder(nextOrder.orderId, sellerId);
                setActiveOrder(accepted);
                nextOrder = accepted;
            }

            const revealed = await revealPaymentForOrder(nextOrder.orderId, buyerId);
            setRevealedPayment(revealed);
            setActiveOrder(revealed.order);
            if (revealed.paymentProfile.rails.wechatQr) {
                setProofChannel('WECHAT');
            } else if (revealed.paymentProfile.rails.alipayQr) {
                setProofChannel('ALIPAY');
            }
            trackPaymentEvent('content_payment_revealed', {
                contentId: content.id,
                orderId: nextOrder.orderId,
                hasWechatQr: Boolean(revealed.paymentProfile.rails.wechatQr),
                hasAlipayQr: Boolean(revealed.paymentProfile.rails.alipayQr),
            });
        } catch (error) {
            const reason = (error as Error).message;
            const friendly = reason === 'seller_payment_profile_missing'
                ? '卖家暂未配置可用收款方式'
                : reason === 'invalid_order_amount'
                    ? '该内容价格无效，无法创建订单'
                    : '支付流程初始化失败，请稍后重试';
            setOrderError(friendly);
            trackPaymentEvent('content_payment_prepare_failed', {
                contentId: content.id,
                reason,
            });
        } finally {
            setOrderBusy(false);
        }
    }, [
        activeOrder,
        buyerId,
        content.id,
        content.publishCategory,
        contentExtra,
        needsPaywall,
        paymentProfileRef,
        policyGroupId,
        price,
        sellerId,
        targetKey,
        isDomestic,
        legacyPayment.wechatQr,
    ]);

    const refreshProofStatus = useCallback(async (): Promise<void> => {
        if (!activeOrder) {
            return;
        }
        const latest = await getLatestByopProof(activeOrder.orderId).catch(() => null);
        if (!latest) {
            return;
        }
        setActiveOrder(latest.order);
        setProofVerification(latest.verification);
        if (isOrderUnlockReady(latest.order)) {
            setShowPayQr(false);
        }
    }, [activeOrder]);

    const handleOpenPayModal = () => {
        setProofTradeNo('');
        setProofPaidAmountCny(price > 0 ? price.toFixed(2) : '');
        setProofPaidAt(toLocalDateTimeInputValue(new Date()));
        setProofScreenshotDataUrl('');
        setProofVerification(null);
        setShowPayQr(true);
        void preparePaymentFlow();
    };

    const handleProofScreenshotSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            const dataUrl = typeof loadEvent.target?.result === 'string' ? loadEvent.target.result : '';
            setProofScreenshotDataUrl(dataUrl);
        };
        reader.readAsDataURL(file);
    };

    const handleSubmitPaymentProof = async () => {
        if (!activeOrder) {
            setOrderError('订单尚未创建');
            return;
        }
        const tradeNo = proofTradeNo.trim();
        if (!tradeNo) {
            setOrderError('请填写交易号');
            return;
        }
        const paidAmount = Number(proofPaidAmountCny);
        if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
            setOrderError('请填写有效支付金额');
            return;
        }
        const paidAt = new Date(proofPaidAt);
        if (Number.isNaN(paidAt.getTime())) {
            setOrderError('请填写有效支付时间');
            return;
        }

        setOrderBusy(true);
        setOrderError('');
        try {
            const screenshotHash = proofScreenshotDataUrl ? await hashDataUrlSha256(proofScreenshotDataUrl) : undefined;
            const result = await submitByopProof(activeOrder.orderId, buyerId, {
                proofType: 'BYOP_RECEIPT_V1',
                proofRef: tradeNo,
                proofHash: screenshotHash,
                metadata: {
                    channel: proofChannel,
                    tradeNo,
                    paidAmountCny: Number(paidAmount.toFixed(2)),
                    paidAt: paidAt.toISOString(),
                    screenshotDataUrl: proofScreenshotDataUrl || undefined,
                    screenshotHash,
                    purchaseSnapshot: {
                        scene: 'CONTENT_PAYWALL',
                        contentId: content.id,
                        targetKey,
                        publishCategory: content.publishCategory,
                    },
                },
            });
            setActiveOrder(result.order);
            setProofTradeNo('');
            setProofVerification(result.verification);
            const latest = await getLatestByopProof(activeOrder.orderId).catch(() => null);
            if (latest) {
                setActiveOrder(latest.order);
                setProofVerification(latest.verification);
            }
            trackPaymentEvent('content_payment_proof_submitted', {
                contentId: content.id,
                orderId: activeOrder.orderId,
                proofId: result.proof.proofId,
                verificationState: result.verification?.state ?? 'PENDING',
            });
            if (isOrderUnlockReady(result.order)) {
                setShowPayQr(false);
            }
        } catch (error) {
            setOrderError('提交支付凭证失败，请稍后重试');
            trackPaymentEvent('content_payment_proof_failed', {
                contentId: content.id,
                orderId: activeOrder.orderId,
                reason: (error as Error).message,
            });
        } finally {
            setOrderBusy(false);
        }
    };

    const handleDevManualUnlock = () => {
        if (!devManualUnlockEnabled) {
            return;
        }
        const now = new Date().toISOString();
        const baseOrder = activeOrder;
        const manualOrder: UnifiedOrder = baseOrder
            ? {
                ...baseOrder,
                orderState: 'COMPLETED',
                paymentState: 'PAID_VERIFIED',
                updatedAt: now,
            }
            : {
                orderId: `ord_dev_unlock_${Date.now()}`,
                scene: 'CONTENT_PAYWALL',
                buyerId,
                sellerId,
                paymentProfileId: paymentProfileRef ?? 'manual_dev_profile',
                amountCny: price,
                preferredRail: isDomestic ? 'BYOP_WECHAT' : 'RWAD_ESCROW',
                orderState: 'COMPLETED',
                paymentState: 'PAID_VERIFIED',
                policyGroupId,
                metadata: {
                    targetKey,
                    contentId: content.id,
                    devManualUnlock: true,
                },
                createdAt: now,
                updatedAt: now,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
            };

        bindOrderTarget(targetKey, manualOrder.orderId);
        saveOrderSnapshot(manualOrder);
        setActiveOrder(manualOrder);
        setShowPayQr(false);
        trackPaymentEvent('content_manual_unlock', {
            contentId: content.id,
            orderId: manualOrder.orderId,
        });
    };

    // Auto-fullscreen for video content
    useEffect(() => {
        if (contentType === 'video') {
            setIsVideoPlaying(true);
        }
    }, [contentType]);

    useEffect(() => {
        setImageIndex(0);
    }, [content.id]);

    useEffect(() => {
        const snapshot = getOrderSnapshotForTarget(targetKey);
        if (snapshot) {
            setActiveOrder(snapshot);
        }
    }, [targetKey]);

    useEffect(() => {
        if (!activeOrder) {
            return;
        }
        bindOrderTarget(targetKey, activeOrder.orderId);
    }, [activeOrder, targetKey]);

    useEffect(() => {
        if (!showPayQr || !activeOrder) {
            return;
        }
        if (isOrderUnlockReady(activeOrder)) {
            return;
        }
        if (activeOrder.orderState !== 'PAY_PROOF_SUBMITTED' || activeOrder.paymentState !== 'PAID_UNVERIFIED') {
            return;
        }

        let cancelled = false;
        const tick = () => {
            if (!cancelled) {
                void refreshProofStatus();
            }
        };
        tick();
        const timer = window.setInterval(tick, 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [activeOrder, refreshProofStatus, showPayQr]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const onUpdate = (event: Event): void => {
            const detail = (event as CustomEvent<UnifiedOrder>).detail;
            if (!detail || typeof detail !== 'object') {
                return;
            }
            const snapshot = getOrderSnapshotForTarget(targetKey);
            if (!snapshot) {
                return;
            }
            if (!activeOrder || snapshot.orderId === activeOrder.orderId) {
                setActiveOrder(snapshot);
            }
        };

        window.addEventListener('unimaker:payment-order-updated', onUpdate as EventListener);
        return () => {
            window.removeEventListener('unimaker:payment-order-updated', onUpdate as EventListener);
        };
    }, [activeOrder, targetKey]);

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 bg-white z-50 flex flex-col"
            style={{ animation: 'slideInRight 0.3s ease-out' }}
        >
            <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes heartBeat {
          0% { transform: scale(1); }
          25% { transform: scale(1.3); }
          50% { transform: scale(1); }
          75% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        .heart-beat { animation: heartBeat 0.4s ease; }
      `}</style>

            {/* Header — no avatar, just back button + username + follow */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-gray-100 shrink-0 bg-white z-10">
                <button onClick={onClose} className="p-1 text-gray-700 hover:text-gray-900">
                    <ArrowLeft size={22} />
                </button>
                <div className="flex items-center gap-2 flex-1 ml-3">
                    <span className="text-sm font-medium text-gray-900 truncate">{content.userName}</span>
                </div>
                <button
                    onClick={() => setIsFollowed(!isFollowed)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${isFollowed
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-red-500 text-white'
                        }`}
                >
                    {isFollowed ? '已关注' : (
                        <span className="flex items-center gap-0.5"><UserPlus size={12} /> 关注</span>
                    )}
                </button>
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto">
                {/* Media section — only render for video/image/audio with actual media */}
                {contentType === 'video' && content.media ? (
                    <div className="relative w-full bg-black" style={{ minHeight: '50vh' }}>
                        <video
                            ref={videoRef}
                            src={content.media}
                            className="w-full h-full object-contain"
                            autoPlay
                            loop
                            playsInline
                            onClick={handleVideoToggle}
                            style={{ minHeight: '50vh' }}
                        />
                        {/* Video overlay controls */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            {!isVideoPlaying && (
                                <div className="w-16 h-16 bg-white/80 rounded-full flex items-center justify-center shadow-lg">
                                    <Play size={32} className="text-gray-900 ml-1" />
                                </div>
                            )}
                        </div>
                        <div className="absolute bottom-4 right-4 flex gap-2">
                            <button
                                onClick={handleVideoToggle}
                                className="w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white"
                            >
                                {isVideoPlaying ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                            <button
                                onClick={handleFullscreen}
                                className="w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white"
                            >
                                <Maximize2 size={14} />
                            </button>
                        </div>
                    </div>
                ) : contentType === 'image' && images.length > 0 ? (
                    <div className="relative w-full">
                        <ImageWithFallback
                            src={images[imageIndex]}
                            alt={content.content}
                            className="w-full h-auto object-cover"
                            style={{ maxHeight: '60vh' }}
                        />
                        {images.length > 1 && (
                            <>
                                {imageIndex > 0 && (
                                    <button
                                        onClick={() => setImageIndex((prev) => prev - 1)}
                                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center shadow"
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                )}
                                {imageIndex < images.length - 1 && (
                                    <button
                                        onClick={() => setImageIndex((prev) => prev + 1)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center shadow"
                                    >
                                        <ChevronRight size={18} />
                                    </button>
                                )}
                                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                                    {images.map((_, i) => (
                                        <div
                                            key={i}
                                            className={`w-1.5 h-1.5 rounded-full transition-all ${i === imageIndex ? 'bg-white w-4' : 'bg-white/50'
                                                }`}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ) : contentType === 'audio' && content.media ? (
                    <div className="w-full aspect-video bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                        <div className="text-white flex flex-col items-center gap-3">
                            <div className="text-4xl">🎵</div>
                            <p className="text-sm">音频内容</p>
                        </div>
                    </div>
                ) : null}

                {/* Paywall for non-previewable paid content (text/image) */}
                {needsPaywall && contentType !== 'video' && contentType !== 'audio' && (
                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/60 to-white z-10" />
                        <div className="relative z-20 flex flex-col items-center py-12 px-6">
                            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                                <Lock size={28} className="text-amber-600" />
                            </div>
                            <p className="text-lg font-semibold text-gray-800 mb-1">付费内容</p>
                            <p className="text-sm text-gray-500 mb-5">购买后解锁全部内容</p>
                            <button
                                onClick={handleOpenPayModal}
                                className="px-8 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-full shadow-lg hover:shadow-xl transition-all"
                            >
                                ¥{price} 立即解锁
                            </button>
                        </div>
                    </div>
                )}

                {/* Audio/Video preview banner */}
                {needsPaywall && (contentType === 'video' || contentType === 'audio') && (
                    <div className="mx-4 mt-3 p-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                                <Lock size={14} className="text-amber-600" />
                            </div>
                            <div>
                                <p className="text-xs font-medium text-amber-800">{contentType === 'video' ? '试看中' : '试听中'}</p>
                                <p className="text-[10px] text-amber-600">购买后解锁完整内容</p>
                            </div>
                        </div>
                        <button
                            onClick={handleOpenPayModal}
                            className="px-4 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-full shadow hover:bg-amber-600 transition-colors"
                        >
                            ¥{price} 解锁
                        </button>
                    </div>
                )}

                {/* Text content — hidden behind paywall for non-previewable paid content */}
                <div className={`px-4 pt-4 ${needsPaywall && contentType !== 'video' && contentType !== 'audio'
                    ? 'blur-md select-none pointer-events-none max-h-20 overflow-hidden'
                    : ''
                    }`}>
                    <p className="text-[15px] text-gray-900 leading-relaxed whitespace-pre-wrap">
                        {content.content}
                    </p>
                </div>

                {/* Location & Time */}
                <div className="px-4 pb-4 mt-2 flex items-center gap-3 text-xs text-gray-400">
                    <span>{formatTime(content.timestamp)}</span>
                    {locationLabel && (
                        <button
                            type="button"
                            onClick={handleLocationClick}
                            title={t.content_location_openInMap}
                            className="flex items-start gap-0.5 text-blue-500 hover:text-blue-600 transition-colors text-left"
                        >
                            <MapPin size={11} />
                            <span className="break-all leading-tight">{locationLabel}</span>
                        </button>
                    )}
                </div>

                {/* Engagement stats */}
                <div className="px-4 pb-3 flex items-center gap-5 text-xs text-gray-500">
                    <span>{formatNumber(likeCount)} 点赞</span>
                    <span>{comments.length + content.comments} 评论</span>
                </div>

                {/* Divider */}
                <div className="h-2 bg-gray-50" />

                {/* Comments section */}
                <div className="px-4 py-4">
                    <div className="text-sm font-medium text-gray-800 mb-3">评论区</div>
                    {comments.length === 0 ? (
                        <div className="text-center py-8 text-sm text-gray-400">
                            暂无评论，快来抢沙发 🛋️
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {comments.map((comment) => (
                                <div key={comment.id} className="flex gap-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-800">{comment.userName}</span>
                                            <span className="text-xs text-gray-400">{formatCommentTime(comment.timestamp)}</span>
                                        </div>
                                        <p className="text-sm text-gray-600 mt-1">{comment.content}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom action bar — like + report + comment input */}
            <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-2 flex items-center gap-3 safe-area-bottom">
                <div className="flex-1 relative">
                    <input
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={handleCommentKeyDown}
                        placeholder="说点什么..."
                        className="w-full pl-3 pr-10 py-2 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    {commentText && (
                        <button
                            onClick={handleSendComment}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-purple-600"
                        >
                            <Send size={16} />
                        </button>
                    )}
                </div>
                <button
                    onClick={handleLike}
                    className={`flex flex-col items-center gap-0.5 transition-all ${isLiked ? 'heart-beat' : ''}`}
                >
                    <Heart
                        size={22}
                        className={isLiked ? 'text-red-500 fill-red-500' : 'text-gray-500'}
                    />
                    <span className={`text-[10px] ${isLiked ? 'text-red-500' : 'text-gray-500'}`}>
                        {formatNumber(likeCount)}
                    </span>
                </button>
                <button className="flex flex-col items-center gap-0.5">
                    <Flag size={22} className="text-gray-500" />
                    <span className="text-[10px] text-gray-500">举报</span>
                </button>
            </div>

            {/* Payment QR Code Modal */}
            {showPayQr && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setShowPayQr(false)}>
                    <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <h3 className="text-base font-semibold text-gray-800">创建订单并支付 ¥{price}</h3>
                            <button onClick={() => setShowPayQr(false)} className="p-1 rounded-full hover:bg-gray-100 transition-colors">
                                <X size={18} className="text-gray-400" />
                            </button>
                        </div>

                        <div className="px-6 py-5 space-y-4">
                            {activeOrder && (
                                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                    <div>订单号：{activeOrder.orderId}</div>
                                    <div className="mt-1">状态：{activeOrder.orderState} / {activeOrder.paymentState}</div>
                                </div>
                            )}

                            {orderError && (
                                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                    <span>{orderError}</span>
                                </div>
                            )}

                            {isDomestic && sellerWechatQr && (
                                <div className="flex flex-col items-center gap-2">
                                    <p className="text-xs text-gray-500 font-medium">微信收款码</p>
                                    <img src={sellerWechatQr} alt="微信收款码" className="w-44 h-44 rounded-lg border border-gray-200 object-contain" />
                                </div>
                            )}
                            {isDomestic && sellerAlipayQr && (
                                <div className="flex flex-col items-center gap-2">
                                    <p className="text-xs text-gray-500 font-medium">支付宝收款码</p>
                                    <img src={sellerAlipayQr} alt="支付宝收款码" className="w-44 h-44 rounded-lg border border-gray-200 object-contain" />
                                </div>
                            )}
                            {!isDomestic && (
                                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 space-y-2">
                                    <div className="text-xs text-gray-500">境外IP支付方式</div>
                                    <div className="text-sm text-gray-700">
                                        信用卡：{sellerCreditCardEnabled ? '已启用（提交凭证核验）' : '未启用'}
                                    </div>
                                    <div className="text-sm text-gray-700 break-all">
                                        收款钱包：{sellerWalletAddress || '未配置'}
                                    </div>
                                </div>
                            )}
                            {((isDomestic && !sellerWechatQr && !sellerAlipayQr) || (!isDomestic && !sellerCreditCardEnabled && !sellerWalletAddress)) && !orderBusy && (
                                <p className="text-center text-sm text-gray-400 py-2">当前无可展示收款方式</p>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">支付渠道</label>
                                    <select
                                        value={proofChannel}
                                        onChange={(event) => setProofChannel(event.target.value as ByopChannel)}
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                    >
                                        <option value="WECHAT">微信</option>
                                        <option value="ALIPAY">支付宝</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">支付金额(CNY)</label>
                                    <input
                                        value={proofPaidAmountCny}
                                        onChange={(event) => setProofPaidAmountCny(event.target.value)}
                                        placeholder="9.90"
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-500 mb-1">交易号</label>
                                <input
                                    value={proofTradeNo}
                                    onChange={(event) => setProofTradeNo(event.target.value)}
                                    placeholder={isDomestic ? '例如：4200002xxxxxx' : '例如：txn_xxx'}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-500 mb-1">支付时间</label>
                                <input
                                    type="datetime-local"
                                    value={proofPaidAt}
                                    onChange={(event) => setProofPaidAt(event.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs text-gray-500">支付截图（用于自动核验）</label>
                                <input
                                    type="file"
                                    ref={proofScreenshotInputRef}
                                    onChange={handleProofScreenshotSelect}
                                    accept="image/*"
                                    className="hidden"
                                />
                                {proofScreenshotDataUrl ? (
                                    <div className="relative rounded-lg border border-gray-200 bg-white p-2">
                                        <img src={proofScreenshotDataUrl} alt="支付截图" className="w-full h-28 object-contain rounded" />
                                        <button
                                            onClick={() => setProofScreenshotDataUrl('')}
                                            className="absolute right-2 top-2 px-2 py-1 text-xs rounded bg-black/60 text-white"
                                        >
                                            清除
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => proofScreenshotInputRef.current?.click()}
                                        className="w-full py-2.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                                    >
                                        上传支付截图
                                    </button>
                                )}
                            </div>

                            {proofVerification && (
                                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                                    <div>核验状态：{proofVerification.state}</div>
                                    {proofVerification.reasonCodes.length > 0 && (
                                        <div className="mt-1">原因：{proofVerification.reasonCodes.join(', ')}</div>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={() => {
                                    void refreshProofStatus();
                                }}
                                disabled={orderBusy || !activeOrder}
                                className="w-full py-2.5 border border-gray-300 text-gray-700 font-medium rounded-full hover:bg-gray-50 transition-colors disabled:opacity-60"
                            >
                                刷新核验状态
                            </button>

                            <button
                                onClick={() => {
                                    void preparePaymentFlow();
                                }}
                                disabled={orderBusy}
                                className="w-full py-2.5 border border-gray-300 text-gray-700 font-medium rounded-full hover:bg-gray-50 transition-colors disabled:opacity-60"
                            >
                                {orderBusy ? (
                                    <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 初始化支付流程</span>
                                ) : '刷新支付方式'}
                            </button>
                        </div>

                        <div className="px-6 pb-5 space-y-2">
                            <button
                                onClick={() => {
                                    void handleSubmitPaymentProof();
                                }}
                                disabled={orderBusy || !activeOrder}
                                className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-full shadow-lg hover:shadow-xl transition-all disabled:opacity-60"
                            >
                                {orderBusy ? '提交中...' : '已支付，提交凭证'}
                            </button>

                            {devManualUnlockEnabled && (
                                <button
                                    onClick={handleDevManualUnlock}
                                    className="w-full py-2.5 text-xs border border-dashed border-orange-300 text-orange-700 rounded-full hover:bg-orange-50"
                                >
                                    开发模式：直接解锁（仅测试）
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
