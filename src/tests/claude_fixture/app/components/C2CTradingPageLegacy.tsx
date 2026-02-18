import { useState } from 'react';
import { ArrowLeft, ChevronDown, Shield, Check } from 'lucide-react';

type TradeMode = 'buy' | 'sell';
type CryptoType = 'USDT' | 'BTC' | 'ETH' | 'BNB';
type PaymentMethod = 'all' | 'bank' | 'wechat' | 'alipay';

interface Merchant {
    id: string;
    name: string;
    avatar: string;
    isVerified: boolean;
    completionRate: number;
    orderCount: number;
    price: number;
    available: number;
    minLimit: number;
    maxLimit: number;
    crypto: CryptoType;
    paymentMethods: PaymentMethod[];
}

const merchants: Merchant[] = [
    {
        id: '1', name: '币通达', avatar: '🏦', isVerified: true,
        completionRate: 99.2, orderCount: 12580,
        price: 7.36, available: 85230.50, minLimit: 100, maxLimit: 50000,
        crypto: 'USDT', paymentMethods: ['bank', 'alipay', 'wechat'],
    },
    {
        id: '2', name: '快链兑', avatar: '⚡', isVerified: true,
        completionRate: 98.8, orderCount: 8920,
        price: 7.37, available: 42100.00, minLimit: 500, maxLimit: 100000,
        crypto: 'USDT', paymentMethods: ['bank', 'alipay'],
    },
    {
        id: '3', name: '安心换', avatar: '🛡️', isVerified: true,
        completionRate: 99.5, orderCount: 15600,
        price: 7.35, available: 120000.00, minLimit: 200, maxLimit: 200000,
        crypto: 'USDT', paymentMethods: ['bank', 'wechat', 'alipay'],
    },
    {
        id: '4', name: '闪电OTC', avatar: '⚡', isVerified: false,
        completionRate: 97.6, orderCount: 3200,
        price: 7.38, available: 15800.00, minLimit: 100, maxLimit: 20000,
        crypto: 'USDT', paymentMethods: ['wechat', 'alipay'],
    },
    {
        id: '5', name: '稳盈通', avatar: '💰', isVerified: true,
        completionRate: 99.1, orderCount: 9800,
        price: 7.36, available: 68500.00, minLimit: 1000, maxLimit: 300000,
        crypto: 'USDT', paymentMethods: ['bank'],
    },
    {
        id: '6', name: '信链宝', avatar: '🔗', isVerified: true,
        completionRate: 98.5, orderCount: 6700,
        price: 7.39, available: 28000.00, minLimit: 200, maxLimit: 80000,
        crypto: 'USDT', paymentMethods: ['bank', 'wechat'],
    },
];

const paymentLabels: Record<PaymentMethod, string> = {
    all: '全部',
    bank: '银行卡',
    wechat: '微信',
    alipay: '支付宝',
};

const paymentIcons: Record<string, string> = {
    bank: '🏦',
    wechat: '💬',
    alipay: '🔵',
};

interface C2CTradingPageProps {
    onBack: () => void;
    activeRail?: 'FIAT' | 'RWAD';
    onSwitchRail?: (rail: 'FIAT' | 'RWAD') => void;
}

