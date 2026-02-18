import { useState, useRef, ReactNode } from 'react';
import { X, Camera, LucideIcon } from 'lucide-react';

export interface PublishField {
    key: string;
    type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'time' | 'tags';
    label: string;
    placeholder?: string;
    required?: boolean;
    options?: { value: string; label: string }[];
    rows?: number;
    icon?: LucideIcon;
    grid?: 'half' | 'full';
}

export interface PublishConfig {
    category: string;
    title: string;
    titleIcon?: LucideIcon;
    titleIconColor?: string;
    publishButtonColor?: string;
    fields: PublishField[];
    hasImages?: boolean;
    hasPayment?: boolean;
    validate: (data: Record<string, unknown>) => boolean;
    buildSummary: (data: Record<string, unknown>, images: string[]) => string;
}

interface PublishBasePageProps {
    config: PublishConfig;
    onClose: () => void;
    onPublish?: (data: Record<string, unknown>, images: string[]) => Promise<void> | void;
    resolvePublishError?: (error: unknown) => string;
    publishLabel?: string;
    publishingLabel?: string;
    children?: ReactNode; // For custom sections
}

export default function PublishBasePage({
    config,
    onClose,
    onPublish,
    resolvePublishError,
    publishLabel = '发布',
    publishingLabel = '发布中...',
    children,
}: PublishBasePageProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<string[]>([]);
    const [data, setData] = useState<Record<string, unknown>>({});
    const [tags, setTags] = useState<Record<string, string[]>>({});
    const [newTag, setNewTag] = useState<Record<string, string>>({});
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');

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

    const addTag = (key: string) => {
        const tag = newTag[key]?.trim();
        if (tag && !tags[key]?.includes(tag)) {
            setTags(prev => ({ ...prev, [key]: [...(prev[key] || []), tag] }));
            setNewTag(prev => ({ ...prev, [key]: '' }));
        }
    };

    const removeTag = (key: string, index: number) => {
        setTags(prev => ({ ...prev, [key]: prev[key]?.filter((_, i) => i !== index) || [] }));
    };

    const updateData = (key: string, value: unknown) => {
        setData(prev => ({ ...prev, [key]: value }));
    };

    const handlePublish = async () => {
        if (isPublishing) {
            return;
        }
        const fullData = { ...data, ...tags };
        const canPublish = config.validate(fullData);

        if (!canPublish) return;
        setPublishError('');
        setIsPublishing(true);

        try {
            if (onPublish) {
                await onPublish(fullData, images);
            }
            onClose();
        } catch (error) {
            if (resolvePublishError) {
                setPublishError(resolvePublishError(error));
            } else if (error instanceof Error && error.message.trim().length > 0) {
                setPublishError(error.message);
            } else {
                setPublishError('发布失败，请重试');
            }
        } finally {
            setIsPublishing(false);
        }
    };

    const canPublish = config.validate({ ...data, ...tags });
    const btnColor = config.publishButtonColor || 'bg-purple-500 hover:bg-purple-600';

    const renderField = (field: PublishField) => {
        const Icon = field.icon;

        switch (field.type) {
            case 'text':
            case 'number':
            case 'date':
            case 'time':
                return (
                    <div key={field.key} className={field.grid === 'half' ? '' : ''}>
                        {field.label && (
                            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                                {Icon && <Icon size={14} />}
                                {field.label}
                            </label>
                        )}
                        <input
                            type={field.type}
                            placeholder={field.placeholder}
                            value={(data[field.key] as string) || ''}
                            onChange={(e) => updateData(field.key, field.type === 'number' ? e.target.value : e.target.value)}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>
                );

            case 'textarea':
                return (
                    <div key={field.key}>
                        {field.label && (
                            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                                {Icon && <Icon size={14} />}
                                {field.label}
                            </label>
                        )}
                        <textarea
                            placeholder={field.placeholder}
                            value={(data[field.key] as string) || ''}
                            onChange={(e) => updateData(field.key, e.target.value)}
                            rows={field.rows || 3}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                    </div>
                );

            case 'select':
                return (
                    <div key={field.key}>
                        {field.label && (
                            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                                {Icon && <Icon size={14} />}
                                {field.label}
                            </label>
                        )}
                        <select
                            value={(data[field.key] as string) || ''}
                            onChange={(e) => updateData(field.key, e.target.value)}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value="">{field.placeholder || '请选择'}</option>
                            {field.options?.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                );

            case 'tags':
                return (
                    <div key={field.key}>
                        {field.label && (
                            <label className="block text-sm font-medium text-gray-700 mb-2">{field.label}</label>
                        )}
                        <div className="flex flex-wrap gap-2 mb-2">
                            {tags[field.key]?.map((tag, idx) => (
                                <span key={idx} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm flex items-center gap-1">
                                    {tag}
                                    <button onClick={() => removeTag(field.key, idx)} className="text-purple-500 hover:text-purple-700">
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder={field.placeholder || '添加标签'}
                                value={newTag[field.key] || ''}
                                onChange={(e) => setNewTag(prev => ({ ...prev, [field.key]: e.target.value }))}
                                onKeyPress={(e) => e.key === 'Enter' && addTag(field.key)}
                                className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl"
                            />
                            <button onClick={() => addTag(field.key)} className="px-4 py-2 bg-purple-500 text-white rounded-xl">
                                添加
                            </button>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    const TitleIcon = config.titleIcon;

    // Group fields by grid
    const fullFields = config.fields.filter(f => f.grid !== 'half');
    const halfFields = config.fields.filter(f => f.grid === 'half');

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg flex items-center gap-2">
                    {TitleIcon && <TitleIcon size={20} className={config.titleIconColor || 'text-purple-500'} />}
                    {config.title}
                </h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish || isPublishing}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing
                        ? `${btnColor} text-white`
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                >
                    {isPublishing ? publishingLabel : publishLabel}
                </button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Images */}
                {config.hasImages && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                            <Camera size={14} /> 图片
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {images.map((img, idx) => (
                                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden">
                                    <img src={img} alt="" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => removeImage(idx)}
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
                )}

                {/* Full-width fields */}
                {fullFields.map(renderField)}

                {/* Half-width fields grouped in rows of 2 */}
                {halfFields.length > 0 && (
                    <div className="space-y-3">
                        {Array.from({ length: Math.ceil(halfFields.length / 2) }).map((_, rowIdx) => (
                            <div key={rowIdx} className="grid grid-cols-2 gap-3">
                                {halfFields.slice(rowIdx * 2, rowIdx * 2 + 2).map(renderField)}
                            </div>
                        ))}
                    </div>
                )}

                {/* Custom children sections */}
                {children}
            </div>
        </div>
    );
}

// Re-export for convenience
export type { PublishField as PublishFieldType, PublishConfig as PublishConfigType };
