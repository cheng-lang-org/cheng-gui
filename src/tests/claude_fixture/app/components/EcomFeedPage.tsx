import { useState, useMemo } from 'react';
import { Search, ChevronLeft, ShoppingBag } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { getAllProducts, type EcomProduct } from '../data/ecomData';
import EcomProductDetailPage from './EcomProductDetailPage';

export interface EcomPaymentContext {
    sellerId: string;
    sellerName?: string;
    sourceContentId?: string;
    extra?: Record<string, unknown>;
}

interface Props {
    onClose: () => void;
    /** If provided, use these products instead of the bundled CSV data */
    externalProducts?: EcomProduct[];
    paymentContext?: EcomPaymentContext;
}

export default function EcomFeedPage({ onClose, externalProducts, paymentContext }: Props) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<EcomProduct | null>(null);

    const products = useMemo(() => externalProducts ?? getAllProducts(), [externalProducts]);

    const filteredProducts = useMemo(() => {
        if (!searchQuery.trim()) return products;
        const q = searchQuery.toLowerCase();
        return products.filter(p =>
            p.title.toLowerCase().includes(q) ||
            p.skus.some(s => s.label.toLowerCase().includes(q))
        );
    }, [products, searchQuery]);

    // If a product is selected, show its detail page
    if (selectedProduct) {
        return (
            <EcomProductDetailPage
                product={selectedProduct}
                onBack={() => setSelectedProduct(null)}
                paymentContext={paymentContext}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-40 bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 z-10">
                <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                >
                    <ChevronLeft size={22} />
                </button>
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="搜索商品..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                </div>
                <div className="flex items-center gap-1 text-gray-500">
                    <ShoppingBag size={18} />
                    <span className="text-xs font-medium">{products.length}</span>
                </div>
            </header>

            {/* Product Grid */}
            <div className="flex-1 overflow-y-auto px-2 py-3">
                {filteredProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                        <p className="text-sm">未找到相关商品</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {filteredProducts.map((product, idx) => (
                            <ProductCard
                                key={`${product.title}-${idx}`}
                                product={product}
                                onClick={() => setSelectedProduct(product)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function ProductCard({ product, onClick }: { product: EcomProduct; onClick: () => void }) {
    const firstSku = product.skus[0];
    const price = firstSku?.finalPriceUsd || firstSku?.priceText || '';
    const originalPrice = firstSku?.originalPriceUsd;
    const sold = firstSku?.sold;

    return (
        <button
            onClick={onClick}
            className="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow text-left"
        >
            <div className="aspect-square overflow-hidden bg-gray-100">
                <ImageWithFallback
                    src={product.coverImage}
                    alt={product.title}
                    className="w-full h-full object-cover"
                />
            </div>
            <div className="p-2.5">
                <h3 className="text-xs font-medium text-gray-900 line-clamp-2 leading-snug mb-1.5">
                    {product.title}
                </h3>
                <div className="flex items-baseline gap-1">
                    <span className="text-sm font-bold text-red-500">{price}</span>
                    {originalPrice && (
                        <span className="text-[10px] text-gray-400 line-through">{originalPrice}</span>
                    )}
                </div>
                <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-gray-400">
                        {product.skus.length}款可选
                    </span>
                    {sold && (
                        <span className="text-[10px] text-gray-400">已售{sold}</span>
                    )}
                </div>
            </div>
        </button>
    );
}
