// ===== Trading Data Types & Real Binance API Integration =====

export interface TradingPair {
    symbol: string;       // e.g. 'BTC/USDC'
    base: string;         // e.g. 'BTC'
    quote: string;        // e.g. 'USDC'
    binanceSymbol: string; // e.g. 'BTCUSDC' - Binance API format
    price: number;
    change24h: number;    // percentage
    high24h: number;
    low24h: number;
    volume24h: number;
    icon: string;         // emoji
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

// ===== Binance API Base URL =====
const BINANCE_API = 'https://api.binance.com';

// ===== Trading Pairs (with Binance symbol mapping) =====
export const tradingPairs: TradingPair[] = [
    { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', binanceSymbol: 'BTCUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '₿' },
    { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', binanceSymbol: 'ETHUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: 'Ξ' },
    { symbol: 'SOL/USDT', base: 'SOL', quote: 'USDT', binanceSymbol: 'SOLUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '◎' },
    { symbol: 'BNB/USDT', base: 'BNB', quote: 'USDT', binanceSymbol: 'BNBUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🔶' },
    { symbol: 'XRP/USDT', base: 'XRP', quote: 'USDT', binanceSymbol: 'XRPUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '✕' },
    { symbol: 'ADA/USDT', base: 'ADA', quote: 'USDT', binanceSymbol: 'ADAUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🔵' },
    { symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', binanceSymbol: 'DOGEUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🐕' },
    { symbol: 'AVAX/USDT', base: 'AVAX', quote: 'USDT', binanceSymbol: 'AVAXUSDT', price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, icon: '🔺' },
];

// ===== Interval mapping (our format -> Binance format) =====
const intervalMap: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1h',
    '4H': '4h',
    '1D': '1d',
};

// ===== Binance REST API Fetchers =====

/**
 * Fetch real K-line/candlestick data from Binance
 * API: GET /api/v3/klines
 */
export async function fetchCandles(pair: TradingPair, count: number = 120, interval: string = '1H'): Promise<Candle[]> {
    const binanceInterval = intervalMap[interval] || '1h';
    const url = `${BINANCE_API}/api/v3/klines?symbol=${pair.binanceSymbol}&interval=${binanceInterval}&limit=${count}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Klines API error: ${res.status}`);

    // Binance klines response: [[openTime, open, high, low, close, volume, closeTime, ...], ...]
    const data: unknown[][] = await res.json();

    return data.map((k) => ({
        time: k[0] as number,
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
    }));
}

/**
 * Fetch real order book depth from Binance
 * API: GET /api/v3/depth
 */
export async function fetchOrderBook(pair: TradingPair, depth: number = 12): Promise<{ asks: OrderBookEntry[]; bids: OrderBookEntry[] }> {
    const url = `${BINANCE_API}/api/v3/depth?symbol=${pair.binanceSymbol}&limit=${Math.min(depth, 100)}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Depth API error: ${res.status}`);

    const data: { asks: [string, string][]; bids: [string, string][] } = await res.json();

    let askTotal = 0;
    const asks: OrderBookEntry[] = data.asks.slice(0, depth).map(([p, a]) => {
        const price = parseFloat(p);
        const amount = parseFloat(a);
        askTotal += amount;
        return { price, amount: +amount.toFixed(6), total: +askTotal.toFixed(6) };
    }).reverse(); // display highest ask at top

    let bidTotal = 0;
    const bids: OrderBookEntry[] = data.bids.slice(0, depth).map(([p, a]) => {
        const price = parseFloat(p);
        const amount = parseFloat(a);
        bidTotal += amount;
        return { price, amount: +amount.toFixed(6), total: +bidTotal.toFixed(6) };
    });

    return { asks, bids };
}

/**
 * Fetch recent trades from Binance
 * API: GET /api/v3/trades
 */
export async function fetchTrades(pair: TradingPair, count: number = 20): Promise<Trade[]> {
    const url = `${BINANCE_API}/api/v3/trades?symbol=${pair.binanceSymbol}&limit=${count}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Trades API error: ${res.status}`);

