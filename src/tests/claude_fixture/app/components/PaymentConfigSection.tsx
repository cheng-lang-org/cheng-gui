import { useState, useEffect } from 'react';
import { MapPin, RefreshCw, CreditCard, Wallet, Coins } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';
import { ensureRegionPolicy, getRegionPolicySync, subscribeRegionPolicy, type RegionPolicy } from '../utils/region';

interface PaymentConfigSectionProps {
    // 价格（通用）
    price: string;
    onPriceChange: (price: string) => void;
}

function sourceText(source: RegionPolicy['source']): string {
    switch (source) {
        case 'ipapi':
            return 'IP: ipapi';
        case 'ipwhois':
            return 'IP: ipwho.is';
        case 'ipinfo':
            return 'IP: ipinfo';
        case 'cache':
            return 'IP缓存';
        default:
            return '本地兜底';
    }
}

export default function PaymentConfigSection({
    price,
    onPriceChange,
}: PaymentConfigSectionProps) {
    const [regionPolicy, setRegionPolicy] = useState<RegionPolicy>(() => getRegionPolicySync());
    const [refreshingPolicy, setRefreshingPolicy] = useState(false);
    const { t } = useLocale();

    useEffect(() => {
        const unsubscribe = subscribeRegionPolicy(setRegionPolicy);
        void ensureRegionPolicy().then(setRegionPolicy);
        return () => {
            unsubscribe();
        };
    }, []);

    const refreshRegionByIp = async () => {
        setRefreshingPolicy(true);
        try {
            const updated = await ensureRegionPolicy(true);
            setRegionPolicy(updated);
        } finally {
            setRefreshingPolicy(false);
        }
    };

    const isInChina = regionPolicy.policyGroupId === 'CN';

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                    <MapPin size={14} className={isInChina ? 'text-green-500' : 'text-blue-500'} />
                    <span className={isInChina ? 'text-green-600' : 'text-blue-600'}>
                        {isInChina ? t.payment_chinaRegion : t.payment_internationalRegion}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[11px] rounded-full">
                        {sourceText(regionPolicy.source)}
                    </span>
                </div>
                <button
                    onClick={() => {
                        void refreshRegionByIp();
                    }}
                    disabled={refreshingPolicy}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                    <RefreshCw size={12} className={refreshingPolicy ? 'animate-spin' : ''} />
                    刷新IP判定
                </button>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.payment_price}<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                        {isInChina ? '¥' : '$'}
                    </span>
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => onPriceChange(e.target.value)}
                        placeholder={t.payment_enterPrice}
                        min="0"
                        step="0.01"
                        className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                    {isInChina ? '将会使用您在"我"页面设置的微信/支付宝收款码' : '将会使用您在"我"页面设置的信用卡或 Web3 收款钱包'}
                </p>
            </div>

            <div className="p-4 bg-gray-100 rounded-xl opacity-60">
                <div className="flex items-center gap-2 mb-3">
                    <Coins size={16} className="text-gray-400" />
                    <span className="text-sm font-medium text-gray-500">
                        {isInChina ? t.payment_pointsPricing : t.payment_rwadPricing}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-200 text-gray-500 text-xs rounded-full">
                        {t.payment_comingSoon}
                    </span>
                </div>
                <div className="relative">
                    <input
                        type="text"
                        disabled
                        placeholder={isInChina ? '输入积分数量' : '输入RWAD数量'}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-50 text-gray-400 cursor-not-allowed"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                        {isInChina ? '积分' : 'RWAD'}
                    </span>
                </div>
            </div>
        </div>
    );
}
