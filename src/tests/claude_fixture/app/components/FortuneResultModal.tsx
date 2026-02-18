import { useMemo, useState } from 'react';
import { HelpCircle, Sparkles, Star, X } from 'lucide-react';
import { Solar } from 'lunar-javascript';
import { calculateBazi, hourToShichen, WUXING_COLORS } from '../utils/bazi';
import { calculateZiwei } from '../utils/ziwei';
import { interpretBazi, interpretZiwei } from '../domain/astrology/interpretation';

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

export function FortuneResultModal({ birthData, onClose }: FortuneResultModalProps) {
    const [activeTab, setActiveTab] = useState<'bazi' | 'ziwei'>('bazi');
    const [question, setQuestion] = useState('');
    const [lastAnswer, setLastAnswer] = useState('');

    const gender = birthData.gender === 'male' ? '男' : '女';

    const { baziResult, ziweiResult, baziReading, ziweiReading } = useMemo(() => {
        const bazi = calculateBazi(
            birthData.year,
            birthData.month,
            birthData.day,
            birthData.hour,
            gender,
            { minute: 0, timezone: 'Asia/Shanghai' },
        );

        const solar = Solar.fromYmdHms(birthData.year, birthData.month, birthData.day, birthData.hour, 0, 0);
        const lunar = solar.getLunar();
        const ziwei = calculateZiwei(
            lunar.getYear(),
            Math.abs(lunar.getMonth()),
            lunar.getDay(),
            hourToShichen(birthData.hour),
            gender,
            { minute: 0, timezone: 'Asia/Shanghai' },
        );

        return {
            baziResult: bazi,
            ziweiResult: ziwei,
            baziReading: interpretBazi(bazi),
            ziweiReading: interpretZiwei(ziwei),
        };
    }, [birthData.day, birthData.gender, birthData.hour, birthData.month, birthData.year, gender]);

    const handleAskQuestion = () => {
        if (!question.trim()) return;
        const base = activeTab === 'bazi' ? baziReading.summary : ziweiReading.summary;
        setLastAnswer(`问题：${question}\n建议：${base}`.trim());
        setQuestion('');
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
            <div className="bg-white w-full max-h-[90vh] rounded-t-2xl overflow-hidden flex flex-col">
                <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-pink-600 p-4 text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles size={24} />
                        <h3 className="font-semibold text-lg">命理分析</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-4 bg-purple-50 border-b border-purple-100">
                    <p className="text-sm text-purple-800">
                        出生时间：{birthData.year}年{birthData.month}月{birthData.day}日 {birthData.hour}:00 · {gender}
                    </p>
                </div>

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

                <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === 'bazi' ? (
                        <div className="space-y-4">
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { label: '年柱', value: `${baziResult.yearPillar.gan}${baziResult.yearPillar.zhi}` },
                                    { label: '月柱', value: `${baziResult.monthPillar.gan}${baziResult.monthPillar.zhi}` },
                                    { label: '日柱', value: `${baziResult.dayPillar.gan}${baziResult.dayPillar.zhi}` },
                                    { label: '时柱', value: `${baziResult.hourPillar.gan}${baziResult.hourPillar.zhi}` },
                                ].map((pillar) => (
                                    <div key={pillar.label} className="bg-gray-50 rounded-lg p-3 text-center">
                                        <div className="text-xs text-gray-500 mb-1">{pillar.label}</div>
                                        <div className="text-lg font-bold text-gray-900">{pillar.value}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-3">五行分布</h4>
                                <div className="flex justify-between">
                                    {Object.entries(baziResult.wuxingCount).map(([name, value]) => (
                                        <div key={name} className="text-center">
                                            <div
                                                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold mx-auto mb-1"
                                                style={{ backgroundColor: WUXING_COLORS[name] }}
                                            >
                                                {value}
                                            </div>
                                            <span className="text-xs text-gray-600">{name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-purple-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-purple-700 mb-2">命理解读</h4>
                                <p className="text-sm text-gray-700 leading-relaxed">{baziReading.summary}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <div className="text-xs text-gray-500 mb-1">命宫</div>
                                    <div className="text-lg font-bold text-purple-600">{ziweiResult.gongs[ziweiResult.mingGongIdx].name}</div>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <div className="text-xs text-gray-500 mb-1">身宫</div>
                                    <div className="text-lg font-bold text-pink-600">{ziweiResult.gongs[ziweiResult.shenGongIdx].name}</div>
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-gray-700 mb-3">主要星曜</h4>
                                <div className="flex flex-wrap gap-2">
                                    {ziweiResult.gongs[ziweiResult.mingGongIdx].mainStars.map((star) => (
                                        <span
                                            key={star.name}
                                            className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm rounded-full flex items-center gap-1"
                                        >
                                            <Star size={12} />
                                            {star.name}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-pink-50 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-pink-700 mb-2">命盘解读</h4>
                                <p className="text-sm text-gray-700 leading-relaxed">{ziweiReading.summary}</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 bg-white">
                    <div className="flex items-center gap-2 mb-3">
                        <HelpCircle size={16} className="text-gray-500" />
                        <span className="text-sm text-gray-600">首版免费问答（不接支付）</span>
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
                            提问
                        </button>
                    </div>
                    {lastAnswer && (
                        <div className="mt-3 text-xs leading-5 text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-line">
                            {lastAnswer}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