    // Binance trades: [{price, qty, time, isBuyerMaker, ...}, ...]
    const data: { price: string; qty: string; time: number; isBuyerMaker: boolean }[] = await res.json();

    return data.reverse().map((t) => ({
        price: parseFloat(t.price),
        amount: parseFloat(t.qty),
        time: t.time,
        isBuy: !t.isBuyerMaker, // isBuyerMaker=true means seller initiated, so buyer is maker
    }));
}

/**
 * Fetch 24h ticker statistics from Binance
 * API: GET /api/v3/ticker/24hr
 */
export async function fetchTicker24h(pair: TradingPair): Promise<Partial<TradingPair>> {
    const url = `${BINANCE_API}/api/v3/ticker/24hr?symbol=${pair.binanceSymbol}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ticker API error: ${res.status}`);

    const data: {
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        volume: string;
        quoteVolume: string;
    } = await res.json();

    return {
        price: parseFloat(data.lastPrice),
        change24h: parseFloat(data.priceChangePercent),
        high24h: parseFloat(data.highPrice),
        low24h: parseFloat(data.lowPrice),
        volume24h: parseFloat(data.quoteVolume), // use quote volume for USD value
    };
}

/**
 * Fetch all tickers to hydrate the trading pairs list on initial load
 */
export async function fetchAllTickers(): Promise<TradingPair[]> {
    // Batch request for specific symbols
    const symbols = tradingPairs.map(p => `"${p.binanceSymbol}"`).join(',');
    const url = `${BINANCE_API}/api/v3/ticker/24hr?symbols=[${symbols}]`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tickers API error: ${res.status}`);

    const data: {
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        volume: string;
        quoteVolume: string;
    }[] = await res.json();

    return tradingPairs.map(pair => {
        const ticker = data.find(d => d.symbol === pair.binanceSymbol);
        if (!ticker) return pair;
        return {
            ...pair,
            price: parseFloat(ticker.lastPrice),
            change24h: parseFloat(ticker.priceChangePercent),
            high24h: parseFloat(ticker.highPrice),
            low24h: parseFloat(ticker.lowPrice),
            volume24h: parseFloat(ticker.quoteVolume),
        };
    });
}

// ===== Mock Data Fallback (used when API is unavailable) =====

const mockPrices: Record<string, number> = {
    'BTCUSDT': 97842.56,
    'ETHUSDT': 3456.78,
    'SOLUSDT': 198.45,
    'BNBUSDT': 645.32,
    'XRPUSDT': 2.34,
    'ADAUSDT': 0.98,
    'DOGEUSDT': 0.38,
    'AVAXUSDT': 42.56,
};

export function generateMockCandles(pair: TradingPair, count: number = 120, interval: string = '1H'): Candle[] {
    const candles: Candle[] = [];
    const now = Date.now();
    const intervalMs: Record<string, number> = {
        '1m': 60_000, '5m': 300_000, '15m': 900_000,
        '1H': 3_600_000, '4H': 14_400_000, '1D': 86_400_000,
    };
    const ms = intervalMs[interval] || 3_600_000;
    const basePrice = mockPrices[pair.binanceSymbol] || pair.price || 100;
    let currentPrice = basePrice * 0.95;

    for (let i = 0; i < count; i++) {
        const volatility = basePrice * 0.008;
        const trend = (basePrice - currentPrice) / (count - i) * 0.3;
        const open = currentPrice;
        const change = (Math.random() - 0.48) * volatility + trend;
        const close = open + change;
        const high = Math.max(open, close) + Math.random() * volatility * 0.5;
        const low = Math.min(open, close) - Math.random() * volatility * 0.5;
        const volume = (pair.volume24h || 1_000_000) / 24 * (0.3 + Math.random() * 1.4);

        candles.push({
            time: now - (count - i) * ms,
            open: +open.toFixed(2),
            high: +high.toFixed(2),
            low: +low.toFixed(2),
            close: +close.toFixed(2),
            volume: Math.round(volume),
        });
        currentPrice = close;
    }
    return candles;
}

export function generateMockOrderBook(pair: TradingPair, depth: number = 12): { asks: OrderBookEntry[]; bids: OrderBookEntry[] } {
    const asks: OrderBookEntry[] = [];
    const bids: OrderBookEntry[] = [];
    const basePrice = pair.price || mockPrices[pair.binanceSymbol] || 100;
    const spread = basePrice * 0.0005;
    let askTotal = 0, bidTotal = 0;

    for (let i = 0; i < depth; i++) {
        const askPrice = +(basePrice + spread + i * basePrice * 0.0003).toFixed(2);
        const askAmount = +(Math.random() * 2 + 0.1).toFixed(4);
        askTotal += askAmount;
        asks.push({ price: askPrice, amount: askAmount, total: +askTotal.toFixed(4) });

        const bidPrice = +(basePrice - spread - i * basePrice * 0.0003).toFixed(2);
        const bidAmount = +(Math.random() * 2 + 0.1).toFixed(4);
        bidTotal += bidAmount;
        bids.push({ price: bidPrice, amount: bidAmount, total: +bidTotal.toFixed(4) });
    }
    return { asks: asks.reverse(), bids };
}

export function generateMockTrades(pair: TradingPair, count: number = 20): Trade[] {
    const trades: Trade[] = [];
    const now = Date.now();
    const basePrice = pair.price || mockPrices[pair.binanceSymbol] || 100;

    for (let i = 0; i < count; i++) {
        const offset = (Math.random() - 0.5) * basePrice * 0.002;
        trades.push({
            price: +(basePrice + offset).toFixed(2),
            amount: +(Math.random() * 1.5 + 0.01).toFixed(4),
            time: now - i * (Math.random() * 30_000 + 5_000),
            isBuy: Math.random() > 0.45,
        });
    }
    return trades;
}

// ===== Wallet Mock Data =====
export const walletAssets: WalletAsset[] = [
    { symbol: 'BTC', name: 'Bitcoin', balance: 0.2456, usdValue: 24028.48, icon: '₿', change24h: 2.34 },
    { symbol: 'ETH', name: 'Ethereum', balance: 3.8721, usdValue: 13386.42, icon: 'Ξ', change24h: -1.25 },
    { symbol: 'USDT', name: 'Tether', balance: 15000.00, usdValue: 15000.00, icon: '₮', change24h: 0.01 },
    { symbol: 'SOL', name: 'Solana', balance: 45.32, usdValue: 8993.72, icon: '◎', change24h: 5.67 },
    { symbol: 'BNB', name: 'BNB', balance: 12.5, usdValue: 8066.50, icon: '🔶', change24h: 0.89 },
    { symbol: 'USDC', name: 'USD Coin', balance: 5000.00, usdValue: 5000.00, icon: '💲', change24h: 0.00 },
    { symbol: 'XRP', name: 'Ripple', balance: 2500, usdValue: 5850.00, icon: '✕', change24h: -0.56 },
    { symbol: 'ADA', name: 'Cardano', balance: 3000, usdValue: 2940.00, icon: '🔵', change24h: 3.21 },
    { symbol: 'DOGE', name: 'Dogecoin', balance: 5000, usdValue: 1900.00, icon: '🐕', change24h: -2.15 },
    { symbol: 'AVAX', name: 'Avalanche', balance: 50, usdValue: 2128.00, icon: '🔺', change24h: 1.78 },
];

// ===== Formatting Helpers =====
export function formatPrice(price: number): string {
    if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(4);
}

export function formatVolume(vol: number): string {
    if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(2) + 'B';
    if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(2) + 'M';
    if (vol >= 1_000) return (vol / 1_000).toFixed(2) + 'K';
    return vol.toFixed(2);
}

export function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
