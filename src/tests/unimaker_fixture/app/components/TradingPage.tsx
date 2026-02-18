import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ChevronDown, Wallet, BarChart3, List, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import TradingKlineChart from './TradingKlineChart';
import TradingOrderBook from './TradingOrderBook';
import TradingWallet from './TradingWallet';
import {
    tradingPairs,
    fetchAllTickers,
    fetchCandles,
    fetchOrderBook,
    fetchTrades,
    fetchTicker24h,
    generateMockCandles,
    generateMockOrderBook,
    generateMockTrades,
    formatPrice,
    formatVolume,
    formatTime,
} from '../data/tradingData';
import { useLocale } from '../i18n/LocaleContext';
import type { TradingPair, Candle, OrderBookEntry, Trade } from '../data/tradingData';

interface TradingPageProps {
    onClose: () => void;
}

type OrderType = 'limit' | 'market';
type TimeInterval = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';
type TabView = 'chart' | 'orderbook' | 'trades';

export default function TradingPage({ onClose }: TradingPageProps) {
    const { t } = useLocale();
    const [pairs, setPairs] = useState<TradingPair[]>(tradingPairs);
    const [selectedPair, setSelectedPair] = useState<TradingPair>(tradingPairs[0]);
    const [showPairList, setShowPairList] = useState(false);
    const [showWallet, setShowWallet] = useState(false);
    const [interval, setInterval_] = useState<TimeInterval>('1H');
    const [orderType, setOrderType] = useState<OrderType>('limit');
    const [buyPrice, setBuyPrice] = useState('');
    const [buyAmount, setBuyAmount] = useState('');
    const [sellPrice, setSellPrice] = useState('');
    const [sellAmount, setSellAmount] = useState('');
    const [activeTab, setActiveTab] = useState<TabView>('chart');

    // Real data states
    const [candles, setCandles] = useState<Candle[]>([]);
    const [orderBook, setOrderBook] = useState<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }>({ asks: [], bids: [] });
    const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
    const [isLive, setIsLive] = useState(false); // true = real data, false = mock fallback
    const [loading, setLoading] = useState(true);
    const refreshTimerRef = useRef<number | null>(null);

    // System theme detection
    const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // Theme-dependent class helpers
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

    // ===== Load all tickers on mount =====
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const updated = await fetchAllTickers();
                if (!cancelled) {
                    setPairs(updated);
                    const current = updated.find(p => p.binanceSymbol === selectedPair.binanceSymbol);
                    if (current) setSelectedPair(current);
                    setIsLive(true);
                }
            } catch {
                // API unavailable, use mock defaults
                console.warn('[DEX] Binance API unavailable, using mock data');
                setIsLive(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ===== Fetch data for selected pair =====
    const loadData = useCallback(async (pair: TradingPair, iv: string) => {
        setLoading(true);
        try {
            // Fetch all in parallel
            const [candleData, obData, tradeData, tickerData] = await Promise.all([
                fetchCandles(pair, 120, iv),
                fetchOrderBook(pair, 15),
                fetchTrades(pair, 30),
                fetchTicker24h(pair),
            ]);

            setCandles(candleData);
            setOrderBook(obData);
            setRecentTrades(tradeData);

            // Update selected pair with latest ticker
            setSelectedPair(prev => ({ ...prev, ...tickerData }));
            // Also update it in the pairs list
            setPairs(prev => prev.map(p =>
                p.binanceSymbol === pair.binanceSymbol ? { ...p, ...tickerData } : p
            ));
            setIsLive(true);
        } catch (err) {
            console.warn('[DEX] API fetch failed, falling back to mock:', err);
            setCandles(generateMockCandles(pair, 120, iv));
            setOrderBook(generateMockOrderBook(pair, 15));
            setRecentTrades(generateMockTrades(pair, 30));
            setIsLive(false);
        } finally {
            setLoading(false);
        }
    }, []);

    // Load data when pair or interval changes
    useEffect(() => {
        loadData(selectedPair, interval);

        // Auto-refresh every 10 seconds
        if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = window.setInterval(() => {
            loadData(selectedPair, interval);
        }, 10_000);

        return () => {
            if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPair.binanceSymbol, interval]);

    // Set default prices when pair changes
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
        const pair = pairs.find(p => p.symbol === symbol);
        if (pair) setSelectedPair(pair);
    }, [pairs]);

    const handleRefresh = useCallback(() => {
        loadData(selectedPair, interval);
    }, [loadData, selectedPair, interval]);

    // Wallet overlay
    if (showWallet) {
        return <TradingWallet onClose={() => setShowWallet(false)} onSelectPair={handleWalletSelectPair} />;
    }

    return (
        <div className={`h-screen flex flex-col ${bg} ${textPrimary} overflow-hidden`}>
            {/* ===== Top Bar ===== */}
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
                    {/* Live/Mock indicator */}
                    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${isLive ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-500'}`}>
                        {isLive ? <Wifi size={10} /> : <WifiOff size={10} />}
                        {isLive ? 'LIVE' : 'MOCK'}
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
                        className={`p-1.5 ${hoverBg} rounded-lg transition-colors`}
                    >
                        <Wallet size={18} className="text-yellow-400" />
                    </button>
                </div>
            </header>

            {/* ===== Pair Selector Dropdown ===== */}
            {showPairList && (
                <div className={`absolute top-12 left-0 right-0 ${bgPanel} border-b ${border} z-40 max-h-[50vh] overflow-y-auto shadow-2xl`}>
                    {pairs.map(pair => (
                        <button
                            key={pair.symbol}
                            onClick={() => handleSelectPair(pair)}
                            className={`w-full flex items-center justify-between px-4 py-3 ${hoverBg} transition-colors border-b ${border}/50 ${pair.symbol === selectedPair.symbol ? activeDropBg : ''
                                }`}
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

            {/* ===== Price Info Bar ===== */}
            <div className={`flex items-center justify-between px-3 py-1.5 border-b ${border} text-xs ${textSecondary} shrink-0`}>
                <div>
                    <span className={`text-base font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {selectedPair.price ? formatPrice(selectedPair.price) : '—'}
                    </span>
                    <span className={`ml-2 ${textMuted}`}>≈ ${selectedPair.price ? formatPrice(selectedPair.price) : '—'}</span>
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

            {/* ===== Tab Switcher ===== */}
            <div className={`flex items-center px-2 py-1 border-b ${border} gap-1 shrink-0`}>
                <button
                    onClick={() => setActiveTab('chart')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'chart' ? `${activeBg} ${textPrimary}` : `${textSecondary}`
                        }`}
                >
                    <BarChart3 size={14} />
                    {t.trading_chart || 'Chart'}
                </button>
                <button
                    onClick={() => setActiveTab('orderbook')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'orderbook' ? `${activeBg} ${textPrimary}` : `${textSecondary}`
                        }`}
                >
                    <List size={14} />
                    {t.trading_orderBook || 'Order Book'}
                </button>
                <button
                    onClick={() => setActiveTab('trades')}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === 'trades' ? `${activeBg} ${textPrimary}` : `${textSecondary}`
                        }`}
                >
                    {t.trading_recentTrades || 'Trades'}
                </button>

                {/* Intervals (only when chart tab is active) */}
                {activeTab === 'chart' && (
                    <div className="flex ml-auto gap-0.5">
                        {intervals.map(iv => (
                            <button
                                key={iv}
                                onClick={() => setInterval_(iv)}
                                className={`px-2 py-1 rounded text-xs transition-colors ${interval === iv ? 'bg-yellow-500/20 text-yellow-400 font-semibold' : `${textMuted}`
                                    }`}
                            >
                                {iv}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ===== Main Content Area ===== */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'chart' && (
                    <div className="h-full">
                        {candles.length > 0 ? (
                            <TradingKlineChart candles={candles} isPositive={isPositive} isDark={isDark} />
                        ) : (
                            <div className={`h-full flex items-center justify-center ${textMuted}`}>
                                <RefreshCw size={20} className="animate-spin mr-2" /> Loading chart...
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
                    />
                )}

                {activeTab === 'trades' && (
                    <div className="h-full overflow-y-auto">
                        <div className={`flex items-center justify-between px-3 py-1.5 text-xs ${textMuted} border-b ${border} sticky top-0 ${bg}`}>
                            <span className="w-1/3">{t.trading_price || 'Price'}</span>
                            <span className="w-1/3 text-right">{t.trading_amount || 'Amount'}</span>
                            <span className="w-1/3 text-right">{t.trading_time || 'Time'}</span>
                        </div>
                        {recentTrades.map((trade, i) => (
                            <div key={i} className={`flex items-center justify-between px-3 py-1 text-xs font-mono ${hoverBg}`}>
                                <span className={`w-1/3 ${trade.isBuy ? 'text-green-500' : 'text-red-500'}`}>
                                    {formatPrice(trade.price)}
                                </span>
                                <span className={`w-1/3 text-right ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{trade.amount.toFixed(4)}</span>
                                <span className={`w-1/3 text-right ${textMuted}`}>{formatTime(trade.time)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ===== Buy/Sell Panel ===== */}
            <div className={`border-t ${border} ${bgPanel} shrink-0`}>
                {/* Order Type Toggle */}
                <div className="flex items-center gap-1 px-3 pt-2">
                    <button
                        onClick={() => setOrderType('limit')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${orderType === 'limit' ? `${activeBg} ${textPrimary}` : textSecondary
                            }`}
                    >
                        {t.trading_limit || 'Limit'}
                    </button>
                    <button
                        onClick={() => setOrderType('market')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${orderType === 'market' ? `${activeBg} ${textPrimary}` : textSecondary
                            }`}
                    >
                        {t.trading_market || 'Market'}
                    </button>
                </div>

                {/* Buy/Sell Form */}
                <div className="grid grid-cols-2 gap-2 p-3">
                    {/* Buy Side */}
                    <div className="space-y-2">
                        {orderType === 'limit' && (
                            <div className="relative">
                                <input
                                    type="text"
                                    value={buyPrice}
                                    onChange={e => setBuyPrice(e.target.value)}
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
                                onChange={e => setBuyAmount(e.target.value)}
                                placeholder={t.trading_amount || 'Amount'}
                                className={`w-full ${inputBg} border rounded-lg px-3 py-2 text-sm ${textPrimary} placeholder-gray-500 focus:outline-none focus:border-green-500`}
                            />
                            <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${textMuted}`}>{selectedPair.base}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                            {['25%', '50%', '75%', '100%'].map(pct => (
                                <button key={pct} className={`py-1 text-xs ${textSecondary} ${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'} rounded transition-colors`}>
                                    {pct}
                                </button>
                            ))}
                        </div>
                        <button className="w-full py-2.5 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg text-sm transition-colors">
                            {t.trading_buy || 'Buy'} {selectedPair.base}
                        </button>
                    </div>

                    {/* Sell Side */}
                    <div className="space-y-2">
                        {orderType === 'limit' && (
                            <div className="relative">
                                <input
                                    type="text"
                                    value={sellPrice}
                                    onChange={e => setSellPrice(e.target.value)}
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
                                onChange={e => setSellAmount(e.target.value)}
                                placeholder={t.trading_amount || 'Amount'}
                                className={`w-full ${inputBg} border rounded-lg px-3 py-2 text-sm ${textPrimary} placeholder-gray-500 focus:outline-none focus:border-red-500`}
                            />
                            <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${textMuted}`}>{selectedPair.base}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                            {['25%', '50%', '75%', '100%'].map(pct => (
                                <button key={pct} className={`py-1 text-xs ${textSecondary} ${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300'} rounded transition-colors`}>
                                    {pct}
                                </button>
                            ))}
                        </div>
                        <button className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg text-sm transition-colors">
                            {t.trading_sell || 'Sell'} {selectedPair.base}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
