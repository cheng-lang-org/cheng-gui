import type { OrderBookEntry } from '../data/tradingData';
import { formatPrice } from '../data/tradingData';

interface TradingOrderBookProps {
    asks: OrderBookEntry[];
    bids: OrderBookEntry[];
    currentPrice: number;
    priceChange: number;
    pairSymbol: string;
}

export default function TradingOrderBook({ asks, bids, currentPrice, priceChange }: TradingOrderBookProps) {
    const maxTotal = Math.max(
        asks.length > 0 ? asks[0].total : 0,
        bids.length > 0 ? bids[bids.length - 1].total : 0
    );

    return (
        <div className="h-full flex flex-col text-xs font-mono bg-[#0d1117]">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1.5 text-gray-500 border-b border-gray-800">
                <span className="w-1/3">Price</span>
                <span className="w-1/3 text-right">Amount</span>
                <span className="w-1/3 text-right">Total</span>
            </div>

            {/* Asks (sells) - red */}
            <div className="flex-1 overflow-hidden flex flex-col justify-end">
                {asks.map((entry, i) => (
                    <div key={`ask-${i}`} className="relative flex items-center justify-between px-3 py-0.5 hover:bg-gray-800/50">
                        <div
                            className="absolute right-0 top-0 bottom-0 bg-red-500/10"
                            style={{ width: `${(entry.total / maxTotal) * 100}%` }}
                        />
                        <span className="relative text-red-400 w-1/3">{formatPrice(entry.price)}</span>
                        <span className="relative text-gray-300 w-1/3 text-right">{entry.amount.toFixed(4)}</span>
                        <span className="relative text-gray-500 w-1/3 text-right">{entry.total.toFixed(4)}</span>
                    </div>
                ))}
            </div>

            {/* Current Price */}
            <div className={`flex items-center justify-center gap-2 py-2 px-3 border-y border-gray-800 ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                <span className="text-lg font-bold">{formatPrice(currentPrice)}</span>
                <span className="text-xs">
                    {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
                </span>
            </div>

            {/* Bids (buys) - green */}
            <div className="flex-1 overflow-hidden">
                {bids.map((entry, i) => (
                    <div key={`bid-${i}`} className="relative flex items-center justify-between px-3 py-0.5 hover:bg-gray-800/50">
                        <div
                            className="absolute right-0 top-0 bottom-0 bg-green-500/10"
                            style={{ width: `${(entry.total / maxTotal) * 100}%` }}
                        />
                        <span className="relative text-green-400 w-1/3">{formatPrice(entry.price)}</span>
                        <span className="relative text-gray-300 w-1/3 text-right">{entry.amount.toFixed(4)}</span>
                        <span className="relative text-gray-500 w-1/3 text-right">{entry.total.toFixed(4)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
