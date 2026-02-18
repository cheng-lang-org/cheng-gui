import { useState } from 'react';
import { Wallet, ArrowUpRight, ArrowDownLeft, Eye, EyeOff, Copy, CheckCircle } from 'lucide-react';
import { walletAssets, formatPrice } from '../data/tradingData';
import { useLocale } from '../i18n/LocaleContext';

interface TradingWalletProps {
    onClose: () => void;
    onSelectPair?: (symbol: string) => void;
}

export default function TradingWallet({ onClose, onSelectPair }: TradingWalletProps) {
    const [hideBalance, setHideBalance] = useState(false);
    const [copied, setCopied] = useState(false);
    const { t } = useLocale();

    const totalUsd = walletAssets.reduce((sum, a) => sum + a.usdValue, 0);
    const walletAddress = '0x7a3F...8c2E';

    const handleCopy = () => {
        navigator.clipboard?.writeText('0x7a3F1234567890abcdef1234567890abcdef8c2E');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-[#0d1117] z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <Wallet size={20} className="text-yellow-400" />
                    <span className="font-semibold text-white">{t.trading_wallet || 'Web3 Wallet'}</span>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-gray-800 transition-colors">
                    ✕
                </button>
            </header>

            {/* Total Balance */}
            <div className="px-4 py-6 bg-gradient-to-br from-gray-900 via-[#0d1117] to-gray-900">
                <div className="text-gray-400 text-sm mb-1 flex items-center gap-2">
                    {t.trading_totalAssets || 'Total Assets'}
                    <button onClick={() => setHideBalance(!hideBalance)} className="p-0.5">
                        {hideBalance ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                </div>
                <div className="text-3xl font-bold text-white mb-2">
                    {hideBalance ? '****.**' : `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{walletAddress}</span>
                    <button onClick={handleCopy} className="hover:text-gray-300 transition-colors">
                        {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
                    </button>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 mt-4">
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium transition-colors">
                        <ArrowDownLeft size={16} />
                        {t.trading_deposit || 'Deposit'}
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm font-medium transition-colors">
                        <ArrowUpRight size={16} />
                        {t.trading_withdraw || 'Withdraw'}
                    </button>
                </div>
            </div>

            {/* Assets List */}
            <div className="flex-1 overflow-y-auto px-4">
                <div className="py-3 text-gray-400 text-xs font-medium uppercase tracking-wider">
                    {t.trading_myAssets || 'My Assets'}
                </div>
                {walletAssets.map(asset => (
                    <button
                        key={asset.symbol}
                        onClick={() => {
                            if (asset.symbol !== 'USDC' && asset.symbol !== 'USDT') {
                                onSelectPair?.(`${asset.symbol}/USDC`);
                                onClose();
                            }
                        }}
                        className="w-full flex items-center justify-between py-3 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors rounded-lg px-2 -mx-2"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-lg">
                                {asset.icon}
                            </div>
                            <div className="text-left">
                                <div className="text-white font-medium text-sm">{asset.symbol}</div>
                                <div className="text-gray-500 text-xs">{asset.name}</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-white text-sm font-medium">
                                {hideBalance ? '****' : asset.balance.toFixed(asset.balance >= 100 ? 2 : 4)}
                            </div>
                            <div className="text-gray-500 text-xs">
                                {hideBalance ? '****' : `≈ $${asset.usdValue.toLocaleString()}`}
                            </div>
                        </div>
                        <div className={`text-xs font-medium ml-3 w-16 text-right ${asset.change24h >= 0 ? 'text-green-400' : 'text-red-400'
                            }`}>
                            {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
