import React, { useEffect, useRef, useState } from 'react';
import { X, GripVertical } from 'lucide-react';
import { publishTypes, type PublishType } from './PublishTypeSelector';
import { useLocale } from '../i18n/LocaleContext';

interface ChannelManagerProps {
    isOpen: boolean;
    onClose: () => void;
    activeOrder: PublishType[];
    onOrderChange: (newOrder: PublishType[]) => void;
    activeCategory: PublishType;
    onCategoryChange: (category: PublishType) => void;
}

export default function ChannelManager({
    isOpen,
    onClose,
    activeOrder,
    onOrderChange,
    activeCategory,
    onCategoryChange,
}: ChannelManagerProps) {
    const { t } = useLocale();
    const [draggedType, setDraggedType] = useState<PublishType | null>(null);
    const [dragOverType, setDragOverType] = useState<PublishType | null>(null);
    const ignoreClickRef = useRef(false);
    const hasMovedRef = useRef(false);
    const pressTimerRef = useRef<number | null>(null);
    const pendingPointerRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

    if (!isOpen) return null;

    useEffect(() => {
        if (!draggedType) return undefined;

        const previousOverflow = document.body.style.overflow;
        const previousTouchAction = document.body.style.touchAction;
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';

        return () => {
            document.body.style.overflow = previousOverflow;
            document.body.style.touchAction = previousTouchAction;
        };
    }, [draggedType]);

    useEffect(() => {
        return () => {
            if (pressTimerRef.current !== null) {
                window.clearTimeout(pressTimerRef.current);
                pressTimerRef.current = null;
            }
        };
    }, []);

    const clearPendingPress = () => {
        if (pressTimerRef.current !== null) {
            window.clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
        pendingPointerRef.current = null;
    };

    const reorderChannels = (sourceType: PublishType, targetType: PublishType) => {
        if (sourceType === targetType) return;
        const sourceIndex = activeOrder.indexOf(sourceType);
        const targetIndex = activeOrder.indexOf(targetType);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

        const nextOrder = [...activeOrder];
        const [moved] = nextOrder.splice(sourceIndex, 1);
        nextOrder.splice(targetIndex, 0, moved);
        onOrderChange(nextOrder);
    };

    const startDrag = (target: HTMLDivElement, pointerId: number, type: PublishType) => {
        setDraggedType(type);
        setDragOverType(type);
        hasMovedRef.current = false;
        target.setPointerCapture(pointerId);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, type: PublishType) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        clearPendingPress();

        if (event.pointerType === 'touch') {
            pendingPointerRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
            };
            const currentTarget = event.currentTarget;
            pressTimerRef.current = window.setTimeout(() => {
                startDrag(currentTarget, event.pointerId, type);
                pressTimerRef.current = null;
            }, 180);
            return;
        }

        startDrag(event.currentTarget, event.pointerId, type);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!draggedType) {
            const pending = pendingPointerRef.current;
            if (pending && pending.pointerId === event.pointerId) {
                const movedX = event.clientX - pending.startX;
                const movedY = event.clientY - pending.startY;
                if (Math.hypot(movedX, movedY) > 8) {
                    clearPendingPress();
                }
            }
            return;
        }

        event.preventDefault();

        const hovered = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>('[data-channel-type]');
        const targetType = hovered?.dataset.channelType as PublishType | undefined;
        if (!targetType || targetType === draggedType || targetType === dragOverType) return;

        reorderChannels(draggedType, targetType);
        setDragOverType(targetType);
        hasMovedRef.current = true;
    };

    const endPointerDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        clearPendingPress();

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        if (!draggedType) return;

        if (hasMovedRef.current) {
            ignoreClickRef.current = true;
            window.setTimeout(() => {
                ignoreClickRef.current = false;
            }, 0);
        }
        setDraggedType(null);
        setDragOverType(null);
        hasMovedRef.current = false;
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center bg-black/50" onClick={onClose}>
            <div
                className="w-full h-[70vh] sm:h-auto sm:max-w-md sm:mx-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <h2 className="text-lg font-bold text-gray-800">
                        {t.channel_manage || '频道管理'}
                    </h2>
                    <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
                        <X size={20} />
                    </button>
                </div>

                <div className={`flex-1 p-4 ${draggedType ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                    <p className="text-xs text-gray-400 mb-4 px-1">
                        {t.channel_tip || '长按拖动排序，点击进入频道'}
                    </p>

                    <div className="grid grid-cols-4 gap-3">
                        {activeOrder.map((type) => {
                            const def = publishTypes.find(p => p.type === type);
                            if (!def) return null;

                            const isActive = activeCategory === type;
                            const isDragging = draggedType === type;
                            const isDragOver = dragOverType === type && draggedType !== type;

                            return (
                                <div
                                    key={type}
                                    data-channel-type={type}
                                    onPointerDown={(e) => handlePointerDown(e, type)}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={endPointerDrag}
                                    onPointerCancel={endPointerDrag}
                                    onClick={() => {
                                        if (ignoreClickRef.current) return;
                                        onCategoryChange(type);
                                        onClose();
                                    }}
                                    className={`
                    relative flex flex-col items-center justify-center py-3 px-1 rounded-xl border transition-all cursor-move select-none touch-none
                    ${isActive
                                            ? 'bg-purple-50 border-purple-200 text-purple-600'
                                            : 'bg-gray-50 border-gray-100 text-gray-600 hover:bg-gray-100'}
                    ${isDragging ? 'opacity-55 scale-95 shadow-lg' : 'opacity-100 scale-100'}
                    ${isDragOver ? 'ring-2 ring-purple-300 ring-offset-1' : ''}
                  `}
                                >
                                    {isActive && <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-purple-500 rounded-full" />}
                                    <span className="text-xs font-medium text-center truncate w-full px-1">
                                        {t[def.labelKey] || def.fallbackLabel}
                                    </span>
                                    <div className="mt-1 text-gray-300">
                                        <GripVertical size={12} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
