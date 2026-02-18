import { useRef, useEffect, useState, useCallback } from 'react';
import type { Candle } from '../data/tradingData';

interface TradingKlineChartProps {
    candles: Candle[];
    isPositive: boolean;
    isDark: boolean;
}

export default function TradingKlineChart({ candles, isPositive, isDark }: TradingKlineChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [viewOffset, setViewOffset] = useState(0);
    const [viewCount, setViewCount] = useState(60);
    const [crosshair, setCrosshair] = useState<{ x: number; y: number; candle: Candle | null } | null>(null);

    // Theme colors
    const bgColor = isDark ? '#0d1117' : '#ffffff';
    const gridColor = isDark ? '#1e2937' : '#e5e7eb';
    const labelColor = isDark ? '#6b7280' : '#9ca3af';
    const crosshairColor = isDark ? '#4a5568' : '#cbd5e1';
    const infoBoxBg = isDark ? 'rgba(30,41,59,0.9)' : 'rgba(241,245,249,0.95)';
    const infoBoxText = isDark ? '#e2e8f0' : '#1e293b';

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
        const ctx = canvas.getContext('2d')!;
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
        const start = Math.max(0, candles.length - viewCount - viewOffset);
        const end = Math.min(candles.length, start + viewCount);
        const visible = candles.slice(start, end);
        if (visible.length === 0) return;

        const candleW = W / viewCount;
        const bodyW = Math.max(1, candleW * 0.7);

        // Price range
        let minPrice = Infinity, maxPrice = -Infinity, maxVol = 0;
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
        const volY = (v: number) => volBottom - (v / maxVol) * volH;

        // Clear
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, W, H);

        // Grid lines
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = chartTop + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();

            // Price labels
            const price = maxPrice - (totalRange / 4) * i;
            ctx.fillStyle = labelColor;
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
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
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        };

        drawMA(ma7, '#f5c842');  // yellow
        drawMA(ma25, '#e84393'); // pink
        drawMA(ma99, '#6c5ce7'); // purple

        // Candles - ALL SOLID (Binance style)
        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const x = i * candleW + candleW / 2;
            const isUp = c.close >= c.open;
            const color = isUp ? '#00c853' : '#ff1744';

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, priceY(c.high));
            ctx.lineTo(x, priceY(c.low));
            ctx.stroke();

            // Body - SOLID fill for both up and down
            const bodyTop = priceY(Math.max(c.open, c.close));
            const bodyBot = priceY(Math.min(c.open, c.close));
            const bodyHeight = Math.max(1, bodyBot - bodyTop);

            ctx.fillStyle = color;
            ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyHeight);

            // Volume bars
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
            const info = `O:${c.open} H:${c.high} L:${c.low} C:${c.close}`;
            ctx.fillStyle = infoBoxBg;
            ctx.fillRect(4, 2, ctx.measureText(info).width + 12, 16);
            ctx.fillStyle = infoBoxText;
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(info, 10, 13);
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

    }, [candles, dimensions, viewOffset, viewCount, crosshair, calcMA, isDark, bgColor, gridColor, labelColor, crosshairColor, infoBoxBg, infoBoxText]);

    // Mouse/touch handlers
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const start = Math.max(0, candles.length - viewCount - viewOffset);
        const candleW = dimensions.width / viewCount;
        const idx = Math.floor(mx / candleW);
        const candle = candles[start + idx] || null;

        setCrosshair({ x: mx, y: my, candle });
    }, [candles, viewCount, viewOffset, dimensions.width]);

    const handleMouseLeave = useCallback(() => setCrosshair(null), []);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        if (e.deltaY > 0) {
            setViewCount(prev => Math.min(prev + 5, candles.length));
        } else {
            setViewCount(prev => Math.max(prev - 5, 15));
        }
    }, [candles.length]);

    return (
        <div ref={containerRef} className={`w-full h-full relative rounded-lg overflow-hidden ${isDark ? 'bg-[#0d1117]' : 'bg-white'}`}>
            <canvas
                ref={canvasRef}
                style={{ width: dimensions.width, height: dimensions.height }}
                className="block"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onWheel={handleWheel}
            />
        </div>
    );
}
