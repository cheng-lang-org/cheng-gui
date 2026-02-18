import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
    ChevronLeft, Share2, Heart, ShoppingCart, Star,
    MessageCircle, Store, Truck, Tag, ChevronDown,
    Minus, Plus, X, Headphones, AlertTriangle, Loader2, CheckCircle2,
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import type { EcomProduct, EcomSku } from '../data/ecomData';
import { parseSpecs } from '../data/ecomData';
import { getCurrentPolicyGroupId } from '../utils/region';
import {
    acceptUnifiedOrder,
    createUnifiedOrder,
    ensurePaymentProfileRef,
    extractLegacyPaymentFields,
    getLatestByopProof,
    isOrderUnlockReady,
    resolveActorId,
    resolvePaymentProfileRefFromContentExtra,
    revealPaymentForOrder,
    submitByopProof,
} from '../domain/payment/paymentApi';
import { bindOrderTarget, getOrderSnapshotForTarget, saveOrderSnapshot } from '../domain/payment/orderStore';
import type { ByopChannel, ProofVerification, RevealPaymentResult, UnifiedOrder } from '../domain/payment/types';
import {
    getAlipayQr,
    getCreditCardEnabled,
    getSettlementWalletAddress,
    getWechatQr,
} from '../utils/paymentStore';

interface EcomPaymentContext {
    sellerId: string;
    sellerName?: string;
    sourceContentId?: string;
    extra?: Record<string, unknown>;
}

interface Props {
    product: EcomProduct;
    onBack: () => void;
    paymentContext?: EcomPaymentContext;
}

