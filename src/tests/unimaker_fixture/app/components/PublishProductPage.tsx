import { useState, useRef } from 'react';
import { X, Camera, Plus, Package } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';

interface PublishProductPageProps {
    onClose: () => void;
}

export default function PublishProductPage({ onClose }: PublishProductPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [stock, setStock] = useState('');
    const [enableSKU, setEnableSKU] = useState(false);
    const [colors, setColors] = useState<string[]>([]);
    const [sizes, setSizes] = useState<string[]>([]);
    const [newColor, setNewColor] = useState('');
    const [newSize, setNewSize] = useState('');
    // 收款设置
    const [price, setPrice] = useState('');
    const [wechatQrCode, setWechatQrCode] = useState<string | null>(null);
    const [alipayQrCode, setAlipayQrCode] = useState<string | null>(null);
    const [creditCardEnabled, setCreditCardEnabled] = useState(false);
    const [walletAddress, setWalletAddress] = useState('');

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

    const handlePublish = () => {
        console.log('Publishing product:', {
            title, description, images, stock,
            enableSKU, colors, sizes,
            price, wechatQrCode, alipayQrCode, creditCardEnabled, walletAddress,
        });
        onClose();
    };

    const canPublish = title.length > 0 && price.length > 0;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">发布商品</h1>
                <button
                    disabled={!canPublish}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish
                        ? 'bg-purple-500 text-white hover:bg-purple-600'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                    onClick={handlePublish}
                >
                    发布
                </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* 商品图片 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                        <Camera size={14} /> 商品图片
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">商品名称</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="请输入商品名称"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                </div>

                {/* 商品描述 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">商品描述</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="详细描述商品信息..."
                        rows={3}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                    />
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

                {/* 库存 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                        <Package size={14} /> 库存
                    </label>
                    <input
                        type="number"
                        value={stock}
                        onChange={(e) => setStock(e.target.value)}
                        placeholder="请输入库存数量"
                        min="0"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                </div>

                {/* SKU开关 */}
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">启用多规格（SKU）</span>
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
                            <label className="block text-sm font-medium text-gray-700 mb-2">颜色</label>
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
                                    placeholder="添加颜色"
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                                <button onClick={addColor} className="px-3 py-2 bg-purple-500 text-white rounded-lg">
                                    <Plus size={16} />
                                </button>
                            </div>
                        </div>

                        {/* 尺寸 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">尺寸</label>
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
                                    placeholder="添加尺寸"
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                                <button onClick={addSize} className="px-3 py-2 bg-teal-500 text-white rounded-lg">
                                    <Plus size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
