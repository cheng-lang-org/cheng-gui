import { useState } from 'react';
import { ChevronLeft, Share2, Heart, ShoppingCart, Star, ChevronRight, MessageCircle, Store, Check } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface ProductDetailPageProps {
    onBack: () => void;
    product?: {
        id: string;
        title: string;
        price: number;
        originalPrice?: number;
        images: string[];
        sales: number;
        rating: number;
        reviews: number;
        description: string;
        shop: {
            name: string;
            avatar: string;
            fans: number;
        };
        skuOptions: {
            name: string;
            values: { label: string; image?: string }[];
        }[];
    };
}

// Mock product data
const mockProduct = {
    id: 'prod_001',
    title: '2024新款韩版宽松短袖T恤女夏季薄款纯棉印花上衣潮流百搭气质',
    price: 89,
    originalPrice: 199,
    images: [
        'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
        'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800',
        'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=800',
        'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800',
    ],
    sales: 2861,
    rating: 4.9,
    reviews: 1523,
    description: '优质面料，舒适透气，时尚百搭，不挑身材，多色可选',
    shop: {
        name: '潮流服饰旗舰店',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100',
        fans: 12800,
    },
    skuOptions: [
        {
            name: '颜色',
            values: [
                { label: '白色' },
                { label: '黑色' },
                { label: '灰色' },
                { label: '粉色' },
            ],
        },
        {
            name: '尺码',
            values: [
                { label: 'S' },
                { label: 'M' },
                { label: 'L' },
                { label: 'XL' },
                { label: 'XXL' },
            ],
        },
    ],
};

