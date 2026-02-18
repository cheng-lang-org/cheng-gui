// ===== Trading Data Types & Multi-Source Market Data =====
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface TradingPair {
    symbol: string;
    base: string;
    quote: string;
    binanceSymbol: string;
    coingeckoId: string;
    price: number;
    change24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    icon: string;
}

export interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface OrderBookEntry {
    price: number;
    amount: number;
    total: number;
}

export interface Trade {
    price: number;
    amount: number;
    time: number;
    isBuy: boolean;
}

export interface WalletAsset {
    symbol: string;
    name: string;
    balance: number;
    usdValue: number;
    icon: string;
    change24h: number;
}

const BINANCE_API = 'https://api.binance.com';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const GATE_API = 'https://api.gateio.ws/api/v4';
const OKX_API = 'https://www.okx.com/api/v5/market';
const BITGET_API = 'https://api.bitget.com/api/v2/spot/market';
const MIN_NETWORK_TIMEOUT_MS = 6000;

export const tradingPairs: TradingPair[] = [
    { symbol: 'BTC/USDC', base: 'BTC', quote: 'USDC', binanceSymbol: 'BTCUSDC', coingeckoId: 'bitcoin', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '₿' },
    { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', binanceSymbol: 'BTCUSDT', coingeckoId: 'bitcoin', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '₿' },
    { symbol: 'XAU/USDC', base: 'XAU', quote: 'USDC', binanceSymbol: 'PAXGUSDT', coingeckoId: 'pax-gold', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🥇' },
    { symbol: 'XAU/USDT', base: 'XAU', quote: 'USDT', binanceSymbol: 'PAXGUSDT', coingeckoId: 'pax-gold', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🥇' },
    { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', binanceSymbol: 'ETHUSDT', coingeckoId: 'ethereum', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: 'Ξ' },
    { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', binanceSymbol: 'SOLUSDT', coingeckoId: 'solana', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '◎' },
    { symbol: 'BNB/USDT', base: 'BNB', quote: 'USDT', binanceSymbol: 'BNBUSDT', coingeckoId: 'binancecoin', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🔶' },
    { symbol: 'XRP/USDT', base: 'XRP', quote: 'USDT', binanceSymbol: 'XRPUSDT', coingeckoId: 'ripple', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '✕' },
    { symbol: 'ADA/USDT', base: 'ADA', quote: 'USDT', binanceSymbol: 'ADAUSDT', coingeckoId: 'cardano', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🔵' },
    { symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', binanceSymbol: 'DOGEUSDT', coingeckoId: 'dogecoin', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🐕' },
    { symbol: 'AVAX/USDT', base: 'AVAX', quote: 'USDT', binanceSymbol: 'AVAXUSDT', coingeckoId: 'avalanche-2', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🔺' },
];

type DexRegion = 'CN' | 'GLOBAL';

interface RegionCache {
    region: DexRegion;
    countryCode: string;
    updatedAt: number;
}

const REGION_CACHE_KEY = 'dex_region_cache_v2';
const REGION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const symbolOverrides: Record<string, { gate: string; okx: string; bitget?: string }> = {
    PAXGUSDT: { gate: 'PAXG_USDT', okx: 'PAXG-USDT', bitget: 'PAXGUSDT' },
};

const intervalMap: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1h',
    '4H': '4h',
    '1D': '1d',
};

const intervalToOkx: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1H',
    '4H': '4H',
    '1D': '1D',
};

const intervalToGate: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1h',
    '4H': '4h',
    '1D': '1d',
};

const intervalToBitget: Record<string, string> = {
    '1m': '1min',
    '5m': '5min',
    '15m': '15min',
    '1H': '1h',
    '4H': '4h',
    '1D': '1day',
};

function getGateSymbol(pair: TradingPair): string {
    return symbolOverrides[pair.binanceSymbol]?.gate ?? `${pair.base}_${pair.quote}`;
}

function getOkxInstId(pair: TradingPair): string {
    return symbolOverrides[pair.binanceSymbol]?.okx ?? `${pair.base}-${pair.quote}`;
}

function getBitgetSymbol(pair: TradingPair): string {
    return symbolOverrides[pair.binanceSymbol]?.bitget ?? pair.binanceSymbol;
}

async function fetchWithTimeout(url: string, timeoutMs: number = 2200): Promise<Response> {
    const effectiveTimeout = Math.max(timeoutMs, MIN_NETWORK_TIMEOUT_MS);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
        const res = await fetch(url, { signal: controller.signal });
        return res;
    } finally {
        clearTimeout(id);
    }
}

function parseJsonBody<T>(payload: unknown): T {
    if (typeof payload === 'string') {
        return JSON.parse(payload) as T;
    }
    return payload as T;
}

async function fetchJsonByNativeHttp<T>(url: string, timeoutMs: number): Promise<T> {
    const response = await CapacitorHttp.get({
        url,
        headers: {
            Accept: 'application/json',
        },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return parseJsonBody<T>(response.data);
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
    const effectiveTimeout = Math.max(timeoutMs, MIN_NETWORK_TIMEOUT_MS);

    // Native runtime: use Capacitor HTTP first to bypass WebView CORS restrictions.
    if (Capacitor.isNativePlatform()) {
        try {
            return await fetchJsonByNativeHttp<T>(url, effectiveTimeout);
        } catch {
            // Fallback to fetch below.
        }
    }

    const res = await fetchWithTimeout(url, effectiveTimeout);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json() as Promise<T>;
}

function inferRegionFromLocale(): DexRegion {
    if (typeof Intl !== 'undefined') {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timezone === 'Asia/Shanghai' || timezone === 'Asia/Chongqing' || timezone === 'Asia/Urumqi') {
            return 'CN';
        }
    }
    if (typeof navigator !== 'undefined') {
        const lang = navigator.language?.toLowerCase() ?? '';
        if (lang.startsWith('zh-cn')) {
            return 'CN';
        }
    }
    return 'GLOBAL';
}

function readRegionCache(): DexRegion | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(REGION_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as RegionCache;
        if (!parsed.updatedAt || Date.now() - parsed.updatedAt > REGION_CACHE_TTL_MS) {
            localStorage.removeItem(REGION_CACHE_KEY);
            return null;
        }
        return parsed.region;
    } catch {
        return null;
    }
}

function saveRegionCache(region: DexRegion, countryCode: string): void {
    if (typeof localStorage === 'undefined') return;
    const payload: RegionCache = {
        region,
        countryCode,
        updatedAt: Date.now(),
    };
    try {
        localStorage.setItem(REGION_CACHE_KEY, JSON.stringify(payload));
    } catch {
        // ignore write failures
    }
}

function parseCountryCode(payload: Record<string, unknown>): string | null {
    const candidates = [payload.country, payload.countryCode, payload.country_code];
    for (const item of candidates) {
        if (typeof item === 'string' && item.trim().length === 2) {
            return item.trim().toUpperCase();
        }
    }
    return null;
}

async function lookupCountryByIp(): Promise<string | null> {
    const endpoints = [
        'https://api.country.is/',
        'https://ipapi.co/json/',
        'https://ipwho.is/',
    ];

    for (const endpoint of endpoints) {
        try {
            const payload = await fetchJsonWithTimeout<Record<string, unknown>>(endpoint, 1000);
            const countryCode = parseCountryCode(payload);
            if (countryCode) return countryCode;
        } catch {
            // continue probing
        }
    }
    return null;
}

function toDexRegion(countryCode: string | null): DexRegion {
    return countryCode === 'CN' ? 'CN' : 'GLOBAL';
}

let detectedRegion: DexRegion = readRegionCache() ?? inferRegionFromLocale();
let regionPromise: Promise<DexRegion> | null = null;

async function ensureDexRegionDetected(): Promise<DexRegion> {
    if (!regionPromise) {
        regionPromise = (async () => {
            const countryCode = await lookupCountryByIp();
            if (countryCode) {
                const region = toDexRegion(countryCode);
                detectedRegion = region;
                saveRegionCache(region, countryCode);
                return region;
            }
            return detectedRegion;
        })().catch(() => detectedRegion);
    }
    return regionPromise;
}

async function resolveDexRegion(maxWaitMs: number = 150): Promise<DexRegion> {
    const fallback = detectedRegion;
    try {
        return await Promise.race([
            ensureDexRegionDetected(),
            new Promise<DexRegion>((resolve) => setTimeout(() => resolve(fallback), maxWaitMs)),
        ]);
    } catch {
        return fallback;
    }
}

void ensureDexRegionDetected();

async function firstSuccessful<T>(providers: Array<() => Promise<T>>): Promise<T> {
    if (providers.length === 0) {
        throw new Error('No market provider configured');
    }

    return new Promise<T>((resolve, reject) => {
        let completed = 0;
        let settled = false;
        const errors: string[] = [];

        providers.forEach((provider, index) => {
            provider()
                .then((value) => {
                    if (!settled) {
                        settled = true;
                        resolve(value);
                    }
                })
                .catch((error) => {
                    completed += 1;
                    const msg = error instanceof Error ? error.message : String(error);
                    errors.push(`P${index + 1}:${msg}`);
                    if (!settled && completed === providers.length) {
                        reject(new Error(`All providers failed: ${errors.join(' | ')}`));
                    }
                });
        });
    });
}

function toNumber(value: string): number {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCandles(rows: Candle[], count: number): Candle[] {
    if (rows.length === 0) return rows;

    const sorted = rows
        .filter((row) =>
            Number.isFinite(row.time)
            && Number.isFinite(row.open)
            && Number.isFinite(row.high)
            && Number.isFinite(row.low)
            && Number.isFinite(row.close)
            && Number.isFinite(row.volume),
        )
        .sort((a, b) => a.time - b.time);

    if (sorted.length === 0) return [];

    const deduped: Candle[] = [];
    for (const row of sorted) {
        const last = deduped[deduped.length - 1];
        if (last && last.time === row.time) {
            deduped[deduped.length - 1] = row;
        } else {
            deduped.push(row);
        }
    }

    if (count <= 0 || deduped.length <= count) return deduped;
    return deduped.slice(deduped.length - count);
}

function withTotals(rows: Array<[string, string]>, reverseForAsks: boolean): OrderBookEntry[] {
    let total = 0;
    const parsed = rows.map(([priceRaw, amountRaw]) => {
        const price = toNumber(priceRaw);
        const amount = toNumber(amountRaw);
        total += amount;
        return {
            price,
            amount: +amount.toFixed(6),
            total: +total.toFixed(6),
        };
    });
    return reverseForAsks ? parsed.reverse() : parsed;
}

async function fetchCandlesFromBinance(pair: TradingPair, count: number, interval: string): Promise<Candle[]> {
    const iv = intervalMap[interval] ?? '1h';
    const url = `${BINANCE_API}/api/v3/klines?symbol=${pair.binanceSymbol}&interval=${iv}&limit=${count}`;
    const data = await fetchJsonWithTimeout<unknown[][]>(url, 2200);
    return data.map((k) => ({
        time: Number(k[0]),
        open: toNumber(String(k[1])),
        high: toNumber(String(k[2])),
        low: toNumber(String(k[3])),
        close: toNumber(String(k[4])),
        volume: toNumber(String(k[5])),
    }));
}

async function fetchCandlesFromGate(pair: TradingPair, count: number, interval: string): Promise<Candle[]> {
    const iv = intervalToGate[interval] ?? '1h';
    const url = `${GATE_API}/spot/candlesticks?currency_pair=${getGateSymbol(pair)}&interval=${iv}&limit=${count}`;
    const data = await fetchJsonWithTimeout<string[][]>(url, 2200);
    return data.map((k) => ({
        time: toNumber(k[0]) * 1000,
        open: toNumber(k[5]),
        high: toNumber(k[3]),
        low: toNumber(k[4]),
        close: toNumber(k[2]),
        volume: toNumber(k[1]),
    }));
}

interface OkxCandlesResponse {
    data: string[][];
}

async function fetchCandlesFromOkx(pair: TradingPair, count: number, interval: string): Promise<Candle[]> {
    const bar = intervalToOkx[interval] ?? '1H';
    const url = `${OKX_API}/candles?instId=${encodeURIComponent(getOkxInstId(pair))}&bar=${bar}&limit=${Math.min(count, 300)}`;
    const payload = await fetchJsonWithTimeout<OkxCandlesResponse>(url, 2200);
    return [...payload.data].reverse().map((k) => ({
        time: toNumber(k[0]),
        open: toNumber(k[1]),
        high: toNumber(k[2]),
        low: toNumber(k[3]),
        close: toNumber(k[4]),
        volume: toNumber(k[5]),
    }));
}

interface BitgetResponse<T> {
    code: string;
    msg: string;
    data: T;
}

async function fetchCandlesFromBitget(pair: TradingPair, count: number, interval: string): Promise<Candle[]> {
    const granularity = intervalToBitget[interval] ?? '1h';
    const url = `${BITGET_API}/candles?symbol=${encodeURIComponent(getBitgetSymbol(pair))}&granularity=${granularity}&limit=${Math.min(count, 200)}`;
    const payload = await fetchJsonWithTimeout<BitgetResponse<string[][]>>(url, 2200);
    if (payload.code !== '00000' || !Array.isArray(payload.data)) {
        throw new Error(`Bitget candles failed: ${payload.msg || payload.code}`);
    }
    return payload.data.map((k) => ({
        time: toNumber(k[0]),
        open: toNumber(k[1]),
        high: toNumber(k[2]),
        low: toNumber(k[3]),
        close: toNumber(k[4]),
        volume: toNumber(k[5]),
    }));
}

async function fetchCandlesFromCoinGecko(pair: TradingPair, interval: string): Promise<Candle[]> {
    let days = '1';
    if (interval === '4H') days = '30';
    if (interval === '1D') days = '90';

    const url = `${COINGECKO_API}/coins/${pair.coingeckoId}/ohlc?vs_currency=usd&days=${days}`;
    const data = await fetchJsonWithTimeout<number[][]>(url, 3000);

    return data.map((k) => ({
        time: k[0],
        open: k[1],
        high: k[2],
        low: k[3],
        close: k[4],
        volume: 0,
    }));
}

interface BinanceDepthResponse {
    asks: [string, string][];
    bids: [string, string][];
}

async function fetchOrderBookFromBinance(pair: TradingPair, depth: number): Promise<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }> {
    const url = `${BINANCE_API}/api/v3/depth?symbol=${pair.binanceSymbol}&limit=${Math.min(depth, 100)}`;
    const data = await fetchJsonWithTimeout<BinanceDepthResponse>(url, 2200);
    return {
        asks: withTotals(data.asks.slice(0, depth), true),
        bids: withTotals(data.bids.slice(0, depth), false),
    };
}

interface GateDepthResponse {
    asks: [string, string][];
    bids: [string, string][];
}

async function fetchOrderBookFromGate(pair: TradingPair, depth: number): Promise<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }> {
    const url = `${GATE_API}/spot/order_book?currency_pair=${getGateSymbol(pair)}&limit=${depth}`;
    const data = await fetchJsonWithTimeout<GateDepthResponse>(url, 2200);
    return {
        asks: withTotals(data.asks.slice(0, depth), true),
        bids: withTotals(data.bids.slice(0, depth), false),
    };
}

interface OkxBooksResponse {
    data: Array<{
        asks: [string, string, string, string][];
        bids: [string, string, string, string][];
    }>;
}

async function fetchOrderBookFromOkx(pair: TradingPair, depth: number): Promise<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }> {
    const url = `${OKX_API}/books?instId=${encodeURIComponent(getOkxInstId(pair))}&sz=${Math.min(depth, 50)}`;
    const payload = await fetchJsonWithTimeout<OkxBooksResponse>(url, 2200);
    const entry = payload.data[0];
    if (!entry) throw new Error('OKX order book empty');

    const asksRows = entry.asks.slice(0, depth).map((k) => [k[0], k[1]] as [string, string]);
    const bidsRows = entry.bids.slice(0, depth).map((k) => [k[0], k[1]] as [string, string]);

    return {
        asks: withTotals(asksRows, true),
        bids: withTotals(bidsRows, false),
    };
}

interface BitgetOrderBookData {
    asks: [string, string][];
    bids: [string, string][];
}

async function fetchOrderBookFromBitget(pair: TradingPair, depth: number): Promise<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }> {
    const url = `${BITGET_API}/orderbook?symbol=${encodeURIComponent(getBitgetSymbol(pair))}&type=step0&limit=${Math.min(depth, 50)}`;
    const payload = await fetchJsonWithTimeout<BitgetResponse<BitgetOrderBookData>>(url, 2200);
    if (payload.code !== '00000' || !payload.data) {
        throw new Error(`Bitget orderbook failed: ${payload.msg || payload.code}`);
    }
    return {
        asks: withTotals((payload.data.asks || []).slice(0, depth), true),
        bids: withTotals((payload.data.bids || []).slice(0, depth), false),
    };
}

interface BinanceTrade {
    price: string;
    qty: string;
    time: number;
    isBuyerMaker: boolean;
}

async function fetchTradesFromBinance(pair: TradingPair, count: number): Promise<Trade[]> {
    const url = `${BINANCE_API}/api/v3/trades?symbol=${pair.binanceSymbol}&limit=${Math.min(count, 100)}`;
    const data = await fetchJsonWithTimeout<BinanceTrade[]>(url, 2200);
    return data.map((t) => ({
        price: toNumber(t.price),
        amount: toNumber(t.qty),
        time: t.time,
        isBuy: !t.isBuyerMaker,
    }));
}

interface GateTrade {
    create_time_ms: string;
    side: 'buy' | 'sell';
    price: string;
    amount: string;
}

async function fetchTradesFromGate(pair: TradingPair, count: number): Promise<Trade[]> {
    const url = `${GATE_API}/spot/trades?currency_pair=${getGateSymbol(pair)}&limit=${Math.min(count, 100)}`;
    const data = await fetchJsonWithTimeout<GateTrade[]>(url, 2200);
    return data.reverse().map((t) => ({
        price: toNumber(t.price),
        amount: toNumber(t.amount),
        time: toNumber(t.create_time_ms),
        isBuy: t.side === 'buy',
    }));
}

interface OkxTrade {
    px: string;
    sz: string;
    ts: string;
    side: 'buy' | 'sell';
}

interface OkxTradesResponse {
    data: OkxTrade[];
}

async function fetchTradesFromOkx(pair: TradingPair, count: number): Promise<Trade[]> {
    const url = `${OKX_API}/trades?instId=${encodeURIComponent(getOkxInstId(pair))}&limit=${Math.min(count, 100)}`;
    const payload = await fetchJsonWithTimeout<OkxTradesResponse>(url, 2200);
    return payload.data.reverse().map((t) => ({
        price: toNumber(t.px),
        amount: toNumber(t.sz),
        time: toNumber(t.ts),
        isBuy: t.side === 'buy',
    }));
}

interface BitgetTrade {
    side: 'buy' | 'sell';
    price: string;
    size: string;
    ts: string;
}

async function fetchTradesFromBitget(pair: TradingPair, count: number): Promise<Trade[]> {
    const url = `${BITGET_API}/fills?symbol=${encodeURIComponent(getBitgetSymbol(pair))}&limit=${Math.min(count, 100)}`;
    const payload = await fetchJsonWithTimeout<BitgetResponse<BitgetTrade[]>>(url, 2200);
    if (payload.code !== '00000' || !Array.isArray(payload.data)) {
        throw new Error(`Bitget trades failed: ${payload.msg || payload.code}`);
    }
    return payload.data.reverse().map((t) => ({
        price: toNumber(t.price),
        amount: toNumber(t.size),
        time: toNumber(t.ts),
        isBuy: t.side === 'buy',
    }));
}

interface TickerSnapshot {
    price: number;
    change24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
}

async function fetchTickerFromBinance(pair: TradingPair): Promise<Partial<TradingPair>> {
    const url = `${BINANCE_API}/api/v3/ticker/24hr?symbol=${pair.binanceSymbol}`;
    const data = await fetchJsonWithTimeout<Record<string, string>>(url, 2200);
    return {
        price: toNumber(data.lastPrice),
        change24h: toNumber(data.priceChangePercent),
        high24h: toNumber(data.highPrice),
        low24h: toNumber(data.lowPrice),
        volume24h: toNumber(data.quoteVolume),
    };
}

async function fetchTickerFromGate(pair: TradingPair): Promise<Partial<TradingPair>> {
    const url = `${GATE_API}/spot/tickers?currency_pair=${getGateSymbol(pair)}`;
    const data = await fetchJsonWithTimeout<Array<Record<string, string>>>(url, 2200);
    const ticker = data[0];
    if (!ticker) throw new Error('Gate ticker empty');

    return {
        price: toNumber(ticker.last),
        change24h: toNumber(ticker.change_percentage),
        high24h: toNumber(ticker.high_24h),
        low24h: toNumber(ticker.low_24h),
        volume24h: toNumber(ticker.base_volume),
    };
}

interface OkxTicker {
    instId: string;
    last: string;
    high24h: string;
    low24h: string;
    open24h: string;
    volCcy24h: string;
}

interface OkxTickerResponse {
    data: OkxTicker[];
}

function toTickerSnapshotFromOkx(t: OkxTicker): TickerSnapshot {
    const last = toNumber(t.last);
    const open24h = toNumber(t.open24h);
    const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
    return {
        price: last,
        change24h,
        high24h: toNumber(t.high24h),
        low24h: toNumber(t.low24h),
        volume24h: toNumber(t.volCcy24h),
    };
}

async function fetchTickerFromOkx(pair: TradingPair): Promise<Partial<TradingPair>> {
    const url = `${OKX_API}/ticker?instId=${encodeURIComponent(getOkxInstId(pair))}`;
    const payload = await fetchJsonWithTimeout<OkxTickerResponse>(url, 2200);
    const ticker = payload.data[0];
    if (!ticker) throw new Error('OKX ticker empty');
    return toTickerSnapshotFromOkx(ticker);
}

interface BitgetTicker {
    symbol: string;
    open: string;
    high24h: string;
    low24h: string;
    lastPr: string;
    quoteVolume: string;
}

function toTickerSnapshotFromBitget(t: BitgetTicker): TickerSnapshot {
    const last = toNumber(t.lastPr);
    const open24h = toNumber(t.open);
    const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
    return {
        price: last,
        change24h,
        high24h: toNumber(t.high24h),
        low24h: toNumber(t.low24h),
        volume24h: toNumber(t.quoteVolume),
    };
}

async function fetchTickerFromBitget(pair: TradingPair): Promise<Partial<TradingPair>> {
    const url = `${BITGET_API}/tickers?symbol=${encodeURIComponent(getBitgetSymbol(pair))}`;
    const payload = await fetchJsonWithTimeout<BitgetResponse<BitgetTicker[]>>(url, 2200);
    const ticker = Array.isArray(payload.data) ? payload.data[0] : null;
    if (payload.code !== '00000' || !ticker) {
        throw new Error(`Bitget ticker failed: ${payload.msg || payload.code}`);
    }
    return toTickerSnapshotFromBitget(ticker);
}

function mergeTickerIntoPair(pair: TradingPair, ticker: Partial<TradingPair>): TradingPair {
    return {
        ...pair,
        price: ticker.price ?? pair.price,
        change24h: ticker.change24h ?? pair.change24h,
        high24h: ticker.high24h ?? pair.high24h,
        low24h: ticker.low24h ?? pair.low24h,
        volume24h: ticker.volume24h ?? pair.volume24h,
    };
}

async function fetchAllTickersFromBinance(): Promise<TradingPair[]> {
    const symbols = tradingPairs.map((p) => `"${p.binanceSymbol}"`).join(',');
    const url = `${BINANCE_API}/api/v3/ticker/24hr?symbols=[${symbols}]`;
    const rows = await fetchJsonWithTimeout<Array<Record<string, string>>>(url, 3000);
    return tradingPairs.map((pair) => {
        const ticker = rows.find((row) => row.symbol === pair.binanceSymbol);
        if (!ticker) return pair;
        return mergeTickerIntoPair(pair, {
            price: toNumber(ticker.lastPrice),
            change24h: toNumber(ticker.priceChangePercent),
            high24h: toNumber(ticker.highPrice),
            low24h: toNumber(ticker.lowPrice),
            volume24h: toNumber(ticker.quoteVolume),
        });
    });
}

async function fetchAllTickersFromGate(): Promise<TradingPair[]> {
    const url = `${GATE_API}/spot/tickers`;
    const rows = await fetchJsonWithTimeout<Array<Record<string, string>>>(url, 3000);

    return tradingPairs.map((pair) => {
        const ticker = rows.find((row) => row.currency_pair === getGateSymbol(pair));
        if (!ticker) return pair;
        return mergeTickerIntoPair(pair, {
            price: toNumber(ticker.last),
            change24h: toNumber(ticker.change_percentage),
            high24h: toNumber(ticker.high_24h),
            low24h: toNumber(ticker.low_24h),
            volume24h: toNumber(ticker.base_volume),
        });
    });
}

interface OkxTickersResponse {
    data: OkxTicker[];
}

async function fetchAllTickersFromOkx(): Promise<TradingPair[]> {
    const url = `${OKX_API}/tickers?instType=SPOT`;
    const payload = await fetchJsonWithTimeout<OkxTickersResponse>(url, 3000);

    return tradingPairs.map((pair) => {
        const ticker = payload.data.find((row) => row.instId === getOkxInstId(pair));
        if (!ticker) return pair;
        return mergeTickerIntoPair(pair, toTickerSnapshotFromOkx(ticker));
    });
}

async function fetchAllTickersFromBitget(): Promise<TradingPair[]> {
    const url = `${BITGET_API}/tickers`;
    const payload = await fetchJsonWithTimeout<BitgetResponse<BitgetTicker[]>>(url, 3000);
    if (payload.code !== '00000' || !Array.isArray(payload.data)) {
        throw new Error(`Bitget all tickers failed: ${payload.msg || payload.code}`);
    }

    return tradingPairs.map((pair) => {
        const ticker = payload.data.find((row) => row.symbol === getBitgetSymbol(pair));
        if (!ticker) return pair;
        return mergeTickerIntoPair(pair, toTickerSnapshotFromBitget(ticker));
    });
}

export async function fetchCandles(pair: TradingPair, count: number = 120, interval: string = '1H'): Promise<Candle[]> {
    const region = await resolveDexRegion();
    const providers = region === 'CN'
        ? [
            () => fetchCandlesFromBitget(pair, count, interval),
            () => fetchCandlesFromBinance(pair, count, interval),
            () => fetchCandlesFromOkx(pair, count, interval),
            () => fetchCandlesFromGate(pair, count, interval),
            () => fetchCandlesFromCoinGecko(pair, interval),
        ]
        : [
            () => fetchCandlesFromBinance(pair, count, interval),
            () => fetchCandlesFromBitget(pair, count, interval),
            () => fetchCandlesFromOkx(pair, count, interval),
            () => fetchCandlesFromGate(pair, count, interval),
            () => fetchCandlesFromCoinGecko(pair, interval),
        ];

    const candles = await firstSuccessful(providers);
    return normalizeCandles(candles, count);
}

export async function fetchOrderBook(pair: TradingPair, depth: number = 12): Promise<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }> {
    const region = await resolveDexRegion();
    const providers = region === 'CN'
        ? [
            () => fetchOrderBookFromBitget(pair, depth),
            () => fetchOrderBookFromBinance(pair, depth),
            () => fetchOrderBookFromOkx(pair, depth),
            () => fetchOrderBookFromGate(pair, depth),
        ]
        : [
            () => fetchOrderBookFromBinance(pair, depth),
            () => fetchOrderBookFromBitget(pair, depth),
            () => fetchOrderBookFromOkx(pair, depth),
            () => fetchOrderBookFromGate(pair, depth),
        ];

    return firstSuccessful(providers);
}

