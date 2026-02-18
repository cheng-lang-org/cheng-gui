/**
 * Wallet Manager Component
 * Extracted from ProfilePage for better maintainability
 */

import { useState, useEffect, useCallback } from 'react';
import {
    Wallet,
    Plus,
    PencilLine,
    Trash2,
    CheckCircle2,
    ShieldAlert,
    X,
    Coins,
    Download,
    Eye,
    EyeOff,
    RefreshCw,
} from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';
import {
    type WalletEntry,
    type ChainType,
    type ChainBalance,
    loadWallets,
    saveWallets,
    deleteWallet as deleteWalletEntry,
    createEVMAndSolanaWallets,
    importEVMWallet,
    importSolanaWallet,
    createBTCWallet,
    importBTCWallet,
    fetchBalance,
    chainLabel,
    chainIcon,
    maskAddr,
} from '../utils/walletChains';

type WalletImportMethod = 'mnemonic' | 'privateKey';
type WalletAction = 'create' | 'import';

interface WalletManagerProps {
    show: boolean;
    onClose: () => void;
}

export default function WalletManager({ show, onClose }: WalletManagerProps) {
    const { t } = useLocale();
    const [wallets, setWallets] = useState<WalletEntry[]>(() => loadWallets());
    const [walletAction, setWalletAction] = useState<WalletAction>('create');
    const [walletChain, setWalletChain] = useState<ChainType>('evm');
    const [tosCheck1, setTosCheck1] = useState(false);
    const [tosCheck2, setTosCheck2] = useState(false);
    const [tosCheck3, setTosCheck3] = useState(false);
    const allTosAccepted = tosCheck1 && tosCheck2 && tosCheck3;
    const [walletBalances, setWalletBalances] = useState<Record<string, ChainBalance>>({});
    const [walletCreating, setWalletCreating] = useState(false);
    const [walletExportId, setWalletExportId] = useState<string | null>(null);
    const [walletShowSecret, setWalletShowSecret] = useState(false);
    const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);

    // Import states
    const [walletImportMethod, setWalletImportMethod] = useState<WalletImportMethod>('mnemonic');
    const [walletInput, setWalletInput] = useState('');
    const [walletAlias, setWalletAlias] = useState(t.profile_myWallet);
    const [mnemonicPath, setMnemonicPath] = useState("m/44'/60'/0'/0/0");
    const [mnemonicPassword, setMnemonicPassword] = useState('');
    const [walletError, setWalletError] = useState('');
    const [walletSuccess, setWalletSuccess] = useState('');


    // Refresh balances
    const refreshBalances = useCallback(async () => {
        setWalletBalanceLoading(true);
        const newBalances: Record<string, ChainBalance> = {};
        for (const w of wallets) {
            try {
                newBalances[w.id] = await fetchBalance(w);
            } catch {
                newBalances[w.id] = { formatted: '0', raw: 0, symbol: '?' };
            }
        }
        setWalletBalances(newBalances);
        setWalletBalanceLoading(false);
    }, [wallets]);

    useEffect(() => {
        if (wallets.length > 0) {
            void refreshBalances();
        }
    }, [wallets, refreshBalances]);

    const handleCreateWallet = async () => {
        setWalletCreating(true);
        setWalletError('');
        try {
            if (walletChain === 'evm') {
                const result = await createEVMAndSolanaWallets(walletAlias || t.profile_myWallet);
                setWallets(loadWallets());
                setWalletSuccess(`已创建 EVM 和 Solana 钱包`);
            } else if (walletChain === 'btc') {
                await createBTCWallet(walletAlias || t.profile_myWallet);
                setWallets(loadWallets());
                setWalletSuccess('已创建 BTC 钱包');
            }
        } catch (err) {
            setWalletError(String(err));
        }
        setWalletCreating(false);
    };

    const handleImportWallet = async () => {
        if (!walletInput.trim()) {
            setWalletError('请输入助记词或私钥');
            return;
        }
        setWalletCreating(true);
        setWalletError('');
        try {
            if (walletChain === 'evm') {
                await importEVMWallet(walletInput, walletAlias || t.profile_myWallet);
                setWallets(loadWallets());
                setWalletSuccess('EVM 钱包导入成功');
            } else if (walletChain === 'solana') {
                await importSolanaWallet(walletInput, walletAlias || t.profile_myWallet);
                setWallets(loadWallets());
                setWalletSuccess('Solana 钱包导入成功');
            }
            setWalletInput('');
        } catch (err) {
            setWalletError(String(err));
        }
        setWalletCreating(false);
    };

    const handleDeleteWallet = async (id: string) => {
        const updated = await deleteWalletEntry(id);
        setWallets(updated);
    };

    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg flex items-center gap-2">
                    <Wallet size={20} className="text-yellow-500" />
                    {t.profile_walletManagement}
                </h1>
                <button
                    onClick={refreshBalances}
                    className={`p-2 hover:bg-gray-100 rounded-full ${walletBalanceLoading ? 'animate-spin' : ''}`}
                >
                    <RefreshCw size={20} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Wallet List */}
                {wallets.map((wallet) => (
                    <div key={wallet.id} className="bg-gray-50 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span>{chainIcon(wallet.chain)}</span>
                                <span className="font-medium">{wallet.alias}</span>
                                <span className="text-xs text-gray-400">{chainLabel(wallet.chain)}</span>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setWalletExportId(wallet.id)}
                                    className="p-2 hover:bg-gray-200 rounded-lg"
                                >
                                    <Download size={16} className="text-gray-500" />
                                </button>
                                <button
                                    onClick={() => handleDeleteWallet(wallet.id)}
                                    className="p-2 hover:bg-gray-200 rounded-lg"
                                >
                                    <Trash2 size={16} className="text-red-500" />
                                </button>
                            </div>
                        </div>
                        <div className="text-sm text-gray-500 font-mono">
                            {maskAddr(wallet.address)}
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                            余额: {walletBalances[wallet.id]?.formatted || '...'} {walletBalances[wallet.id]?.symbol || ''}
                        </div>
                    </div>
                ))}

                {/* Create/Import Section */}
                <div className="border-t border-gray-200 pt-4 space-y-4">
                    <div className="flex gap-2">
                        <button
                            onClick={() => { setWalletAction('create'); setTosCheck1(false); setTosCheck2(false); setTosCheck3(false); }}
                            className={`flex-1 py-2 rounded-lg ${walletAction === 'create' ? 'bg-purple-500 text-white' : 'bg-gray-100'}`}
                        >
                            创建钱包
                        </button>
                        <button
                            onClick={() => { setWalletAction('import'); setTosCheck1(false); setTosCheck2(false); setTosCheck3(false); }}
                            className={`flex-1 py-2 rounded-lg ${walletAction === 'import' ? 'bg-purple-500 text-white' : 'bg-gray-100'}`}
                        >
                            导入钱包
                        </button>
                    </div>

                    {/* Chain Selector */}
                    <div className="flex gap-2">
                        {(['evm', 'solana', 'btc'] as ChainType[]).map((chain) => (
                            <button
                                key={chain}
                                onClick={() => setWalletChain(chain)}
                                className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1 ${walletChain === chain ? 'bg-purple-500 text-white' : 'bg-gray-100'}`}
                            >
                                {chainIcon(chain)} {chain.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    <input
                        type="text"
                        placeholder={t.profile_walletName}
                        value={walletAlias}
                        onChange={(e) => setWalletAlias(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-xl"
                    />

                    {walletAction === 'import' && (
                        <>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setWalletImportMethod('mnemonic')}
                                    className={`flex-1 py-2 rounded-lg ${walletImportMethod === 'mnemonic' ? 'bg-purple-500 text-white' : 'bg-gray-100'}`}
                                >
                                    助记词
                                </button>
                                <button
                                    onClick={() => setWalletImportMethod('privateKey')}
                                    className={`flex-1 py-2 rounded-lg ${walletImportMethod === 'privateKey' ? 'bg-purple-500 text-white' : 'bg-gray-100'}`}
                                >
                                    私钥
                                </button>
                            </div>
                            <textarea
                                placeholder={walletImportMethod === 'mnemonic' ? '输入助记词（空格分隔）' : '输入私钥'}
                                value={walletInput}
                                onChange={(e) => setWalletInput(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-xl resize-none"
                                rows={3}
                            />
                        </>
                    )}

                    {walletError && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                            {walletError}
                        </div>
                    )}

                    {walletSuccess && (
                        <div className="p-3 bg-green-50 text-green-600 rounded-lg text-sm">
                            {walletSuccess}
                        </div>
                    )}

                    {/* Non-Custodial ToS */}
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
                        <h3 className="font-semibold text-amber-800 text-sm">{t.wallet_tos_title}</h3>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" checked={tosCheck1} onChange={(e) => setTosCheck1(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" />
                            <span className="text-xs text-gray-700 leading-relaxed">{t.wallet_tos_1}</span>
                        </label>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" checked={tosCheck2} onChange={(e) => setTosCheck2(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" />
                            <span className="text-xs text-gray-700 leading-relaxed">{t.wallet_tos_2}</span>
                        </label>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" checked={tosCheck3} onChange={(e) => setTosCheck3(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" />
                            <span className="text-xs text-gray-700 leading-relaxed">{t.wallet_tos_3}</span>
                        </label>
                    </div>

                    <button
                        onClick={walletAction === 'create' ? handleCreateWallet : handleImportWallet}
                        disabled={walletCreating || !allTosAccepted}
                        className="w-full py-3 bg-purple-500 text-white rounded-xl font-medium disabled:opacity-50"
                    >
                        {walletCreating ? '处理中...' : walletAction === 'create' ? '创建钱包' : '导入钱包'}
                    </button>
                </div>
            </div>
        </div>
    );
}