function normalizePriceCny(sku: EcomSku): number {
    if (typeof sku.finalPrice === 'number' && Number.isFinite(sku.finalPrice) && sku.finalPrice > 0) {
        return Number(sku.finalPrice.toFixed(2));
    }
    const matcher = sku.priceText.match(/([\d]+(?:\.[\d]+)?)/);
    if (matcher) {
        const parsed = Number(matcher[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Number(parsed.toFixed(2));
        }
    }
    return 0;
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

export default function EcomProductDetailPage({ product, onBack, paymentContext }: Props) {
    const [selectedSkuIndex, setSelectedSkuIndex] = useState(0);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [tabIndex, setTabIndex] = useState(0); // 0:宝贝 1:评价 2:图文
    const [quantity, setQuantity] = useState(1);
    const [isFavorite, setIsFavorite] = useState(false);
    const [showSkuSheet, setShowSkuSheet] = useState(false);
    const [showPaySheet, setShowPaySheet] = useState(false);
    const proofScreenshotInputRef = useRef<HTMLInputElement>(null);
    const [activeOrder, setActiveOrder] = useState<UnifiedOrder | null>(null);
    const [revealedPayment, setRevealedPayment] = useState<RevealPaymentResult | null>(null);
    const [paymentProfileRef, setPaymentProfileRef] = useState<string | null>(
        typeof paymentContext?.extra?.paymentProfileRef === 'string' ? paymentContext.extra.paymentProfileRef : null,
    );
    const [proofChannel, setProofChannel] = useState<ByopChannel>('WECHAT');
    const [proofTradeNo, setProofTradeNo] = useState('');
    const [proofPaidAmountCny, setProofPaidAmountCny] = useState('');
    const [proofPaidAt, setProofPaidAt] = useState(toLocalDateTimeInputValue(new Date()));
    const [proofScreenshotDataUrl, setProofScreenshotDataUrl] = useState('');
    const [proofVerification, setProofVerification] = useState<ProofVerification | null>(null);
    const [orderBusy, setOrderBusy] = useState(false);
    const [orderError, setOrderError] = useState('');

    const currentSku = product.skus[selectedSkuIndex] || product.skus[0];
    const policyGroupId = getCurrentPolicyGroupId();
    const isDomestic = policyGroupId === 'CN';
    const buyerId = useMemo(() => resolveActorId(), []);
    const sellerId = paymentContext?.sellerId?.trim() || 'ecom_vendor_default';
    const targetKey = useMemo(
        () => `ecom:${paymentContext?.sourceContentId ?? product.title}`,
        [paymentContext?.sourceContentId, product.title],
    );
    const unitPriceCny = useMemo(() => normalizePriceCny(currentSku), [currentSku]);
    const orderAmountCny = Number((unitPriceCny * quantity).toFixed(2));

    // Build gallery from current SKU
    const gallery = useMemo(() => {
        const imgs: string[] = [];
        if (currentSku.mainImage) imgs.push(currentSku.mainImage);
        for (const img of currentSku.images) {
            if (img && !imgs.includes(img)) imgs.push(img);
        }
        return imgs;
    }, [currentSku]);

    // Price display
    const finalPrice = currentSku.finalPriceUsd || currentSku.priceText;
    const originalPrice = currentSku.originalPriceUsd;
    const soldLabel = currentSku.sold;

    // Fake reviews
    const reviews = useMemo(() =>
        Array.from({ length: 10 }, (_, i) => `用户${i + 1}: 很满意，物流很快！`),
        []
    );

    // Rich images for 图文 tab
    const richImages = useMemo(() => {
        const imgs = currentSku.images.length > 0
            ? currentSku.images
            : product.skus.flatMap(s => s.images).slice(0, 12);
        return imgs.filter(Boolean);
    }, [currentSku, product.skus]);

    const legacyPayment = useMemo(
        () => extractLegacyPaymentFields(paymentContext?.extra),
        [paymentContext?.extra],
    );
    const sellerWechatQr = revealedPayment?.paymentProfile.rails.wechatQr ?? legacyPayment.wechatQr;
    const sellerAlipayQr = revealedPayment?.paymentProfile.rails.alipayQr ?? legacyPayment.alipayQr;
    const sellerWalletAddress = (
        revealedPayment?.paymentProfile.rails.walletAddress
        ?? (typeof paymentContext?.extra?.walletAddress === 'string' ? paymentContext.extra.walletAddress : undefined)
    )?.trim();
    const sellerCreditCardEnabled = Boolean(
        revealedPayment?.paymentProfile.rails.creditCardEnabled
        ?? (typeof paymentContext?.extra?.creditCardEnabled === 'boolean' ? paymentContext.extra.creditCardEnabled : false),
    );
    const isPurchased = isOrderUnlockReady(activeOrder);

    const preparePaymentFlow = useCallback(async () => {
        if (!(orderAmountCny > 0)) {
            setOrderError('商品价格无效，无法创建订单');
            return;
        }
        setOrderBusy(true);
        setOrderError('');

        try {
            let profileRef = paymentProfileRef;
            if (!profileRef) {
                const resolvedRef = await resolvePaymentProfileRefFromContentExtra(paymentContext?.extra, sellerId);
                if (resolvedRef) {
                    profileRef = resolvedRef;
                    setPaymentProfileRef(resolvedRef);
                }
            }
            if (!profileRef) {
                const fallbackRef = await ensurePaymentProfileRef({
                    ownerId: sellerId,
                    policyGroupId,
                    kycTier: 'L2',
                    wechatQr: isDomestic ? (legacyPayment.wechatQr ?? getWechatQr()) : null,
                    alipayQr: isDomestic ? (legacyPayment.alipayQr ?? getAlipayQr()) : null,
                    creditCardEnabled: !isDomestic && (sellerCreditCardEnabled || getCreditCardEnabled()),
                    walletAddress: !isDomestic ? (sellerWalletAddress || getSettlementWalletAddress() || undefined) : undefined,
                });
                if (fallbackRef) {
                    profileRef = fallbackRef;
                    setPaymentProfileRef(fallbackRef);
                }
            }
            if (!profileRef) {
                throw new Error('seller_payment_profile_missing');
            }

            let nextOrder = activeOrder;
            const needNewOrder =
                !nextOrder
                || nextOrder.scene !== 'ECOM_PRODUCT'
                || nextOrder.sellerId !== sellerId
                || nextOrder.amountCny !== orderAmountCny
                || nextOrder.orderState === 'CANCELLED'
                || nextOrder.orderState === 'EXPIRED';

            if (needNewOrder) {
                const created = await createUnifiedOrder({
                    scene: 'ECOM_PRODUCT',
                    buyerId,
                    sellerId,
                    paymentProfileId: profileRef,
                    amountCny: orderAmountCny,
                    preferredRail: isDomestic
                        ? (legacyPayment.wechatQr ? 'BYOP_WECHAT' : 'BYOP_ALIPAY')
                        : 'RWAD_ESCROW',
                    policyGroupId,
                    metadata: {
                        targetKey,
                        sourceContentId: paymentContext?.sourceContentId,
                        productTitle: product.title,
                        skuLabel: currentSku.label,
                        qty: quantity,
                        purchaseSnapshot: {
                            scene: 'ECOM_PRODUCT',
                            productRef: product.title,
                            skuLabel: currentSku.label,
                            qty: quantity,
                            targetKey,
                            sourceContentId: paymentContext?.sourceContentId,
                        },
                    },
                    buyerKycTier: 'L1',
                    sellerKycTier: 'L2',
                });
                bindOrderTarget(targetKey, created.orderId);
                saveOrderSnapshot(created);
                setActiveOrder(created);
                nextOrder = created;
            }
            if (!nextOrder) {
                throw new Error('order_create_failed');
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
        } catch (error) {
            const reason = (error as Error).message;
            if (reason === 'seller_payment_profile_missing') {
                setOrderError('卖家暂未配置可用收款方式');
            } else {
                setOrderError('支付流程初始化失败，请稍后重试');
            }
        } finally {
            setOrderBusy(false);
        }
    }, [
        activeOrder,
        buyerId,
        currentSku.label,
        isDomestic,
        legacyPayment.alipayQr,
        legacyPayment.wechatQr,
        orderAmountCny,
        paymentContext?.extra,
        paymentContext?.sourceContentId,
        paymentProfileRef,
        policyGroupId,
        product.title,
        quantity,
        sellerId,
        sellerCreditCardEnabled,
        sellerWalletAddress,
        targetKey,
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
            setShowPaySheet(false);
        }
    }, [activeOrder]);

    const openCheckout = (): void => {
        setProofTradeNo('');
        setProofPaidAmountCny(orderAmountCny.toFixed(2));
        setProofPaidAt(toLocalDateTimeInputValue(new Date()));
        setProofScreenshotDataUrl('');
        setProofVerification(null);
        setShowPaySheet(true);
        const cached = getOrderSnapshotForTarget(targetKey);
        if (cached) {
            setActiveOrder(cached);
        }
        void preparePaymentFlow();
    };

    const handleProofScreenshotSelect = (event: React.ChangeEvent<HTMLInputElement>): void => {
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

    const handleSubmitProof = async (): Promise<void> => {
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
                        scene: 'ECOM_PRODUCT',
                        productRef: product.title,
                        skuLabel: currentSku.label,
                        qty: quantity,
                        targetKey,
                        sourceContentId: paymentContext?.sourceContentId,
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
                if (isOrderUnlockReady(latest.order)) {
                    setShowPaySheet(false);
                }
            }
        } catch {
            setOrderError('提交支付凭证失败，请稍后重试');
        } finally {
            setOrderBusy(false);
        }
    };

    useEffect(() => {
        if (!showPaySheet || !activeOrder) {
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
    }, [activeOrder, refreshProofStatus, showPaySheet]);

    // ── Hero Image Carousel ──────────────────────────────────────
    const renderHeroCarousel = () => (
        <div className="relative bg-gray-100">
            <div className="aspect-square overflow-hidden">
                <ImageWithFallback
                    src={gallery[currentImageIndex] || product.coverImage}
                    alt={product.title}
                    className="w-full h-full object-cover"
                />
            </div>
            {/* Dots */}
            {gallery.length > 1 && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                    {gallery.map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => setCurrentImageIndex(idx)}
                            className={`w-2 h-2 rounded-full transition-all ${idx === currentImageIndex ? 'bg-white scale-125' : 'bg-white/50'
                                }`}
                        />
                    ))}
                </div>
            )}
            {/* Top nav */}
            <div className="absolute top-3 left-3 right-3 flex justify-between">
                <button
                    onClick={onBack}
                    className="w-9 h-9 bg-black/30 backdrop-blur-sm rounded-full flex items-center justify-center text-white"
                >
                    <ChevronLeft size={22} />
                </button>
                <button className="w-9 h-9 bg-black/30 backdrop-blur-sm rounded-full flex items-center justify-center text-white">
                    <Share2 size={18} />
                </button>
            </div>
            {/* Counter */}
            <div className="absolute bottom-3 right-3 bg-black/40 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-full">
                {currentImageIndex + 1}/{gallery.length}
            </div>
        </div>
    );

    // ── SKU Thumbnail Row (one per SKU, clicking switches SKU) ───
    const renderThumbnailRow = () => {
        if (product.skus.length <= 1) return null;
        return (
            <div className="flex gap-2 overflow-x-auto py-2 px-4 scrollbar-hide">
                {product.skus.map((sku, idx) => {
                    const thumb = sku.mainImage || sku.images[0] || product.coverImage;
                    const isSelected = idx === selectedSkuIndex;
                    const price = sku.finalPriceUsd || sku.priceText || '';
                    return (
                        <button
                            key={idx}
                            onClick={() => {
                                setSelectedSkuIndex(idx);
                                setCurrentImageIndex(0);
                            }}
                            className={`flex-shrink-0 w-16 rounded-lg overflow-hidden border-2 transition-colors flex flex-col items-center ${isSelected ? 'border-red-500' : 'border-transparent'
                                }`}
                        >
                            <ImageWithFallback src={thumb} alt="" className="w-16 h-16 object-cover" />
                            <span className={`text-[10px] leading-tight truncate w-full text-center px-0.5 py-0.5 ${isSelected ? 'text-red-500 font-semibold' : 'text-gray-500'
                                }`}>{price}</span>
                        </button>
                    );
                })}
            </div>
        );
    };

    // ── Price Section ────────────────────────────────────────────
    const renderPriceSection = () => (
        <div className="bg-white px-4 py-3">
            {/* Small price + title above fold */}
            <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs text-red-500">券后</span>
                <span className="text-2xl font-bold text-red-500">{finalPrice}</span>
                {originalPrice && (
                    <span className="text-sm text-gray-400 line-through">{originalPrice}</span>
                )}
                {soldLabel && (
                    <span className="text-xs text-gray-400 ml-auto">已售 {soldLabel}</span>
                )}
            </div>
            <h1 className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
                {product.title}
            </h1>
        </div>
    );

    // ── Quantity Row ─────────────────────────────────────────────
    const renderQuantityRow = () => (
        <div className="bg-white px-4 py-2 flex items-center justify-between border-t border-gray-50">
            <div className="flex items-baseline gap-2">
                <span className="text-xs text-red-500">券后</span>
                <span className="text-xl font-bold text-red-500">{finalPrice}</span>
                {originalPrice && (
                    <span className="text-xs text-gray-400 line-through">{originalPrice}</span>
                )}
                {soldLabel && (
                    <span className="text-xs text-gray-400">已售 {soldLabel}</span>
                )}
            </div>
            <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">数量</span>
                <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center"
                >
                    <Minus size={14} />
                </button>
                <span className="w-6 text-center text-sm">{quantity}</span>
                <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center"
                >
                    <Plus size={14} />
                </button>
            </div>
        </div>
    );

    // ── SKU Selector Row ─────────────────────────────────────────
    const renderSkuSelectorRow = () => (
        <button
            onClick={() => setShowSkuSheet(true)}
            className="bg-white px-4 py-3 mt-2 flex items-center justify-between w-full text-left shadow-sm rounded-lg"
        >
            <div>
                <span className="text-xs text-gray-400">已选</span>
                <span className="text-sm ml-2 text-gray-800 line-clamp-1">
                    {currentSku.label || '选择 规格与口味'} ×{quantity}
                </span>
            </div>
            <span className="text-sm text-purple-500 flex-shrink-0">选择规格 ›</span>
        </button>
    );

    // ── Promo Banner ─────────────────────────────────────────────
    const renderPromoBanner = () => (
        <div className="mx-4 mt-3 rounded-xl bg-gradient-to-r from-red-500 to-red-600 p-3 text-white shadow-lg">
            <div className="flex justify-between items-center">
                <div>
                    <div className="text-lg font-bold">券后 {finalPrice}</div>
                    <div className="text-xs opacity-90">优惠前 {originalPrice || '—'}</div>
                </div>
                <div className="text-right">
                    <div className="text-xs">最后3天</div>
                    <div className="text-xs">已售 {soldLabel || '400+'}</div>
                </div>
            </div>
            <div className="mt-2">
                <span className="inline-block px-3 py-0.5 bg-red-700 rounded-full text-xs">
                    官方立减12%
                </span>
            </div>
        </div>
    );

    // ── Delivery Row ─────────────────────────────────────────────
    const renderDeliveryRow = () => (
        <div className="mx-4 mt-3 bg-white rounded-xl shadow-sm p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Truck size={18} className="text-purple-500 flex-shrink-0" />
                <div>
                    <div className="text-sm font-medium">配送至</div>
                    <div className="text-xs text-gray-500">广东省深圳市南山区</div>
                    <div className="text-xs text-gray-400 italic">快递 免运费</div>
                </div>
            </div>
            <span className="text-sm text-purple-500">选择</span>
        </div>
    );

    // ── Params Section ───────────────────────────────────────────
    const renderParamsSection = () => (
        <div className="mx-4 mt-3 bg-white rounded-xl shadow-sm p-3">
            <div className="flex items-center gap-2 mb-2">
                <Tag size={16} className="text-purple-500" />
                <span className="text-sm font-medium">商品参数</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {[['品牌', '通用'], ['产地', '中国'], ['包装', '瓶装']].map(([k, v]) => (
                    <div key={k}>
                        <div className="text-xs text-gray-400">{k}</div>
                        <div className="text-xs text-gray-700">{v}</div>
                    </div>
                ))}
            </div>
        </div>
    );

    // ── Tab Content ──────────────────────────────────────────────
    const renderTabContent = () => {
        if (tabIndex === 1) {
            // 评价
            return (
                <div className="space-y-3 px-4 py-3">
                    {reviews.map((rv, i) => (
                        <div key={i} className="bg-white rounded-xl shadow-sm p-3">
                            <p className="text-sm text-gray-700">{rv}</p>
                        </div>
                    ))}
                </div>
            );
        }
        if (tabIndex === 2) {
            // 图文
            if (richImages.length === 0) {
                return (
                    <div className="flex items-center justify-center h-40 text-gray-400">暂无图文</div>
                );
            }
            return (
                <div className="space-y-3 px-4 py-3">
                    {richImages.map((img, i) => (
                        <ImageWithFallback
                            key={i}
                            src={img}
                            alt={`详情图${i + 1}`}
                            className="w-full rounded-xl"
                        />
                    ))}
                </div>
            );
        }
        // 宝贝 (default)
        return (
            <div>
                {renderPriceSection()}
                {renderThumbnailRow()}
                {renderQuantityRow()}
                {renderSkuSelectorRow()}
                {renderPromoBanner()}
                {renderDeliveryRow()}
                {renderParamsSection()}
                <div className="h-4" />
            </div>
        );
    };

    // ── Tab Bar (Sticky) ─────────────────────────────────────────
    const tabs = ['宝贝', '评价', '图文'];

    // ── Bottom Buy Bar ───────────────────────────────────────────
    const renderBottomBar = () => (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-3 py-2 flex items-center gap-2 z-30"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
        >
            {/* Left icons */}
            <div className="flex items-center gap-3">
                <button className="flex flex-col items-center gap-0.5">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                        <Headphones size={20} className="text-gray-500" />
                    </div>
                    <span className="text-[10px] text-gray-500">客服</span>
                </button>
                <button className="flex flex-col items-center gap-0.5">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                        <Store size={20} className="text-gray-500" />
                    </div>
                    <span className="text-[10px] text-gray-500">店铺</span>
                </button>
                <button
                    onClick={() => setIsFavorite(!isFavorite)}
                    className="flex flex-col items-center gap-0.5"
                >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isFavorite ? 'bg-purple-50' : 'bg-gray-100'
                        }`}>
                        <Heart
                            size={20}
                            className={isFavorite ? 'text-red-500 fill-red-500' : 'text-gray-500'}
                        />
                    </div>
                    <span className={`text-[10px] ${isFavorite ? 'text-red-500' : 'text-gray-500'}`}>
                        {isFavorite ? '已收藏' : '收藏'}
                    </span>
                </button>
                <button className="flex flex-col items-center gap-0.5">
                    <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center">
                        <ShoppingCart size={20} className="text-purple-500" />
                    </div>
                    <span className="text-[10px] text-purple-500">加购</span>
                </button>
            </div>
            {/* Buy button */}
            <button
                onClick={openCheckout}
                className="flex-1 ml-2 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-full font-medium text-sm shadow-lg"
            >
                {isPurchased ? '已购买' : '立即购买'}
            </button>
        </div>
    );

    // ── SKU Bottom Sheet ─────────────────────────────────────────
    const renderSkuSheet = () => {
        if (!showSkuSheet) return null;

        return (
            <div className="fixed inset-0 z-50 flex flex-col justify-end">
                <div className="absolute inset-0 bg-black/50" onClick={() => setShowSkuSheet(false)} />
                <div className="relative bg-white rounded-t-2xl max-h-[80vh] overflow-hidden animate-slide-up">
                    {/* Header */}
                    <div className="p-4 border-b border-gray-100 flex items-start gap-3">
                        <ImageWithFallback
                            src={currentSku.mainImage || product.coverImage}
                            alt=""
                            className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-400">已选</div>
                            <div className="text-sm text-gray-800 line-clamp-2 mt-0.5">{currentSku.label}</div>
                            <div className="mt-1">
                                <span className="text-lg font-bold text-red-500">{finalPrice}</span>
                                {originalPrice && (
                                    <span className="text-xs text-gray-400 line-through ml-2">{originalPrice}</span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setShowSkuSheet(false)}
                            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0"
                        >
                            <X size={16} className="text-gray-500" />
                        </button>
                    </div>

                    {/* Spec chips */}
                    <div className="p-4 overflow-y-auto max-h-[50vh]">
                        {/* Delivery row */}
                        <div className="flex items-center gap-2 mb-4 text-sm text-gray-600">
                            <Truck size={16} className="text-purple-500" />
                            <span className="truncate">广东省深圳市 | 包邮 预计后天送达</span>
                        </div>

                        {Object.entries(product.specUniverse).map(([key, values]) => (
                            <div key={key} className="mb-5">
                                <div className="text-sm font-medium mb-2">{key}</div>
                                <div className="flex flex-wrap gap-2">
                                    {values.map((value) => {
                                        // Find which SKU matches
                                        const matchIdx = product.skus.findIndex(s => {
                                            const specs = parseSpecs(s.label);
                                            return specs[key] === value;
                                        });
                                        const isSelected = matchIdx === selectedSkuIndex;
                                        return (
                                            <button
                                                key={value}
                                                onClick={() => {
                                                    if (matchIdx >= 0) {
                                                        setSelectedSkuIndex(matchIdx);
                                                        setCurrentImageIndex(0);
                                                    }
                                                }}
                                                className={`px-3 py-1.5 rounded-full text-sm transition-all ${isSelected
                                                    ? 'bg-purple-100 text-purple-600 ring-2 ring-purple-400'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {value}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        {/* Quantity in sheet */}
                        <div className="flex items-center justify-between py-3 border-t border-gray-100">
                            <span className="text-sm font-medium">数量</span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center"
                                >
                                    -
                                </button>
                                <span className="w-8 text-center">{quantity}</span>
                                <button
                                    onClick={() => setQuantity(quantity + 1)}
                                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center"
                                >
                                    +
                                </button>
                                <span className="text-sm text-gray-400 ml-2">有货</span>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-gray-100 flex gap-3">
                        <button
                            onClick={() => setShowSkuSheet(false)}
                            className="flex-1 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-full font-medium"
                        >
                            加入购物车
                        </button>
                        <button
                            onClick={() => {
                                setShowSkuSheet(false);
                                openCheckout();
                            }}
                            className="flex-1 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-full font-medium"
                        >
                            领券购买
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderPaymentSheet = () => {
        if (!showPaySheet) {
            return null;
        }
        return (
            <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-5" onClick={() => setShowPaySheet(false)}>
                <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <h3 className="text-base font-semibold text-gray-800">
                            创建订单并支付 ¥{orderAmountCny.toFixed(2)}
                        </h3>
                        <button onClick={() => setShowPaySheet(false)} className="p-1 rounded-full hover:bg-gray-100 transition-colors">
                            <X size={18} className="text-gray-400" />
                        </button>
                    </div>
                    <div className="px-5 py-4 space-y-3">
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
                                <div className="text-xs text-gray-500">微信收款码</div>
                                <img src={sellerWechatQr} alt="微信收款码" className="w-40 h-40 rounded-lg border border-gray-200 object-contain" />
                            </div>
                        )}
                        {isDomestic && sellerAlipayQr && (
                            <div className="flex flex-col items-center gap-2">
                                <div className="text-xs text-gray-500">支付宝收款码</div>
                                <img src={sellerAlipayQr} alt="支付宝收款码" className="w-40 h-40 rounded-lg border border-gray-200 object-contain" />
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
                        {((isDomestic && !sellerWechatQr && !sellerAlipayQr) || (!isDomestic && !sellerCreditCardEnabled && !sellerWalletAddress)) && (
                            <div className="text-sm text-gray-400 text-center py-1">当前无可展示收款方式</div>
                        )}
                        {isPurchased && (
                            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 flex items-center gap-2">
                                <CheckCircle2 size={14} />
                                <span>支付已核验通过，等待卖家发货/确认</span>
                            </div>
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
                                    placeholder={orderAmountCny.toFixed(2)}
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
                                    <img src={proofScreenshotDataUrl} alt="支付截图" className="w-full h-24 object-contain rounded" />
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
                                void preparePaymentFlow();
                            }}
                            disabled={orderBusy}
                            className="w-full py-2.5 border border-gray-300 text-gray-700 font-medium rounded-full hover:bg-gray-50 transition-colors disabled:opacity-60"
                        >
                            {orderBusy ? (
                                <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 初始化支付流程</span>
                            ) : '刷新支付方式'}
                        </button>
                        <button
                            onClick={() => {
                                void refreshProofStatus();
                            }}
                            disabled={orderBusy || !activeOrder}
                            className="w-full py-2.5 border border-gray-300 text-gray-700 font-medium rounded-full hover:bg-gray-50 transition-colors disabled:opacity-60"
                        >
                            刷新核验状态
                        </button>
                    </div>
                    <div className="px-5 pb-4">
                        <button
                            onClick={() => {
                                void handleSubmitProof();
                            }}
                            disabled={orderBusy || !activeOrder || isPurchased}
                            className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-full shadow-lg hover:shadow-xl transition-all disabled:opacity-60"
                        >
                            {orderBusy ? '提交中...' : isPurchased ? '已提交凭证' : '已支付，提交凭证'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-40 bg-gray-50 flex flex-col">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto pb-24">
                {renderHeroCarousel()}

                {/* Sticky Tabs */}
                <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
                    <div className="flex">
                        {tabs.map((tab, i) => (
                            <button
                                key={tab}
                                onClick={() => setTabIndex(i)}
                                className={`flex-1 py-3 text-sm font-medium text-center transition-colors relative ${tabIndex === i ? 'text-red-500' : 'text-gray-600'
                                    }`}
                            >
                                {tab}
                                {tabIndex === i && (
                                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-red-500 rounded-full" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {renderTabContent()}
            </div>

            {renderBottomBar()}
            {renderSkuSheet()}
            {renderPaymentSheet()}
        </div>
    );
}
