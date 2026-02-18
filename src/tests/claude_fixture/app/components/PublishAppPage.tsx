import { useState, useRef } from 'react';
import { X, Upload, Code, Globe, Image as ImageIcon, FileText, Check, AlertCircle } from 'lucide-react';
import { publishDistributedContent } from '../data/distributedContent';
import { getAlipayQr, getCreditCardEnabled, getSettlementWalletAddress, getWechatQr } from '../utils/paymentStore';
import { createPublishPaymentMeta, resolveActorId } from '../domain/payment/paymentApi';
import { getCurrentPolicyGroupId } from '../utils/region';
import { useLocale } from '../i18n/LocaleContext';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';

interface PublishAppPageProps {
    onClose: () => void;
}

export default function PublishAppPage({ onClose }: PublishAppPageProps) {
    const { t } = useLocale();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const iconInputRef = useRef<HTMLInputElement>(null);
    const [appName, setAppName] = useState('');
    const [description, setDescription] = useState('');
    const [version, setVersion] = useState('1.0.0');
    const [appIcon, setAppIcon] = useState<string | null>(null);
    const [appFile, setAppFile] = useState<File | null>(null);
    const [category, setCategory] = useState<string>('');
    const [isOpenSource, setIsOpenSource] = useState(false);
    const [repoUrl, setRepoUrl] = useState('');
    const [isPaidApp, setIsPaidApp] = useState(false);
    const [priceYuan, setPriceYuan] = useState('');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');

    const categories = [
        { id: 'tools', name: t.pubApp_catTools, icon: '🔧' },
        { id: 'social', name: t.pubApp_catSocial, icon: '💬' },
        { id: 'games', name: t.pubApp_catGames, icon: '🎮' },
        { id: 'media', name: t.pubApp_catMedia, icon: '🎬' },
        { id: 'finance', name: t.pubApp_catFinance, icon: '💰' },
        { id: 'education', name: t.pubApp_catEducation, icon: '📚' },
    ];

    const handleIconSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => setAppIcon(e.target?.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleAppFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setAppFile(file);
        }
    };

    const handlePublish = async () => {
        if (isPublishing) {
            return;
        }
        setPublishError('');
        setIsPublishing(true);
        const parsedPrice = Number.parseFloat(priceYuan);
        const ownerId = resolveActorId();
        const policyGroupId = getCurrentPolicyGroupId();
        const isDomestic = policyGroupId === 'CN';
        try {
            const paymentMeta = await createPublishPaymentMeta({
                scene: 'APP_ITEM',
                ownerId,
                policyGroupId,
                amountCny: isPaidApp && Number.isFinite(parsedPrice) ? parsedPrice : undefined,
                wechatQr: isDomestic ? getWechatQr() : undefined,
                alipayQr: isDomestic ? getAlipayQr() : undefined,
                creditCardEnabled: isDomestic ? false : getCreditCardEnabled(),
                walletAddress: isDomestic ? undefined : getSettlementWalletAddress(),
            });
            const summary = `${appName} v${version}${category ? ` · ${category}` : ''}${description ? ` · ${description}` : ''}`;
            console.log('Publishing app:', {
                appName, description, version, appIcon, appFile, category, isOpenSource, repoUrl
            });
            await publishDistributedContent({
                publishCategory: 'app',
                type: appIcon ? 'image' : 'text',
                content: summary,
                media: appIcon ?? undefined,
                mediaItems: appIcon ? [appIcon] : undefined,
                coverMedia: appIcon ?? undefined,
                mediaAspectRatio: appIcon ? 1 : undefined,
                extra: {
                    appMeta: {
                        appName,
                        version,
                        category,
                        isOpenSource,
                        repoUrl: isOpenSource ? repoUrl : '',
                        packageName: appFile?.name ?? '',
                    },
                    ...(isPaidApp && Number.isFinite(parsedPrice) && parsedPrice > 0 ? { isPaid: true, price: parsedPrice } : {}),
                    ...paymentMeta,
                },
            });
            onClose();
        } catch (error) {
            setPublishError(getPublishLocationErrorMessage(t, error));
        } finally {
            setIsPublishing(false);
        }
    };

    const canPublish = appName.length > 0 && description.length > 0 && category;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">{t.pubApp_title}</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish || isPublishing}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing
                        ? 'bg-purple-500 text-white hover:bg-purple-600'
                        : 'bg-gray-200 text-gray-400'
                        }`}
                >
                    {isPublishing ? t.common_loading : t.pub_publish}
                </button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-6">
                    {/* 应用图标 */}
                    <div className="flex items-center gap-4">
                        <input
                            type="file"
                            ref={iconInputRef}
                            onChange={handleIconSelect}
                            accept="image/*"
                            className="hidden"
                        />
                        <button
                            onClick={() => iconInputRef.current?.click()}
                            className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center border-2 border-dashed border-gray-300 hover:border-blue-500 transition-colors overflow-hidden"
                        >
                            {appIcon ? (
                                <img src={appIcon} alt="App Icon" className="w-full h-full object-cover" />
                            ) : (
                                <ImageIcon size={32} className="text-gray-400" />
                            )}
                        </button>
                        <div>
                            <div className="font-medium text-gray-800">{t.pubApp_icon}</div>
                            <div className="text-xs text-gray-500">{t.pubApp_iconHint}</div>
                        </div>
                    </div>

                    {/* 应用名称 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubApp_name}</h3>
                        <input
                            type="text"
                            placeholder={t.pubApp_namePh}
                            value={appName}
                            onChange={(e) => setAppName(e.target.value)}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                            maxLength={30}
                        />
                    </div>

                    {/* 应用描述 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubApp_desc}</h3>
                        <textarea
                            placeholder={t.pubApp_descPh}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>

                    {/* 版本号 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubApp_version}</h3>
                        <input
                            type="text"
                            placeholder="1.0.0"
                            value={version}
                            onChange={(e) => setVersion(e.target.value)}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>

                    {/* 应用定价 */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm font-medium text-gray-700">{t.pubApp_pricing}</span>
                            <button
                                type="button"
                                onClick={() => setIsPaidApp(!isPaidApp)}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${isPaidApp ? 'bg-amber-500' : 'bg-gray-300'
                                    }`}
                            >
                                <span
                                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${isPaidApp ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                />
                            </button>
                        </div>
                        {isPaidApp && (
                            <div className="px-4 pb-3 flex items-center gap-2">
                                <span className="text-lg font-semibold text-amber-600">¥</span>
                                <input
                                    type="number"
                                    placeholder={t.pubApp_pricePh}
                                    value={priceYuan}
                                    onChange={(e) => setPriceYuan(e.target.value)}
                                    min="0.01"
                                    step="0.01"
                                    className="flex-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                                <span className="text-xs text-gray-400">{t.pub_yuan}</span>
                            </div>
                        )}
                    </div>

                    {/* 分隔线 */}
                    <div className="h-px bg-gray-200" />

                    {/* 分类选择 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3">{t.pubApp_categoryLabel}</h3>
                        <div className="grid grid-cols-3 gap-2">
                            {categories.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => setCategory(cat.id)}
                                    className={`p-3 rounded-xl flex items-center gap-2 transition-colors border-2 ${category === cat.id
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 hover:border-blue-200'
                                        }`}
                                >
                                    <span className="text-xl">{cat.icon}</span>
                                    <span className="text-sm font-medium">{cat.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 应用文件上传 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubApp_file}</h3>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleAppFileSelect}
                            accept=".zip,.apk,.ipa,.wasm"
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full p-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-500 transition-colors flex items-center justify-center gap-3"
                        >
                            {appFile ? (
                                <>
                                    <Check size={20} className="text-green-500" />
                                    <span className="text-gray-700">{appFile.name}</span>
                                </>
                            ) : (
                                <>
                                    <Upload size={20} className="text-gray-400" />
                                    <span className="text-gray-600">{t.pubApp_uploadHint}</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* 开源选项 */}
                    <button
                        onClick={() => setIsOpenSource(!isOpenSource)}
                        className={`w-full p-4 rounded-xl flex items-center justify-between transition-colors border-2 ${isOpenSource ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <Code size={20} className="text-gray-600" />
                            <span className="font-medium">{t.pubApp_openSource}</span>
                        </div>
                        <div className={`w-12 h-6 rounded-full transition-colors ${isOpenSource ? 'bg-blue-500' : 'bg-gray-300'} relative`}>
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isOpenSource ? 'translate-x-7' : 'translate-x-1'}`} />
                        </div>
                    </button>

                    {isOpenSource && (
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                                <Globe size={16} />
                                {t.pubApp_repoUrl}
                            </h3>
                            <input
                                type="url"
                                placeholder="https://github.com/username/repo"
                                value={repoUrl}
                                onChange={(e) => setRepoUrl(e.target.value)}
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>
                    )}

                    {/* 提示 */}
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                        <AlertCircle size={16} className="text-purple-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-700">
                            {t.pubApp_hint}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