export async function fetchTrades(pair: TradingPair, count: number = 20): Promise<Trade[]> {
    const region = await resolveDexRegion();
    const providers = region === 'CN'
        ? [
            () => fetchTradesFromBitget(pair, count),
            () => fetchTradesFromBinance(pair, count),
            () => fetchTradesFromOkx(pair, count),
            () => fetchTradesFromGate(pair, count),
        ]
        : [
            () => fetchTradesFromBinance(pair, count),
            () => fetchTradesFromBitget(pair, count),
            () => fetchTradesFromOkx(pair, count),
            () => fetchTradesFromGate(pair, count),
        ];

    return firstSuccessful(providers);
}

export async function fetchTicker24h(pair: TradingPair): Promise<Partial<TradingPair>> {
    const region = await resolveDexRegion();
    const providers = region === 'CN'
        ? [
            () => fetchTickerFromBitget(pair),
            () => fetchTickerFromBinance(pair),
            () => fetchTickerFromOkx(pair),
            () => fetchTickerFromGate(pair),
        ]
        : [
            () => fetchTickerFromBinance(pair),
            () => fetchTickerFromBitget(pair),
            () => fetchTickerFromOkx(pair),
            () => fetchTickerFromGate(pair),
        ];

    return firstSuccessful(providers);
}

