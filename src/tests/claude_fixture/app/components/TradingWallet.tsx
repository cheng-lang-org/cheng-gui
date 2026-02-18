import { useState, useEffect, useCallback } from 'react';
import { Wallet, ArrowUpRight, ArrowDownLeft, Eye, EyeOff, Copy, CheckCircle, RefreshCw } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';
import {
    type WalletEntry,
    loadWallets,
    fetchEVMBalance,
    chainIcon,
    maskAddr,
} from '../utils/walletChains';
import { getBNBBalance, getTokenBalance, CONTRACTS, BSC_EXPLORER } from '../utils/dexSwap';

interface TradingWalletProps {
    onClose: () => void;
    onSelectPair?: (symbol: string) => void;
    /** Callback to pass selected wallet to TradingPage */
    onSelectWallet?: (wallet: WalletEntry) => void;
}

export default function TradingWallet({ onClose, onSelectPair, onSelectWallet }: TradingWalletProps) {
    const [hideBalance, setHideBalance] = useState(false);
    const [copied, setCopied] = useState(false);
    const { t } = useLocale();

    // Real wallet data
    const [wallets, setWallets] = useState<WalletEntry[]>([]);
    const [selectedWallet, setSelectedWallet] = useState<WalletEntry | null>(null);
    const [bnbBalance, setBnbBalance] = useState('0.000000');
    const [busdBalance, setBusdBalance] = useState('0.000000');
    const [loadingBalances, setLoadingBalances] = useState(false);

    // Load EVM wallets from storage
    useEffect(() => {
        const allWallets = loadWallets();
        const evmWallets = allWallets.filter(w => w.chain === 'evm');
        setWallets(evmWallets);
        if (evmWallets.length > 0) {
            setSelectedWallet(evmWallets[0]);
        }
    }, []);

    // Fetch real balances when wallet is selected
    const refreshBalances = useCallback(async () => {
        if (!selectedWallet) return;
        setLoadingBalances(true);
        try {
            const [bnb, busd] = await Promise.all([
                getBNBBalance(selectedWallet.address),
                getTokenBalance(selectedWallet.address, CONTRACTS.BUSD),
            ]);
            setBnbBalance(Number(bnb).toFixed(6));
            setBusdBalance(Number(busd).toFixed(4));
        } catch (err) {
            console.warn('[TradingWallet] Balance fetch failed:', err);
        }
        setLoadingBalances(false);
    }, [selectedWallet]);

    useEffect(() => {
        if (selectedWallet) {
            refreshBalances();
            // Notify parent
            onSelectWallet?.(selectedWallet);
        }
    }, [selectedWallet, refreshBalances, onSelectWallet]);

    const handleCopy = () => {
        if (selectedWallet) {
            navigator.clipboard?.writeText(selectedWallet.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const totalUsd = 0; // Will be calculated from real prices later

    return (
        <div className="fixed inset-0 bg-[#0d1117] z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <Wallet size={20} className="text-yellow-400" />
                    <span className="font-semibold text-white">{t.trading_wallet || 'DEX Wallet'}</span>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-gray-800 transition-colors">
                    ✕
                </button>
            </header>

            {/* Wallet Selector */}
            {wallets.length > 1 && (
                <div className="px-4 pt-3 flex gap-2 overflow-x-auto">
                    {wallets.map(w => (
                        <button
                            key={w.id}
                            onClick={() => setSelectedWallet(w)}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedWallet?.id === w.id
                                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                    : 'bg-gray-800 text-gray-400 border border-gray-700'
                                }`}
                        >
                            {chainIcon(w.chain)} {w.alias || maskAddr(w.address)}
                        </button>
                    ))}
                </div>
            )}

            {/* Balance Card */}
            <div className="px-4 py-6 bg-gradient-to-br from-gray-900 via-[#0d1117] to-gray-900">
                {selectedWallet ? (
                    <>
                        <div className="text-gray-400 text-sm mb-1 flex items-center gap-2">
                            BSC Testnet 余额
                            <button onClick={() => setHideBalance(!hideBalance)} className="p-0.5">
                                {hideBalance ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                            <div className="flex-1" />
                            <button
                                onClick={refreshBalances}
                                className="text-xs bg-gray-800 px-2 py-1 rounded text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                                <RefreshCw size={12} className={loadingBalances ? 'animate-spin' : ''} />
                                刷新
                            </button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                            <span className="font-mono">{maskAddr(selectedWallet.address)}</span>
                            <button onClick={handleCopy} className="hover:text-gray-300 transition-colors">
                                {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
                            </button>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 mt-4">
                            <a
                                href={`https://testnet.bnbchain.org/faucet-smart`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium transition-colors"
                            >
                                <ArrowDownLeft size={16} />
                                领取测试币
                            </a>
                            <a
                                href={`${BSC_EXPLORER}/address/${selectedWallet.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm font-medium transition-colors"
                            >
                                <ArrowUpRight size={16} />
                                浏览器
                            </a>
                        </div>
                    </>
                ) : (
                    <div className="text-center text-gray-500 py-8">
                        <p className="text-sm">尚未创建/导入 EVM 钱包</p>
                        <p className="text-xs mt-1">请在「我的」页面创建或导入钱包后使用</p>
                    </div>
                )}
            </div>

            {/* Assets List (Real Balances) */}
            {selectedWallet && (
                <div className="flex-1 overflow-y-auto px-4">
                    <div className="py-3 text-gray-400 text-xs font-medium uppercase tracking-wider">
                        BSC Testnet 资产
                    </div>

                    {/* tBNB */}
                    <div className="flex items-center justify-between py-3 border-b border-gray-800/50 rounded-lg px-2 -mx-2">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-lg">🔶</div>
                            <div>
                                <div className="text-white font-medium text-sm">tBNB</div>
                                <div className="text-gray-500 text-xs">Testnet BNB</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-white text-sm font-medium font-mono">
                                {hideBalance ? '****' : bnbBalance}
                            </div>
                            <div className="text-gray-500 text-xs">原生代币</div>
                        </div>
                    </div>

                    {/* BUSD */}
                    <div className="flex items-center justify-between py-3 border-b border-gray-800/50 rounded-lg px-2 -mx-2">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-lg">💵</div>
                            <div>
                                <div className="text-white font-medium text-sm">BUSD</div>
                                <div className="text-gray-500 text-xs">Binance USD</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-white text-sm font-medium font-mono">
                                {hideBalance ? '****' : busdBalance}
                            </div>
                            <div className="text-gray-500 text-xs">ERC-20</div>
                        </div>
                    </div>

                    {/* Testnet info */}
                    <div className="mt-4 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                        <div className="text-xs text-yellow-400 font-medium mb-1">⚠️ 测试网</div>
                        <div className="text-xs text-gray-500 leading-relaxed">
                            这是 BSC Testnet，所有代币均为测试用途，无真实价值。
                            请通过上方"领取测试币"按钮获取 tBNB。
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
