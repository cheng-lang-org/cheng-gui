import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Shield, TriangleAlert } from 'lucide-react';
import C2CTradingPageLegacy from './C2CTradingPageLegacy';
import { getFeatureFlag } from '../utils/featureFlags';
import { ensureRegionPolicy, getCurrentPolicyGroupId, subscribeRegionPolicy } from '../utils/region';
import {
    getC2CSnapshot,
    placeMarketOrder,
    publishMarketListing,
    startC2CSync,
    submitOrderAssetTransfer,
    subscribeC2CSnapshot,
} from '../domain/c2c/c2cSync';
import { pickVerifiedListings } from '../domain/c2c/c2cStore';
import type { C2COrderRecord } from '../domain/c2c/types';
import { getDexSnapshot, subscribeDexSnapshot } from '../domain/dex/dexSync';
import { loadWallets, getWalletPrivateKey } from '../utils/walletChains';
import { libp2pService } from '../libp2p/service';
import { useLocale } from '../i18n/LocaleContext';

interface C2CTradingPageProps {
    onBack: () => void;
}

type TradeMode = 'buy' | 'sell';
type SettlementRail = 'FIAT' | 'RWAD';

const C2C_SETTLEMENT_RAIL_KEY = 'unimaker_c2c_settlement_rail_v1';

function defaultSettlementRail(): SettlementRail {
    if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(C2C_SETTLEMENT_RAIL_KEY);
        if (raw === 'FIAT' || raw === 'RWAD') {
            return raw;
        }
    }
    return getCurrentPolicyGroupId() === 'CN' ? 'FIAT' : 'RWAD';
}

interface RwadSigner {
    address: string;
    peerId: string;
    privateKeyPkcs8: string;
}

const stateTone: Record<string, string> = {
    DRAFT: 'bg-gray-700 text-gray-200',
    LISTED: 'bg-blue-500/20 text-blue-300',
    LOCK_PENDING: 'bg-yellow-500/20 text-yellow-300',
    LOCKED: 'bg-cyan-500/20 text-cyan-300',
    DELIVERING: 'bg-purple-500/20 text-purple-300',
    SETTLING: 'bg-indigo-500/20 text-indigo-300',
    RELEASED: 'bg-green-500/20 text-green-300',
    REFUNDED: 'bg-orange-500/20 text-orange-300',
    EXPIRED: 'bg-gray-500/20 text-gray-300',
    FAILED: 'bg-red-500/20 text-red-300',
};

async function resolveRwadSigner(): Promise<RwadSigner | null> {
    const wallet = loadWallets().find((item) => item.chain === 'rwad');
    if (!wallet) {
        return null;
    }
    const privateKeyPkcs8 = await getWalletPrivateKey(wallet).catch(() => '');
    if (!privateKeyPkcs8) {
        return null;
    }
    const peerId = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
    return {
        address: wallet.address,
        peerId,
        privateKeyPkcs8,
    };
}