export async function fetchAllTickers(): Promise<TradingPair[]> {
    const region = await resolveDexRegion(250);

    const providers = region === 'CN'
        ? [
            () => fetchAllTickersFromBitget(),
            () => fetchAllTickersFromBinance(),
            () => fetchAllTickersFromOkx(),
            () => fetchAllTickersFromGate(),
        ]
        : [
            () => fetchAllTickersFromBinance(),
            () => fetchAllTickersFromBitget(),
            () => fetchAllTickersFromOkx(),
            () => fetchAllTickersFromGate(),
        ];

    try {
        return await firstSuccessful(providers);
    } catch {
        return tradingPairs;
    }
}

// Wallet assets are initialized as zero to avoid simulated balances.
export const walletAssets: WalletAsset[] = [
    { symbol: 'BTC', name: 'Bitcoin', balance: 0, usdValue: 0, icon: '₿', change24h: 0 },
    { symbol: 'ETH', name: 'Ethereum', balance: 0, usdValue: 0, icon: 'Ξ', change24h: 0 },
    { symbol: 'USDT', name: 'Tether', balance: 0, usdValue: 0, icon: '₮', change24h: 0 },
    { symbol: 'SOL', name: 'Solana', balance: 0, usdValue: 0, icon: '◎', change24h: 0 },
    { symbol: 'BNB', name: 'BNB', balance: 0, usdValue: 0, icon: '🔶', change24h: 0 },
    { symbol: 'USDC', name: 'USD Coin', balance: 0, usdValue: 0, icon: '💲', change24h: 0 },
    { symbol: 'XRP', name: 'Ripple', balance: 0, usdValue: 0, icon: '✕', change24h: 0 },
    { symbol: 'ADA', name: 'Cardano', balance: 0, usdValue: 0, icon: '🔵', change24h: 0 },
    { symbol: 'DOGE', name: 'Dogecoin', balance: 0, usdValue: 0, icon: '🐕', change24h: 0 },
    { symbol: 'AVAX', name: 'Avalanche', balance: 0, usdValue: 0, icon: '🔺', change24h: 0 },
];

export function formatPrice(price: number): string {
    if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(2);
    if (price <= 0) return '0.00';
    return price.toFixed(4);
}

export function formatVolume(vol: number): string {
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(2)}K`;
    return vol.toFixed(2);
}

export function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}
