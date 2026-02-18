import { useState, useEffect, useRef } from 'react';
import { Upload, MapPin, X, Info, CreditCard, Wallet, Coins, Globe } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';

interface PaymentConfigSectionProps {
    // 国内收款码
    wechatQrCode: string | null;
    onWechatQrCodeChange: (url: string | null) => void;
    alipayQrCode: string | null;
    onAlipayQrCodeChange: (url: string | null) => void;
    // 国外收款
    creditCardEnabled?: boolean;
    onCreditCardEnabledChange?: (enabled: boolean) => void;
    walletAddress?: string;
    onWalletAddressChange?: (address: string) => void;
    // 价格（通用）
    price: string;
    onPriceChange: (price: string) => void;
}

export default function PaymentConfigSection({
    wechatQrCode,
    onWechatQrCodeChange,
    alipayQrCode,
    onAlipayQrCodeChange,
    creditCardEnabled = false,
    onCreditCardEnabledChange,
    walletAddress = '',
    onWalletAddressChange,
    price,
    onPriceChange,
}: PaymentConfigSectionProps) {
    const [detectedRegion, setDetectedRegion] = useState<'china' | 'intl' | null>(null);
    const [displayRegion, setDisplayRegion] = useState<'china' | 'intl'>('china');
    const [locationLoading, setLocationLoading] = useState(true);
    const wechatInputRef = useRef<HTMLInputElement>(null);
    const alipayInputRef = useRef<HTMLInputElement>(null);
    const { t } = useLocale();

    // 基于IP/GPS检测区域
    useEffect(() => {
        const detectRegion = async () => {
            try {
                if ('geolocation' in navigator) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            const { latitude, longitude } = position.coords;
                            const inChina =
                                latitude >= 18 && latitude <= 54 &&
                                longitude >= 73 && longitude <= 135;
                            const region = inChina ? 'china' : 'intl';
                            setDetectedRegion(region);
                            setDisplayRegion(region);
                            setLocationLoading(false);
                        },
                        () => {
                            setDetectedRegion('china');
                            setDisplayRegion('china');
                            setLocationLoading(false);
                        },
                        { timeout: 5000, enableHighAccuracy: false }
                    );
                } else {
                    setDetectedRegion('china');
                    setDisplayRegion('china');
                    setLocationLoading(false);
                }
            } catch {
                setDetectedRegion('china');
                setDisplayRegion('china');
                setLocationLoading(false);
            }
        };
        detectRegion();
    }, []);

    const handleImageUpload = (type: 'wechat' | 'alipay', e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const url = event.target?.result as string;
                if (type === 'wechat') {
                    onWechatQrCodeChange(url);
                } else {
                    onAlipayQrCodeChange(url);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const toggleRegion = () => {
        setDisplayRegion(prev => prev === 'china' ? 'intl' : 'china');
    };

    const isInChina = displayRegion === 'china';
    const isPreviewMode = detectedRegion !== displayRegion;

    // 加载中状态
    if (locationLoading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-gray-700">
                    <MapPin size={18} className="text-purple-500 animate-pulse" />
                    <span className="font-medium">{t.payment_detectingRegion}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* 区域切换按钮 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                    <MapPin size={14} className={isInChina ? 'text-green-500' : 'text-blue-500'} />
                    <span className={isInChina ? 'text-green-600' : 'text-blue-600'}>
                        {isInChina ? t.payment_chinaRegion : t.payment_internationalRegion}
                    </span>
                    {isPreviewMode && (
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">
                            预览
                        </span>
                    )}
                </div>
                <button
                    onClick={toggleRegion}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                    <Globe size={12} />
                    {t.payment_switchPreview}
                </button>
            </div>

            {/* 价格输入（通用） */}
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
            </div>

            {/* 国内：微信/支付宝收款码 (BYOP) */}
            {isInChina && (
                <div className="space-y-4 p-4 bg-gray-50 rounded-xl">
                    <div className="flex items-start gap-2">
                        <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-gray-600">
                            {t.payment_uploadInfo}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {/* 微信收款码 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                {t.payment_wechatQr}
                            </label>
                            <input
                                type="file"
                                ref={wechatInputRef}
                                onChange={(e) => handleImageUpload('wechat', e)}
                                accept="image/*"
                                className="hidden"
                            />
                            {wechatQrCode ? (
                                <div className="relative w-full aspect-square bg-white rounded-lg overflow-hidden border border-gray-200">
                                    <img src={wechatQrCode} alt="微信收款码" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => onWechatQrCodeChange(null)}
                                        className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 rounded-full flex items-center justify-center"
                                    >
                                        <X size={14} className="text-white" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => wechatInputRef.current?.click()}
                                    className="w-full aspect-square border-2 border-dashed border-green-300 rounded-lg flex flex-col items-center justify-center text-green-500 hover:bg-green-50 transition-colors"
                                >
                                    <Upload size={24} />
                                    <span className="text-xs mt-2">{t.payment_uploadWechat}</span>
                                </button>
                            )}
                        </div>

                        {/* 支付宝收款码 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                {t.payment_alipayQr}
                            </label>
                            <input
                                type="file"
                                ref={alipayInputRef}
                                onChange={(e) => handleImageUpload('alipay', e)}
                                accept="image/*"
                                className="hidden"
                            />
                            {alipayQrCode ? (
                                <div className="relative w-full aspect-square bg-white rounded-lg overflow-hidden border border-gray-200">
                                    <img src={alipayQrCode} alt="支付宝收款码" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => onAlipayQrCodeChange(null)}
                                        className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 rounded-full flex items-center justify-center"
                                    >
                                        <X size={14} className="text-white" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => alipayInputRef.current?.click()}
                                    className="w-full aspect-square border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors"
                                >
                                    <Upload size={24} />
                                    <span className="text-xs mt-2">{t.payment_uploadAlipay}</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 国外：信用卡 + Web3钱包 (非托管) */}
            {!isInChina && (
                <div className="space-y-4 p-4 bg-gray-50 rounded-xl">
                    <div className="flex items-start gap-2">
                        <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-gray-600">
                            {t.payment_internationalInfo}
                        </p>
                    </div>

                    {/* 信用卡收款 */}
                    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                        <div className="flex items-center gap-3">
                            <CreditCard size={20} className="text-gray-600" />
                            <div>
                                <span className="font-medium text-gray-800">{t.payment_creditCard}</span>
                                <p className="text-xs text-gray-500">{t.payment_creditCardDesc}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => onCreditCardEnabledChange?.(!creditCardEnabled)}
                            className={`w-12 h-6 rounded-full transition-colors ${creditCardEnabled ? 'bg-purple-500' : 'bg-gray-300'
                                }`}
                        >
                            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${creditCardEnabled ? 'translate-x-6' : 'translate-x-0.5'
                                }`} />
                        </button>
                    </div>

                    {/* Web3钱包地址 */}
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <Wallet size={16} className="text-gray-600" />
                            <label className="text-sm font-medium text-gray-700">
                                Web3 Wallet (USDT/USDC)
                            </label>
                        </div>
                        <input
                            type="text"
                            value={walletAddress}
                            onChange={(e) => onWalletAddressChange?.(e.target.value)}
                            placeholder={t.payment_walletPlaceholder}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            {t.payment_web3WalletDesc}
                        </p>
                    </div>
                </div>
            )}

            {/* 敬请期待区域 */}
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
