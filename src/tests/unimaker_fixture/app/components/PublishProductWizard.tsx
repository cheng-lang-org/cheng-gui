import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Camera, Plus, Minus, Check, Package, Tag, Layers, DollarSign, Image as ImageIcon } from 'lucide-react';

interface PublishProductWizardProps {
    onClose: () => void;
}

interface SKUAttribute {
    name: string;
    values: string[];
}

interface SKUItem {
    attrs: string[];
    price: number;
    stock: number;
}

const categories = [
    { id: 'clothing', name: '服装服饰', icon: '👕' },
    { id: 'beauty', name: '美妆个护', icon: '💄' },
    { id: 'food', name: '食品饮料', icon: '🍜' },
    { id: 'digital', name: '数码电子', icon: '📱' },
    { id: 'home', name: '家居用品', icon: '🏠' },
    { id: 'sports', name: '运动户外', icon: '⚽' },
    { id: 'books', name: '图书文创', icon: '📚' },
    { id: 'other', name: '其他类目', icon: '📦' },
];

export default function PublishProductWizard({ onClose }: PublishProductWizardProps) {
    const [step, setStep] = useState(1);
    const [category, setCategory] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [basePrice, setBasePrice] = useState('');
    const [stock, setStock] = useState('');
    const [enableSKU, setEnableSKU] = useState(false);
    const [skuAttributes, setSkuAttributes] = useState<SKUAttribute[]>([
        { name: '颜色', values: [] },
        { name: '尺寸', values: [] },
    ]);
    const [newAttrValue, setNewAttrValue] = useState<{ [key: string]: string }>({});

    const totalSteps = 5;

    const canProceed = () => {
        switch (step) {
            case 1: return category !== null;
            case 2: return title.length > 0;
            case 3: return true;
            case 4: return basePrice && parseFloat(basePrice) > 0 && parseInt(stock) >= 0;
            case 5: return true;
            default: return false;
        }
    };

    const handlePublish = () => {
        console.log('Publishing product:', {
            category,
            title,
            description,
            images,
            basePrice,
            stock,
            enableSKU,
            skuAttributes,
        });
        onClose();
    };

    const addAttrValue = (attrIndex: number) => {
        const key = `attr_${attrIndex}`;
        const value = newAttrValue[key]?.trim();
        if (value && !skuAttributes[attrIndex].values.includes(value)) {
            const newAttrs = [...skuAttributes];
            newAttrs[attrIndex].values.push(value);
            setSkuAttributes(newAttrs);
            setNewAttrValue({ ...newAttrValue, [key]: '' });
        }
    };

    const removeAttrValue = (attrIndex: number, valueIndex: number) => {
        const newAttrs = [...skuAttributes];
        newAttrs[attrIndex].values.splice(valueIndex, 1);
        setSkuAttributes(newAttrs);
    };

    const renderStepIndicator = () => (
        <div className="flex items-center justify-center gap-1 mb-6">
            {[1, 2, 3, 4, 5].map((s) => (
                <div key={s} className="flex items-center">
                    <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${s < step ? 'bg-orange-500 text-white' :
                                s === step ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'
                            }`}
                    >
                        {s < step ? <Check size={14} /> : s}
                    </div>
                    {s < 5 && (
                        <div className={`w-6 h-0.5 ${s < step ? 'bg-orange-500' : 'bg-gray-200'}`} />
                    )}
                </div>
            ))}
        </div>
    );

    const renderStep1 = () => (
        <div className="space-y-4">
            <div className="flex items-center gap-2 justify-center mb-2">
                <Package size={20} className="text-orange-500" />
                <h4 className="font-medium text-gray-800">选择商品类目</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {categories.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => setCategory(cat.id)}
                        className={`p-4 rounded-xl transition-all flex items-center gap-3 border-2 ${category === cat.id
                                ? 'border-orange-500 bg-orange-50 shadow-md'
                                : 'border-gray-200 bg-white hover:border-orange-200'
                            }`}
                    >
                        <span className="text-2xl">{cat.icon}</span>
                        <span className="font-medium text-gray-800">{cat.name}</span>
                    </button>
                ))}
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="space-y-4">
            <div className="flex items-center gap-2 justify-center mb-2">
                <Tag size={20} className="text-orange-500" />
                <h4 className="font-medium text-gray-800">商品信息</h4>
            </div>

            <div>
                <label className="block text-sm text-gray-600 mb-2">商品标题 *</label>
                <input
                    type="text"
                    placeholder="请输入商品标题，如：原创设计纯棉T恤"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    maxLength={60}
                />
                <div className="text-right text-xs text-gray-400 mt-1">{title.length}/60</div>
            </div>

            <div>
                <label className="block text-sm text-gray-600 mb-2">商品描述</label>
                <textarea
                    placeholder="详细描述商品特点、材质、使用方法等..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full h-32 p-4 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
            </div>
        </div>
    );

    const renderStep3 = () => (
        <div className="space-y-4">
            <div className="flex items-center gap-2 justify-center mb-2">
                <ImageIcon size={20} className="text-orange-500" />
                <h4 className="font-medium text-gray-800">商品图片</h4>
            </div>
            <p className="text-sm text-gray-500 text-center">上传商品图片，第一张将作为主图</p>

            <div className="grid grid-cols-3 gap-3">
                {/* 已上传的图片占位 */}
                {images.map((_, idx) => (
                    <div key={idx} className="aspect-square bg-gray-100 rounded-xl relative">
                        <button className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center">
                            <X size={14} />
                        </button>
                    </div>
                ))}

                {/* 添加图片按钮 */}
                {images.length < 9 && (
                    <button
                        onClick={() => setImages([...images, 'placeholder'])}
                        className="aspect-square bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-orange-500 hover:bg-orange-50 transition-colors"
                    >
                        <Camera size={24} className="text-gray-400" />
                        <span className="text-xs text-gray-500">添加图片</span>
                    </button>
                )}
            </div>

            <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600">
                    💡 提示：建议上传正方形图片，主图会影响买家的点击率
                </p>
            </div>
        </div>
    );

    const renderStep4 = () => (
        <div className="space-y-4">
            <div className="flex items-center gap-2 justify-center mb-2">
                <DollarSign size={20} className="text-orange-500" />
                <h4 className="font-medium text-gray-800">价格与库存</h4>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-gray-600 mb-2">售价 (¥) *</label>
                    <input
                        type="number"
                        placeholder="0.00"
                        value={basePrice}
                        onChange={(e) => setBasePrice(e.target.value)}
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        min="0"
                        step="0.01"
                    />
                </div>
                <div>
                    <label className="block text-sm text-gray-600 mb-2">库存 *</label>
                    <input
                        type="number"
                        placeholder="0"
                        value={stock}
                        onChange={(e) => setStock(e.target.value)}
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        min="0"
                    />
                </div>
            </div>

            <button
                onClick={() => setEnableSKU(!enableSKU)}
                className={`w-full p-4 rounded-xl border-2 flex items-center justify-between transition-colors ${enableSKU ? 'border-orange-500 bg-orange-50' : 'border-gray-200'
                    }`}
            >
                <div className="flex items-center gap-3">
                    <Layers size={20} className="text-gray-600" />
                    <span className="font-medium">启用多规格SKU</span>
                </div>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${enableSKU ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
                    }`}>
                    {enableSKU && <Check size={12} className="text-white" />}
                </div>
            </button>
        </div>
    );

    const renderStep5 = () => (
        <div className="space-y-4">
            <div className="flex items-center gap-2 justify-center mb-2">
                <Layers size={20} className="text-orange-500" />
                <h4 className="font-medium text-gray-800">{enableSKU ? 'SKU属性设置' : '发布确认'}</h4>
            </div>

            {enableSKU ? (
                <div className="space-y-4">
                    {skuAttributes.map((attr, attrIndex) => (
                        <div key={attrIndex} className="p-4 bg-gray-50 rounded-xl">
                            <div className="font-medium text-gray-800 mb-3">{attr.name}</div>

                            <div className="flex flex-wrap gap-2 mb-3">
                                {attr.values.map((val, valIndex) => (
                                    <div key={valIndex} className="px-3 py-1.5 bg-white border border-gray-200 rounded-full flex items-center gap-2">
                                        <span className="text-sm">{val}</span>
                                        <button
                                            onClick={() => removeAttrValue(attrIndex, valIndex)}
                                            className="text-gray-400 hover:text-red-500"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder={`添加${attr.name}，如：${attr.name === '颜色' ? '白色' : 'M'}`}
                                    value={newAttrValue[`attr_${attrIndex}`] || ''}
                                    onChange={(e) => setNewAttrValue({ ...newAttrValue, [`attr_${attrIndex}`]: e.target.value })}
                                    onKeyPress={(e) => e.key === 'Enter' && addAttrValue(attrIndex)}
                                    className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                                />
                                <button
                                    onClick={() => addAttrValue(attrIndex)}
                                    className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                                >
                                    <Plus size={18} />
                                </button>
                            </div>
                        </div>
                    ))}

                    <div className="p-3 bg-blue-50 rounded-lg">
                        <p className="text-xs text-blue-700">
                            💡 设置好规格后，系统会自动生成组合SKU，您需要为每个SKU设置单独的价格和库存
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-xl">
                        <h5 className="font-medium text-gray-800 mb-3">商品信息预览</h5>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">类目</span>
                                <span>{categories.find(c => c.id === category)?.name}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">标题</span>
                                <span className="text-right max-w-[60%] truncate">{title}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">价格</span>
                                <span className="text-orange-600 font-semibold">¥{basePrice || '0'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">库存</span>
                                <span>{stock || '0'} 件</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">图片</span>
                                <span>{images.length} 张</span>
                            </div>
                        </div>
                    </div>

                    <div className="p-3 bg-green-50 rounded-lg flex items-center gap-2">
                        <Check size={16} className="text-green-600" />
                        <p className="text-xs text-green-700">商品信息已填写完成，确认发布后将上架销售</p>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
            <div className="bg-white w-full max-h-[90vh] rounded-t-3xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
                    <button
                        onClick={step === 1 ? onClose : () => setStep(step - 1)}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        {step === 1 ? <X size={24} /> : <ChevronLeft size={24} />}
                    </button>
                    <h3 className="font-semibold text-lg">发布商品</h3>
                    {step < totalSteps ? (
                        <button
                            onClick={() => setStep(step + 1)}
                            disabled={!canProceed()}
                            className={`p-2 rounded-full transition-colors ${canProceed() ? 'text-orange-500 hover:bg-orange-50' : 'text-gray-300'
                                }`}
                        >
                            <ChevronRight size={24} />
                        </button>
                    ) : (
                        <button
                            onClick={handlePublish}
                            className="px-5 py-2 bg-orange-500 text-white rounded-full font-medium hover:bg-orange-600 transition-colors"
                        >
                            发布
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {renderStepIndicator()}

                    {step === 1 && renderStep1()}
                    {step === 2 && renderStep2()}
                    {step === 3 && renderStep3()}
                    {step === 4 && renderStep4()}
                    {step === 5 && renderStep5()}
                </div>
            </div>
        </div>
    );
}
