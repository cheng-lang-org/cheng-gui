/**
 * Trading Data Hook
 * Extracted from TradingPage for better maintainability
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    tradingPairs,
    fetchAllTickers,
    fetchCandles,
    fetchOrderBook,
    fetchTrades,
    fetchTicker24h,
    type TradingPair,
    type Candle,
    type OrderBookEntry,
    type Trade,
} from '../data/tradingData';

type TimeInterval = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';
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
    '1m': 2_000,
    '5m': 3_000,
    '15m': 4_000,
    '1H': 5_000,
    '4H': 6_000,
    '1D': 8_000,
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

export interface TradingDataState {
    pairs: TradingPair[];
    selectedPair: TradingPair;
    candles: Candle[];
    orderBook: { asks: OrderBookEntry[]; bids: OrderBookEntry[] };
    recentTrades: Trade[];
    dexHealth: DexHealth;
    loadError: string;
    loading: boolean;
}

export interface TradingDataActions {
    setSelectedPair: (pair: TradingPair) => void;
    refresh: () => void;
}

export function useTradingData(interval: TimeInterval): [TradingDataState, TradingDataActions] {
    const [pairs, setPairs] = useState<TradingPair[]>(tradingPairs);
    const [selectedPair, setSelectedPair] = useState<TradingPair>(tradingPairs[0]);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [orderBook, setOrderBook] = useState<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }>({ asks: [], bids: [] });
    const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
    const [dexHealth, setDexHealth] = useState<DexHealth>('partial');
    const [loadError, setLoadError] = useState('');
    const [loading, setLoading] = useState(true);

    const refreshTimerRef = useRef<number | null>(null);
    const loadingRef = useRef(false);

    // Load all tickers on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const updated = await fetchAllTickers();
                if (!cancelled) {
                    setPairs(updated);
                    const current = updated.find(p => p.binanceSymbol === selectedPair.binanceSymbol);
                    if (current) setSelectedPair(current);
                    if (updated.some(pair => pair.price > 0)) {
                        setDexHealth('live');
                        setLoadError('');
                    }
                }
            } catch (error) {
                console.warn('[DEX] Initial tickers fetch failed:', error);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load data for selected pair
    const loadData = useCallback(async (pair: TradingPair, iv: TimeInterval) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);

        try {
            const results = await Promise.allSettled([
                fetchCandles(pair, 120, iv),
                fetchOrderBook(pair, 15),
                fetchTrades(pair, 30),
                fetchTicker24h(pair),
            ]);

            let okCount = 0;
            const failedParts: string[] = [];
            let livePrice = 0;
            let tickerPrice = 0;
            let tradePrice = 0;
            let orderBookMidPrice = 0;

            const tradesResult = results[2];
            if (tradesResult.status === 'fulfilled') {
                setRecentTrades(tradesResult.value);
                const latestTrade = tradesResult.value[tradesResult.value.length - 1];
                tradePrice = latestTrade?.price ?? 0;
                okCount += 1;
            } else {
                failedParts.push('成交');
            }

            const orderBookResult = results[1];
            if (orderBookResult.status === 'fulfilled') {
                setOrderBook(orderBookResult.value);
                const askPrices = orderBookResult.value.asks.map(row => row.price).filter(price => price > 0);
                const bidPrices = orderBookResult.value.bids.map(row => row.price).filter(price => price > 0);
                if (askPrices.length > 0 && bidPrices.length > 0) {
                    const bestAsk = Math.min(...askPrices);
                    const bestBid = Math.max(...bidPrices);
                    orderBookMidPrice = (bestAsk + bestBid) / 2;
                }
                okCount += 1;
            } else {
                failedParts.push('盘口');
            }

            const tickerResult = results[3];
            if (tickerResult.status === 'fulfilled') {
                tickerPrice = tickerResult.value.price ?? 0;
                setSelectedPair(prev => ({ ...prev, ...tickerResult.value }));
                setPairs(prev => prev.map(p =>
                    p.binanceSymbol === pair.binanceSymbol ? { ...p, ...tickerResult.value } : p
                ));
                okCount += 1;
            } else {
                failedParts.push('24h');
            }

            livePrice = tradePrice || tickerPrice || orderBookMidPrice;
            if (livePrice > 0) {
                setSelectedPair(prev => ({ ...prev, price: livePrice }));
                setPairs(prev => prev.map(p =>
                    p.binanceSymbol === pair.binanceSymbol ? { ...p, price: livePrice } : p
                ));
            }

            const candleResult = results[0];
            if (candleResult.status === 'fulfilled') {
                const synced = syncCandlesWithLivePrice(candleResult.value, livePrice, iv);
                setCandles(synced);
                okCount += 1;
            } else {
                failedParts.push('K线');
                if (livePrice > 0) {
                    setCandles(prev => syncCandlesWithLivePrice(prev, livePrice, iv));
                }
            }

            if (okCount === 0) {
                setDexHealth('offline');
                setLoadError('行情暂时不可用，请稍后重试。');
            } else if (failedParts.length > 0) {
                setDexHealth('partial');
                setLoadError(`部分数据更新失败：${failedParts.join('、')}`);
            } else {
                setDexHealth('live');
                setLoadError('');
            }
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, []);

    // Auto-refresh
    useEffect(() => {
        loadData(selectedPair, interval);

        const refreshMs = refreshIntervalByTimeframe[interval];
        if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = window.setInterval(() => {
            loadData(selectedPair, interval);
        }, refreshMs);

        return () => {
            if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPair.binanceSymbol, interval]);

    const handleSelectPair = useCallback((pair: TradingPair) => {
        setSelectedPair(pair);
    }, []);

    const handleRefresh = useCallback(() => {
        loadData(selectedPair, interval);
    }, [loadData, selectedPair, interval]);

    return [
        {
            pairs,
            selectedPair,
            candles,
            orderBook,
            recentTrades,
            dexHealth,
            loadError,
            loading,
        },
        {
            setSelectedPair: handleSelectPair,
            refresh: handleRefresh,
        },
    ];
}
