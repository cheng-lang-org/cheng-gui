import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, Star, X, AlertTriangle, Loader2, CheckCircle2, MessageSquarePlus, MessageSquareX } from 'lucide-react';
import { getCurrentPolicyGroupId } from '../utils/region';
import {
    acceptUnifiedOrder,
    createUnifiedOrder,
    ensurePaymentProfileRef,
    getLatestByopProof,
    getUnifiedOrder,
    isOrderUnlockReady,
    resolveActorId,
    revealPaymentForOrder,
    submitByopProof,
} from '../domain/payment/paymentApi';
import { bindOrderTarget, getOrderSnapshotForTarget, saveOrderSnapshot } from '../domain/payment/orderStore';
import type { ByopChannel, ProofVerification, RevealPaymentResult, UnifiedOrder } from '../domain/payment/types';
import { getAppEntitlements, grantAppEntitlement, revokeAppEntitlement } from '../domain/payment/entitlementStore';
import { mockApps, type App } from '../data/appList';
import { addSocialApp, getSocialApps, isSocialApp, removeSocialApp } from '../data/appStore';
import ByopReviewConsole from './ByopReviewConsole';

const categories = ['全部', '命理', '娱乐', '游戏', '工具', '金融'];
const APP_TARGET_PREFIX = 'app_item:';

