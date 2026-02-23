import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, ChevronDown, Wallet, BarChart3, List, RefreshCw, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import TradingKlineChart from './TradingKlineChart';
import TradingOrderBook from './TradingOrderBook';
import C2CTradingPage from './C2CTradingPage';
import TradingWallet from './TradingWallet';
import {
    tradingPairs,
    fetchAllTickers,
    fetchCandles,
    fetchOrderBook,
    fetchTrades,
    fetchTicker24h,
    formatPrice,
    formatVolume,
    formatTime,
} from '../data/tradingData';
import { useLocale } from '../i18n/LocaleContext';
import type { TradingPair, Candle, OrderBookEntry, Trade } from '../data/tradingData';
import { type WalletEntry, loadWallets, maskAddr, getWalletPrivateKey } from '../utils/walletChains';
import { libp2pService } from '../libp2p/service';
import {
    disableDexAsiSession,
    enableDexAsiSession,
    getDexAsiSessionState,
    getDexSnapshot,
    setDexDefaultSigner,
    startDexSync,
    subscribeDexAsiSessionState,
    submitDexOrder,
    subscribeDexSnapshot,
    type DexAsiSessionState,
    type SubmitDexOrderInput,
} from '../domain/dex/dexSync';
import { resolveDexMarketId } from '../domain/dex/marketConfig';
import type { DexSignerIdentity, DexSnapshot } from '../domain/dex/types';

interface TradingPageProps {
    onClose: () => void;
}

type OrderType = 'limit' | 'market';
type TimeInForce = 'GTC' | 'IOC' | 'FOK';
type TimeInterval = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';
type TabView = 'chart' | 'orderbook' | 'trades' | 'c2c';
type DexHealth = 'live' | 'partial' | 'offline';

const intervalToMs: Record<TimeInterval, number> = {
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1H': 60 * 60_000,
    '4H': 4 * 60 * 60_000,
    '1D': 24 * 60 * 60_000,
};

const refreshIntervalByTimeframe: Record<TimeInterval, number> = {
    '1m': 2_500,
    '5m': 4_000,
    '15m': 5_000,
    '1H': 6_000,
    '4H': 7_000,
    '1D': 9_000,
};

function syncCandlesWithLivePrice(rows: Candle[], livePrice: number, interval: TimeInterval): Candle[] {
    if (!Number.isFinite(livePrice) || livePrice <= 0 || rows.length === 0) return rows;

    const intervalMs = intervalToMs[interval];
    const nowBucket = Math.floor(Date.now() / intervalMs) * intervalMs;
    const next = [...rows];
    const last = next[next.length - 1];
    const lastBucket = Math.floor(last.time / intervalMs) * intervalMs;

    if (nowBucket > lastBucket) {
        const open = last.close;
        next.push({
            time: nowBucket,
            open,
            high: Math.max(open, livePrice),
            low: Math.min(open, livePrice),
            close: livePrice,
            volume: 0,
        });
    } else {
        next[next.length - 1] = {
            ...last,
            close: livePrice,
            high: Math.max(last.high, livePrice),
            low: Math.min(last.low, livePrice),
        };
    }

    const maxSize = Math.max(120, rows.length);
    return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}

function toOrderBookRows(levels: Array<{ price: number; qty: number }>): OrderBookEntry[] {
    let total = 0;
    return levels.map((level) => {
        total += level.qty;
        return {
            price: level.price,
            amount: level.qty,
            total,
        };
    });
}

function deriveTrades(snapshot: DexSnapshot, marketId: string): Trade[] {
    const matches = snapshot.matches.filter((item) => item.marketId === marketId).slice(0, 30);
    let prev = matches.length > 0 ? matches[matches.length - 1].price : 0;
    return matches.map((item) => {
        const isBuy = item.price >= prev;
        prev = item.price;
        return {
            price: item.price,
            amount: item.qty,
            time: item.ts,
            isBuy,
        };
    });
}

