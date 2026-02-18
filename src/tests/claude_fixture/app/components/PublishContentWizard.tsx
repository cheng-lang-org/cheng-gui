import { useState } from 'react';
import { X, Image, Video, Music, FileText, Camera, ChevronLeft, ChevronRight, AlertTriangle, Check, Info } from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';

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

export default function PublishContentWizard({ onClose }: PublishContentWizardProps) {
    const { t } = useLocale();
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

    const contentTypes = [
        { type: 'image' as ContentType, icon: Image, label: t.pubContent_image, color: 'bg-blue-500' },
        { type: 'video' as ContentType, icon: Video, label: t.pubContent_video, color: 'bg-purple-500' },
        { type: 'audio' as ContentType, icon: Music, label: t.pubContent_audio, color: 'bg-pink-500' },
        { type: 'text' as ContentType, icon: FileText, label: t.pubContent_text, color: 'bg-green-500' },
    ];

    const ageRatings: { value: AgeRating; label: string; desc: string }[] = [
        { value: 'ALL', label: t.pubContent_allAges, desc: t.pubContent_allAgesDesc },
        { value: '12+', label: t.pubContent_age12, desc: t.pubContent_age12Desc },
        { value: '16+', label: t.pubContent_age16, desc: t.pubContent_age16Desc },
        { value: '18+', label: t.pubContent_age18, desc: t.pubContent_age18Desc },
    ];

    const riskDimensions = [
        {
            key: 'nudity' as const,
            label: t.pubContent_nudity,
            desc: t.pubContent_nudityDesc,
            levels: [t.pubContent_none, t.risk_nudity1, t.risk_nudity2, t.risk_nudity3]
        },
        {
            key: 'violence' as const,
            label: t.pubContent_violence,
            desc: t.pubContent_violenceDesc,
            levels: [t.pubContent_none, t.risk_violence1, t.risk_violence2, t.risk_violence3]
        },
        {
            key: 'drugs' as const,
            label: t.pubContent_drugs,
            desc: t.pubContent_drugsDesc,
            levels: [t.pubContent_none, t.risk_drugs1, t.risk_drugs2, t.risk_drugs3]
        },
        {
            key: 'gambling' as const,
            label: t.pubContent_gambling,
            desc: t.pubContent_gamblingDesc,
            levels: [t.pubContent_none, t.risk_gambling1, t.risk_gambling2, t.risk_gambling3]
        },
        {
            key: 'political' as const,
            label: t.pubContent_political,
            desc: t.pubContent_politicalDesc,
            levels: [t.pubContent_none, t.risk_political1, t.risk_political2, t.risk_political3]
        },
    ];

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
            <h4 className="text-center font-medium text-gray-800">{t.pubContent_selectType}</h4>
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
            <h4 className="text-center font-medium text-gray-800">{t.pubContent_editContent}</h4>

            <textarea
                placeholder={t.pubContent_sharePlaceholder}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-32 p-4 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
            />

            {selectedType !== 'text' && (
                <button className="w-full p-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-colors flex flex-col items-center gap-2">
                    <Camera size={28} className="text-gray-400" />
                    <span className="text-sm text-gray-600">{t.pubContent_uploadHint} {selectedType === 'image' ? t.pubContent_image : selectedType === 'video' ? t.pubContent_video : t.pubContent_audio}</span>
                </button>
            )}
        </div>
    );

    const renderStep3 = () => (
        <div className="space-y-4">
            <h4 className="text-center font-medium text-gray-800">{t.pubContent_contentRating}</h4>
            <p className="text-sm text-gray-500 text-center">{t.pubContent_ageRatingHint}</p>

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
                <Info size={16} className="text-purple-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">
                    {t.pubContent_ageSuggestion}
                </p>
            </div>
        </div>
    );

    const renderStep4 = () => (
        <div className="space-y-4">
            <h4 className="text-center font-medium text-gray-800">{t.pubContent_riskDimension}</h4>
            <p className="text-sm text-gray-500 text-center">{t.pubContent_riskDimensionHint}</p>

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
                                {risks[dim.key] === 0 ? t.pubContent_none : `${t.pubContent_riskLevel}${risks[dim.key]}`}
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
                        {t.pubContent_riskHighWarning}
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
                    <h3 className="font-semibold text-lg">{t.pubContent_publishContent}</h3>
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
                            {t.pub_publish}
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
