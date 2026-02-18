import { useState, useRef } from 'react';
import { X, Camera, Image, Video, Music, AlertTriangle, Check, Info } from 'lucide-react';

interface PublishContentPageProps {
    onClose: () => void;
}

type AgeRating = 'ALL' | '12+' | '16+' | '18+';
type RiskLevel = 0 | 1 | 2 | 3;

interface RiskDimensions {
    nudity: RiskLevel;
    violence: RiskLevel;
    drugs: RiskLevel;
    gambling: RiskLevel;
    political: RiskLevel;
}

const ageRatings: { value: AgeRating; label: string; desc: string }[] = [
    { value: 'ALL', label: '全年龄', desc: '适合所有人群' },
    { value: '12+', label: '12+', desc: '轻度惊吓/暴力' },
    { value: '16+', label: '16+', desc: '明显暴力/暗示' },
    { value: '18+', label: '18+', desc: '成人内容' },
];

const riskDimensions = [
    { key: 'nudity' as const, label: '裸露/性', levels: ['无', '轻度', '明显', '色情'] },
    { key: 'violence' as const, label: '暴力', levels: ['无', '轻微', '明显', '强烈'] },
    { key: 'drugs' as const, label: '毒品', levels: ['无', '提及', '展示', '教学'] },
    { key: 'gambling' as const, label: '赌博', levels: ['无', '提及', '推广', '教学'] },
    { key: 'political' as const, label: '政治', levels: ['无', '讨论', '争议', '极端'] },
];

export default function PublishContentPage({ onClose }: PublishContentPageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [content, setContent] = useState('');
    const [mediaFiles, setMediaFiles] = useState<File[]>([]);
    const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
    const [ageRating, setAgeRating] = useState<AgeRating>('ALL');
    const [risks, setRisks] = useState<RiskDimensions>({
        nudity: 0, violence: 0, drugs: 0, gambling: 0, political: 0,
    });

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        setMediaFiles([...mediaFiles, ...files]);

        // 生成预览
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                setMediaPreviews(prev => [...prev, e.target?.result as string]);
            };
            reader.readAsDataURL(file);
        });
    };

    const removeMedia = (index: number) => {
        setMediaFiles(mediaFiles.filter((_, i) => i !== index));
        setMediaPreviews(mediaPreviews.filter((_, i) => i !== index));
    };

    const getMediaType = (file: File) => {
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('video/')) return 'video';
        if (file.type.startsWith('audio/')) return 'audio';
        return 'unknown';
    };

    const handlePublish = () => {
        const riskCode = `${risks.nudity}${risks.violence}${risks.drugs}${risks.gambling}${risks.political}`;
        console.log('Publishing content:', { content, mediaFiles, ageRating, riskCode });
        onClose();
    };

    const canPublish = content.length > 0 || mediaFiles.length > 0;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">发布内容</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish
                            ? 'bg-purple-500 text-white hover:bg-purple-600'
                            : 'bg-gray-200 text-gray-400'
                        }`}
                >
                    发布
                </button>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-6">
                    {/* 文本输入 */}
                    <div>
                        <textarea
                            placeholder="分享你的想法..."
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            className="w-full h-32 p-4 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>

                    {/* 媒体预览 */}
                    {mediaPreviews.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                            {mediaPreviews.map((preview, idx) => (
                                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                                    {getMediaType(mediaFiles[idx]) === 'image' && (
                                        <img src={preview} alt="" className="w-full h-full object-cover" />
                                    )}
                                    {getMediaType(mediaFiles[idx]) === 'video' && (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-800">
                                            <Video size={32} className="text-white" />
                                        </div>
                                    )}
                                    {getMediaType(mediaFiles[idx]) === 'audio' && (
                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500">
                                            <Music size={32} className="text-white" />
                                        </div>
                                    )}
                                    <button
                                        onClick={() => removeMedia(idx)}
                                        className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 添加媒体按钮 */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept="image/*,video/*,audio/*"
                        multiple
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full p-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-colors flex items-center justify-center gap-3"
                    >
                        <Camera size={24} className="text-gray-400" />
                        <span className="text-gray-600">添加图片/视频/音频</span>
                    </button>

                    {/* 分隔线 */}
                    <div className="h-px bg-gray-200" />

                    {/* 年龄分级 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                            <Info size={16} />
                            内容分级
                        </h3>
                        <div className="flex gap-2">
                            {ageRatings.map((rating) => (
                                <button
                                    key={rating.value}
                                    onClick={() => setAgeRating(rating.value)}
                                    className={`flex-1 py-3 rounded-xl text-center transition-all border-2 ${ageRating === rating.value
                                            ? 'border-purple-500 bg-purple-50 text-purple-700'
                                            : 'border-gray-200 text-gray-600 hover:border-purple-200'
                                        }`}
                                >
                                    <div className="font-semibold">{rating.label}</div>
                                    <div className="text-xs opacity-70">{rating.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 风险维度 */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                            <AlertTriangle size={16} />
                            风险声明
                        </h3>
                        <div className="space-y-3">
                            {riskDimensions.map((dim) => (
                                <div key={dim.key} className="flex items-center gap-3">
                                    <span className="w-16 text-sm text-gray-600">{dim.label}</span>
                                    <div className="flex-1 flex gap-1">
                                        {dim.levels.map((level, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setRisks({ ...risks, [dim.key]: idx as RiskLevel })}
                                                className={`flex-1 py-2 text-xs rounded-lg transition-colors ${risks[dim.key] === idx
                                                        ? idx === 0 ? 'bg-green-500 text-white' :
                                                            idx === 1 ? 'bg-yellow-500 text-white' :
                                                                idx === 2 ? 'bg-orange-500 text-white' :
                                                                    'bg-red-500 text-white'
                                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {level}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 风险提示 */}
                    {(risks.nudity >= 2 || risks.violence >= 2 || risks.drugs >= 2 || risks.gambling >= 2 || risks.political >= 2) && (
                        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                            <AlertTriangle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-yellow-700">
                                您标注的风险等级较高，内容可能在部分地区受到限制展示。
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
