import { useState, useRef } from 'react';
import { X, Camera, Tag, MapPin, Phone } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';

interface PublishSellPageProps {
    onClose: () => void;
}

export default function PublishSellPage({ onClose }: PublishSellPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState('');
    const [location, setLocation] = useState('');
    const [contact, setContact] = useState('');
    const [negotiable, setNegotiable] = useState(false);
    // 收款设置
    const [wechatQrCode, setWechatQrCode] = useState<string | null>(null);
    const [alipayQrCode, setAlipayQrCode] = useState<string | null>(null);
    const [creditCardEnabled, setCreditCardEnabled] = useState(false);
    const [walletAddress, setWalletAddress] = useState('');

    const categories = ['房产', '车辆', '土地', '商铺', '设备', '其他'];

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => setImages(prev => [...prev, e.target?.result as string]);
            reader.readAsDataURL(file);
        });
    };

    const handlePublish = () => {
        console.log('Publishing sell:', {
            images, title, description, price, category, location, contact, negotiable,
            wechatQrCode, alipayQrCode, creditCardEnabled, walletAddress
        });
        onClose();
    };

    const canPublish = title && category && price;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
                <h1 className="font-semibold text-lg">发布出售</h1>
                <button onClick={handlePublish} disabled={!canPublish} className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish ? 'bg-purple-500 text-white hover:bg-purple-600' : 'bg-gray-200 text-gray-400'}`}>发布</button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* 图片 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Camera size={16} />物品图片</h3>
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
                                <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-purple-500">
                                    <Camera size={20} className="text-gray-400" /><span className="text-[10px] text-gray-500">{images.length}/9</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <input type="text" placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />

                {/* 分类 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Tag size={14} />出售类型</h3>
                    <div className="flex flex-wrap gap-2">
                        {categories.map(cat => (
                            <button key={cat} onClick={() => setCategory(cat)} className={`px-4 py-2 rounded-full text-sm ${category === cat ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{cat}</button>
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

                {/* 可议价 */}
                <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">可议价</span>
                    <button onClick={() => setNegotiable(!negotiable)} className={`w-12 h-6 rounded-full transition-colors ${negotiable ? 'bg-purple-500' : 'bg-gray-300'}`}>
                        <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${negotiable ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><MapPin size={14} />所在地</h3>
                    <input type="text" placeholder="所在城市/地区" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Phone size={14} />联系方式</h3>
                    <input type="text" placeholder="电话或微信" value={contact} onChange={(e) => setContact(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                <textarea placeholder="详细描述..." value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
            </div>
        </div>
    );
}
