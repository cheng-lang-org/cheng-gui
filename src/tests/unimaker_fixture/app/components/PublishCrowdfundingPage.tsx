import { useState } from 'react';
import { X, Upload, Rocket, Calendar, Users, Gift, Info } from 'lucide-react';
import PaymentConfigSection from './PaymentConfigSection';

interface PublishCrowdfundingPageProps {
    onClose: () => void;
}

export default function PublishCrowdfundingPage({ onClose }: PublishCrowdfundingPageProps) {
    const [images, setImages] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [goalAmount, setGoalAmount] = useState('');
    const [minSupport, setMinSupport] = useState('');
    const [endDate, setEndDate] = useState('');
    const [category, setCategory] = useState('');
    const [rewards, setRewards] = useState([{ amount: '', description: '', limit: '' }]);
    // 收款设置
    const [wechatQrCode, setWechatQrCode] = useState<string | null>(null);
    const [alipayQrCode, setAlipayQrCode] = useState<string | null>(null);
    const [creditCardEnabled, setCreditCardEnabled] = useState(false);
    const [walletAddress, setWalletAddress] = useState('');

    const categories = ['科技产品', '创意设计', '影视动画', '音乐专辑', '游戏开发', '公益项目', '出版物', '其他'];

    const handleImageUpload = () => {
        const mockImage = `https://images.unsplash.com/photo-${Date.now()}?w=400`;
        if (images.length < 5) {
            setImages([...images, mockImage]);
        }
    };

    const addReward = () => {
        setRewards([...rewards, { amount: '', description: '', limit: '' }]);
    };

    const updateReward = (index: number, field: string, value: string) => {
        const newRewards = [...rewards];
        newRewards[index] = { ...newRewards[index], [field]: value };
        setRewards(newRewards);
    };

    const removeReward = (index: number) => {
        if (rewards.length > 1) {
            setRewards(rewards.filter((_, i) => i !== index));
        }
    };

    const handleSubmit = () => {
        console.log('众筹项目:', {
            title, description, goalAmount, minSupport, endDate, category, rewards, images,
            wechatQrCode, alipayQrCode, creditCardEnabled, walletAddress
        });
        onClose();
    };

    const canPublish = title && endDate && goalAmount;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="text-lg font-semibold flex items-center gap-2">
                    <Rocket size={20} className="text-cyan-500" />
                    发起众筹
                </h1>
                <button
                    onClick={handleSubmit}
                    disabled={!canPublish}
                    className="px-4 py-2 bg-cyan-500 text-white rounded-full text-sm font-medium disabled:opacity-50"
                >
                    发布
                </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* 图片上传 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">项目封面（最多5张）</label>
                    <div className="flex gap-2 flex-wrap">
                        {images.map((img, idx) => (
                            <div key={idx} className="w-20 h-20 rounded-lg overflow-hidden relative">
                                <img src={img} alt="" className="w-full h-full object-cover" />
                                <button
                                    onClick={() => setImages(images.filter((_, i) => i !== idx))}
                                    className="absolute top-1 right-1 w-5 h-5 bg-black bg-opacity-50 rounded-full flex items-center justify-center"
                                >
                                    <X size={12} className="text-white" />
                                </button>
                            </div>
                        ))}
                        {images.length < 5 && (
                            <button
                                onClick={handleImageUpload}
                                className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400"
                            >
                                <Upload size={20} />
                                <span className="text-xs mt-1">上传</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* 项目标题 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">项目标题</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="请输入众筹项目标题"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                </div>

                {/* 项目描述 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">项目描述</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="详细介绍你的众筹项目..."
                        rows={4}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none"
                    />
                </div>

                {/* 收款配置 */}
                <PaymentConfigSection
                    price={goalAmount}
                    onPriceChange={setGoalAmount}
                    wechatQrCode={wechatQrCode}
                    onWechatQrCodeChange={setWechatQrCode}
                    alipayQrCode={alipayQrCode}
                    onAlipayQrCodeChange={setAlipayQrCode}
                    creditCardEnabled={creditCardEnabled}
                    onCreditCardEnabledChange={setCreditCardEnabled}
                    walletAddress={walletAddress}
                    onWalletAddressChange={setWalletAddress}
                />

                {/* 最低支持 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Users size={14} className="inline mr-1" />
                        最低支持金额
                    </label>
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">¥</span>
                        <input
                            type="number"
                            value={minSupport}
                            onChange={(e) => setMinSupport(e.target.value)}
                            placeholder="1"
                            className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        />
                    </div>
                </div>

                {/* 结束日期 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Calendar size={14} className="inline mr-1" />
                        众筹截止日期
                    </label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                </div>

                {/* 项目分类 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">项目分类</label>
                    <div className="flex flex-wrap gap-2">
                        {categories.map((cat) => (
                            <button
                                key={cat}
                                onClick={() => setCategory(cat)}
                                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${category === cat
                                    ? 'bg-cyan-500 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 回报档位 */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Gift size={14} className="inline mr-1" />
                        回报档位
                    </label>
                    <div className="space-y-3">
                        {rewards.map((reward, index) => (
                            <div key={index} className="p-3 bg-gray-50 rounded-xl space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-500">档位 {index + 1}</span>
                                    {rewards.length > 1 && (
                                        <button onClick={() => removeReward(index)} className="text-red-500 text-sm">
                                            删除
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="number"
                                        value={reward.amount}
                                        onChange={(e) => updateReward(index, 'amount', e.target.value)}
                                        placeholder="支持金额 ¥"
                                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    />
                                    <input
                                        type="number"
                                        value={reward.limit}
                                        onChange={(e) => updateReward(index, 'limit', e.target.value)}
                                        placeholder="限量（留空不限）"
                                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    />
                                </div>
                                <input
                                    type="text"
                                    value={reward.description}
                                    onChange={(e) => updateReward(index, 'description', e.target.value)}
                                    placeholder="回报内容描述"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                            </div>
                        ))}
                        <button
                            onClick={addReward}
                            className="w-full py-2 border-2 border-dashed border-cyan-300 text-cyan-500 rounded-xl text-sm hover:bg-cyan-50"
                        >
                            + 添加回报档位
                        </button>
                    </div>
                </div>

                {/* 提示 */}
                <div className="flex items-start gap-2 p-3 bg-cyan-50 rounded-xl">
                    <Info size={16} className="text-cyan-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-cyan-700">
                        众筹项目需经过审核后才会上线。若未达到目标金额，所有支持者将获得全额退款。
                    </p>
                </div>
            </div>
        </div>
    );
}
