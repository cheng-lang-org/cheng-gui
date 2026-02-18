import { useState } from 'react';
import { Calendar, HelpCircle, X, Sparkles, Star, Lock } from 'lucide-react';

interface FortuneResultModalProps {
    birthData: {
        year: number;
        month: number;
        day: number;
        hour: number;
        gender: 'male' | 'female';
    };
    onClose: () => void;
}

// Mock BaZi calculation result
const mockBaZiResult = {
    yearPillar: '丙寅',
    monthPillar: '己亥',
    dayPillar: '甲子',
    hourPillar: '甲子',
    elements: {
        wood: 3,
        fire: 1,
        earth: 1,
        metal: 0,
        water: 3,
    },
    analysis: '命主八字木水旺盛，缺金。性格聪明灵活，富有创造力，但需注意健康和情绪管理。适合从事技术、艺术或教育行业。',
};

// Mock Ziwei result
const mockZiweiResult = {
    mingGong: '紫微天府',
    shenGong: '天机太阴',
    mainStars: ['紫微', '天府', '天机', '太阴'],
    analysis: '命宫紫微天府同度，主人格局高贵，为人正直大方。配合身宫天机太阴，智谋出众，适合从事管理或专业技术工作。',
};

export function FortuneResultModal({ birthData, onClose }: FortuneResultModalProps) {
    const [activeTab, setActiveTab] = useState<'bazi' | 'ziwei'>('bazi');
    const [question, setQuestion] = useState('');
    const [hasAskedFreeQuestion, setHasAskedFreeQuestion] = useState(false);
    const [showPaymentPrompt, setShowPaymentPrompt] = useState(false);

    const handleAskQuestion = () => {
        if (hasAskedFreeQuestion) {
            setShowPaymentPrompt(true);
        } else {
            // Simulate answering free question
            setHasAskedFreeQuestion(true);
            setQuestion('');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
            <div className="bg-white w-full max-h-[90vh] rounded-t-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-pink-600 p-4 text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles size={24} />
                        <h3 className="font-semibold text-lg">命理分析</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full">
                        <X size={24} />
                    </button>
                </div>

                {/* Birth Info Summary */}
                <div className="p-4 bg-purple-50 border-b border-purple-100">
                    <p className="text-sm text-purple-800">
                        出生时间：{birthData.year}年{birthData.month}月{birthData.day}日 {birthData.hour}:00
                        · {birthData.gender === 'male' ? '男' : '女'}
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('bazi')}
                        className={`flex-1 py-3 text-center font-medium transition-colors ${activeTab === 'bazi'
                                ? 'text-purple-600 border-b-2 border-purple-600'
                                : 'text-gray-600'
                            }`}
                    >
                        八字分析
                    </button>
                    <button
                        onClick={() => setActiveTab('ziwei')}
                        className={`flex-1 py-3 text-center font-medium transition-colors ${activeTab === 'ziwei'
                                ? 'text-purple-600 border-b-2 border-purple-600'
                                : 'text-gray-600'
                            }`}
                    >
                        紫微斗数
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === 'bazi' ? (
                        <div className="space-y-4">
                            {/* Four Pillars */}
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { label: '年柱', value: mockBaZiResult.yearPillar },
                                    { label: '月柱', value: mockBaZiResult.monthPillar },
                                    { label: '日柱', value: mockBaZiResult.dayPillar },
                                    { label: '时柱', value: mockBaZiResult.hourPillar },
                                ].map((pillar) => (
                                    <div key={pillar.label} className="bg-gray-50 rounded-lg p-3 text-center">
                                        <div className="text-xs text-gray-500 mb-1">{pillar.label}</div>
                                        <div className="text-lg font-bold text-gray-900">{pillar.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Five Elements */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-3">五行分布</h4>
                                <div className="flex justify-between">
                                    {[
                                        { name: '木', value: mockBaZiResult.elements.wood, color: 'bg-green-500' },
                                        { name: '火', value: mockBaZiResult.elements.fire, color: 'bg-red-500' },
                                        { name: '土', value: mockBaZiResult.elements.earth, color: 'bg-yellow-500' },
                                        { name: '金', value: mockBaZiResult.elements.metal, color: 'bg-gray-400' },
                                        { name: '水', value: mockBaZiResult.elements.water, color: 'bg-blue-500' },
                                    ].map((el) => (
                                        <div key={el.name} className="text-center">
                                            <div className={`w-8 h-8 ${el.color} rounded-full flex items-center justify-center text-white font-bold mx-auto mb-1`}>
                                                {el.value}
                                            </div>
                                            <span className="text-xs text-gray-600">{el.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Analysis */}
                            <div className="bg-purple-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-purple-700 mb-2">命理解读</h4>
                                <p className="text-sm text-gray-700 leading-relaxed">{mockBaZiResult.analysis}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Main Palaces */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <div className="text-xs text-gray-500 mb-1">命宫</div>
                                    <div className="text-lg font-bold text-purple-600">{mockZiweiResult.mingGong}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <div className="text-xs text-gray-500 mb-1">身宫</div>
                                    <div className="text-lg font-bold text-pink-600">{mockZiweiResult.shenGong}</div>
                                </div>
                            </div>

                            {/* Main Stars */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-3">主要星曜</h4>
                                <div className="flex flex-wrap gap-2">
                                    {mockZiweiResult.mainStars.map((star) => (
                                        <span
                                            key={star}
                                            className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm rounded-full flex items-center gap-1"
                                        >
                                            <Star size={12} />
                                            {star}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Analysis */}
                            <div className="bg-pink-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-pink-700 mb-2">命盘解读</h4>
                                <p className="text-sm text-gray-700 leading-relaxed">{mockZiweiResult.analysis}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Ask Question Section */}
                <div className="p-4 border-t border-gray-200 bg-white">
                    <div className="flex items-center gap-2 mb-3">
                        <HelpCircle size={16} className="text-gray-500" />
                        <span className="text-sm text-gray-600">
                            {hasAskedFreeQuestion ? (
                                <span className="flex items-center gap-1">
                                    <Lock size={14} />
                                    追问需支付 10 RWAD
                                </span>
                            ) : (
                                '免费提问一次'
                            )}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="输入您想问的问题..."
                            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <button
                            onClick={handleAskQuestion}
                            disabled={!question.trim()}
                            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {hasAskedFreeQuestion ? '付费提问' : '免费提问'}
                        </button>
                    </div>
                </div>

                {/* Payment Prompt */}
                {showPaymentPrompt && (
                    <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
                            <Lock size={48} className="text-purple-500 mx-auto mb-4" />
                            <h4 className="font-semibold text-lg mb-2">需要付费解锁</h4>
                            <p className="text-gray-600 text-sm mb-4">
                                您的免费提问次数已用完，追问需支付 10 RWAD
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowPaymentPrompt(false)}
                                    className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600"
                                >
                                    取消
                                </button>
                                <button className="flex-1 py-2 bg-purple-500 text-white rounded-lg">
                                    支付 10 RWAD
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