export default function TradingPage({ onClose }: TradingPageProps) {
    const { t } = useLocale();
    const [pairs, setPairs] = useState<TradingPair[]>(tradingPairs);
    const [selectedPair, setSelectedPair] = useState<TradingPair>(tradingPairs[0]);
    const [showPairList, setShowPairList] = useState(false);
    const [showWallet, setShowWallet] = useState(false);
    const [interval, setInterval_] = useState<TimeInterval>('1H');
    const [orderType, setOrderType] = useState<OrderType>('limit');
    const [timeInForce, setTimeInForce] = useState<TimeInForce>('GTC');
    const [buyPrice, setBuyPrice] = useState('');
    const [buyAmount, setBuyAmount] = useState('');
    const [sellPrice, setSellPrice] = useState('');
    const [sellAmount, setSellAmount] = useState('');
    const [activeTab, setActiveTab] = useState<TabView>('chart');

    const [candles, setCandles] = useState<Candle[]>([]);
    const [dexSnapshot, setDexSnapshot] = useState<DexSnapshot>(() => getDexSnapshot());
    const [externalOrderBook, setExternalOrderBook] = useState<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }>({ asks: [], bids: [] });
    const [externalTrades, setExternalTrades] = useState<Trade[]>([]);
    const [externalUpdatedAt, setExternalUpdatedAt] = useState(0);
    const [dexHealth, setDexHealth] = useState<DexHealth>('partial');
    const [loadError, setLoadError] = useState('');
    const [loading, setLoading] = useState(true);
    const [placing, setPlacing] = useState(false);
    const [orderNotice, setOrderNotice] = useState('');
    const [asiBusy, setAsiBusy] = useState(false);
    const [asiState, setAsiState] = useState<DexAsiSessionState>(() => getDexAsiSessionState());

    const refreshTimerRef = useRef<number | null>(null);
    const loadingRef = useRef(false);

    const [connectedWallet, setConnectedWallet] = useState<WalletEntry | null>(null);
    const [dexSigner, setDexSigner] = useState<DexSignerIdentity | null>(null);

    useEffect(() => {
        const wallets = loadWallets();
        const preferred = wallets.find((item) => item.chain === 'rwad') ?? wallets[0] ?? null;
        setConnectedWallet(preferred);
    }, []);

    useEffect(() => {
        let disposed = false;
        if (!connectedWallet || connectedWallet.chain !== 'rwad') {
            setDexSigner(null);
            setDexDefaultSigner(null);
            return;
        }

        void (async () => {
            const privateKeyPkcs8 = await getWalletPrivateKey(connectedWallet).catch(() => '');
            if (!privateKeyPkcs8 || disposed) {
                setDexSigner(null);
                setDexDefaultSigner(null);
                return;
            }
            const peerId = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
            const signer: DexSignerIdentity = {
                address: connectedWallet.address,
                peerId,
                privateKeyPkcs8,
            };
            if (!disposed) {
                setDexSigner(signer);
                setDexDefaultSigner(signer);
            }
        })();

        return () => {
            disposed = true;
        };
    }, [connectedWallet]);

    useEffect(() => {
        let disposed = false;
        void startDexSync().then((ok) => {
            if (!disposed) {
                setDexHealth(ok ? 'live' : 'offline');
                if (!ok) {
                    setLoadError('DEX runtime unavailable.');
                }
            }
        });
        const unsubscribe = subscribeDexSnapshot((next) => {
            if (!disposed) {
                setDexSnapshot(next);
            }
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeDexAsiSessionState((next) => {
            setAsiState(next);
        });
        return () => {
            unsubscribe();
        };
    }, []);

    // System theme detection
    const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const bg = isDark ? 'bg-[#0d1117]' : 'bg-white';
    const bgPanel = isDark ? 'bg-[#161b22]' : 'bg-gray-50';
    const border = isDark ? 'border-gray-800' : 'border-gray-200';
    const textPrimary = isDark ? 'text-white' : 'text-gray-900';
    const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
    const textMuted = isDark ? 'text-gray-500' : 'text-gray-400';
    const inputBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300';
    const hoverBg = isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100';
    const activeBg = isDark ? 'bg-gray-700' : 'bg-gray-200';
    const activeDropBg = isDark ? 'bg-gray-800' : 'bg-blue-50';

    const intervals: TimeInterval[] = ['1m', '5m', '15m', '1H', '4H', '1D'];
    const isPositive = selectedPair.change24h >= 0;

    const resolvedDexMarketId = useMemo(() => resolveDexMarketId(selectedPair.symbol), [selectedPair.symbol]);
    const isDexMarket = Boolean(resolvedDexMarketId);
    const marketId = resolvedDexMarketId ?? 'BTC-USDC';

    const depth = useMemo(
        () => (isDexMarket ? dexSnapshot.depths.find((item) => item.marketId === marketId) ?? null : null),
        [dexSnapshot.depths, marketId, isDexMarket],
    );

    const orderBook = useMemo(() => {
        if (!isDexMarket) {
            return externalOrderBook;
        }
        const asks = toOrderBookRows(depth?.asks ?? []);
        const bids = toOrderBookRows(depth?.bids ?? []);
        return { asks, bids };
    }, [depth, externalOrderBook, isDexMarket]);

    const recentTrades = useMemo(
        () => (isDexMarket ? deriveTrades(dexSnapshot, marketId) : externalTrades),
        [dexSnapshot, marketId, externalTrades, isDexMarket],
    );

    const depthStalenessMs = useMemo(() => {
        if (!isDexMarket) {
            return externalUpdatedAt > 0 ? Math.max(0, Date.now() - externalUpdatedAt) : 99_999;
        }
        if (!depth) {
            return 99_999;
        }
        return Math.max(0, Date.now() - depth.updatedAtMs);
    }, [depth, dexSnapshot.updatedAt, externalUpdatedAt, isDexMarket]);

    useEffect(() => {
        if (!isDexMarket) {
            return;
        }
        const bestAsk = depth?.asks[0]?.price ?? 0;
        const bestBid = depth?.bids[0]?.price ?? 0;
        const mid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
        if (mid > 0) {
            setSelectedPair((prev) => ({ ...prev, price: mid }));
            setPairs((prev) => prev.map((item) => (item.symbol === selectedPair.symbol ? { ...item, price: mid } : item)));
        }
    }, [depth, selectedPair.symbol, isDexMarket]);

    useEffect(() => {
        if (isDexMarket) {
            if (depthStalenessMs > 3_000) {
                setDexHealth('partial');
            } else if (dexSnapshot.depths.length > 0) {
                setDexHealth('live');
            }
            return;
        }
        setDexHealth(externalUpdatedAt > 0 ? 'live' : 'partial');
    }, [depthStalenessMs, dexSnapshot.depths.length, externalUpdatedAt, isDexMarket]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const updated = await fetchAllTickers();
                if (!cancelled) {
                    setPairs(updated);
                    const current = updated.find((p) => p.symbol === selectedPair.symbol);
                    if (current) {
                        setSelectedPair((prev) => ({ ...prev, ...current }));
                    }
                }
            } catch {
                // ignore external ticker failure
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadChartData = useCallback(async (pair: TradingPair, iv: TimeInterval) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);

        try {
            const [candlesResult, tickerResult, orderBookResult, tradesResult] = await Promise.allSettled([
                fetchCandles(pair, 120, iv),
                fetchTicker24h(pair),
                fetchOrderBook(pair, 15),
                fetchTrades(pair, 30),
            ]);

            let livePrice = selectedPair.price;
            if (tickerResult.status === 'fulfilled' && tickerResult.value.price && tickerResult.value.price > 0) {
                livePrice = tickerResult.value.price;
                setSelectedPair((prev) => ({ ...prev, ...tickerResult.value }));
                setPairs((prev) => prev.map((item) => (
                    item.symbol === pair.symbol ? { ...item, ...tickerResult.value } : item
                )));
            }

            if (orderBookResult.status === 'fulfilled') {
                setExternalOrderBook(orderBookResult.value);
                setExternalUpdatedAt(Date.now());
                if (!isDexMarket) {
                    const bestAsk = orderBookResult.value.asks[0]?.price ?? 0;
                    const bestBid = orderBookResult.value.bids[0]?.price ?? 0;
                    const mid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
                    if (mid > 0) {
                        livePrice = mid;
                    }
                }
            }

            if (tradesResult.status === 'fulfilled') {
                setExternalTrades(tradesResult.value);
                setExternalUpdatedAt(Date.now());
                if (!isDexMarket && tradesResult.value.length > 0) {
                    livePrice = tradesResult.value[0].price;
                }
            }

            if (!isDexMarket && livePrice > 0) {
                setSelectedPair((prev) => (prev.symbol === pair.symbol ? { ...prev, price: livePrice } : prev));
                setPairs((prev) => prev.map((item) => (item.symbol === pair.symbol ? { ...item, price: livePrice } : item)));
            }

            const effectiveLivePrice = livePrice > 0 ? livePrice : selectedPair.price;

            if (candlesResult.status === 'fulfilled') {
                setCandles(syncCandlesWithLivePrice(candlesResult.value, effectiveLivePrice, iv));
                setLoadError('');
            } else if (candles.length > 0) {
                setCandles((prev) => syncCandlesWithLivePrice(prev, effectiveLivePrice, iv));
            }
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, [candles.length, isDexMarket, selectedPair.price]);

    useEffect(() => {
        loadChartData(selectedPair, interval);
        const refreshMs = refreshIntervalByTimeframe[interval];
        if (refreshTimerRef.current) {
            window.clearInterval(refreshTimerRef.current);
        }
        refreshTimerRef.current = window.setInterval(() => {
            loadChartData(selectedPair, interval);
        }, refreshMs);

        return () => {
            if (refreshTimerRef.current) {
                window.clearInterval(refreshTimerRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPair.symbol, interval]);

    useEffect(() => {
        if (selectedPair.price > 0) {
            const p = formatPrice(selectedPair.price);
            setBuyPrice(p);
            setSellPrice(p);
        }
    }, [selectedPair.price]);

    const handleSelectPair = useCallback((pair: TradingPair) => {
        setSelectedPair(pair);
        setShowPairList(false);
    }, []);

    const handleWalletSelectPair = useCallback((symbol: string) => {
        const pair = pairs.find((p) => p.symbol === symbol);
        if (pair) {
            setSelectedPair(pair);
        }
    }, [pairs]);

    const handleRefresh = useCallback(() => {
        loadChartData(selectedPair, interval);
    }, [loadChartData, selectedPair, interval]);

    const toggleAsiSession = useCallback(async () => {
        if (asiBusy) {
            return;
        }
        if (asiState.enabled) {
            disableDexAsiSession('manual_disable');
            setOrderNotice('ASI 会话已销毁，签名回退为 Root。');
            return;
        }
        setAsiBusy(true);
        const result = await enableDexAsiSession();
        setAsiBusy(false);
        if (!result.ok) {
            setOrderNotice(`ASI 启用失败: ${result.reason ?? 'session_enable_failed'}`);
            return;
        }
        setOrderNotice('ASI 会话已启用（24h / 500 RWAD / 仅 DEX 动作）。');
    }, [asiBusy, asiState.enabled]);

    const submitOrder = useCallback(async (side: 'BUY' | 'SELL') => {
        if (!isDexMarket || !resolvedDexMarketId) {
            setOrderNotice('当前交易对仅支持行情展示，尚未接入 DEX 订单簿下单。');
            return;
        }
        if (!dexSigner) {
            setOrderNotice('请先连接 RWAD 钱包用于 DEX 签名。');
            return;
        }

        const amountRaw = side === 'BUY' ? buyAmount : sellAmount;
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) {
            setOrderNotice('请输入有效数量。');
            return;
        }

        const input: SubmitDexOrderInput = {
            marketId: resolvedDexMarketId,
            side,
            type: orderType === 'limit' ? 'LIMIT' : 'MARKET',
            timeInForce,
            qty: amount,
            metadata: {
                ui: 'TradingPage',
                pair: selectedPair.symbol,
            },
        };

        if (orderType === 'limit') {
            const rawPrice = side === 'BUY' ? buyPrice : sellPrice;
            const price = Number(rawPrice);
            if (!Number.isFinite(price) || price <= 0) {
                setOrderNotice('请输入有效价格。');
                return;
            }
            input.price = price;
        }

        setPlacing(true);
        setOrderNotice('');
        const result = await submitDexOrder(input, dexSigner);
        setPlacing(false);

        if (!result.ok) {
            setOrderNotice(`下单失败: ${result.reason || 'unknown_error'}`);
            return;
        }

        if (side === 'BUY') {
            setBuyAmount('');
        } else {
            setSellAmount('');
        }

        setOrderNotice(
            result.fallbackOrderId
                ? `下单成功 ${result.orderId}，已触发 C2C 回落 ${result.fallbackOrderId}`
                : `下单成功 ${result.orderId}，成交量 ${Number(result.filledQty ?? 0).toFixed(4)}`,
        );
    }, [buyAmount, buyPrice, dexSigner, isDexMarket, orderType, resolvedDexMarketId, sellAmount, sellPrice, selectedPair.symbol, timeInForce]);

    const dexStatusStyles = dexHealth === 'live'
        ? 'bg-green-500/15 text-green-400'
        : dexHealth === 'partial'
            ? 'bg-yellow-500/15 text-yellow-400'
            : 'bg-red-500/15 text-red-400';
    const dexStatusLabel = dexHealth === 'live' ? 'LIVE' : dexHealth === 'partial' ? 'PARTIAL' : 'OFFLINE';

    if (showWallet) {
        return <TradingWallet
            onClose={() => setShowWallet(false)}
            onSelectPair={handleWalletSelectPair}
            onSelectWallet={(wallet) => setConnectedWallet(wallet)}
        />;
    }

    return (
        <div
            className={`fixed inset-0 flex flex-col ${bg} ${textPrimary} overflow-hidden`}
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                paddingLeft: 'env(safe-area-inset-left, 0px)',
                paddingRight: 'env(safe-area-inset-right, 0px)',
            }}
        >
            <header className={`flex items-center justify-between px-3 py-2 border-b ${border} ${bg} shrink-0`}>
                <div className="flex items-center gap-2">
                    <button onClick={onClose} className={`p-1.5 ${hoverBg} rounded-lg transition-colors`}>
                        <ArrowLeft size={20} className={isDark ? 'text-gray-300' : 'text-gray-600'} />
                    </button>
                    <button
                        onClick={() => setShowPairList(!showPairList)}
                        className={`flex items-center gap-1 ${hoverBg} rounded-lg px-2 py-1 transition-colors`}
                    >
                        <span className="text-lg font-bold">{selectedPair.symbol}</span>
                        <ChevronDown size={16} className={textSecondary} />
                    </button>
                    <span className={`text-sm font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {isPositive ? '+' : ''}{selectedPair.change24h.toFixed(2)}%
                    </span>
                    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${dexStatusStyles}`}>
                        {dexHealth === 'live' ? <Wifi size={10} /> : <WifiOff size={10} />}
                        {dexStatusLabel}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleRefresh}
                        className={`p-1.5 ${hoverBg} rounded-lg transition-colors`}
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={`${textSecondary} ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={() => setShowWallet(true)}
                        className={`p-1.5 ${hoverBg} rounded-lg transition-colors flex items-center gap-1`}
                    >
                        <Wallet size={18} className={dexSigner ? 'text-yellow-400' : 'text-gray-500'} />
                        {connectedWallet && (
                            <span className="text-xs text-gray-400 font-mono">{maskAddr(connectedWallet.address)}</span>
                        )}
                    </button>
                    <button
                        onClick={() => { void toggleAsiSession(); }}
                        disabled={asiBusy || !dexSigner}
                        className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                            asiState.enabled ? 'bg-cyan-500/20 text-cyan-300' : 'bg-gray-500/15 text-gray-400'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title="Enable ASI session signer"
                    >
                        {asiBusy ? 'ASI...' : asiState.enabled ? 'ASI ON' : 'ASI OFF'}
                    </button>
                </div>
            </header>

            {showPairList && (
                <div className={`absolute top-12 left-0 right-0 ${bgPanel} border-b ${border} z-40 max-h-[50vh] overflow-y-auto shadow-2xl`}>
                    {pairs.map((pair) => (
                        <button
                            key={pair.symbol}
                            onClick={() => handleSelectPair(pair)}
                            className={`w-full flex items-center justify-between px-4 py-3 ${hoverBg} transition-colors border-b ${border}/50 ${pair.symbol === selectedPair.symbol ? activeDropBg : ''}`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-lg w-6 text-center">{pair.icon}</span>
                                <div className="text-left">
                                    <div className="font-medium text-sm">{pair.symbol}</div>
                                    <div className={`text-xs ${textMuted}`}>Vol {formatVolume(pair.volume24h)}</div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-medium">{pair.price ? formatPrice(pair.price) : '—'}</div>
                                <div className={`text-xs ${pair.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {pair.change24h >= 0 ? '+' : ''}{pair.change24h.toFixed(2)}%
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {activeTab !== 'c2c' && (<>
                <div className={`flex items-center justify-between px-3 py-1.5 border-b ${border} text-xs ${textSecondary} shrink-0`}>
                    <div>
                        <span className={`text-base font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                            {selectedPair.price ? formatPrice(selectedPair.price) : '—'}
                        </span>
                        <span className={`ml-2 ${textMuted}`}>≈ {selectedPair.quote} {selectedPair.price ? formatPrice(selectedPair.price) : '—'}</span>
                    </div>
                    <div className="flex gap-4">
                        <div>
                            <span className={textMuted}>24h H </span>
                            <span className={textPrimary}>{selectedPair.high24h ? formatPrice(selectedPair.high24h) : '—'}</span>
                        </div>
                        <div>
                            <span className={textMuted}>24h L </span>
                            <span className={textPrimary}>{selectedPair.low24h ? formatPrice(selectedPair.low24h) : '—'}</span>
                        </div>
                        <div>
                            <span className={textMuted}>Vol </span>
                            <span className={textPrimary}>{selectedPair.volume24h ? formatVolume(selectedPair.volume24h) : '—'}</span>
                        </div>
                    </div>
                </div>
                {loadError && (
                    <div className="shrink-0 px-3 py-2 border-b border-yellow-300/40 bg-yellow-500/10 text-[11px] text-yellow-500 flex items-center gap-1.5">
                        <AlertTriangle size={12} />
                        <span>{loadError}</span>
                    </div>
                )}
            </>)}

            <div className={`flex items-center px-2 py-1 border-b ${border} gap-1 shrink-0`}>
                <button
                    onClick={() => setActiveTab('chart')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'chart' ? `${activeBg} ${textPrimary}` : `${textSecondary}`}`}
                >
                    <BarChart3 size={14} />
                    {t.trading_chart || 'Chart'}
                </button>
                <button
                    onClick={() => setActiveTab('orderbook')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'orderbook' ? `${activeBg} ${textPrimary}` : `${textSecondary}`}`}
                >
                    <List size={14} />
                    {t.trading_orderBook || 'Order Book'}
                </button>
                <button
                    onClick={() => setActiveTab('trades')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'trades' ? `${activeBg} ${textPrimary}` : `${textSecondary}`}`}
                >
                    {t.trading_recentTrades || 'Trades'}
                </button>
                <button
                    onClick={() => setActiveTab('c2c')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'c2c' ? `${activeBg} ${textPrimary}` : `${textSecondary}`}`}
                >
                    C2C
                </button>

                {activeTab === 'chart' && (
                    <div className="flex ml-auto gap-0.5">
                        {intervals.map((iv) => (
                            <button
                                key={iv}
                                onClick={() => setInterval_(iv)}
                                className={`px-2 py-1 rounded text-xs transition-colors ${interval === iv ? 'bg-yellow-500/20 text-yellow-400 font-semibold' : `${textMuted}`}`}
                            >
                                {iv}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-hidden">
                {activeTab === 'chart' && (
                    <div className="h-full">
                        {candles.length > 0 ? (
                            <TradingKlineChart candles={candles} isPositive={isPositive} isDark={isDark} />
                        ) : (
                            <div className={`h-full flex items-center justify-center ${textMuted}`}>
                                <RefreshCw size={20} className={loading ? 'animate-spin mr-2' : 'mr-2'} />
                                <span>{loadError || 'Loading chart...'}</span>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'orderbook' && (
                    <TradingOrderBook
                        asks={orderBook.asks}
                        bids={orderBook.bids}
                        currentPrice={selectedPair.price}
                        priceChange={selectedPair.change24h}
                        pairSymbol={selectedPair.symbol}
                        sequence={depth?.sequence}
                        checksum={depth?.checksum}
                        stalenessMs={depthStalenessMs}
                    />
                )}

                {activeTab === 'trades' && (
                    <div className="h-full overflow-y-auto">
                        <div className={`flex items-center justify-between px-3 py-1.5 text-xs ${textMuted} border-b ${border} sticky top-0 ${bg}`}>
                            <span className="w-1/3">{t.trading_price || 'Price'}</span>
                            <span className="w-1/3 text-right">{t.trading_amount || 'Amount'}</span>
                            <span className="w-1/3 text-right">{t.trading_time || 'Time'}</span>
                        </div>
                        {recentTrades.map((trade, index) => (
                            <div key={`${trade.time}-${index}`} className={`flex items-center justify-between px-3 py-1 text-xs font-mono ${hoverBg}`}>
                                <span className={`w-1/3 ${trade.isBuy ? 'text-green-500' : 'text-red-500'}`}>
                                    {formatPrice(trade.price)}
                                </span>
                                <span className={`w-1/3 text-right ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{trade.amount.toFixed(4)}</span>
                                <span className={`w-1/3 text-right ${textMuted}`}>{formatTime(trade.time)}</span>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'c2c' && (
                    <C2CTradingPage onBack={() => setActiveTab('chart')} />
                )}
            </div>

            {activeTab !== 'c2c' && (
                <div className={`border-t ${border} ${bgPanel} shrink-0`}>
                    <div className="flex items-center gap-1 px-3 pt-2">
                        <button
                            onClick={() => setOrderType('limit')}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${orderType === 'limit' ? `${activeBg} ${textPrimary}` : textSecondary}`}
                        >
                            {t.trading_limit || 'Limit'}
                        </button>
                        <button
                            onClick={() => setOrderType('market')}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${orderType === 'market' ? `${activeBg} ${textPrimary}` : textSecondary}`}
                        >
                            {t.trading_market || 'Market'}
                        </button>
                        <div className="ml-auto flex items-center gap-1">
                            {(['GTC', 'IOC', 'FOK'] as const).map((tif) => (
                                <button
                                    key={tif}
                                    onClick={() => setTimeInForce(tif)}
                                    className={`px-2 py-1 rounded text-[10px] transition-colors ${timeInForce === tif ? 'bg-cyan-500/20 text-cyan-300' : textMuted}`}
                                >
                                    {tif}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 p-3">
                        <div className="space-y-2">
                            {orderType === 'limit' && (
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={buyPrice}
                                        onChange={(event) => setBuyPrice(event.target.value)}
                                        placeholder={t.trading_price || 'Price'}
                                        className={`w-full ${inputBg} border rounded-lg px-3 py-2 text-sm ${textPrimary} placeholder-gray-500 focus:outline-none focus:border-green-500`}
                                    />
                                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${textMuted}`}>{selectedPair.quote}</span>
                                </div>
                            )}
                            <div className="relative">
                                <input
                                    type="text"
                                    value={buyAmount}
                                    onChange={(event) => setBuyAmount(event.target.value)}
                                    placeholder={t.trading_amount || 'Amount'}
                                    className={`w-full ${inputBg} border rounded-lg px-3 py-2 text-sm ${textPrimary} placeholder-gray-500 focus:outline-none focus:border-green-500`}
                                />
                                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${textMuted}`}>{selectedPair.base}</span>
                            </div>
                            <button
                                onClick={() => { void submitOrder('BUY'); }}
                                disabled={placing}
                                className="w-full py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors"
                            >
                                {placing ? 'Submitting...' : `${t.trading_buy || 'Buy'} ${selectedPair.base}`}
                            </button>
                        </div>

                        <div className="space-y-2">
                            {orderType === 'limit' && (
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={sellPrice}
                                        onChange={(event) => setSellPrice(event.target.value)}
                                        placeholder={t.trading_price || 'Price'}
                                        className={`w-full ${inputBg} border rounded-lg px-3 py-2 text-sm ${textPrimary} placeholder-gray-500 focus:outline-none focus:border-red-500`}
                                    />
                                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${textMuted}`}>{selectedPair.quote}</span>
                                </div>
                            )}
                            <div className="relative">
                                <input
                                    type="text"
                                    value={sellAmount}
                                    onChange={(event) => setSellAmount(event.target.value)}
                                    placeholder={t.trading_amount || 'Amount'}
                                    className={`w-full ${inputBg} border rounded-lg px-3 py-2 text-sm ${textPrimary} placeholder-gray-500 focus:outline-none focus:border-red-500`}
                                />
                                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${textMuted}`}>{selectedPair.base}</span>
                            </div>
                            <button
                                onClick={() => { void submitOrder('SELL'); }}
                                disabled={placing}
                                className="w-full py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors"
                            >
                                {placing ? 'Submitting...' : `${t.trading_sell || 'Sell'} ${selectedPair.base}`}
                            </button>
                        </div>
                    </div>

                    <div className="mx-3 mb-3 text-[11px] text-gray-400">
                        <div>Signer: {dexSigner ? maskAddr(dexSigner.address) : 'RWAD wallet required'}</div>
                        <div>
                            ASI: {asiState.enabled ? (asiState.active ? 'session-active' : 'session-inactive') : 'disabled'}
                            {asiState.sessionId ? ` (${asiState.sessionId.slice(0, 16)}...)` : ''}
                        </div>
                        <div>
                            Policy: 24h / 500 RWAD / unimaker.dex / placeLimitOrder|cancelOrder|settleMatch / transfer forbidden
                        </div>
                        {asiState.expiresAt > 0 && (
                            <div>
                                Expires: {new Date(asiState.expiresAt).toLocaleString()} | Remaining: {asiState.remainingRWAD.toFixed(4)} RWAD
                            </div>
                        )}
                        {orderNotice && <div className="mt-1 text-cyan-400">{orderNotice}</div>}
                    </div>
                </div>
            )}
        </div>
    );
}