export default function C2CTradingPage({ onBack }: C2CTradingPageProps) {
    const { t } = useLocale();
    const enableC2CV2 = getFeatureFlag('c2c_rwads_v2', false);
    const [policyGroupId, setPolicyGroupId] = useState(() => getCurrentPolicyGroupId());
    const isDomestic = policyGroupId === 'CN';
    const rwadEnabled = enableC2CV2 || !isDomestic;
    const [settlementRail, setSettlementRail] = useState<SettlementRail>(() => defaultSettlementRail());
    const [mode, setMode] = useState<TradeMode>('buy');
    const [snapshot, setSnapshot] = useState(() => getC2CSnapshot());
    const [dexSnapshot, setDexSnapshot] = useState(() => getDexSnapshot());
    const [signer, setSigner] = useState<RwadSigner | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    const [selectedListingId, setSelectedListingId] = useState('');
    const [orderQty, setOrderQty] = useState('1');

    const [publishAssetId, setPublishAssetId] = useState('');
    const [publishQty, setPublishQty] = useState('1');
    const [publishPrice, setPublishPrice] = useState('1');
    const [publishExpiry, setPublishExpiry] = useState('30');

    const stateText = (state: string): string => {
        switch (state) {
            case 'LOCK_PENDING':
                return t.c2c_state_lockPending;
            case 'LOCKED':
                return t.c2c_state_locked;
            case 'DELIVERING':
                return t.c2c_state_delivering;
            case 'SETTLING':
                return t.c2c_state_settling;
            case 'RELEASED':
                return t.c2c_state_released;
            case 'REFUNDED':
                return t.c2c_state_refunded;
            case 'EXPIRED':
                return t.c2c_state_expired;
            case 'FAILED':
                return t.c2c_state_failed;
            case 'LISTED':
                return t.c2c_state_listed;
            case 'DRAFT':
                return t.c2c_state_draft;
            default:
                return state;
        }
    };

    const reasonText = (reason: string): string => {
        switch (reason) {
            case 'invalid_escrow_id':
                return t.c2c_err_invalidEscrow;
            case 'seller_mismatch':
                return t.c2c_err_sellerMismatch;
            case 'listing_not_found':
                return t.c2c_err_listingNotFound;
            case 'qty_out_of_range':
                return t.c2c_err_qtyOutOfRange;
            case 'invalid_qty':
            case 'invalid_qty_or_price':
                return t.c2c_err_invalidAmount;
            case 'order_publish_failed':
            case 'publish_failed':
                return t.c2c_err_publishFailed;
            case 'native_platform_required':
            case 'bridge_method_unavailable':
            case 'bridge_call_failed':
            case 'rwad_service_peer_unavailable':
            case 'rwad_service_dial_failed':
            case 'rwad_request_failed':
            case 'rwad_empty_response':
            case 'rwad_non_json_response':
                return t.c2c_err_runtimeUnavailable;
            default:
                return reason || t.c2c_err_unknown;
        }
    };

    useEffect(() => {
        void ensureRegionPolicy();
        return subscribeRegionPolicy((policy) => {
            setPolicyGroupId(policy.policyGroupId);
        });
    }, []);

    useEffect(() => {
        if (!rwadEnabled || settlementRail !== 'RWAD') {
            return;
        }
        let disposed = false;
        void (async () => {
            const started = await startC2CSync();
            if (!started && !disposed) {
                setMessage(`[error] ${t.c2c_err_runtimeUnavailable}`);
            }
            const nextSigner = await resolveRwadSigner();
            if (!disposed) {
                setSigner(nextSigner);
            }
        })();

        const unsubscribe = subscribeC2CSnapshot((next) => {
            if (!disposed) {
                setSnapshot(next);
            }
        });

        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [rwadEnabled, settlementRail, t.c2c_err_runtimeUnavailable]);

    useEffect(() => {
        return subscribeDexSnapshot((next) => {
            setDexSnapshot(next);
        });
    }, []);

    const listings = useMemo(() => {
        const all = pickVerifiedListings(snapshot);
        if (!signer) {
            return all;
        }
        return all.filter((item) => item.seller !== signer.address);
    }, [snapshot, signer]);

    const selectedListing = useMemo(
        () => listings.find((item) => item.listingId === selectedListingId) ?? null,
        [listings, selectedListingId],
    );

    const myOrders = useMemo(() => {
        if (!signer) {
            return [] as C2COrderRecord[];
        }
        return snapshot.orders.filter((item) => item.buyer === signer.address || item.seller === signer.address);
    }, [snapshot, signer]);

    const pendingDeliveries = useMemo(() => {
        if (!signer) {
            return [] as C2COrderRecord[];
        }
        return myOrders.filter((item) => item.seller === signer.address && (item.state === 'LOCKED' || item.state === 'DELIVERING'));
    }, [myOrders, signer]);

    const recentDexLinkEvents = useMemo(() => dexSnapshot.links.slice(0, 8), [dexSnapshot.links]);

    useEffect(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(C2C_SETTLEMENT_RAIL_KEY, settlementRail);
        }
    }, [settlementRail]);

    useEffect(() => {
        if (!rwadEnabled && settlementRail === 'RWAD') {
            setSettlementRail('FIAT');
        }
        if (!isDomestic && settlementRail === 'FIAT') {
            setSettlementRail('RWAD');
        }
    }, [isDomestic, rwadEnabled, settlementRail]);

    if (settlementRail === 'FIAT') {
        return (
            <C2CTradingPageLegacy
                onBack={onBack}
                activeRail="FIAT"
                onSwitchRail={(next) => {
                    if (next === 'FIAT' && !isDomestic) {
                        return;
                    }
                    if (next === 'RWAD' && !rwadEnabled) {
                        return;
                    }
                    setSettlementRail(next);
                }}
            />
        );
    }

    if (!rwadEnabled) {
        return <C2CTradingPageLegacy onBack={onBack} activeRail="FIAT" onSwitchRail={() => setSettlementRail('FIAT')} />;
    }

    const placeOrder = async (): Promise<void> => {
        if (!signer || !selectedListing) {
            setMessage(`[error] ${t.c2c_err_selectWalletAndListing}`);
            return;
        }
        const qty = Number(orderQty);
        if (!Number.isInteger(qty) || qty <= 0) {
            setMessage(`[error] ${t.c2c_err_invalidAmount}`);
            return;
        }
        setBusy(true);
        setMessage('');
        const result = await placeMarketOrder({ listingId: selectedListing.listingId, qty }, signer);
        setBusy(false);
        if (!result.ok) {
            setMessage(`[error] ${t.c2c_action_orderFailed}: ${reasonText(result.reason ?? '')}`);
            return;
        }
        setMessage(`${t.c2c_v2_orderSuccess}：${result.orderId}`);
        setSelectedListingId('');
    };

    const publishListing = async (): Promise<void> => {
        if (!signer) {
            setMessage(`[error] ${t.c2c_err_walletMissing}`);
            return;
        }
        const qty = Number(publishQty);
        const price = Number(publishPrice);
        const expiry = Number(publishExpiry);
        if (!publishAssetId.trim()) {
            setMessage(`[error] ${t.c2c_err_missingAssetId}`);
            return;
        }
        if (!Number.isInteger(qty) || qty <= 0 || !Number.isInteger(price) || price <= 0) {
            setMessage(`[error] ${t.c2c_err_invalidAmount}`);
            return;
        }

        setBusy(true);
        setMessage('');
        const result = await publishMarketListing(
            {
                assetId: publishAssetId.trim(),
                qty,
                unitPriceRwads: price,
                expiresInMinutes: expiry,
            },
            signer,
        );
        setBusy(false);

        if (!result.ok) {
            setMessage(`[error] ${t.c2c_action_publishFailed}: ${reasonText(result.reason ?? '')}`);
            return;
        }
        setMessage(`${t.c2c_v2_publishSuccess}：${result.listingId}`);
    };

    const deliverOrder = async (order: C2COrderRecord): Promise<void> => {
        if (!signer) {
            setMessage(`[error] ${t.c2c_err_walletMissing}`);
            return;
        }
        setBusy(true);
        setMessage('');
        const result = await submitOrderAssetTransfer(order, signer);
        setBusy(false);
        if (!result.ok) {
            setMessage(`[error] ${t.c2c_action_deliverFailed}: ${reasonText(result.reason ?? '')}`);
            return;
        }
        setMessage(`${t.c2c_v2_deliverSuccess}：${order.orderId}`);
    };

    return (
        <div
            className="fixed inset-0 flex flex-col bg-[#0d1117] text-white overflow-hidden"
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-1 hover:bg-gray-800 rounded-lg transition-colors">
                        <ArrowLeft size={20} className="text-gray-300" />
                    </button>
                    <div>
                        <h1 className="text-lg font-bold">{t.c2c_v2_title}</h1>
                        <div className="text-[11px] text-gray-500">{t.c2c_v2_subtitle}</div>
                    </div>
                </div>
                <div className="text-right text-[11px] text-gray-400">
                    <div>{signer ? `${t.c2c_v2_walletPrefix} ${signer.address.slice(0, 8)}...` : t.c2c_v2_walletMissing}</div>
                    <div>{libp2pService.isNativePlatform() ? 'Native runtime' : 'Web ingress runtime'}</div>
                </div>
            </header>

            <div className="px-4 pt-3 pb-2 flex items-center gap-2 shrink-0">
                {isDomestic && (
                    <button
                        onClick={() => setSettlementRail('FIAT')}
                        className="px-3 py-2 text-xs font-bold rounded-lg bg-gray-800 text-gray-300"
                    >
                        Fiat (BYOP)
                    </button>
                )}
                <button
                    onClick={() => setSettlementRail('RWAD')}
                    className="px-3 py-2 text-xs font-bold rounded-lg bg-cyan-500 text-white"
                >
                    {isDomestic ? 'RWAD Escrow' : 'RWAD Escrow (INTL)'}
                </button>
                <button
                    onClick={() => setMode('buy')}
                    className={`px-4 py-2 text-sm font-bold rounded-lg ${mode === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-400'}`}
                >
                    {t.c2c_buy}
                </button>
                <button
                    onClick={() => setMode('sell')}
                    className={`px-4 py-2 text-sm font-bold rounded-lg ${mode === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400'}`}
                >
                    {t.c2c_sell}
                </button>
            </div>

            {message && (
                <div className="px-4 pb-2 shrink-0">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-gray-300 flex items-start gap-2">
                        {message.startsWith('[error]') ? <TriangleAlert size={14} className="text-red-400 mt-0.5" /> : <CheckCircle2 size={14} className="text-green-400 mt-0.5" />}
                        <span>{message.replace(/^\[error\]\s*/, '')}</span>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
                {mode === 'buy' && (
                    <>
                        <section className="rounded-xl border border-gray-800 bg-[#111827] p-3 space-y-2">
                            <div className="text-xs text-gray-400">{t.c2c_v2_buyAdsTitle}</div>
                            {listings.length === 0 && <div className="text-sm text-gray-500 py-2">{t.c2c_v2_noListings}</div>}
                            {listings.map((listing) => (
                                <label
                                    key={listing.listingId}
                                    className={`block rounded-lg border p-3 cursor-pointer ${selectedListingId === listing.listingId ? 'border-yellow-400 bg-yellow-500/10' : 'border-gray-700 bg-gray-900/30'
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        className="hidden"
                                        checked={selectedListingId === listing.listingId}
                                        onChange={() => setSelectedListingId(listing.listingId)}
                                    />
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold">{listing.assetId}</div>
                                            <div className="text-xs text-gray-400 mt-1">{t.c2c_v2_sellerPrefix} {listing.seller.slice(0, 10)}... · {t.c2c_v2_remaining} {listing.qty}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-base font-bold text-yellow-300">{listing.unitPriceRwads} RWAD</div>
                                            <div className="text-xs text-gray-500 mt-1">{t.c2c_v2_limitRange} {listing.minQty} - {listing.maxQty}</div>
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </section>

                        <section className="rounded-xl border border-gray-800 bg-[#111827] p-3 space-y-2">
                            <div className="text-xs text-gray-400">{t.c2c_v2_lockTitle}</div>
                            <div className="flex items-center gap-2">
                                <input
                                    value={orderQty}
                                    onChange={(event) => setOrderQty(event.target.value)}
                                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                                    placeholder={t.c2c_v2_qtyPlaceholder}
                                    inputMode="numeric"
                                />
                                <button
                                    disabled={busy || !selectedListing}
                                    onClick={() => {
                                        void placeOrder();
                                    }}
                                    className="px-4 py-2 rounded-lg bg-green-500 text-white text-sm font-semibold disabled:opacity-40"
                                >
                                    {busy ? <Loader2 size={14} className="animate-spin" /> : t.c2c_v2_submitLock}
                                </button>
                            </div>
                            {selectedListing && (
                                <div className="text-xs text-gray-500">{t.c2c_v2_estimateLock} {Number(orderQty || 0) * selectedListing.unitPriceRwads || 0} RWAD</div>
                            )}
                        </section>
                    </>
                )}

                {mode === 'sell' && (
                    <>
                        <section className="rounded-xl border border-gray-800 bg-[#111827] p-3 space-y-2">
                            <div className="text-xs text-gray-400">{t.c2c_v2_publishTitle}</div>
                            <div className="grid grid-cols-2 gap-2">
                                <input
                                    value={publishAssetId}
                                    onChange={(event) => setPublishAssetId(event.target.value)}
                                    className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                                    placeholder="asset_id"
                                />
                                <input
                                    value={publishQty}
                                    onChange={(event) => setPublishQty(event.target.value)}
                                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                                    placeholder={t.c2c_v2_publishQtyPh}
                                    inputMode="numeric"
                                />
                                <input
                                    value={publishPrice}
                                    onChange={(event) => setPublishPrice(event.target.value)}
                                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                                    placeholder={t.c2c_v2_publishPricePh}
                                    inputMode="numeric"
                                />
                                <input
                                    value={publishExpiry}
                                    onChange={(event) => setPublishExpiry(event.target.value)}
                                    className="col-span-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                                    placeholder={t.c2c_v2_publishExpiryPh}
                                    inputMode="numeric"
                                />
                            </div>
                            <button
                                disabled={busy}
                                onClick={() => {
                                    void publishListing();
                                }}
                                className="w-full mt-1 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold disabled:opacity-40"
                            >
                                {busy ? t.c2c_v2_processing : t.c2c_v2_publishBtn}
                            </button>
                        </section>

                        <section className="rounded-xl border border-gray-800 bg-[#111827] p-3 space-y-2">
                            <div className="text-xs text-gray-400">{t.c2c_v2_pendingTitle}</div>
                            {pendingDeliveries.length === 0 && <div className="text-sm text-gray-500 py-2">{t.c2c_v2_noPending}</div>}
                            {pendingDeliveries.map((order) => (
                                <div key={order.orderId} className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold">{order.assetId}</div>
                                            <div className="text-xs text-gray-400 mt-1">{t.c2c_v2_orderPrefix} {order.orderId.slice(0, 12)}... · {t.c2c_quantity} {order.qty}</div>
                                        </div>
                                        <span className={`text-[11px] px-2 py-1 rounded ${stateTone[order.state] || stateTone.DRAFT}`}>{stateText(order.state)}</span>
                                    </div>
                                    <button
                                        className="mt-3 px-3 py-2 rounded-lg bg-purple-500 text-white text-xs font-semibold disabled:opacity-40"
                                        disabled={busy}
                                        onClick={() => {
                                            void deliverOrder(order);
                                        }}
                                    >
                                        {t.c2c_v2_deliverBtn}
                                    </button>
                                </div>
                            ))}
                        </section>
                    </>
                )}

                <section className="rounded-xl border border-gray-800 bg-[#111827] p-3 space-y-2">
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                        <Shield size={13} className="text-yellow-400" />
                        {t.c2c_v2_myOrdersTitle}
                    </div>
                    {myOrders.length === 0 && <div className="text-sm text-gray-500 py-2">{t.c2c_v2_noOrders}</div>}
                    {myOrders.map((order) => (
                        <div key={order.orderId} className="rounded-lg border border-gray-700 bg-gray-900/30 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-gray-400">{order.orderId}</div>
                                <span className={`text-[11px] px-2 py-1 rounded ${stateTone[order.state] || stateTone.DRAFT}`}>{stateText(order.state)}</span>
                            </div>
                            <div className="text-sm mt-2">{order.assetId} · {order.qty} · {order.totalRwads} RWAD</div>
                            <div className="text-[11px] text-gray-500 mt-1">Escrow: {order.escrowId}</div>
                            {order.lockTxHash && <div className="text-[11px] text-gray-500">tx: {order.lockTxHash}</div>}
                        </div>
                    ))}
                </section>

                <section className="rounded-xl border border-gray-800 bg-[#111827] p-3 space-y-2">
                    <div className="text-xs text-gray-400">DEX x C2C Link Events</div>
                    {recentDexLinkEvents.length === 0 && <div className="text-sm text-gray-500 py-2">No linkage events yet.</div>}
                    {recentDexLinkEvents.map((event) => (
                        <div key={event.linkId} className="rounded-lg border border-gray-700 bg-gray-900/30 p-3 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-gray-300">{event.marketId}</span>
                                <span className={`px-2 py-0.5 rounded ${event.status === 'EXECUTED' ? 'bg-green-500/20 text-green-300' : event.status === 'FAILED' ? 'bg-red-500/20 text-red-300' : 'bg-gray-700 text-gray-300'}`}>
                                    {event.status}
                                </span>
                            </div>
                            <div className="text-gray-500 mt-1">{event.direction}</div>
                            {event.reason && <div className="text-gray-400 mt-1">{event.reason}</div>}
                            {event.relatedOrderId && <div className="text-gray-500 mt-1">order: {event.relatedOrderId}</div>}
                            {event.relatedTradeId && <div className="text-gray-500 mt-1">trade: {event.relatedTradeId}</div>}
                        </div>
                    ))}
                </section>
            </div>
        </div>
    );
}