export default function C2CTradingPage({ onBack, activeRail = 'FIAT', onSwitchRail }: C2CTradingPageProps) {
    const [mode, setMode] = useState<TradeMode>('buy');
    const [selectedCrypto, setSelectedCrypto] = useState<CryptoType>('USDT');
    const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('all');
    const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
    const [amount, setAmount] = useState('');
    const [showCryptoSelector, setShowCryptoSelector] = useState(false);

    const cryptoOptions: CryptoType[] = ['USDT', 'BTC', 'ETH', 'BNB'];
    const paymentOptions: PaymentMethod[] = ['all', 'bank', 'wechat', 'alipay'];

    const filteredMerchants = merchants.filter(m => {
        if (selectedPayment !== 'all' && !m.paymentMethods.includes(selectedPayment)) return false;
        return true;
    });

    // Sort: buy mode = lowest price first, sell mode = highest price first
    const sortedMerchants = [...filteredMerchants].sort((a, b) =>
        mode === 'buy' ? a.price - b.price : b.price - a.price
    );

    const totalCNY = amount ? (parseFloat(amount) * (selectedMerchant?.price ?? 0)).toFixed(2) : '';

    return (
        <div className="fixed inset-0 flex flex-col bg-[#0d1117] text-white overflow-hidden"
            style={{
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-1 hover:bg-gray-800 rounded-lg transition-colors">
                        <ArrowLeft size={20} className="text-gray-300" />
                    </button>
                    <h1 className="text-lg font-bold">C2C交易</h1>
                </div>
            </header>

            {onSwitchRail && (
                <div className="flex px-4 pt-3 pb-2 gap-2 shrink-0">
                    <button
                        onClick={() => onSwitchRail('FIAT')}
                        className={`px-3 py-2 text-xs font-bold rounded-lg ${activeRail === 'FIAT' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >
                        Fiat (BYOP)
                    </button>
                    <button
                        onClick={() => onSwitchRail('RWAD')}
                        className={`px-3 py-2 text-xs font-bold rounded-lg ${activeRail === 'RWAD' ? 'bg-cyan-500 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >
                        RWAD Escrow
                    </button>
                </div>
            )}

            {/* Buy / Sell Toggle */}
            <div className="flex px-4 pt-3 pb-2 gap-0 shrink-0">
                <button
                    onClick={() => setMode('buy')}
                    className={`flex-1 py-2.5 text-sm font-bold rounded-l-lg transition-all ${mode === 'buy'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                        }`}
                >
                    购买
                </button>
                <button
                    onClick={() => setMode('sell')}
                    className={`flex-1 py-2.5 text-sm font-bold rounded-r-lg transition-all ${mode === 'sell'
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                        }`}
                >
                    出售
                </button>
            </div>

            {/* Crypto Selector + Filters */}
            <div className="px-4 pb-2 space-y-2 shrink-0">
                {/* Crypto pills */}
                <div className="flex items-center gap-2">
                    {cryptoOptions.map(crypto => (
                        <button
                            key={crypto}
                            onClick={() => setSelectedCrypto(crypto)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${selectedCrypto === crypto
                                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                                }`}
                        >
                            {crypto}
                        </button>
                    ))}

                    {/* Fiat selector */}
                    <button
                        onClick={() => setShowCryptoSelector(!showCryptoSelector)}
                        className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-full text-xs text-gray-300 hover:bg-gray-700"
                    >
                        🇨🇳 CNY
                        <ChevronDown size={12} />
                    </button>
                </div>

                {/* Payment method filters */}
                <div className="flex items-center gap-2 overflow-x-auto">
                    {paymentOptions.map(pm => (
                        <button
                            key={pm}
                            onClick={() => setSelectedPayment(pm)}
                            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${selectedPayment === pm
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                : 'bg-gray-800/60 text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            {paymentLabels[pm]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Column Headers */}
            <div className="flex items-center px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800/60 shrink-0">
                <span className="flex-1">商家</span>
                <span className="w-20 text-right">单价</span>
                <span className="w-24 text-right">数量/限额</span>
                <span className="w-16 text-right">操作</span>
            </div>

            {/* Merchant Listings */}
            <div className="flex-1 overflow-y-auto">
                {sortedMerchants.map(merchant => (
                    <div
                        key={merchant.id}
                        className="px-4 py-3 border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors"
                    >
                        <div className="flex items-start gap-3">
                            {/* Merchant Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="text-lg">{merchant.avatar}</span>
                                    <span className="font-medium text-sm text-white">{merchant.name}</span>
                                    {merchant.isVerified && (
                                        <Shield size={14} className="text-yellow-400 fill-yellow-400/20" />
                                    )}
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-gray-500">
                                    <span>{merchant.orderCount} 单</span>
                                    <span>{merchant.completionRate}% 完成率</span>
                                </div>
                                {/* Payment methods */}
                                <div className="flex items-center gap-1.5 mt-1.5">
                                    {merchant.paymentMethods.map(pm => (
                                        <span
                                            key={pm}
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400"
                                        >
                                            {paymentIcons[pm]} {paymentLabels[pm]}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Price + Limits */}
                            <div className="text-right shrink-0">
                                <div className="text-base font-bold text-white">
                                    ¥{merchant.price.toFixed(2)}
                                </div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                    数量 {merchant.available.toLocaleString()} {selectedCrypto}
                                </div>
                                <div className="text-[10px] text-gray-600 mt-0.5">
                                    限额 ¥{merchant.minLimit.toLocaleString()}-¥{merchant.maxLimit.toLocaleString()}
                                </div>
                            </div>

                            {/* Action Button */}
                            <button
                                onClick={() => setSelectedMerchant(merchant)}
                                className={`self-center px-4 py-2 rounded-lg text-xs font-bold transition-colors shrink-0 ${mode === 'buy'
                                    ? 'bg-green-500 hover:bg-green-400 text-white'
                                    : 'bg-red-500 hover:bg-red-400 text-white'
                                    }`}
                            >
                                {mode === 'buy' ? '购买' : '出售'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Order Detail Sheet */}
            {selectedMerchant && (
                <>
                    <div
                        className="fixed inset-0 bg-black/60 z-40"
                        onClick={() => { setSelectedMerchant(null); setAmount(''); }}
                    />
                    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#161b22] rounded-t-2xl border-t border-gray-700 max-h-[80vh] overflow-y-auto animate-slide-up"
                        style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
                    >
                        {/* Sheet Header */}
                        <div className="flex items-center justify-between px-5 pt-5 pb-3">
                            <div className="flex items-center gap-3">
                                <span className="text-2xl">{selectedMerchant.avatar}</span>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-white">{selectedMerchant.name}</span>
                                        {selectedMerchant.isVerified && (
                                            <Shield size={14} className="text-yellow-400 fill-yellow-400/20" />
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5">
                                        {selectedMerchant.orderCount} 单 · {selectedMerchant.completionRate}% 完成率
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => { setSelectedMerchant(null); setAmount(''); }}
                                className="text-gray-400 hover:text-white text-xl p-1"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Price Display */}
                        <div className="px-5 pb-3">
                            <div className="text-sm text-gray-400">单价</div>
                            <div className={`text-2xl font-bold ${mode === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                                ¥{selectedMerchant.price.toFixed(2)}
                                <span className="text-xs text-gray-500 font-normal ml-2">CNY / {selectedCrypto}</span>
                            </div>
                        </div>

                        {/* Order Info */}
                        <div className="mx-5 p-3 bg-gray-800/50 rounded-xl space-y-2 text-sm">
                            <div className="flex justify-between text-gray-400">
                                <span>可用数量</span>
                                <span className="text-white">{selectedMerchant.available.toLocaleString()} {selectedCrypto}</span>
                            </div>
                            <div className="flex justify-between text-gray-400">
                                <span>交易限额</span>
                                <span className="text-white">¥{selectedMerchant.minLimit.toLocaleString()} - ¥{selectedMerchant.maxLimit.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-gray-400">
                                <span>支付方式</span>
                                <span className="text-white">
                                    {selectedMerchant.paymentMethods.map(pm => paymentLabels[pm]).join('、')}
                                </span>
                            </div>
                        </div>

                        {/* Amount Input */}
                        <div className="px-5 pt-4 space-y-3">
                            <div>
                                <label className="text-xs text-gray-400 mb-1.5 block">
                                    {mode === 'buy' ? '我要购买' : '我要出售'} ({selectedCrypto})
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder={`输入${selectedCrypto}数量`}
                                        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-base placeholder-gray-600 focus:outline-none focus:border-yellow-500/50"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                                        {selectedCrypto}
                                    </span>
                                </div>
                            </div>

                            {/* Total */}
                            {totalCNY && parseFloat(totalCNY) > 0 && (
                                <div className="flex justify-between items-center p-3 bg-gray-800/40 rounded-xl">
                                    <span className="text-sm text-gray-400">
                                        {mode === 'buy' ? '需支付' : '将收到'}
                                    </span>
                                    <span className="text-lg font-bold text-yellow-400">
                                        ¥{parseFloat(totalCNY).toLocaleString()}
                                    </span>
                                </div>
                            )}

                            {/* Confirm Button */}
                            <button
                                disabled={!amount || parseFloat(amount) <= 0}
                                className={`w-full py-3.5 rounded-xl text-base font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'buy'
                                    ? 'bg-green-500 hover:bg-green-400 active:bg-green-600 text-white'
                                    : 'bg-red-500 hover:bg-red-400 active:bg-red-600 text-white'
                                    }`}
                                onClick={() => {
                                    // TODO: implement real order flow
                                    setSelectedMerchant(null);
                                    setAmount('');
                                }}
                            >
                                {mode === 'buy' ? `购买 ${selectedCrypto}` : `出售 ${selectedCrypto}`}
                            </button>

                            {/* Safety Notice */}
                            <div className="flex items-start gap-2 text-[11px] text-gray-500 pb-4">
                                <Check size={14} className="text-green-500 shrink-0 mt-0.5" />
                                <span>
                                    {activeRail === 'FIAT'
                                        ? 'BYOP 模式：平台不代收代付，仅管理订单、凭证与争议。'
                                        : '智能合约担保（Escrow）：交易期间数字资产由链上智能合约锁定，确保买卖双方权益。'}
                                </span>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
