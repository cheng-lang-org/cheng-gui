import { useState, useRef } from 'react';
import { X, Camera, MapPin, Home, Calendar, Ruler } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';
import { publishDistributedContent } from '../data/distributedContent';
import { createPublishPaymentMeta, resolveActorId } from '../domain/payment/paymentApi';
import { getCurrentPolicyGroupId } from '../utils/region';
import { useLocale } from '../i18n/LocaleContext';
import { getWechatQr, getAlipayQr, getCreditCardEnabled, getSettlementWalletAddress } from '../utils/paymentStore';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';

interface PublishRentPageProps {
    onClose: () => void;
}

export default function PublishRentPage({ onClose }: PublishRentPageProps) {
    const { t } = useLocale();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [area, setArea] = useState('');
    const [rooms, setRooms] = useState('');
    const [category, setCategory] = useState('');
    const [availableDate, setAvailableDate] = useState('');
    const [price, setPrice] = useState('');
    const [priceUnit, setPriceUnit] = useState(t.pubRent_month);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');

    const categories = [t.pubRent_whole, t.pubRent_shared, t.pubRent_shortTerm, t.pubRent_shop, t.pubRent_office, t.pubRent_warehouse];
    const priceUnits = [t.pubRent_day, t.pubRent_week, t.pubRent_month, t.pubRent_year];

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
                scene: 'C2C_FIAT',
                ownerId,
                policyGroupId,
                amountCny: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
                wechatQr: isDomestic ? (getWechatQr() ?? undefined) : undefined,
                alipayQr: isDomestic ? (getAlipayQr() ?? undefined) : undefined,
                creditCardEnabled: isDomestic ? false : getCreditCardEnabled(),
                walletAddress: isDomestic ? undefined : getSettlementWalletAddress(),
            });
            const summary = `${title}${category ? ` · ${category}` : ''}${address ? ` · ${address}` : ''}${price ? ` · ¥${price}/${priceUnit}` : ''}`;
            console.log('Publishing rent:', {
                images, title, description, address, area, rooms, category, availableDate,
                price, priceUnit
            });
            await publishDistributedContent({
                publishCategory: 'rent',
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
                    rentMeta: {
                        title,
                        description,
                        address,
                        area,
                        rooms,
                        category,
                        availableDate,
                        priceUnit,
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
                <h1 className="font-semibold text-lg">{t.pubRent_title}</h1>
                <button onClick={handlePublish} disabled={!canPublish || isPublishing} className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing ? 'bg-teal-500 text-white hover:bg-teal-600' : 'bg-gray-200 text-gray-400'}`}>{isPublishing ? t.common_loading : t.pub_publish}</button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* 图片 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Home size={16} />{t.pubRent_image}</h3>
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
                                <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-teal-500">
                                    <Camera size={20} className="text-gray-400" /><span className="text-[10px] text-gray-500">{images.length}/9</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* 标题 */}
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t.pubRent_titlePlaceholder}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
                />

                {/* 描述 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubRent_desc}</h3>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t.pubRent_descPlaceholder}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 h-24 resize-none"
                    />
                </div>

                {/* 地址 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2"><MapPin size={16} />{t.pub_address}</h3>
                    <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="小区/街道/门牌号"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <p className="mt-1 text-xs text-gray-400">{t.publish_location_required_hint}</p>
                </div>

                {/* 面积与户型 */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Ruler size={16} />{t.pubRent_area}</h3>
                        <div className="relative">
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">m²</span>
                            <input
                                type="number"
                                value={area}
                                onChange={(e) => setArea(e.target.value)}
                                placeholder="0"
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                        </div>
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubRent_layout}</h3>
                        <input
                            type="text"
                            value={rooms}
                            onChange={(e) => setRooms(e.target.value)}
                            placeholder={t.pubRent_layoutPlaceholder}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
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
                                className={`px-4 py-2 rounded-full text-sm transition-colors ${category === c ? 'bg-teal-100 text-teal-600 border-teal-200 border' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'}`}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 入住时间 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Calendar size={16} />{t.pubRent_availableDate}</h3>
                    <input
                        type="date"
                        value={availableDate}
                        onChange={(e) => setAvailableDate(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>

                {/* 租金 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubRent_price}</h3>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">¥</span>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="0"
                                className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                        </div>
                        <select
                            value={priceUnit}
                            onChange={(e) => setPriceUnit(e.target.value)}
                            className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 outline-none"
                        >
                            {priceUnits.map(u => <option key={u} value={u}>/{u}</option>)}
                        </select>
                    </div>
                </div>

                <PaymentConfigSection />
            </div>
        </div>
    );
}
