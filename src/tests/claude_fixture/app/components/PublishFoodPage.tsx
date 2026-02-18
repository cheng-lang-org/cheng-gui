import { useState, useRef } from 'react';
import { X, Camera, MapPin, Utensils, Clock } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';
import { publishDistributedContent } from '../data/distributedContent';
import { createPublishPaymentMeta, resolveActorId } from '../domain/payment/paymentApi';
import { getCurrentPolicyGroupId } from '../utils/region';
import { useLocale } from '../i18n/LocaleContext';
import { getWechatQr, getAlipayQr, getCreditCardEnabled, getSettlementWalletAddress } from '../utils/paymentStore';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';

interface PublishFoodPageProps {
    onClose: () => void;
}

export default function PublishFoodPage({ onClose }: PublishFoodPageProps) {
    const { t } = useLocale();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState('');
    const [address, setAddress] = useState('');
    const [availableTime, setAvailableTime] = useState('');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');

    const categories = [t.pubFood_homeCooking, t.pubFood_baking, t.pubFood_dessert, t.pubFood_drink, t.pubFood_snack, t.pub_other];

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => setImages(prev => [...prev, e.target?.result as string]);
            reader.readAsDataURL(file);
        });
    };

    const handlePublish = async () => {
        if (isPublishing) {
            return;
        }
        setPublishError('');
        setIsPublishing(true);
        const parsedPrice = Number.parseFloat(price);
        const ownerId = resolveActorId();
        const policyGroupId = getCurrentPolicyGroupId();
        const isDomestic = policyGroupId === 'CN';
        try {
            const paymentMeta = await createPublishPaymentMeta({
                scene: 'ECOM_PRODUCT',
                ownerId,
                policyGroupId,
                amountCny: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
                wechatQr: isDomestic ? (getWechatQr() ?? undefined) : undefined,
                alipayQr: isDomestic ? (getAlipayQr() ?? undefined) : undefined,
                creditCardEnabled: isDomestic ? false : getCreditCardEnabled(),
                walletAddress: isDomestic ? undefined : getSettlementWalletAddress(),
            });
            const summary = `${title}${category ? ` · ${category}` : ''}${price ? ` · ¥${price}` : ''}${address ? ` · ${address}` : ''}`;
            console.log('Publishing food:', {
                images, title, description, price, category, address, availableTime
            });
            await publishDistributedContent({
                publishCategory: 'food',
                type: images.length > 0 ? 'image' : 'text',
                content: summary,
                media: images[0],
                mediaItems: images,
                coverMedia: images[0],
                mediaAspectRatio: images.length > 0 ? 1 : undefined,
                locationHint: {
                    city: address.trim() || undefined,
                },
                extra: {
                    foodMeta: {
                        title,
                        description,
                        category,
                        address,
                        availableTime,
                    },
                    ...(Number.isFinite(parsedPrice) && parsedPrice > 0 ? { isPaid: true, price: parsedPrice } : {}),
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

    const canPublish = title && address && category && price;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
                <h1 className="font-semibold text-lg flex items-center gap-2"><Utensils size={20} className="text-orange-500" />{t.pubFood_title}</h1>
                <button onClick={handlePublish} disabled={!canPublish || isPublishing} className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-gray-200 text-gray-400'}`}>{isPublishing ? t.common_loading : t.pub_publish}</button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* 图片 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Camera size={16} />{t.pubFood_image}</h3>
                    <div className="flex gap-2 flex-wrap">
                        {images.map((img, idx) => (
                            <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden">
                                <img src={img} alt="" className="w-full h-full object-cover" />
                                <button onClick={() => setImages(images.filter((_, i) => i !== idx))} className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full text-xs">×</button>
                            </div>
                        ))}
                        {images.length < 9 && (
                            <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 bg-gray-50 border border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:bg-gray-100">
                                <Camera size={24} />
                                <span className="text-xs mt-1">{images.length}/9</span>
                            </button>
                        )}
                        <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/*" multiple className="hidden" />
                    </div>
                </div>

                {/* 标题 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubFood_name}</h3>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="例如：自制红烧肉"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                </div>

                {/* 描述 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubFood_desc}</h3>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="描述一下这道美食..."
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 h-24 resize-none"
                    />
                </div>

                {/* 价格 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubFood_price}</h3>
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">¥</span>
                        <input
                            type="number"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                    </div>
                </div>

                {/* 分类 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pub_category}</h3>
                    <div className="flex flex-wrap gap-2">
                        {categories.map((c) => (
                            <button
                                key={c}
                                onClick={() => setCategory(c)}
                                className={`px-4 py-2 rounded-full text-sm transition-colors ${category === c ? 'bg-orange-100 text-orange-600 border-orange-200 border' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 供餐时间 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Clock size={16} />{t.pubFood_time}</h3>
                    <input
                        type="text"
                        value={availableTime}
                        onChange={(e) => setAvailableTime(e.target.value)}
                        placeholder="例如：每日 18:00 - 20:00"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                </div>

                {/* 地址 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2"><MapPin size={16} />{t.pub_address}</h3>
                    <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={t.pub_addressPlaceholder}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    <p className="mt-1 text-xs text-gray-400">{t.publish_location_required_hint}</p>
                </div>

                <PaymentConfigSection />
            </div>
        </div>
    );
}
