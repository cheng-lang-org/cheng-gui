import { useState, useRef } from 'react';
import { X, Camera, Tag, MapPin } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';
import { publishDistributedContent } from '../data/distributedContent';
import { createPublishPaymentMeta, resolveActorId } from '../domain/payment/paymentApi';
import { getCurrentPolicyGroupId } from '../utils/region';
import { useLocale } from '../i18n/LocaleContext';
import { getWechatQr, getAlipayQr, getCreditCardEnabled, getSettlementWalletAddress } from '../utils/paymentStore';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';

interface PublishSecondhandPageProps {
    onClose: () => void;
}

export default function PublishSecondhandPage({ onClose }: PublishSecondhandPageProps) {
    const { t } = useLocale();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [originalPrice, setOriginalPrice] = useState('');
    const [condition, setCondition] = useState('');
    const [category, setCategory] = useState('');
    const [locationInput, setLocationInput] = useState('');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');

    const categories = [t.pubSecond_digital, t.pubSecond_furniture, t.pubSecond_clothing, t.pubSecond_books, t.pubSecond_beauty, t.pubSecond_sports, t.pub_other];
    const conditions = [t.pubSecond_new, t.pubSecond_likeNew, t.pubSecond_good, t.pubSecond_fair];

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
                scene: 'C2C_FIAT', ownerId, policyGroupId,
                amountCny: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
                wechatQr: isDomestic ? (getWechatQr() ?? undefined) : undefined,
                alipayQr: isDomestic ? (getAlipayQr() ?? undefined) : undefined,
                creditCardEnabled: isDomestic ? false : getCreditCardEnabled(),
                walletAddress: isDomestic ? undefined : getSettlementWalletAddress(),
            });
            const summary = `${title}${category ? ` · ${category}` : ''}${condition ? ` · ${condition}` : ''}${price ? ` · ¥${price}` : ''}`;
            await publishDistributedContent({
                publishCategory: 'secondhand',
                type: images.length > 0 ? 'image' : 'text',
                content: summary, media: images[0], mediaItems: images, coverMedia: images[0],
                mediaAspectRatio: images.length > 0 ? 1 : undefined,
                extra: {
                    secondhandMeta: { title, description, category, condition, originalPrice, location: locationInput },
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

    const canPublish = title && category && price && condition;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
                <h1 className="font-semibold text-lg">{t.pubSecond_title}</h1>
                <button onClick={handlePublish} disabled={!canPublish || isPublishing} className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-gray-200 text-gray-400'}`}>{isPublishing ? t.common_loading : t.pub_publish}</button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Camera size={16} />{t.pubSecond_image}</h3>
                    <div className="flex gap-2 flex-wrap">
                        {images.map((img, idx) => (
                            <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden">
                                <img src={img} alt="" className="w-full h-full object-cover" />
                                <button onClick={() => setImages(images.filter((_, i) => i !== idx))} className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full text-xs">×</button>
                            </div>
                        ))}
                        {images.length < 9 && (
                            <>
                                <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/*" multiple className="hidden" />
                                <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-orange-500">
                                    <Camera size={20} className="text-gray-400" /><span className="text-[10px] text-gray-500">{images.length}/9</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>
                <input type="text" placeholder={t.pub_title} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                <textarea placeholder={t.pub_desc} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-32 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />

                {/* Location */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2"><MapPin size={16} />{t.pub_location}</h3>
                    <input
                        type="text"
                        value={locationInput}
                        onChange={(e) => setLocationInput(e.target.value)}
                        placeholder="城市/区域" // TODO: i18n
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    <p className="mt-1 text-xs text-gray-400">{t.publish_location_required_hint}</p>
                </div>

                <div className="flex gap-2">
                    <input type="number" placeholder={t.pub_price} value={price} onChange={(e) => setPrice(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    <input type="number" placeholder={t.pubSecond_originalPrice} value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Tag size={14} />{t.pubSecond_condition}</h3>
                    <div className="flex gap-2 mb-4">
                        {conditions.map(c => (
                            <button key={c} onClick={() => setCondition(c)} className={`px-4 py-2 rounded-full text-sm ${condition === c ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{c}</button>
                        ))}
                    </div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Tag size={14} />{t.pubSecond_category}</h3>
                    <div className="flex flex-wrap gap-2">
                        {categories.map(cat => (
                            <button key={cat} onClick={() => setCategory(cat)} className={`px-4 py-2 rounded-full text-sm ${category === cat ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{cat}</button>
                        ))}
                    </div>
                </div>

                <PaymentConfigSection />
            </div>
        </div>
    );
}