interface AppMarketplaceProps {
    onBack: () => void;
    onOpenApp?: (appId: string) => void;
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

export default function AppMarketplace({ onBack, onOpenApp }: AppMarketplaceProps) {
    const [selectedCategory, setSelectedCategory] = useState('全部');
    const [searchQuery, setSearchQuery] = useState('');
    const [apps, setApps] = useState<App[]>(mockApps);
    const [entitlements, setEntitlements] = useState(() => getAppEntitlements());
    const [selectedApp, setSelectedApp] = useState<App | null>(null);
    const [showPaySheet, setShowPaySheet] = useState(false);
    const [activeOrder, setActiveOrder] = useState<UnifiedOrder | null>(null);
    const [revealedPayment, setRevealedPayment] = useState<RevealPaymentResult | null>(null);
    const [paymentProfileRef, setPaymentProfileRef] = useState<string | null>(null);
    const [proofChannel, setProofChannel] = useState<ByopChannel>('WECHAT');
    const [proofTradeNo, setProofTradeNo] = useState('');
    const [proofPaidAmountCny, setProofPaidAmountCny] = useState('');
    const [proofPaidAt, setProofPaidAt] = useState(toLocalDateTimeInputValue(new Date()));
    const [proofScreenshotDataUrl, setProofScreenshotDataUrl] = useState('');
    const [proofVerification, setProofVerification] = useState<ProofVerification | null>(null);
    const [orderBusy, setOrderBusy] = useState(false);
    const [orderError, setOrderError] = useState('');
    const proofScreenshotInputRef = useRef<HTMLInputElement>(null);
    const [showReviewConsole, setShowReviewConsole] = useState(false);

    const [socialApps, setSocialApps] = useState<string[]>([]);

    const buyerId = useMemo(() => resolveActorId(), []);
    const policyGroupId = getCurrentPolicyGroupId();
    const isDomestic = policyGroupId === 'CN';

    useEffect(() => {
        setSocialApps(getSocialApps());
    }, []);

    const selectedTargetKey = useMemo(
        () => (selectedApp ? `${APP_TARGET_PREFIX}${selectedApp.id}` : ''),
        [selectedApp],
    );

    useEffect(() => {
        if (!selectedTargetKey) {
            setActiveOrder(null);
            return;
        }
        setActiveOrder(getOrderSnapshotForTarget(selectedTargetKey));
    }, [selectedTargetKey]);

    useEffect(() => {
        if (!selectedApp) {
            setPaymentProfileRef(null);
            return;
        }
        setPaymentProfileRef(null);
    }, [selectedApp]);

    useEffect(() => {
        let disposed = false;
        const run = async (): Promise<void> => {
            const entries = Object.entries(entitlements);
            let changed = false;
            for (const [appId, entitlement] of entries) {
                try {
                    const order = await getUnifiedOrder(entitlement.orderId);
                    if (!isOrderUnlockReady(order)) {
                        revokeAppEntitlement(appId);
                        changed = true;
                    }
                } catch {
                    // Keep local entitlement on transient gateway errors.
                }
                if (disposed) {
                    return;
                }
            }
            if (changed && !disposed) {
                setEntitlements(getAppEntitlements());
            }
        };
        void run();
        return () => {
            disposed = true;
        };
    }, []);

    const filteredApps = apps.filter((app) => {
        const matchesCategory = selectedCategory === '全部' || app.category === selectedCategory;
        const matchesSearch = !searchQuery
            || app.name.toLowerCase().includes(searchQuery.toLowerCase())
            || app.description.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    const selectedWechatQr = revealedPayment?.paymentProfile.rails.wechatQr ?? selectedApp?.wechatQr;
    const selectedAlipayQr = revealedPayment?.paymentProfile.rails.alipayQr ?? selectedApp?.alipayQr;
    const selectedWalletAddress = (
        revealedPayment?.paymentProfile.rails.walletAddress
        ?? selectedApp?.walletAddress
    )?.trim();
    const selectedCreditCardEnabled = Boolean(
        revealedPayment?.paymentProfile.rails.creditCardEnabled
        ?? selectedApp?.creditCardEnabled,
    );

    const selectedPriceCny = typeof selectedApp?.price === 'number' && Number.isFinite(selectedApp.price)
        ? Number(selectedApp.price.toFixed(2))
        : 0;

    const appUnlocked = useCallback((app: App): boolean => {
        if (app.price === 'free') {
            return true;
        }
        if (app.isInstalled) {
            return true;
        }
        return Boolean(entitlements[app.id]);
    }, [entitlements]);

    const ensureProfileForApp = useCallback(async (app: App): Promise<string | null> => {
        if (paymentProfileRef) {
            return paymentProfileRef;
        }
        const profileId = await ensurePaymentProfileRef({
            ownerId: app.sellerId ?? `vendor_${app.id}`,
            policyGroupId,
            kycTier: 'L2',
            wechatQr: isDomestic ? app.wechatQr ?? null : null,
            alipayQr: isDomestic ? app.alipayQr ?? null : null,
            creditCardEnabled: !isDomestic && Boolean(app.creditCardEnabled),
            walletAddress: !isDomestic ? app.walletAddress : undefined,
        });
        if (profileId) {
            setPaymentProfileRef(profileId);
        }
        return profileId;
    }, [isDomestic, paymentProfileRef, policyGroupId]);

    const preparePaymentFlow = useCallback(async (app: App): Promise<void> => {
        if (app.price === 'free') {
            return;
        }
        const amount = typeof app.price === 'number' ? Number(app.price.toFixed(2)) : 0;
        if (!(amount > 0)) {
            setOrderError('应用价格无效，无法创建订单');
            return;
        }

        setOrderBusy(true);
        setOrderError('');
        try {
            let profileRef = paymentProfileRef;
            if (!profileRef) {
                const resolved = await ensureProfileForApp(app);
                if (resolved) {
                    profileRef = resolved;
                }
            }
            if (!profileRef) {
                throw new Error('seller_payment_profile_missing');
            }

            const targetKey = `${APP_TARGET_PREFIX}${app.id}`;
            const currentOrderAppId = activeOrder && typeof activeOrder.metadata.appId === 'string'
                ? activeOrder.metadata.appId
                : '';
            let nextOrder = activeOrder;
            const needNewOrder = (
                !nextOrder
                || nextOrder.scene !== 'APP_ITEM'
                || currentOrderAppId !== app.id
                || nextOrder.amountCny !== amount
                || nextOrder.orderState === 'CANCELLED'
                || nextOrder.orderState === 'EXPIRED'
            );

            if (needNewOrder) {
                const created = await createUnifiedOrder({
                    scene: 'APP_ITEM',
                    buyerId,
                    sellerId: app.sellerId ?? `vendor_${app.id}`,
                    paymentProfileId: profileRef,
                    amountCny: amount,
                    preferredRail: isDomestic
                        ? (app.wechatQr ? 'BYOP_WECHAT' : 'BYOP_ALIPAY')
                        : 'RWAD_ESCROW',
                    policyGroupId,
                    metadata: {
                        targetKey,
                        appId: app.id,
                        appName: app.name,
                        purchaseSnapshot: {
                            scene: 'APP_ITEM',
                            appId: app.id,
                            appName: app.name,
                            targetKey,
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
                const accepted = await acceptUnifiedOrder(nextOrder.orderId, app.sellerId ?? `vendor_${app.id}`);
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
    }, [activeOrder, buyerId, ensureProfileForApp, isDomestic, paymentProfileRef, policyGroupId]);

    const refreshOrderStatus = async (): Promise<void> => {
        if (!activeOrder) {
            return;
        }
        setOrderBusy(true);
        setOrderError('');
        try {
            const nextOrder = await getUnifiedOrder(activeOrder.orderId);
            setActiveOrder(nextOrder);
            const latest = await getLatestByopProof(activeOrder.orderId).catch(() => null);
            if (latest) {
                setActiveOrder(latest.order);
                setProofVerification(latest.verification);
                if (selectedApp && isOrderUnlockReady(latest.order)) {
                    grantAppEntitlement(selectedApp.id, latest.order.orderId);
                    setEntitlements(getAppEntitlements());
                    setShowPaySheet(false);
                }
            }
        } catch {
            setOrderError('刷新订单状态失败，请稍后重试');
        } finally {
            setOrderBusy(false);
        }
    };

    const pollProofStatus = useCallback(async (): Promise<void> => {
        if (!activeOrder) {
            return;
        }
        const latest = await getLatestByopProof(activeOrder.orderId).catch(() => null);
        if (!latest) {
            return;
        }
        setActiveOrder(latest.order);
        setProofVerification(latest.verification);
        if (selectedApp && isOrderUnlockReady(latest.order)) {
            grantAppEntitlement(selectedApp.id, latest.order.orderId);
            setEntitlements(getAppEntitlements());
            setShowPaySheet(false);
        }
    }, [activeOrder, selectedApp]);

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
                void pollProofStatus();
            }
        };
        tick();
        const timer = window.setInterval(tick, 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [activeOrder, pollProofStatus, showPaySheet]);

    const openCheckout = (app: App): void => {
        setSelectedApp(app);
        setRevealedPayment(null);
        setProofTradeNo('');
        setProofPaidAmountCny(typeof app.price === 'number' ? app.price.toFixed(2) : '');
        setProofPaidAt(toLocalDateTimeInputValue(new Date()));
        setProofScreenshotDataUrl('');
        setProofVerification(null);
        setOrderError('');
        setShowPaySheet(true);
        const targetKey = `${APP_TARGET_PREFIX}${app.id}`;
        const cached = getOrderSnapshotForTarget(targetKey);
        if (cached) {
            setActiveOrder(cached);
        }
        void preparePaymentFlow(app);
    };

    const handleOpenApp = (app: App): void => {
        if (appUnlocked(app)) {
            onOpenApp?.(app.id);
            return;
        }
        openCheckout(app);
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

    const handleSubmitProof = async (): Promise<void> => {
        if (!selectedApp) {
            setOrderError('应用信息缺失');
            return;
        }
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
                        scene: 'APP_ITEM',
                        appId: selectedApp.id,
                        appName: selectedApp.name,
                        targetKey: selectedTargetKey,
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
                    grantAppEntitlement(selectedApp.id, latest.order.orderId);
                    setEntitlements(getAppEntitlements());
                    setShowPaySheet(false);
                }
            }
        } catch {
            setOrderError('提交支付凭证失败，请稍后重试');
        } finally {
            setOrderBusy(false);
        }
    };

    const toggleSocialApp = (e: React.MouseEvent, app: App) => {
        e.stopPropagation();
        if (isSocialApp(app.id)) {
            removeSocialApp(app.id);
            setSocialApps((prev) => prev.filter((id) => id !== app.id));
        } else {
            addSocialApp(app.id);
            setSocialApps((prev) => [...prev, app.id]);
        }
    };

    const renderPaymentSheet = () => {
        if (!showPaySheet || !selectedApp || selectedApp.price === 'free') {
            return null;
        }
        return (
            <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-5" onClick={() => setShowPaySheet(false)}>
                <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <h3 className="text-base font-semibold text-gray-800">
                            购买 {selectedApp.name} · ¥{selectedPriceCny.toFixed(2)}
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

                        {isDomestic && selectedWechatQr && (
                            <div className="flex flex-col items-center gap-2">
                                <div className="text-xs text-gray-500">微信收款码</div>
                                <img src={selectedWechatQr} alt="微信收款码" className="w-40 h-40 rounded-lg border border-gray-200 object-contain" />
                            </div>
                        )}
                        {isDomestic && selectedAlipayQr && (
                            <div className="flex flex-col items-center gap-2">
                                <div className="text-xs text-gray-500">支付宝收款码</div>
                                <img src={selectedAlipayQr} alt="支付宝收款码" className="w-40 h-40 rounded-lg border border-gray-200 object-contain" />
                            </div>
                        )}
                        {!isDomestic && (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 space-y-2">
                                <div className="text-xs text-gray-500">境外IP支付方式</div>
                                <div className="text-sm text-gray-700">信用卡：{selectedCreditCardEnabled ? '已启用（提交凭证核验）' : '未启用'}</div>
                                <div className="text-sm text-gray-700 break-all">收款钱包：{selectedWalletAddress || '未配置'}</div>
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
                                    placeholder={selectedPriceCny.toFixed(2)}
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
                                void preparePaymentFlow(selectedApp);
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
                                void refreshOrderStatus();
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
                            disabled={orderBusy || !activeOrder || appUnlocked(selectedApp)}
                            className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-full shadow-lg hover:shadow-xl transition-all disabled:opacity-60"
                        >
                            {orderBusy ? '提交中...' : appUnlocked(selectedApp) ? '已解锁' : '已支付，提交凭证'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col bg-gray-50">
            <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
                <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded-full">
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-xl font-semibold flex-1">应用市场</h1>
                <button
                    onClick={() => setShowReviewConsole(true)}
                    className="px-3 py-1.5 text-xs rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                    支付核验台
                </button>
            </header>

            <div className="bg-white px-4 py-3 border-b border-gray-200">
                <div className="relative">
                    <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索应用..."
                        className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                </div>
            </div>

            <div className="bg-white px-4 py-3 border-b border-gray-200 flex gap-2 overflow-x-auto">
                {categories.map((cat) => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${selectedCategory === cat
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {filteredApps.map((app) => {
                    const isAdded = socialApps.includes(app.id);
                    const unlocked = appUnlocked(app);
                    return (
                        <div
                            key={app.id}
                            onClick={() => handleOpenApp(app)}
                            className="w-full bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer active:scale-[0.99] transition-transform"
                        >
                            <div className="flex items-center gap-4 justify-between">
                                <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0">
                                    {app.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-gray-900 mb-0.5">{app.name}</h3>
                                    <p className="text-xs text-gray-500 mb-1.5 truncate">{app.description}</p>
                                    <div className="flex items-center gap-4 text-xs text-gray-400">
                                        <span className="flex items-center gap-1">
                                            <Star size={10} className="text-yellow-500 fill-yellow-500" />
                                            {app.rating}
                                        </span>
                                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                                            {app.category}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded ${unlocked ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {app.price === 'free' ? '免费' : unlocked ? '已解锁' : `¥${Number(app.price).toFixed(2)}`}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    onClick={(e) => toggleSocialApp(e, app)}
                                    className={`p-2 rounded-full transition-colors ${isAdded
                                        ? 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                    title={isAdded ? '从社交面板移除' : '添加到社交面板'}
                                >
                                    {isAdded ? <MessageSquareX size={20} /> : <MessageSquarePlus size={20} />}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {renderPaymentSheet()}
            {showReviewConsole && (
                <ByopReviewConsole onClose={() => setShowReviewConsole(false)} />
            )}
        </div>
    );
}