export default function ProductDetailPage({ onBack, product = mockProduct }: ProductDetailPageProps) {
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [showSKUPanel, setShowSKUPanel] = useState(false);
    const [selectedSKU, setSelectedSKU] = useState<{ [key: string]: string }>({});
    const [quantity, setQuantity] = useState(1);
    const [isFavorite, setIsFavorite] = useState(false);

    const discount = product.originalPrice
        ? Math.round((1 - product.price / product.originalPrice) * 100)
        : 0;

    const renderImageCarousel = () => (
        <div className="relative bg-gray-100">
            <div className="aspect-square overflow-hidden">
                <ImageWithFallback
                    src={product.images[currentImageIndex]}
                    alt={product.title}
                    className="w-full h-full object-cover"
                />
            </div>

            {/* Image dots */}
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                {product.images.map((_, idx) => (
                    <button
                        key={idx}
                        onClick={() => setCurrentImageIndex(idx)}
                        className={`w-2 h-2 rounded-full transition-colors ${idx === currentImageIndex ? 'bg-white' : 'bg-white/50'
                            }`}
                    />
                ))}
            </div>

            {/* Navigation buttons */}
            <div className="absolute top-4 left-4 right-4 flex justify-between">
                <button
                    onClick={onBack}
                    className="w-10 h-10 bg-black/30 backdrop-blur-sm rounded-full flex items-center justify-center text-white"
                >
                    <ChevronLeft size={24} />
                </button>
                <button className="w-10 h-10 bg-black/30 backdrop-blur-sm rounded-full flex items-center justify-center text-white">
                    <Share2 size={20} />
                </button>
            </div>
        </div>
    );

    const renderPriceSection = () => (
        <div className="bg-white px-4 py-4">
            <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm text-red-500">¥</span>
                <span className="text-3xl font-bold text-red-500">{product.price}</span>
                {product.originalPrice && (
                    <>
                        <span className="text-sm text-gray-400 line-through">¥{product.originalPrice}</span>
                        <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs rounded">-{discount}%</span>
                    </>
                )}
            </div>

            <h1 className="text-base font-medium text-gray-900 leading-snug mb-3">
                {product.title}
            </h1>

            <div className="flex items-center gap-4 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                    <Star size={14} className="text-yellow-400 fill-yellow-400" />
                    <span>{product.rating}</span>
                </div>
                <span>{product.reviews}条评价</span>
                <span>已售{product.sales}</span>
            </div>
        </div>
    );

    const renderSKUSelector = () => (
        <button
            onClick={() => setShowSKUPanel(true)}
            className="bg-white px-4 py-4 mt-2 flex items-center justify-between"
        >
            <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">选择</span>
                {Object.keys(selectedSKU).length > 0 ? (
                    <span className="text-sm">{Object.values(selectedSKU).join(' / ')}</span>
                ) : (
                    <span className="text-sm text-gray-400">请选择颜色、尺码</span>
                )}
            </div>
            <ChevronRight size={20} className="text-gray-400" />
        </button>
    );

    const renderShopSection = () => (
        <div className="bg-white px-4 py-4 mt-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <ImageWithFallback
                    src={product.shop.avatar}
                    alt={product.shop.name}
                    className="w-12 h-12 rounded-full object-cover"
                />
                <div>
                    <div className="font-medium">{product.shop.name}</div>
                    <div className="text-xs text-gray-500">{product.shop.fans}粉丝</div>
                </div>
            </div>
            <button className="px-4 py-2 border border-red-500 text-red-500 rounded-full text-sm font-medium">
                进店
            </button>
        </div>
    );

    const renderDescriptionSection = () => (
        <div className="bg-white px-4 py-4 mt-2">
            <h3 className="font-medium mb-3">商品详情</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{product.description}</p>

            {/* 详情图片 */}
            <div className="mt-4 space-y-2">
                {product.images.slice(1).map((img, idx) => (
                    <ImageWithFallback
                        key={idx}
                        src={img}
                        alt={`详情图${idx + 1}`}
                        className="w-full rounded-lg"
                    />
                ))}
            </div>
        </div>
    );

    const renderBottomBar = () => (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-4">
            <div className="flex items-center gap-6">
                <button className="flex flex-col items-center gap-1">
                    <Store size={22} className="text-gray-600" />
                    <span className="text-xs text-gray-600">店铺</span>
                </button>
                <button className="flex flex-col items-center gap-1">
                    <MessageCircle size={22} className="text-gray-600" />
                    <span className="text-xs text-gray-600">客服</span>
                </button>
                <button
                    onClick={() => setIsFavorite(!isFavorite)}
                    className="flex flex-col items-center gap-1"
                >
                    <Heart
                        size={22}
                        className={isFavorite ? 'text-red-500 fill-red-500' : 'text-gray-600'}
                    />
                    <span className="text-xs text-gray-600">收藏</span>
                </button>
            </div>

            <div className="flex-1 flex gap-2">
                <button
                    onClick={() => setShowSKUPanel(true)}
                    className="flex-1 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-full font-medium flex items-center justify-center gap-1"
                >
                    <ShoppingCart size={18} />
                    加入购物车
                </button>
                <button
                    onClick={() => setShowSKUPanel(true)}
                    className="flex-1 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-full font-medium"
                >
                    立即购买
                </button>
            </div>
        </div>
    );

    const renderSKUPanel = () => (
        <div
            className={`fixed inset-0 z-50 transition-opacity ${showSKUPanel ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
            <div
                className="absolute inset-0 bg-black/50"
                onClick={() => setShowSKUPanel(false)}
            />
            <div
                className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[80vh] overflow-hidden transition-transform ${showSKUPanel ? 'translate-y-0' : 'translate-y-full'
                    }`}
            >
                {/* Panel Header */}
                <div className="p-4 border-b border-gray-100 flex items-start gap-4">
                    <ImageWithFallback
                        src={product.images[0]}
                        alt={product.title}
                        className="w-20 h-20 rounded-lg object-cover"
                    />
                    <div className="flex-1">
                        <div className="flex items-baseline gap-1 mb-2">
                            <span className="text-sm text-red-500">¥</span>
                            <span className="text-2xl font-bold text-red-500">{product.price}</span>
                        </div>
                        <div className="text-sm text-gray-500">
                            已选: {Object.values(selectedSKU).join(' ') || '请选择规格'}
                        </div>
                    </div>
                    <button
                        onClick={() => setShowSKUPanel(false)}
                        className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
                    >
                        <span className="text-gray-500">×</span>
                    </button>
                </div>

                {/* SKU Options */}
                <div className="p-4 overflow-y-auto max-h-[50vh]">
                    {product.skuOptions.map((option) => (
                        <div key={option.name} className="mb-6">
                            <h4 className="text-sm font-medium mb-3">{option.name}</h4>
                            <div className="flex flex-wrap gap-2">
                                {option.values.map((val) => (
                                    <button
                                        key={val.label}
                                        onClick={() => setSelectedSKU({ ...selectedSKU, [option.name]: val.label })}
                                        className={`px-4 py-2 rounded-lg text-sm border-2 transition-colors ${selectedSKU[option.name] === val.label
                                                ? 'border-red-500 bg-red-50 text-red-500'
                                                : 'border-gray-200 text-gray-700'
                                            }`}
                                    >
                                        {val.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Quantity */}
                    <div className="flex items-center justify-between py-4 border-t border-gray-100">
                        <span className="text-sm font-medium">数量</span>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600"
                            >
                                -
                            </button>
                            <span className="w-8 text-center">{quantity}</span>
                            <button
                                onClick={() => setQuantity(quantity + 1)}
                                className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600"
                            >
                                +
                            </button>
                        </div>
                    </div>
                </div>

                {/* Panel Footer */}
                <div className="p-4 border-t border-gray-100 flex gap-3">
                    <button
                        onClick={() => setShowSKUPanel(false)}
                        className="flex-1 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-full font-medium"
                    >
                        加入购物车
                    </button>
                    <button
                        onClick={() => setShowSKUPanel(false)}
                        className="flex-1 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-full font-medium"
                    >
                        立即购买
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="h-full bg-gray-100 overflow-y-auto pb-20">
            {renderImageCarousel()}
            {renderPriceSection()}
            {renderSKUSelector()}
            {renderShopSection()}
            {renderDescriptionSection()}
            {renderBottomBar()}
            {renderSKUPanel()}
        </div>
    );
}
