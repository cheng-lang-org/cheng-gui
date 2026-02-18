import { useState, useRef } from 'react';
import { X, Camera, Tag, Package, Star, Recycle } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';

interface PublishSecondhandPageProps {
    onClose: () => void;
}

export default function PublishSecondhandPage({ onClose }: PublishSecondhandPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [originalPrice, setOriginalPrice] = useState('');
    const [condition, setCondition] = useState('');
    const [category, setCategory] = useState('');
    // 收款设置
    const [wechatQrCode, setWechatQrCode] = useState<string | null>(null);
    const [alipayQrCode, setAlipayQrCode] = useState<string | null>(null);
    const [creditCardEnabled, setCreditCardEnabled] = useState(false);
    const [walletAddress, setWalletAddress] = useState('');

    const conditions = ['全新', '几乎全新', '轻微使用', '明显使用', '需维修'];
    const categories = ['数码', '服饰', '家居', '图书', '运动', '其他'];

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => setImages(prev => [...prev, e.target?.result as string]);
            reader.readAsDataURL(file);
        });
    };

    const handlePublish = () => {
        console.log('Publishing secondhand:', {
            images, title, description, price, originalPrice, condition, category,
            wechatQrCode, alipayQrCode, creditCardEnabled, walletAddress
        });
        onClose();
    };

    const canPublish = title && condition && category && images.length > 0 && price;

    // 计算折扣
    const discount = originalPrice && price
        ? Math.round((1 - parseFloat(price) / parseFloat(originalPrice)) * 100)
        : null;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
                <h1 className="font-semibold text-lg flex items-center gap-2"><Recycle size={20} className="text-green-500" />发布闲置</h1>
                <button onClick={handlePublish} disabled={!canPublish} className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-200 text-gray-400'}`}>发布</button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* 图片 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Camera size={16} />物品图片 <span className="text-red-500">*</span></h3>
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
                                <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-green-500">
                                    <Camera size={20} className="text-gray-400" /><span className="text-[10px] text-gray-500">{images.length}/9</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <input type="text" placeholder="物品名称" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />

                {/* 成色 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Star size={14} />成色 <span className="text-red-500">*</span></h3>
                    <div className="flex flex-wrap gap-2">
                        {conditions.map(cond => (
                            <button key={cond} onClick={() => setCondition(cond)} className={`px-4 py-2 rounded-full text-sm ${condition === cond ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{cond}</button>
                        ))}
                    </div>
                </div>

                {/* 分类 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Tag size={14} />分类 <span className="text-red-500">*</span></h3>
                    <div className="flex flex-wrap gap-2">
                        {categories.map(cat => (
                            <button key={cat} onClick={() => setCategory(cat)} className={`px-4 py-2 rounded-full text-sm ${category === cat ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{cat}</button>
                        ))}
                    </div>
                </div>

                {/* 原价（可选） */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Package size={14} />原价（可选）</h3>
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">¥</span>
                        <input type="number" placeholder="原价" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                    {discount !== null && discount > 0 && (
                        <p className="text-xs text-green-600 mt-1">比原价便宜 {discount}%</p>
                    )}
                </div>

                {/* 收款配置 */}
                <PaymentConfigSection
                    price={price}
                    onPriceChange={setPrice}
                    wechatQrCode={wechatQrCode}
                    onWechatQrCodeChange={setWechatQrCode}
                    alipayQrCode={alipayQrCode}
                    onAlipayQrCodeChange={setAlipayQrCode}
                    creditCardEnabled={creditCardEnabled}
                    onCreditCardEnabledChange={setCreditCardEnabled}
                    walletAddress={walletAddress}
                    onWalletAddressChange={setWalletAddress}
                />

                <textarea placeholder="描述物品详情、使用情况..." value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
            </div>
        </div>
    );
}
