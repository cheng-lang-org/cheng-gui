import { useState, useRef, useMemo, useEffect } from 'react';
import { X, FileUp, Video, Music, Shield, Eye, File as FileIcon, Mic, WandSparkles } from 'lucide-react';
import { publishDistributedContent } from '../data/distributedContent';
import { getAlipayQr, getCreditCardEnabled, getSettlementWalletAddress, getWechatQr } from '../utils/paymentStore';
import { createPublishPaymentMeta, resolveActorId } from '../domain/payment/paymentApi';
import { getCurrentPolicyGroupId } from '../utils/region';
import { useLocale } from '../i18n/LocaleContext';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';
import { loadKnownBlockedHashes, runEdgeFilterPipeline, type EdgeFilterSummary } from '../services/edge/contentFilter';
import { blurBackgroundFromDataUrl, parseBlurVoiceCommand } from '../services/edge/backgroundBlur';
import { isEdgeSpeechSupported, transcribeOnce } from '../services/edge/speechRecognition';

interface PublishContentPageProps {
    onClose: () => void;
}

type AgeRating = 'ALL' | 'ADULT';

export default function PublishContentPage({ onClose }: PublishContentPageProps) {
    const { t } = useLocale();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [content, setContent] = useState('');
    const [mediaFiles, setMediaFiles] = useState<File[]>([]);
    const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
    const [ageRating, setAgeRating] = useState<AgeRating>('ALL');
    /** Subtle content descriptors — users tag what *viewers should expect*, not what they "admit" */
    const contentDescriptors = useMemo(() => [
        { key: 'mature' as const, label: t.pubContent_nudity, hint: t.pubContent_nudityDesc },
        { key: 'artistic' as const, label: t.pubContent_violence, hint: t.pubContent_violenceDesc },
        { key: 'conflict' as const, label: t.pubContent_drugs, hint: t.pubContent_drugsDesc },
        { key: 'nightlife' as const, label: t.pubContent_gambling, hint: t.pubContent_gamblingDesc },
        { key: 'controversy' as const, label: t.pubContent_political, hint: t.pubContent_politicalDesc },
        { key: 'language' as const, label: t.pubContent_riskLevel, hint: t.pubContent_riskDimensionHint },
    ], [t]);
    type DescriptorKey = typeof contentDescriptors[number]['key'];
    const [selectedDescriptors, setSelectedDescriptors] = useState<Set<DescriptorKey>>(new Set());
    /** Raw CSV text keyed by file index — survives the media pipeline */
    const [csvTexts, setCsvTexts] = useState<Map<number, string>>(new Map());
    const [isPaid, setIsPaid] = useState(false);
    const [priceYuan, setPriceYuan] = useState('');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');
    const [blurEnabled, setBlurEnabled] = useState(false);
    const [blurredPreviews, setBlurredPreviews] = useState<Map<number, string>>(new Map());
    const [blurBusy, setBlurBusy] = useState(false);
    const [blurHint, setBlurHint] = useState('');
    const [voiceSupported, setVoiceSupported] = useState(false);
    const [voiceBusy, setVoiceBusy] = useState(false);
    const [edgeFilterSummary, setEdgeFilterSummary] = useState<EdgeFilterSummary | null>(null);

    useEffect(() => {
        let cancelled = false;
        void isEdgeSpeechSupported()
            .then((supported) => {
                if (!cancelled) {
                    setVoiceSupported(supported);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setVoiceSupported(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const isCsvFile = (file: File) =>
        file.name.endsWith('.csv') ||
        file.type === 'text/csv' ||
        file.type === 'application/vnd.ms-excel';

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const startIdx = mediaFiles.length;
        if (files.length === 0) {
            return;
        }
        setEdgeFilterSummary(null);
        setBlurHint('');
        setMediaFiles([...mediaFiles, ...files]);
        files.forEach((file, i) => {
            // Always create data URL preview
            const reader = new FileReader();
            reader.onload = (ev) => {
                setMediaPreviews(prev => [...prev, ev.target?.result as string]);
            };
            reader.readAsDataURL(file);

            // For CSV files, also read as text
            if (isCsvFile(file)) {
                const textReader = new FileReader();
                textReader.onload = (ev) => {
                    const text = ev.target?.result as string;
                    setCsvTexts(prev => {
                        const next = new Map(prev);
                        next.set(startIdx + i, text);
                        return next;
                    });
                };
                textReader.readAsText(file, 'utf-8');
            }
        });
    };

    const removeMedia = (index: number) => {
        setMediaFiles(mediaFiles.filter((_, i) => i !== index));
        setMediaPreviews(mediaPreviews.filter((_, i) => i !== index));
        setEdgeFilterSummary(null);
        setBlurredPreviews(prev => {
            const next = new Map<number, string>();
            for (const [k, v] of prev) {
                if (k < index) next.set(k, v);
                else if (k > index) next.set(k - 1, v);
            }
            return next;
        });
        setCsvTexts(prev => {
            const next = new Map<number, string>();
            for (const [k, v] of prev) {
                if (k < index) next.set(k, v);
                else if (k > index) next.set(k - 1, v);
            }
            return next;
        });
    };

    const getMediaType = (file: File) => {
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('video/')) return 'video';
        if (file.type.startsWith('audio/')) return 'audio';
        return 'unknown';
    };

    /** Does the current upload contain audio or video that can't be auto-scanned on device? */
    const hasAudioVideo = useMemo(
        () => mediaFiles.some(f => f.type.startsWith('video/') || f.type.startsWith('audio/')),
        [mediaFiles],
    );

    const toggleDescriptor = (key: DescriptorKey) => {
        setSelectedDescriptors(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const resolvePreviewAt = (index: number): string => {
        const original = mediaPreviews[index] ?? '';
        if (!blurEnabled) {
            return original;
        }
        return blurredPreviews.get(index) ?? original;
    };

    const applyBackgroundBlurToImages = async () => {
        if (blurBusy) {
            return;
        }
        const imageIndexes = mediaFiles
            .map((file, idx) => ({ file, idx }))
            .filter((entry) => entry.file.type.startsWith('image/'))
            .map((entry) => entry.idx);
        if (imageIndexes.length === 0) {
            setBlurHint('没有可处理的图片');
            return;
        }
        setBlurBusy(true);
        setBlurHint('正在执行端侧背景虚化...');
        try {
            const next = new Map(blurredPreviews);
            let usedBackend: 'cheng-native-kernel' = 'cheng-native-kernel';
            for (const idx of imageIndexes) {
                const source = mediaPreviews[idx];
                if (!source) {
                    continue;
                }
                const result = await blurBackgroundFromDataUrl(source, {
                    blurRadius: 18,
                    modelSelection: 1,
                });
                next.set(idx, result.outputDataUrl);
                usedBackend = result.backend;
            }
            setBlurredPreviews(next);
            setBlurHint(usedBackend === 'cheng-native-kernel' ? '背景虚化完成（Cheng Native）' : '背景虚化完成');
        } catch (error) {
            setBlurHint(error instanceof Error ? `背景虚化失败：${error.message}` : '背景虚化失败');
        } finally {
            setBlurBusy(false);
        }
    };

    const handleVoiceBlurControl = async () => {
        if (voiceBusy) {
            return;
        }
        if (!voiceSupported) {
            setBlurHint('当前设备不支持语音识别');
            return;
        }
        setVoiceBusy(true);
        setBlurHint('请说：开启背景虚化 / 关闭背景虚化 / 虚化背景');
        try {
            const result = await transcribeOnce({
                language: 'zh-CN',
                maxResults: 1,
                timeoutMs: 10_000,
                onPartial: (partial) => {
                    setBlurHint(`识别中：${partial}`);
                },
            });
            const transcript = result.transcript.trim();
            const command = parseBlurVoiceCommand(transcript);
            if (command === 'enable_blur' || command === 'apply_blur') {
                setBlurEnabled(true);
                setBlurHint(`语音指令：${transcript}`);
                await applyBackgroundBlurToImages();
            } else if (command === 'disable_blur') {
                setBlurEnabled(false);
                setBlurHint('已关闭背景虚化');
            } else if (transcript) {
                setBlurHint(`未识别到虚化指令：${transcript}`);
            } else {
                setBlurHint('未识别到有效语音');
            }
        } catch (error) {
            setBlurHint(error instanceof Error ? `语音识别失败：${error.message}` : '语音识别失败');
        } finally {
            setVoiceBusy(false);
        }
    };

    const handlePublish = async () => {
        if (isPublishing) {
            return;
        }
        setPublishError('');
        setIsPublishing(true);
        const descriptorCodes = Array.from(selectedDescriptors).sort().join(',');
        const firstFile = mediaFiles[0];
        const mediaType = firstFile ? getMediaType(firstFile) : 'text';
        const normalizedType =
            mediaType === 'video' ? 'video' :
                mediaType === 'audio' ? 'audio' :
                    mediaType === 'image' ? 'image' : 'text';
        const mediaAspectRatio =
            normalizedType === 'video' ? 16 / 9 :
                normalizedType === 'audio' ? 1 :
                    normalizedType === 'image' ? 3 / 4 : undefined;
        let resolvedMediaPreviews = mediaPreviews.map((preview, idx) => {
            if (!blurEnabled) {
                return preview;
            }
            return blurredPreviews.get(idx) ?? preview;
        });
        let appliedBlurCount = Array.from(blurredPreviews.keys()).length;
        const summary = content.trim() || '发布了内容';
        const parsedPrice = parseFloat(priceYuan);
        const isPaywalled = isPaid && parsedPrice > 0;
        const ownerId = resolveActorId();
        const policyGroupId = getCurrentPolicyGroupId();
        const isDomestic = policyGroupId === 'CN';

        // Collect CSV text data (first CSV found)
        const csvData = csvTexts.size > 0 ? Array.from(csvTexts.values())[0] : undefined;

        const paymentMeta = isPaywalled
            ? await createPublishPaymentMeta({
                scene: 'CONTENT_PAYWALL',
                ownerId,
                policyGroupId,
                amountCny: parsedPrice,
                wechatQr: isDomestic ? getWechatQr() : undefined,
                alipayQr: isDomestic ? getAlipayQr() : undefined,
                creditCardEnabled: isDomestic ? false : getCreditCardEnabled(),
                walletAddress: isDomestic ? undefined : getSettlementWalletAddress(),
            })
            : {};

        try {
            if (blurEnabled) {
                const next = new Map(blurredPreviews);
                for (let idx = 0; idx < mediaFiles.length; idx += 1) {
                    if (!mediaFiles[idx].type.startsWith('image/')) {
                        continue;
                    }
                    if (next.has(idx)) {
                        continue;
                    }
                    const source = mediaPreviews[idx];
                    if (!source) {
                        continue;
                    }
                    const blurResult = await blurBackgroundFromDataUrl(source, {
                        blurRadius: 18,
                        modelSelection: 1,
                    });
                    next.set(idx, blurResult.outputDataUrl);
                }
                setBlurredPreviews(next);
                resolvedMediaPreviews = mediaPreviews.map((preview, idx) => next.get(idx) ?? preview);
                appliedBlurCount = next.size;
            }
            let finalFilter: EdgeFilterSummary | null = null;
            const imagePreviews = resolvedMediaPreviews.filter((_, idx) => getMediaType(mediaFiles[idx]) === 'image');
            if (imagePreviews.length > 0) {
                const knownBlockedHashes = await loadKnownBlockedHashes();
                const filterResult = await runEdgeFilterPipeline(imagePreviews, {
                    nudenetThreshold: 0.62,
                    phashDistance: 10,
                    knownBlockedHashes,
                });
                setEdgeFilterSummary(filterResult);
                finalFilter = filterResult;
                if (!filterResult.passed) {
                    setPublishError(`端侧过滤拦截：${filterResult.blockedReasons.join(', ')}`);
                    return;
                }
            } else {
                setEdgeFilterSummary(null);
            }
            console.log('Publishing content:', { content, mediaFiles, ageRating, descriptorCodes, hasCsv: !!csvData });
            await publishDistributedContent({
                publishCategory: 'content',
                type: normalizedType,
                content: summary,
                media: resolvedMediaPreviews[0],
                mediaItems: resolvedMediaPreviews,
                coverMedia: resolvedMediaPreviews[0],
                mediaAspectRatio,
                extra: {
                    ageRating,
                    descriptors: descriptorCodes,
                    ...(csvData ? { csvData } : {}),
                    ...(isPaywalled ? { isPaid: true, price: parsedPrice } : {}),
                    ...(finalFilter ? { edgeValidation: finalFilter as any } : {}),
                    edgeBlur: {
                        enabled: blurEnabled,
                        appliedImages: appliedBlurCount,
                    },
                    ...paymentMeta,
                },
            });
            onClose();
        } catch (error) {
            setPublishError(getPublishLocationErrorMessage(t, error));
        } finally {
            setIsPublishing(false);
        }
    };

    const canPublish = content.length > 0 || mediaFiles.length > 0;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">{t.pubContent_publishContent}</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish || isPublishing || blurBusy || voiceBusy}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing
                        ? 'bg-purple-500 text-white hover:bg-purple-600'
                        : 'bg-gray-200 text-gray-400'
                        }`}
                >
                    {isPublishing ? t.common_loading : t.pub_publish}
                </button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-6">
                    {/* 文本输入 */}
                    <div>
                        <textarea
                            placeholder={t.pubContent_sharePlaceholder}
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
                                        <img src={resolvePreviewAt(idx) || preview} alt="" className="w-full h-full object-cover" />
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
                                    {getMediaType(mediaFiles[idx]) !== 'image' && getMediaType(mediaFiles[idx]) !== 'video' && getMediaType(mediaFiles[idx]) !== 'audio' && (
                                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-200 p-2">
                                            <FileIcon size={28} className="text-gray-500" />
                                            <span className="text-[10px] text-gray-500 mt-1 truncate w-full text-center">
                                                {mediaFiles[idx]?.name}
                                            </span>
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

                    {/* 选择文件按钮 */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept="*/*"
                        multiple
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full p-6 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-colors flex items-center justify-center gap-3"
                    >
                        <FileUp size={24} className="text-gray-400" />
                        <span className="text-gray-600">{t.pubContent_uploadHint}</span>
                    </button>

                    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-700">图片背景虚化</p>
                                <p className="text-xs text-gray-500">语音命令：开启背景虚化 / 关闭背景虚化 / 虚化背景</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setBlurEnabled((prev) => !prev)}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${blurEnabled ? 'bg-purple-500' : 'bg-gray-300'}`}
                            >
                                <span
                                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${blurEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                                />
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => void applyBackgroundBlurToImages()}
                                disabled={blurBusy || mediaFiles.every((file) => !file.type.startsWith('image/'))}
                                className="flex-1 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 text-sm disabled:opacity-50"
                            >
                                <span className="inline-flex items-center gap-2">
                                    <WandSparkles size={16} />
                                    {blurBusy ? '处理中...' : '执行背景虚化'}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleVoiceBlurControl()}
                                disabled={voiceBusy}
                                className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm disabled:opacity-50"
                            >
                                <span className="inline-flex items-center gap-2">
                                    <Mic size={16} />
                                    {voiceBusy ? '识别中...' : '语音控制'}
                                </span>
                            </button>
                        </div>
                        {blurHint && (
                            <p className="text-xs text-gray-500">{blurHint}</p>
                        )}
                    </div>

                    {/* 付费内容开关 */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-700">{t.pub_paidContent}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsPaid(!isPaid)}
                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${isPaid ? 'bg-amber-500' : 'bg-gray-300'
                                    }`}
                            >
                                <span
                                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${isPaid ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                />
                            </button>
                        </div>
                        {isPaid && (
                            <div className="px-4 pb-3 flex items-center gap-2">
                                <span className="text-lg font-semibold text-amber-600">¥</span>
                                <input
                                    type="number"
                                    placeholder={t.payment_enterPrice}
                                    value={priceYuan}
                                    onChange={(e) => setPriceYuan(e.target.value)}
                                    min="0.01"
                                    step="0.01"
                                    className="flex-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <span className="text-xs text-gray-400">{t.pub_yuan}</span>
                            </div>
                        )}
                    </div>

                    {/* 分隔线 */}
                    <div className="h-px bg-gray-200" />

                    {/* 端侧自动过滤提示（文本/图片） */}
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-start gap-2">
                        <Shield size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-green-700 leading-relaxed">
                            {t.pubContent_riskWarning}
                        </p>
                    </div>
                    {edgeFilterSummary && (
                        <div className={`p-3 border rounded-xl ${edgeFilterSummary.passed ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                            <p className={`text-xs font-medium ${edgeFilterSummary.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                                {edgeFilterSummary.passed ? '端侧过滤通过' : `端侧过滤拦截：${edgeFilterSummary.blockedReasons.join(', ')}`}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-1">
                                YOLO: {edgeFilterSummary.yolo.backend} / detections {edgeFilterSummary.yolo.detections}
                                {' · '}
                                NudeNet: {edgeFilterSummary.nudenet.backend} / max {edgeFilterSummary.nudenet.maxScore.toFixed(2)}
                                {' · '}
                                pHash hits: {edgeFilterSummary.phash.knownBlockedHits.length}
                            </p>
                        </div>
                    )}

                    {/* 音视频内容分级（仅当存在音视频时显示） */}
                    {hasAudioVideo && (
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                                <Eye size={16} className="text-purple-500" />
                                {t.pubContent_contentRating}
                            </h3>
                            <p className="text-xs text-gray-500 mb-3">
                                {t.pubContent_ageRatingHint}
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setAgeRating('ALL')}
                                    className={`flex-1 py-4 rounded-xl text-center transition-all border-2 ${ageRating === 'ALL'
                                        ? 'border-green-500 bg-green-50 text-green-700'
                                        : 'border-gray-200 text-gray-600 hover:border-green-200'
                                        }`}
                                >
                                    <div className="text-2xl mb-1">🌱</div>
                                    <div className="font-semibold">{t.pubContent_allAges}</div>
                                    <div className="text-xs opacity-70">{t.pubContent_allAgesDesc}</div>
                                </button>
                                <button
                                    onClick={() => setAgeRating('ADULT')}
                                    className={`flex-1 py-4 rounded-xl text-center transition-all border-2 ${ageRating === 'ADULT'
                                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                                        : 'border-gray-200 text-gray-600 hover:border-orange-200'
                                        }`}
                                >
                                    <div className="text-2xl mb-1">🔞</div>
                                    <div className="font-semibold">{t.pubContent_age18}</div>
                                    <div className="text-xs opacity-70">{t.pubContent_age18Desc}</div>
                                </button>
                            </div>
                        </div>
                    )}


                </div>
            </div>
        </div>
    );
}
