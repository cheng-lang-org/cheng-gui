import { useRef, useEffect, useState, useCallback } from 'react';
import type { Candle } from '../data/tradingData';

interface TradingKlineChartProps {
    candles: Candle[];
    isPositive: boolean;
    isDark: boolean;
}

type Crosshair = { x: number; y: number; candle: Candle | null } | null;
type TouchMode = 'none' | 'pan' | 'pinch';

const MIN_VIEW_COUNT = 20;
const ZOOM_STEP = 5;
const FOLLOW_LATEST_SNAP_OFFSET = 1;
const TAP_MOVE_THRESHOLD_PX = 8;
const RIGHT_PADDING_MIN_PX = 32;
const RIGHT_PADDING_MAX_PX = 72;
const RIGHT_PADDING_RATIO = 0.12;

function distanceBetweenTouches(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getRightPadding(width: number): number {
    return Math.min(RIGHT_PADDING_MAX_PX, Math.max(RIGHT_PADDING_MIN_PX, width * RIGHT_PADDING_RATIO));
}

function formatCandleTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString([], {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function TradingKlineChart({ candles, isPositive, isDark }: TradingKlineChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [viewOffset, setViewOffset] = useState(0);
    const [viewCount, setViewCount] = useState(60);
    const [followLatest, setFollowLatest] = useState(true);
    const [crosshair, setCrosshair] = useState<Crosshair>(null);

    const mousePanningRef = useRef(false);
    const panStartXRef = useRef(0);
    const panStartOffsetRef = useRef(0);

    const touchModeRef = useRef<TouchMode>('none');
    const pinchStartDistanceRef = useRef(0);
    const pinchStartViewCountRef = useRef(60);
    const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
    const touchMovedRef = useRef(false);

    // Theme colors
    const bgColor = isDark ? '#0d1117' : '#ffffff';
    const gridColor = isDark ? '#1e2937' : '#e5e7eb';
    const labelColor = isDark ? '#6b7280' : '#9ca3af';
    const crosshairColor = isDark ? '#4a5568' : '#cbd5e1';
    const infoBoxBg = isDark ? 'rgba(30,41,59,0.9)' : 'rgba(241,245,249,0.95)';
    const infoBoxText = isDark ? '#e2e8f0' : '#1e293b';

    const clampViewCount = useCallback(
        (count: number): number => {
            const maxCount = Math.max(MIN_VIEW_COUNT, candles.length || MIN_VIEW_COUNT);
            return Math.max(MIN_VIEW_COUNT, Math.min(count, maxCount));
        },
        [candles.length],
    );

    const clampOffset = useCallback(
        (offset: number, count: number = viewCount): number => {
            const maxOffset = Math.max(0, candles.length - count);
            return Math.max(0, Math.min(offset, maxOffset));
        },
        [candles.length, viewCount],
    );

    const setOffsetAndMode = useCallback(
        (nextOffset: number) => {
            const clamped = clampOffset(nextOffset);
            if (clamped <= FOLLOW_LATEST_SNAP_OFFSET) {
                setViewOffset(0);
                setFollowLatest(true);
                return;
            }
            setViewOffset(clamped);
            setFollowLatest(false);
        },
        [clampOffset],
    );

    // Responsive resize
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const obs = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            setDimensions({ width: Math.floor(width), height: Math.floor(height) });
        });
        obs.observe(container);
        return () => obs.disconnect();
    }, []);

    // Keep zoom and offset valid for new data.
    useEffect(() => {
        setViewCount(prev => clampViewCount(prev));
    }, [clampViewCount]);

    useEffect(() => {
        if (followLatest) {
            if (viewOffset !== 0) setViewOffset(0);
            return;
        }
        const clamped = clampOffset(viewOffset);
        if (clamped !== viewOffset) {
            setViewOffset(clamped);
            if (clamped <= FOLLOW_LATEST_SNAP_OFFSET) {
                setViewOffset(0);
                setFollowLatest(true);
            }
        }
    }, [candles, followLatest, viewOffset, clampOffset]);

    // Calculate MA
    const calcMA = useCallback((data: Candle[], period: number): (number | null)[] => {
        return data.map((_, i) => {
            if (i < period - 1) return null;
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
            return sum / period;
        });
    }, []);

    // Draw chart
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || dimensions.width === 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = dimensions.width * dpr;
        canvas.height = dimensions.height * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        const W = dimensions.width;
        const H = dimensions.height;

        // Layout
        const chartTop = 8;
        const chartBottom = H * 0.72;
        const volTop = H * 0.76;
        const volBottom = H - 20;
        const chartH = chartBottom - chartTop;
        const volH = volBottom - volTop;

        // Visible candles
        const safeViewCount = Math.max(MIN_VIEW_COUNT, viewCount);
        const start = Math.max(0, candles.length - safeViewCount - viewOffset);
        const end = Math.min(candles.length, start + safeViewCount);
        const visible = candles.slice(start, end);

        // Clear background even with empty dataset.
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, W, H);

        if (visible.length === 0) return;

        const plotWidth = Math.max(1, W - getRightPadding(W));
        const candleW = plotWidth / safeViewCount;
        const bodyW = Math.max(1, candleW * 0.7);

        // Price range
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let maxVol = 0;
        for (const c of visible) {
            if (c.low < minPrice) minPrice = c.low;
            if (c.high > maxPrice) maxPrice = c.high;
            if (c.volume > maxVol) maxVol = c.volume;
        }
        const priceRange = maxPrice - minPrice || 1;
        const pricePad = priceRange * 0.08;
        minPrice -= pricePad;
        maxPrice += pricePad;
        const totalRange = maxPrice - minPrice;

        const priceY = (p: number) => chartTop + (1 - (p - minPrice) / totalRange) * chartH;
        const volY = (v: number) => {
            if (maxVol <= 0) return volBottom;
            return volBottom - (v / maxVol) * volH;
        };

        // Grid lines
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';

        for (let i = 0; i <= 4; i++) {
            const y = chartTop + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();

            const price = maxPrice - (totalRange / 4) * i;
            ctx.fillStyle = labelColor;
            ctx.fillText(price.toFixed(2), W - 4, y - 2);
        }

        // MAs
        const ma7 = calcMA(candles, 7).slice(start, end);
        const ma25 = calcMA(candles, 25).slice(start, end);
        const ma99 = calcMA(candles, 99).slice(start, end);

        const drawMA = (values: (number | null)[], color: string) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < values.length; i++) {
                if (values[i] === null) continue;
                const x = i * candleW + candleW / 2;
                const y = priceY(values[i]!);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        };

        drawMA(ma7, '#f5c842');
        drawMA(ma25, '#e84393');
        drawMA(ma99, '#6c5ce7');

        // Candles
        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const x = i * candleW + candleW / 2;
            const isUp = c.close >= c.open;
            const color = isUp ? '#00c853' : '#ff1744';

            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, priceY(c.high));
            ctx.lineTo(x, priceY(c.low));
            ctx.stroke();

            const bodyTop = priceY(Math.max(c.open, c.close));
            const bodyBot = priceY(Math.min(c.open, c.close));
            const bodyHeight = Math.max(1, bodyBot - bodyTop);

            ctx.fillStyle = color;
            ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyHeight);

            const vTop = volY(c.volume);
            ctx.fillStyle = isUp ? 'rgba(0,200,83,0.3)' : 'rgba(255,23,68,0.3)';
            ctx.fillRect(x - bodyW / 2, vTop, bodyW, volBottom - vTop);
        }

        // Crosshair overlay
        if (crosshair && crosshair.candle) {
            ctx.strokeStyle = crosshairColor;
            ctx.lineWidth = 0.5;
            ctx.setLineDash([4, 4]);

            ctx.beginPath();
            ctx.moveTo(0, crosshair.y);
            ctx.lineTo(W, crosshair.y);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(crosshair.x, 0);
            ctx.lineTo(crosshair.x, H);
            ctx.stroke();

            ctx.setLineDash([]);

            const c = crosshair.candle;
            const timeLine = `T:${formatCandleTime(c.time)}`;
            const infoLine = `O:${c.open} H:${c.high} L:${c.low} C:${c.close}`;
            ctx.font = '10px monospace';
            const boxW = Math.max(ctx.measureText(timeLine).width, ctx.measureText(infoLine).width) + 12;

            ctx.fillStyle = infoBoxBg;
            ctx.fillRect(4, 2, boxW, 28);

            ctx.fillStyle = infoBoxText;
            ctx.textAlign = 'left';
            ctx.fillText(timeLine, 10, 13);
            ctx.fillText(infoLine, 10, 24);
        }

        // MA legend
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f5c842';
        ctx.fillText('MA7', 4, chartBottom + 12);
        ctx.fillStyle = '#e84393';
        ctx.fillText('MA25', 32, chartBottom + 12);
        ctx.fillStyle = '#6c5ce7';
        ctx.fillText('MA99', 68, chartBottom + 12);
    }, [
        candles,
        dimensions,
        viewOffset,
        viewCount,
        crosshair,
        calcMA,
        isDark,
        bgColor,
        gridColor,
        labelColor,
        crosshairColor,
        infoBoxBg,
        infoBoxText,
    ]);

    const updateCrosshair = useCallback(
        (x: number, y: number) => {
            if (dimensions.width <= 0 || viewCount <= 0) {
                setCrosshair(null);
                return;
            }
            const start = Math.max(0, candles.length - viewCount - viewOffset);
            const plotWidth = Math.max(1, dimensions.width - getRightPadding(dimensions.width));
            if (x < 0 || x >= plotWidth) {
                setCrosshair(null);
                return;
            }
            const candleW = plotWidth / viewCount;
            if (candleW <= 0) {
                setCrosshair(null);
                return;
            }
            const idx = Math.floor(x / candleW);
            if (idx < 0 || idx >= viewCount) {
                setCrosshair(null);
                return;
            }
            const candle = candles[start + idx] || null;
            setCrosshair({ x, y, candle });
        },
        [candles, dimensions.width, viewCount, viewOffset],
    );

    const panFromGesture = useCallback(
        (deltaX: number) => {
            if (dimensions.width <= 0 || viewCount <= 0) return;
            const plotWidth = Math.max(1, dimensions.width - getRightPadding(dimensions.width));
            const candleW = plotWidth / viewCount;
            if (candleW <= 0) return;

            // Positive deltaX means finger moves right, so chart should follow right.
            const deltaCandles = Math.round(deltaX / candleW);
            setOffsetAndMode(panStartOffsetRef.current + deltaCandles);
        },
        [dimensions.width, viewCount, setOffsetAndMode],
    );

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        mousePanningRef.current = true;
        panStartXRef.current = e.clientX;
        panStartOffsetRef.current = viewOffset;
        setCrosshair(null);
    }, [viewOffset]);

    const handleMouseUp = useCallback(() => {
        mousePanningRef.current = false;
    }, []);

    const handleMouseMove = useCallback(
        (e: React.MouseEvent) => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            if (mousePanningRef.current) {
                panFromGesture(e.clientX - panStartXRef.current);
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            updateCrosshair(mx, my);
        },
        [panFromGesture, updateCrosshair],
    );

    const handleMouseLeave = useCallback(() => {
        setCrosshair(null);
        mousePanningRef.current = false;
    }, []);

    const handleWheel = useCallback(
        (e: React.WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP;
            setViewCount(prev => clampViewCount(prev + delta));
        },
        [clampViewCount],
    );

    const handleTouchStart = useCallback(
        (e: React.TouchEvent) => {
            if (e.touches.length === 1) {
                touchModeRef.current = 'pan';
                panStartXRef.current = e.touches[0].clientX;
                panStartOffsetRef.current = viewOffset;
                touchStartPointRef.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                };
                touchMovedRef.current = false;
                setCrosshair(null);
                return;
            }

            if (e.touches.length >= 2) {
                touchModeRef.current = 'pinch';
                pinchStartDistanceRef.current = distanceBetweenTouches(e.touches[0], e.touches[1]);
                pinchStartViewCountRef.current = viewCount;
                touchMovedRef.current = true;
                touchStartPointRef.current = null;
                setCrosshair(null);
            }
        },
        [viewOffset, viewCount],
    );

    const handleTouchMove = useCallback(
        (e: React.TouchEvent) => {
            if (e.touches.length === 1 && touchModeRef.current === 'pan') {
                const dx = e.touches[0].clientX - panStartXRef.current;
                const startPoint = touchStartPointRef.current;
                const dy = startPoint ? e.touches[0].clientY - startPoint.y : 0;
                if (!touchMovedRef.current && (Math.abs(dx) > TAP_MOVE_THRESHOLD_PX || Math.abs(dy) > TAP_MOVE_THRESHOLD_PX)) {
                    touchMovedRef.current = true;
                }
                if (touchMovedRef.current) {
                    e.preventDefault();
                    panFromGesture(dx);
                }
                return;
            }

            if (e.touches.length >= 2) {
                e.preventDefault();
                touchModeRef.current = 'pinch';
                touchMovedRef.current = true;
                const distance = distanceBetweenTouches(e.touches[0], e.touches[1]);
                const startDistance = pinchStartDistanceRef.current || distance;
                if (startDistance <= 0) return;

                const scale = distance / startDistance;
                if (!Number.isFinite(scale) || scale <= 0) return;

                const targetCount = Math.round(pinchStartViewCountRef.current / scale);
                setViewCount(clampViewCount(targetCount));
            }
        },
        [panFromGesture, clampViewCount],
    );

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            if (e.touches.length === 0) {
                if (!touchMovedRef.current && touchStartPointRef.current && canvasRef.current) {
                    const rect = canvasRef.current.getBoundingClientRect();
                    const x = touchStartPointRef.current.x - rect.left;
                    const y = touchStartPointRef.current.y - rect.top;
                    updateCrosshair(x, y);
                }
                touchModeRef.current = 'none';
                touchStartPointRef.current = null;
                touchMovedRef.current = false;
                return;
            }

            if (e.touches.length === 1) {
                touchModeRef.current = 'pan';
                panStartXRef.current = e.touches[0].clientX;
                panStartOffsetRef.current = viewOffset;
                touchStartPointRef.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                };
                touchMovedRef.current = false;
            }
        },
        [viewOffset, updateCrosshair],
    );

    return (
        <div ref={containerRef} className={`w-full h-full relative rounded-lg overflow-hidden ${isDark ? 'bg-[#0d1117]' : 'bg-white'}`}>
            {!followLatest && (
                <button
                    onClick={() => {
                        setViewOffset(0);
                        setFollowLatest(true);
                    }}
                    className={`absolute right-2 top-2 z-10 px-2 py-1 rounded-md text-[11px] font-medium border ${
                        isPositive
                            ? 'bg-green-500/20 text-green-400 border-green-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
                    }`}
                >
                    回到最新
                </button>
            )}

            <canvas
                ref={canvasRef}
                style={{
                    width: dimensions.width,
                    height: dimensions.height,
                    touchAction: 'none',
                    cursor: mousePanningRef.current ? 'grabbing' : 'crosshair',
                }}
                className="block"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleMouseMove}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
            />
        </div>
    );
}
