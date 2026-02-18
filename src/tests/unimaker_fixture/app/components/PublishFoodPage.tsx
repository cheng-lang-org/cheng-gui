import { useState, useRef } from 'react';
import { X, Camera, MapPin, Utensils, Clock } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';

interface PublishFoodPageProps {
    onClose: () => void;
}

export default function PublishFoodPage({ onClose }: PublishFoodPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState('');
    const [address, setAddress] = useState('');
    const [availableTime, setAvailableTime] = useState('');
    // 收款设置
    const [wechatQrCode, setWechatQrCode] = useState<string | null>(null);
    const [alipayQrCode, setAlipayQrCode] = useState<string | null>(null);
    const [creditCardEnabled, setCreditCardEnabled] = useState(false);
    const [walletAddress, setWalletAddress] = useState('');

    const categories = ['家常菜', '烘焙', '甜点', '饮品', '小吃', '其他'];

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => setImages(prev => [...prev, e.target?.result as string]);
            reader.readAsDataURL(file);
        });
    };

    const handlePublish = () => {
        console.log('Publishing food:', {
            images, title, description, price, category, address, availableTime,
            wechatQrCode, alipayQrCode, creditCardEnabled, walletAddress
        });
        onClose();
    };

    const canPublish = title && address && category && price;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
                <h1 className="font-semibold text-lg flex items-center gap-2"><Utensils size={20} className="text-orange-500" />发布美食</h1>
                <button onClick={handlePublish} disabled={!canPublish} className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-gray-200 text-gray-400'}`}>发布</button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* 图片 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Camera size={16} />美食图片</h3>
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

                <input type="text" placeholder="美食名称" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />

                {/* 分类 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">美食类型</h3>
                    <div className="flex flex-wrap gap-2">
                        {categories.map(cat => (
                            <button key={cat} onClick={() => setCategory(cat)} className={`px-4 py-2 rounded-full text-sm ${category === cat ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{cat}</button>
                        ))}
                    </div>
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

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={14} />供应时间</h3>
                    <input type="text" placeholder="如：每天 11:00-14:00" value={availableTime} onChange={(e) => setAvailableTime(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><MapPin size={14} />取餐地址</h3>
                    <input type="text" placeholder="取餐/配送地址" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                <textarea placeholder="描述美食特点、食材..." value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
            </div>
        </div>
    );
}
