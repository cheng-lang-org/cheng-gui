import { useState, useRef, useMemo } from 'react';
import { X, Camera, Plus, Package, FileSpreadsheet, PencilLine, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { publishDistributedContent } from '../data/distributedContent';
import { parseProductsFromCsvString } from '../data/ecomData';
import { getAlipayQr, getCreditCardEnabled, getSettlementWalletAddress, getWechatQr } from '../utils/paymentStore';
import { getCurrentPolicyGroupId } from '../utils/region';
import { createPublishPaymentMeta, resolveActorId } from '../domain/payment/paymentApi';
import { useLocale } from '../i18n/LocaleContext';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';

interface PublishProductPageProps {
    onClose: () => void;
}

type PublishMode = 'csv' | 'manual';

export default function PublishProductPage({ onClose }: PublishProductPageProps) {
    const { t } = useLocale();
    const [mode, setMode] = useState<PublishMode>('csv');

    // CSV mode state
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [csvFileName, setCsvFileName] = useState('');
    const [csvText, setCsvText] = useState('');
    const [csvPreview, setCsvPreview] = useState<{ productCount: number; skuCount: number; firstTitle: string } | null>(null);
    const [csvError, setCsvError] = useState('');

    // Manual mode state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [price, setPrice] = useState('');
    const [stock, setStock] = useState('');
    const [enableSKU, setEnableSKU] = useState(false);
    const [colors, setColors] = useState<string[]>([]);
    const [sizes, setSizes] = useState<string[]>([]);
    const [newColor, setNewColor] = useState('');
    const [newSize, setNewSize] = useState('');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');

    const policyGroupId = getCurrentPolicyGroupId();
    const isDomestic = policyGroupId === 'CN';

    // ---- CSV handlers ----
    const handleCsvSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setCsvFileName(file.name);
        setCsvError('');
        setCsvPreview(null);

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            setCsvText(text);
            try {
                const products = parseProductsFromCsvString(text);
                if (products.length === 0) {
                    setCsvError(t.pubProduct_csvUploadHint);
                    return;
                }
                const totalSkus = products.reduce((sum, p) => sum + p.skus.length, 0);
                setCsvPreview({
                    productCount: products.length,
                    skuCount: totalSkus,
                    firstTitle: products[0].title,
                });
            } catch {
                setCsvError(t.pubProduct_csvUploadHint);
            }
        };
        reader.readAsText(file, 'utf-8');
    };

    // ---- Manual handlers ----
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImages(prev => [...prev, e.target?.result as string]);
            };
            reader.readAsDataURL(file);
        });
    };

    const removeImage = (index: number) => {
        setImages(images.filter((_, i) => i !== index));
    };

    const addColor = () => {
        if (newColor.trim() && !colors.includes(newColor.trim())) {
            setColors([...colors, newColor.trim()]);
            setNewColor('');
        }
    };

    const addSize = () => {
        if (newSize.trim() && !sizes.includes(newSize.trim())) {
            setSizes([...sizes, newSize.trim()]);
            setNewSize('');
        }
    };

    // ---- Publish ----
    const handlePublish = async () => {
        if (isPublishing) {
            return;
        }
        setPublishError('');
        setIsPublishing(true);
        const wechatQr = isDomestic ? (getWechatQr() ?? undefined) : undefined;
        const alipayQr = isDomestic ? (getAlipayQr() ?? undefined) : undefined;
        const creditCardEnabled = !isDomestic && getCreditCardEnabled();
        const settlementWalletAddress = !isDomestic ? getSettlementWalletAddress() : '';
        const ownerId = resolveActorId();

        try {
            if (mode === 'csv') {
                if (!csvText || !csvPreview) {
                    setIsPublishing(false);
                    return;
                }
                const summary = `${csvPreview.firstTitle} ×${csvPreview.productCount}`;
                const paymentMeta = await createPublishPaymentMeta({
                    scene: 'ECOM_PRODUCT',
                    ownerId,
                    policyGroupId,
                    wechatQr,
                    alipayQr,
                    creditCardEnabled,
                    walletAddress: settlementWalletAddress || undefined,
                });
                await publishDistributedContent({
                    publishCategory: 'product',
                    type: 'text',
                    content: summary,
                    extra: {
                        csvData: csvText,
                        ...paymentMeta,
                    },
                });
            } else {
                if (!title || !price) {
                    setIsPublishing(false);
                    return;
                }
                const parsedPrice = Number.parseFloat(price);
                const summary = `${title}${price ? ` · ¥${price}` : ''}${description ? ` · ${description}` : ''}`;
                const paymentMeta = await createPublishPaymentMeta({
                    scene: 'ECOM_PRODUCT',
                    ownerId,
                    policyGroupId,
                    amountCny: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
                    wechatQr,
                    alipayQr,
                    creditCardEnabled,
                    walletAddress: settlementWalletAddress || undefined,
                });
                await publishDistributedContent({
                    publishCategory: 'product',
                    type: images.length > 0 ? 'image' : 'text',
                    content: summary,
                    media: images[0],
                    mediaItems: images,
                    coverMedia: images[0],
                    mediaAspectRatio: images.length > 0 ? 1 : undefined,
                    extra: {
                        manualProduct: {
                            title, description, price, stock,
                            images,
                            ...(enableSKU ? { colors, sizes } : {}),
                        },
                        ...(Number.isFinite(parsedPrice) && parsedPrice > 0 ? { isPaid: true, price: parsedPrice } : {}),
                        ...paymentMeta,
                    },
                });
            }
            onClose();
        } catch (error) {
            setPublishError(getPublishLocationErrorMessage(t, error));
        } finally {
            setIsPublishing(false);
        }
    };

    const canPublish = mode === 'csv'
        ? csvText.length > 0 && csvPreview !== null
        : title.length > 0 && price.length > 0;

    const hasPaymentQr = isDomestic && (getWechatQr() !== null || getAlipayQr() !== null);
    const hasIntlRails = !isDomestic && (getCreditCardEnabled() || getSettlementWalletAddress().length > 0);

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">{t.pubProduct_title}</h1>
                <button
                    disabled={!canPublish || isPublishing}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing
                        ? 'bg-purple-500 text-white hover:bg-purple-600'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                    onClick={handlePublish}
                >
                    {isPublishing ? t.common_loading : t.pub_publish}
                </button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}

            {/* Mode Tabs */}
            <div className="flex border-b border-gray-200">
                <button
                    onClick={() => setMode('csv')}
                    className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${mode === 'csv'
                        ? 'text-purple-600 border-b-2 border-purple-500 bg-purple-50'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    <FileSpreadsheet size={16} />
                    {t.pubProduct_csvMode}
                </button>
                <button
                    onClick={() => setMode('manual')}
                    className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${mode === 'manual'
                        ? 'text-purple-600 border-b-2 border-purple-500 bg-purple-50'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    <PencilLine size={16} />
                    {t.pubProduct_manualMode}
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">

                {/* === CSV Mode === */}
                {mode === 'csv' && (
                    <>
                        <div>
                            <input
                                type="file"
                                ref={csvInputRef}
                                onChange={handleCsvSelect}
                                accept=".csv,text/csv,application/vnd.ms-excel"
                                className="hidden"
                            />
                            <button
                                onClick={() => csvInputRef.current?.click()}
                                className="w-full p-6 border-2 border-dashed border-purple-300 rounded-2xl flex flex-col items-center gap-3 text-purple-500 hover:bg-purple-50 transition-colors"
                            >
                                <Upload size={32} />
                                <span className="font-medium">{csvFileName || t.pubProduct_csvUploadHint}</span>
                                <span className="text-xs text-gray-400">CSV</span>
                            </button>
                        </div>

                        {/* CSV Preview */}
                        {csvPreview && (
                            <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                                <div className="flex items-center gap-2 mb-2">
                                    <CheckCircle2 size={16} className="text-green-600" />
                                    <span className="font-medium text-green-800">✓</span>
                                </div>
                                <div className="text-sm text-green-700 space-y-1">
                                    <div>{t.pubProduct_productName}：<span className="font-semibold">{csvPreview.productCount}</span></div>
                                    <div>SKU：<span className="font-semibold">{csvPreview.skuCount}</span></div>
                                    <div>{csvPreview.firstTitle}</div>
                                </div>
                            </div>
                        )}

                        {csvError && (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                                <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                                <span className="text-sm text-red-700">{csvError}</span>
                            </div>
                        )}
                    </>
                )}

                {/* === Manual Mode === */}
                {mode === 'manual' && (
                    <>
                        {/* 商品图片 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                                <Camera size={14} /> {t.pubProduct_productImage}
                            </label>
                            <div className="flex gap-2 flex-wrap">
                                {images.map((img, index) => (
                                    <div key={index} className="relative w-20 h-20 rounded-lg overflow-hidden">
                                        <img src={img} alt="" className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => removeImage(index)}
                                            className="absolute top-1 right-1 w-5 h-5 bg-black bg-opacity-60 rounded-full flex items-center justify-center"
                                        >
                                            <X size={12} className="text-white" />
                                        </button>
                                    </div>
                                ))}
                                {images.length < 9 && (
                                    <>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            onChange={handleImageSelect}
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                        />
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-20 h-20 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-purple-400 hover:text-purple-400"
                                        >
                                            <Camera size={20} />
                                            <span className="text-[10px] mt-1">{images.length}/9</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* 商品名称 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">{t.pubProduct_productName} <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder={t.pubProduct_productNamePh}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                        </div>

                        {/* 商品描述 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">{t.pubProduct_productDesc}</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t.pubProduct_productDescPh}
                                rows={3}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                            />
                        </div>

                        {/* 价格 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">{t.payment_price} <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">¥</span>
                                <input
                                    type="number"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    placeholder={t.payment_enterPrice}
                                    min="0"
                                    step="0.01"
                                    className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                />
                            </div>
                        </div>

                        {/* 库存 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                                <Package size={14} /> {t.pubProduct_stock}
                            </label>
                            <input
                                type="number"
                                value={stock}
                                onChange={(e) => setStock(e.target.value)}
                                placeholder={t.pubProduct_stockPh}
                                min="0"
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                        </div>

                        {/* SKU开关 */}
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">{t.pubProduct_enableSku}</span>
                            <button
                                onClick={() => setEnableSKU(!enableSKU)}
                                className={`w-12 h-6 rounded-full transition-colors ${enableSKU ? 'bg-purple-500' : 'bg-gray-300'}`}
                            >
                                <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${enableSKU ? 'translate-x-6' : 'translate-x-0.5'}`} />
                            </button>
                        </div>

                        {/* SKU配置 */}
                        {enableSKU && (
                            <div className="space-y-4 p-4 bg-gray-50 rounded-xl">
                                {/* 颜色 */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">{t.pubProduct_color}</label>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {colors.map((color, i) => (
                                            <span key={i} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm flex items-center gap-1">
                                                {color}
                                                <button onClick={() => setColors(colors.filter((_, idx) => idx !== i))} className="ml-1">
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newColor}
                                            onChange={(e) => setNewColor(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && addColor()}
                                            placeholder={t.pubProduct_addColor}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        />
                                        <button onClick={addColor} className="px-3 py-2 bg-purple-500 text-white rounded-lg">
                                            <Plus size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* 尺寸 */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">{t.pubProduct_size}</label>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {sizes.map((size, i) => (
                                            <span key={i} className="px-3 py-1 bg-teal-100 text-teal-700 rounded-full text-sm flex items-center gap-1">
                                                {size}
                                                <button onClick={() => setSizes(sizes.filter((_, idx) => idx !== i))} className="ml-1">
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newSize}
                                            onChange={(e) => setNewSize(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && addSize()}
                                            placeholder={t.pubProduct_addSize}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        />
                                        <button onClick={addSize} className="px-3 py-2 bg-teal-500 text-white rounded-lg">
                                            <Plus size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Payment QR auto-attach hint */}
                {isDomestic && (
                    <div className={`p-3 rounded-xl text-xs flex items-start gap-2 ${hasPaymentQr ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                        {hasPaymentQr ? (
                            <>
                                <CheckCircle2 size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                                <span className="text-green-700">{t.payment_uploadInfo}</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle size={14} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                                <span className="text-yellow-700">{t.payment_uploadInfo}</span>
                            </>
                        )}
                    </div>
                )}
                {!isDomestic && (
                    <div className={`p-3 rounded-xl text-xs flex items-start gap-2 ${hasIntlRails ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                        {hasIntlRails ? (
                            <>
                                <CheckCircle2 size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                                <span className="text-green-700">{t.payment_internationalInfo}</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle size={14} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                                <span className="text-yellow-700">{t.payment_internationalInfo}</span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
