import { useState } from 'react';
import { X, Image, Video, Music, FileText, Camera, ChevronLeft, ChevronRight, AlertTriangle, Check, Info } from 'lucide-react';

interface PublishContentWizardProps {
    onClose: () => void;
}

type ContentType = 'text' | 'image' | 'video' | 'audio';
type AgeRating = 'ALL' | '12+' | '16+' | '18+';
type RiskLevel = 0 | 1 | 2 | 3;

interface RiskDimensions {
    nudity: RiskLevel;      // 裸露/性
    violence: RiskLevel;    // 暴力/血腥
    drugs: RiskLevel;       // 毒品
    gambling: RiskLevel;    // 赌博
    political: RiskLevel;   // 政治敏感
}

const contentTypes = [
    { type: 'image' as ContentType, icon: Image, label: '图片', color: 'bg-blue-500' },
    { type: 'video' as ContentType, icon: Video, label: '视频', color: 'bg-purple-500' },
    { type: 'audio' as ContentType, icon: Music, label: '音频', color: 'bg-pink-500' },
    { type: 'text' as ContentType, icon: FileText, label: '文字', color: 'bg-green-500' },
];

const ageRatings: { value: AgeRating; label: string; desc: string }[] = [
    { value: 'ALL', label: '全年龄', desc: '适合所有人群观看' },
    { value: '12+', label: '12岁以上', desc: '包含轻度惊吓或暴力元素' },
    { value: '16+', label: '16岁以上', desc: '包含明显暴力或暗示内容' },
    { value: '18+', label: '18岁以上', desc: '成人内容，需要门禁确认' },
];

const riskDimensions = [
    {
        key: 'nudity' as const,
        label: '裸露/性',
        desc: '是否包含裸露或性暗示内容？',
        levels: ['无', '轻度暗示', '明确裸露', '色情内容']
    },
    {
        key: 'violence' as const,
        label: '暴力/血腥',
        desc: '是否包含暴力或血腥场景？',
        levels: ['无', '轻微打斗', '明显受伤', '强烈血腥']
    },
    {
        key: 'drugs' as const,
        label: '毒品相关',
        desc: '是否涉及毒品内容？',
        levels: ['无', '仅提及', '展示使用', '制贩教学']
    },
    {
        key: 'gambling' as const,
        label: '赌博相关',
        desc: '是否涉及赌博内容？',
        levels: ['无', '仅提及', '推广引导', '教学诈骗']
    },
    {
        key: 'political' as const,
        label: '政治敏感',
        desc: '是否涉及政治敏感话题？',
        levels: ['无', '一般讨论', '争议表达', '极端动员']
    },
];

export default function PublishContentWizard({ onClose }: PublishContentWizardProps) {
    const [step, setStep] = useState(1);
    const [selectedType, setSelectedType] = useState<ContentType | null>(null);
    const [content, setContent] = useState('');
    const [ageRating, setAgeRating] = useState<AgeRating>('ALL');
    const [risks, setRisks] = useState<RiskDimensions>({
        nudity: 0,
        violence: 0,
        drugs: 0,
        gambling: 0,
        political: 0,
    });
    const [expandedRisk, setExpandedRisk] = useState<string | null>(null);

    const totalSteps = 4;

    const canProceed = () => {
        switch (step) {
            case 1: return selectedType !== null;
            case 2: return content.length > 0;
            case 3: return true;
            case 4: return true;
            default: return false;
        }
    };

    const handlePublish = () => {
        const riskCode = `${risks.nudity}${risks.violence}${risks.drugs}${risks.gambling}${risks.political}`;
        console.log('Publishing content:', {
            type: selectedType,
            content,
            ageRating,
            riskCode,
            risks,
        });
        onClose();
    };

    const renderStepIndicator = () => (
        <div className="flex items-center justify-center gap-2 mb-6">
            {[1, 2, 3, 4].map((s) => (
                <div key={s} className="flex items-center">
                    <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${s < step ? 'bg-purple-500 text-white' :
                                s === step ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-500'
                            }`}
                    >
                        {s < step ? <Check size={16} /> : s}
                    </div>
                    {s < 4 && (
                        <div className={`w-8 h-0.5 ${s < step ? 'bg-purple-500' : 'bg-gray-200'}`} />
                    )}
                </div>
            ))}
        </div>
    );

    const renderStep1 = () => (
        <div className="space-y-4">
            <h4 className="text-center font-medium text-gray-800">选择内容类型</h4>
            <div className="grid grid-cols-2 gap-3">
                {contentTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                        <button
                            key={type.type}
                            onClick={() => setSelectedType(type.type)}
                            className={`p-5 rounded-2xl transition-all flex flex-col items-center gap-3 border-2 ${selectedType === type.type
                                    ? 'border-purple-500 bg-purple-50 shadow-md'
                                    : 'border-gray-200 bg-gray-50 hover:border-purple-200'
                                }`}
                        >
                            <div className={`w-12 h-12 ${type.color} rounded-xl flex items-center justify-center`}>
                                <Icon size={24} className="text-white" />
                            </div>
                            <span className="font-medium text-gray-800">{type.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="space-y-4">
            <h4 className="text-center font-medium text-gray-800">编辑内容</h4>

            <textarea
                placeholder="分享你的想法..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-32 p-4 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
            />

            {selectedType !== 'text' && (
                <button className="w-full p-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-colors flex flex-col items-center gap-2">
                    <Camera size={28} className="text-gray-400" />
                    <span className="text-sm text-gray-600">点击上传{selectedType === 'image' ? '图片' : selectedType === 'video' ? '视频' : '音频'}</span>
                </button>
            )}
        </div>
    );

    const renderStep3 = () => (
        <div className="space-y-4">
            <h4 className="text-center font-medium text-gray-800">内容分级</h4>
            <p className="text-sm text-gray-500 text-center">选择适合观看的年龄范围</p>

            <div className="space-y-2">
                {ageRatings.map((rating) => (
                    <button
                        key={rating.value}
                        onClick={() => setAgeRating(rating.value)}
                        className={`w-full p-4 rounded-xl transition-all flex items-center justify-between border-2 ${ageRating === rating.value
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-200 hover:border-purple-200'
                            }`}
                    >
                        <div className="text-left">
                            <div className="font-medium text-gray-800">{rating.label}</div>
                            <div className="text-xs text-gray-500">{rating.desc}</div>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${ageRating === rating.value ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}>
                            {ageRating === rating.value && <Check size={12} className="text-white" />}
                        </div>
                    </button>
                ))}
            </div>

            <div className="mt-4 p-3 bg-blue-50 rounded-lg flex items-start gap-2">
                <Info size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">
                    建议：如果不确定分级，请选择更高的年龄限制，以减少下架和争议风险。
                </p>
            </div>
        </div>
    );

    const renderStep4 = () => (
        <div className="space-y-4">
            <h4 className="text-center font-medium text-gray-800">风险维度声明</h4>
            <p className="text-sm text-gray-500 text-center">标注内容可能涉及的敏感领域</p>

            <div className="space-y-2">
                {riskDimensions.map((dim) => (
                    <div key={dim.key} className="border border-gray-200 rounded-xl overflow-hidden">
                        <button
                            onClick={() => setExpandedRisk(expandedRisk === dim.key ? null : dim.key)}
                            className="w-full p-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
                        >
                            <div className="text-left">
                                <div className="font-medium text-gray-800">{dim.label}</div>
                                <div className="text-xs text-gray-500">{dim.levels[risks[dim.key]]}</div>
                            </div>
                            <div className={`px-2 py-1 rounded text-xs font-medium ${risks[dim.key] === 0 ? 'bg-green-100 text-green-700' :
                                    risks[dim.key] === 1 ? 'bg-yellow-100 text-yellow-700' :
                                        risks[dim.key] === 2 ? 'bg-orange-100 text-orange-700' :
                                            'bg-red-100 text-red-700'
                                }`}>
                                {risks[dim.key] === 0 ? '无' : `等级${risks[dim.key]}`}
                            </div>
                        </button>

                        {expandedRisk === dim.key && (
                            <div className="px-4 pb-4 bg-gray-50 border-t border-gray-200">
                                <p className="text-sm text-gray-600 mb-3">{dim.desc}</p>
                                <div className="grid grid-cols-4 gap-2">
                                    {dim.levels.map((level, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setRisks({ ...risks, [dim.key]: idx as RiskLevel })}
                                            className={`py-2 px-1 text-xs rounded-lg text-center transition-colors ${risks[dim.key] === idx
                                                    ? 'bg-purple-500 text-white'
                                                    : 'bg-white border border-gray-200 text-gray-600 hover:border-purple-300'
                                                }`}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {(risks.nudity >= 2 || risks.violence >= 2 || risks.drugs >= 2 || risks.gambling >= 2 || risks.political >= 2) && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                    <AlertTriangle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-yellow-700">
                        您标注的风险等级较高，内容可能在部分地区受到限制展示。
                    </p>
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
                    <h3 className="font-semibold text-lg">发布内容</h3>
                    {step < totalSteps ? (
                        <button
                            onClick={() => setStep(step + 1)}
                            disabled={!canProceed()}
                            className={`p-2 rounded-full transition-colors ${canProceed() ? 'text-purple-500 hover:bg-purple-50' : 'text-gray-300'
                                }`}
                        >
                            <ChevronRight size={24} />
                        </button>
                    ) : (
                        <button
                            onClick={handlePublish}
                            className="px-5 py-2 bg-purple-500 text-white rounded-full font-medium hover:bg-purple-600 transition-colors"
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
                </div>
            </div>
        </div>
    );
}
