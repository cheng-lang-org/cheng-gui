/**
 * ZiweiPage — 紫微斗数专业排盘页面
 * 传统 4×4 网格布局 (中间 2×2 为命盘信息区)
 * 包含: 十二宫、主星亮度、四化标记、大限、流年
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Lunar, Solar } from 'lunar-javascript';
import {
    calculateZiwei,
    BRIGHTNESS_COLORS,
    DIRECTION_LABELS,
    type ZiweiResult,
    type GongInfo,
    type StarInfo,
} from '../utils/ziwei';
import { SHICHEN_LABELS } from '../utils/bazi';
import { WENMO_BASIC_PROFILE } from '../domain/astrology/profile';
import { interpretZiwei } from '../domain/astrology/interpretation';
import { listAstrologyRecords, removeAstrologyRecord, saveAstrologyRecord } from '../domain/astrology/storage';
import type { AstrologyRecord, CalendarType } from '../domain/astrology/types';
import { downloadAstrologyRecordJson, downloadAstrologyRecordPdf } from '../domain/astrology/export';

interface ZiweiPageProps {
    onClose: () => void;
}

type ZiweiMainTab = '命盘' | '帮助' | '关于';
type ZiweiTopView = 'main' | 'settings';
type ZiweiMode = '飞星' | '三合' | '四化';
type LayoutDensity = 'normal' | 'compact' | 'dense';
type PalacePlanTier = 'full' | 'focus' | 'compact' | 'minimal';
type TimelineType = '大限' | '流年';

interface TimelineSelection {
    type: TimelineType;
    idx: number;
    daxianIdx?: number;
    palaceIndex: number;
    targetDizhi: string;
    label: string;
}

interface PalaceLayoutInput {
    density: LayoutDensity;
    activeMode: ZiweiMode;
    isSelected: boolean;
    width: number;
    height: number;
    mainCount: number;
    auxCount: number;
    siHuaCount: number;
}

interface PalaceLayoutPlan {
    tier: PalacePlanTier;
    scale: number;
    showYearPreview: boolean;
    yearCount: number;
    enableOverflowScroll: boolean;
}

const SIHUA_COLORS: Record<string, string> = {
    '化禄': '#16a34a',
    '化权': '#7c3aed',
    '化科': '#2563eb',
    '化忌': '#dc2626',
};
const TIANGAN_COLORS: Record<string, string> = {
    '甲': '#2e8b57', '乙': '#3cb371',
    '丙': '#e53e3e', '丁': '#e53e3e',
    '戊': '#b8860b', '己': '#b8860b',
    '庚': '#6b7280', '辛': '#6b7280',
    '壬': '#1a56db', '癸': '#1a56db',
};
const ZIWEI_SETTINGS_KEY = 'astrology_ziwei_settings_v1';

function shichenToHour(shichen: number): number {
    const idx = ((Math.floor(shichen) % 12) + 12) % 12;
    if (idx === 0) return 23;
    return idx * 2 - 1;
}

function formatShichenNumericRange(index: number): string {
    const raw = SHICHEN_LABELS[index] || '';
    const matched = raw.match(/\((\d{2})-(\d{2})\)/);
    if (!matched) return raw;
    const [, start, end] = matched;
    return `${start}-${end}`;
}

function estimateFlowRows(itemCount: number, itemWidth: number, zoneWidth: number, gap: number): number {
    if (itemCount <= 0) return 0;
    const safeWidth = Math.max(1, zoneWidth);
    const safeItemWidth = Math.max(1, itemWidth);
    const perRow = Math.max(1, Math.floor((safeWidth + gap) / (safeItemWidth + gap)));
    return Math.ceil(itemCount / perRow);
}

function estimateFlowHeight(
    itemCount: number,
    itemWidth: number,
    itemHeight: number,
    zoneWidth: number,
    gap: number,
): number {
    const rows = estimateFlowRows(itemCount, itemWidth, zoneWidth, gap);
    if (rows <= 0) return 0;
    return rows * itemHeight + (rows - 1) * gap;
}

function clampScale(value: number): number {
    return Math.max(0.64, Math.min(1, value));
}

function computePalaceLayoutPlan(input: PalaceLayoutInput): PalaceLayoutPlan {
    const { density, activeMode, isSelected, mainCount, auxCount, siHuaCount } = input;
    const width = Math.max(0, input.width);
    const height = Math.max(0, input.height);

    const densityBaseScale: Record<LayoutDensity, number> = {
        normal: 1,
        compact: 0.9,
        dense: 0.8,
    };
    const densityYearBase: Record<LayoutDensity, number> = {
        normal: 4,
        compact: 3,
        dense: 2,
    };
    const baseScale = densityBaseScale[density];
    const yearBase = densityYearBase[density];

    if (width < 8 || height < 8) {
        return {
            tier: 'minimal',
            scale: clampScale(baseScale * 0.8),
            showYearPreview: false,
            yearCount: 0,
            enableOverflowScroll: false,
        };
    }

    const scaleFactors = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.66];
    const defaultShowYear = density !== 'dense' || isSelected;
    const defaultYearCount = defaultShowYear ? yearBase : 0;
    const siHuaRenderCount = activeMode === '四化' ? siHuaCount : 0;

    const calcTotalHeight = (scale: number, yearCount: number) => {
        const mainHeight = estimateFlowHeight(mainCount, 12 * scale, 33 * scale, width, 1.2 * scale) + 1;
        const auxHeight = estimateFlowHeight(auxCount, 8.5 * scale, 19 * scale, width, 1.05 * scale) + 1;
        const siHuaHeight = siHuaRenderCount > 0
            ? estimateFlowHeight(siHuaRenderCount, 22 * scale, 10 * scale, width, 1.2 * scale) + 1
            : 0;
        const yearHeight = yearCount > 0 ? Math.max(10, 13.6 * scale) : 0;
        return mainHeight + auxHeight + siHuaHeight + yearHeight + 1;
    };

    for (const factor of scaleFactors) {
        const scale = clampScale(baseScale * factor);
        const totalWithYear = calcTotalHeight(scale, defaultYearCount);
        if (totalWithYear <= height + 0.5) {
            return {
                tier: factor >= 0.9 ? 'full' : factor >= 0.8 ? 'focus' : 'compact',
                scale,
                showYearPreview: defaultYearCount > 0,
                yearCount: defaultYearCount,
                enableOverflowScroll: false,
            };
        }

        const totalWithoutYear = calcTotalHeight(scale, 0);
        if (totalWithoutYear <= height + 0.5) {
            return {
                tier: factor >= 0.9 ? 'focus' : 'compact',
                scale,
                showYearPreview: false,
                yearCount: 0,
                enableOverflowScroll: false,
            };
        }
    }

    return {
        tier: 'minimal',
        scale: clampScale(baseScale * 0.66),
        showYearPreview: false,
        yearCount: 0,
        enableOverflowScroll: true,
    };
}

export default function ZiweiPage({ onClose }: ZiweiPageProps) {
    const [calendarType, setCalendarType] = useState<CalendarType>('solar');
    const [year, setYear] = useState(1990);
    const [month, setMonth] = useState(1);
    const [day, setDay] = useState(1);
    const [shichen, setShichen] = useState(0);
    const [minute, setMinute] = useState(0);
    const [gender, setGender] = useState<'男' | '女'>('男');
    const [timezone, setTimezone] = useState('Asia/Shanghai');
    const [longitude, setLongitude] = useState<number | undefined>(116.4);
    const [useTrueSolarTime, setUseTrueSolarTime] = useState(false);
    const [lateZiBoundary, setLateZiBoundary] = useState<'23:00' | '00:00'>('00:00');
    const [result, setResult] = useState<ZiweiResult | null>(null);
    const [activeMainTab, setActiveMainTab] = useState<ZiweiMainTab>('命盘');
    const [activeTopView, setActiveTopView] = useState<ZiweiTopView>('main');
    const [activeMode, setActiveMode] = useState<ZiweiMode>('三合');
    const [archives, setArchives] = useState<AstrologyRecord[]>([]);
    const [archiveHint, setArchiveHint] = useState('');
    const contentRef = useRef<HTMLDivElement | null>(null);

    const handleCalendarTypeChange = (next: CalendarType) => {
        if (next === calendarType) return;

        const hour = shichenToHour(shichen);
        try {
            if (calendarType === 'solar' && next === 'lunar') {
                const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
                const lunar = solar.getLunar();
                setYear(lunar.getYear());
                setMonth(Math.abs(lunar.getMonth()));
                setDay(lunar.getDay());
            } else if (calendarType === 'lunar' && next === 'solar') {
                const lunar = Lunar.fromYmdHms(year, month, Math.min(day, 30), hour, minute, 0);
                const solar = lunar.getSolar();
                setYear(solar.getYear());
                setMonth(solar.getMonth());
                setDay(solar.getDay());
            }
        } catch {
            // keep existing Y/M/D when conversion fails
        }

        setCalendarType(next);
    };

    const handleCalculate = () => {
        const r = calculateZiwei(year, month, day, shichen, gender, {
            calendar: calendarType,
            minute,
            timezone,
            longitude,
            profile: {
                ...WENMO_BASIC_PROFILE,
                useTrueSolarTime,
                lateZiBoundary,
            },
        });
        setResult(r);
    };

    const reading = useMemo(() => (result ? interpretZiwei(result) : null), [result]);

    const refreshArchives = () => {
        setArchives(listAstrologyRecords('ziwei'));
    };

    const handleSaveArchive = () => {
        if (!result) return;
        saveAstrologyRecord({
            type: 'ziwei',
            title: `${calendarType === 'solar' ? '阳历' : '农历'} ${year}年${month}月${day}日 紫微`,
            input: result.input,
            profile: result.profile,
            chart: result,
            interpretation: reading || undefined,
        });
        setArchiveHint('已保存到本地档案');
        refreshArchives();
    };

    const handleDeleteArchive = (id: string) => {
        removeAstrologyRecord(id);
        refreshArchives();
    };

    const handleLoadArchive = (record: AstrologyRecord) => {
        const input = record.input;
        const loadedShichen = input.hour >= 23 ? 0 : Math.floor((input.hour + 1) / 2);
        setCalendarType(input.calendar);
        setYear(input.year);
        setMonth(input.month);
        setDay(input.day);
        setShichen(loadedShichen);
        setMinute(input.minute);
        setGender(input.gender);
        setTimezone(input.timezone);
        setLongitude(input.longitude);
        setUseTrueSolarTime(record.profile.useTrueSolarTime);
        setLateZiBoundary(record.profile.lateZiBoundary);

        const loaded = calculateZiwei(input.year, input.month, input.day, loadedShichen, input.gender, {
            calendar: input.calendar,
            minute: input.minute,
            timezone: input.timezone,
            longitude: input.longitude,
            profile: record.profile,
        });
        setResult(loaded);
        setArchiveHint('已加载档案并重新排盘');
        setActiveTopView('main');
        setActiveMainTab('命盘');
    };

    useEffect(() => {
        const raw = localStorage.getItem(ZIWEI_SETTINGS_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as {
                    calendarType?: CalendarType;
                    minute?: number;
                    timezone?: string;
                    longitude?: number;
                    useTrueSolarTime?: boolean;
                    lateZiBoundary?: '23:00' | '00:00';
                };
                if (parsed.calendarType === 'solar' || parsed.calendarType === 'lunar') setCalendarType(parsed.calendarType);
                if (typeof parsed.minute === 'number') setMinute(parsed.minute);
                if (typeof parsed.timezone === 'string') setTimezone(parsed.timezone);
                if (typeof parsed.longitude === 'number') setLongitude(parsed.longitude);
                if (typeof parsed.useTrueSolarTime === 'boolean') setUseTrueSolarTime(parsed.useTrueSolarTime);
                if (parsed.lateZiBoundary === '23:00' || parsed.lateZiBoundary === '00:00') {
                    setLateZiBoundary(parsed.lateZiBoundary);
                }
            } catch {
                // ignore invalid settings
            }
        }
        refreshArchives();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        localStorage.setItem(
            ZIWEI_SETTINGS_KEY,
            JSON.stringify({
                calendarType,
                minute,
                timezone,
                longitude,
                useTrueSolarTime,
                lateZiBoundary,
            }),
        );
    }, [calendarType, lateZiBoundary, longitude, minute, timezone, useTrueSolarTime]);

    useEffect(() => {
        handleCalculate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [calendarType, day, gender, lateZiBoundary, minute, month, shichen, timezone, useTrueSolarTime, year, longitude]);

    useEffect(() => {
        if (activeTopView !== 'main' || activeMainTab !== '命盘') return;
        contentRef.current?.scrollTo({ top: 0 });
    }, [activeMainTab, activeTopView]);

    const renderMainContent = () => {
        if (activeTopView === 'settings') {
            return (
                <ZiweiSettingsView
                    minute={minute}
                    setMinute={setMinute}
                    timezone={timezone}
                    setTimezone={setTimezone}
                    longitude={longitude}
                    setLongitude={setLongitude}
                    useTrueSolarTime={useTrueSolarTime}
                    setUseTrueSolarTime={setUseTrueSolarTime}
                    lateZiBoundary={lateZiBoundary}
                    setLateZiBoundary={setLateZiBoundary}
                    onRecalculate={handleCalculate}
                />
            );
        }

        if (activeMainTab === '命盘') {
            if (!result) {
                return <ZiweiNotice title="请先排盘" description="输入出生信息后点击“排盘”，即可生成命盘。" />;
            }
            return (
                <ZiweiGrid
                    result={result}
                    year={year}
                    month={month}
                    day={day}
                    shichen={shichen}
                    gender={gender}
                    activeMode={activeMode}
                    onModeChange={setActiveMode}
                />
            );
        }

        if (activeMainTab === '帮助') {
            if (!reading) {
                return <ZiweiNotice title="暂无解读" description="当前无可用命盘，请先返回命盘页进行排盘。" />;
            }
            return <ZiweiReadingView summary={reading.summary} sections={reading.sections} />;
        }

        return (
            <ZiweiAboutView
                archives={archives}
                hint={archiveHint}
                onSave={handleSaveArchive}
                onDelete={handleDeleteArchive}
                onLoad={handleLoadArchive}
                onExportJson={downloadAstrologyRecordJson}
                onExportPdf={downloadAstrologyRecordPdf}
            />
        );
    };

    const handleSettingsToggle = () => {
        setActiveTopView(prev => (prev === 'main' ? 'settings' : 'main'));
    };
    const isChartMainView = activeTopView === 'main' && activeMainTab === '命盘';

    return (
        <div className="fixed inset-0 z-50 flex justify-center bg-gray-200/60" style={{ fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif" }}>
            <div className="flex h-full w-full max-w-[430px] flex-col bg-white shadow-sm">
                <div className="flex h-12 items-center justify-between border-b border-gray-200 bg-gray-50 px-3 shrink-0">
                    <button onClick={onClose} className="flex items-center gap-1 text-[15px] font-medium text-blue-600">
                        <ArrowLeft size={18} />
                        命例
                    </button>
                    <h3 className="text-[20px] font-medium text-gray-900">文墨天机基础版</h3>
                    <button
                        onClick={handleSettingsToggle}
                        className={`flex items-center gap-0.5 text-[15px] ${activeTopView === 'settings' ? 'text-indigo-600' : 'text-blue-600'}`}
                    >
                        设置
                        <ChevronRight size={16} />
                    </button>
                </div>

                {activeTopView === 'main' && (
                    <div className="shrink-0 border-b border-gray-200 bg-white px-2 py-1.5">
                        <div className="grid gap-1" style={{ gridTemplateColumns: '1.25fr 1.9fr 1fr 1fr 1.65fr 1.1fr 1.3fr' }}>
                            <select
                                value={calendarType}
                                onChange={e => handleCalendarTypeChange(e.target.value as CalendarType)}
                                className="h-7 w-full rounded border border-gray-300 px-1 text-xs"
                            >
                                <option value="solar">阳历</option>
                                <option value="lunar">农历</option>
                            </select>
                            <input
                                type="number"
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                                className="h-7 w-full rounded border border-gray-300 px-1.5 text-xs"
                                placeholder={calendarType === 'solar' ? '公历年' : '农历年'}
                            />
                            <input
                                type="number"
                                value={month}
                                onChange={e => setMonth(Number(e.target.value))}
                                min={1}
                                max={12}
                                className="h-7 w-full rounded border border-gray-300 px-1 text-xs"
                                placeholder="月"
                            />
                            <input
                                type="number"
                                value={day}
                                onChange={e => setDay(Number(e.target.value))}
                                min={1}
                                max={calendarType === 'solar' ? 31 : 30}
                                className="h-7 w-full rounded border border-gray-300 px-1 text-xs"
                                placeholder="日"
                            />
                            <select
                                value={shichen}
                                onChange={e => setShichen(Number(e.target.value))}
                                className="h-7 w-full rounded border border-gray-300 px-1 text-[11px]"
                            >
                                {SHICHEN_LABELS.map((_, i) => (
                                    <option key={i} value={i}>{formatShichenNumericRange(i)}</option>
                                ))}
                            </select>
                            <select
                                value={gender}
                                onChange={e => setGender(e.target.value as '男' | '女')}
                                className="h-7 w-full rounded border border-gray-300 px-1 text-xs"
                            >
                                <option value="男">男</option>
                                <option value="女">女</option>
                            </select>
                            <button
                                onClick={handleCalculate}
                                className="h-7 w-full rounded bg-indigo-600 text-xs font-medium text-white"
                            >
                                排盘
                            </button>
                        </div>
                    </div>
                )}

                <div
                    ref={contentRef}
                    className={`min-h-0 flex-1 bg-[#f7f7f7] pb-[env(safe-area-inset-bottom)] ${
                        isChartMainView ? 'overflow-hidden' : 'overflow-y-auto'
                    }`}
                >
                    {renderMainContent()}
                </div>
            </div>
        </div>
    );
}

function ZiweiNotice({ title, description }: { title: string; description: string }) {
    return (
        <div className="p-3">
            <div className="rounded border border-gray-200 bg-white p-4 text-center">
                <div className="text-sm font-medium text-gray-700">{title}</div>
                <div className="mt-1 text-xs text-gray-500">{description}</div>
            </div>
        </div>
    );
}

/* ================================================================ */
/*  Settings / Reading / About                                      */
/* ================================================================ */

function ZiweiSettingsView({
    minute,
    setMinute,
    timezone,
    setTimezone,
    longitude,
    setLongitude,
    useTrueSolarTime,
    setUseTrueSolarTime,
    lateZiBoundary,
    setLateZiBoundary,
    onRecalculate,
}: {
    minute: number;
    setMinute: (value: number) => void;
    timezone: string;
    setTimezone: (value: string) => void;
    longitude: number | undefined;
    setLongitude: (value: number | undefined) => void;
    useTrueSolarTime: boolean;
    setUseTrueSolarTime: (value: boolean) => void;
    lateZiBoundary: '23:00' | '00:00';
    setLateZiBoundary: (value: '23:00' | '00:00') => void;
    onRecalculate: () => void;
}) {
    return (
        <div className="p-3 space-y-3 text-sm">
            <div className="rounded border border-gray-200 bg-white p-3">
                <div className="mb-2 font-medium text-gray-800">规则模板</div>
                <div className="text-xs text-gray-600">wenmo-basic-v1（文墨基础配置）</div>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
                <div className="font-medium text-gray-800">专业开关</div>
                <label className="flex items-center justify-between text-xs text-gray-700">
                    <span>真太阳时校正</span>
                    <input
                        type="checkbox"
                        checked={useTrueSolarTime}
                        onChange={(e) => setUseTrueSolarTime(e.target.checked)}
                    />
                </label>
                <label className="flex items-center justify-between text-xs text-gray-700">
                    <span>晚子时换日</span>
                    <select
                        value={lateZiBoundary}
                        onChange={(e) => setLateZiBoundary(e.target.value as '23:00' | '00:00')}
                        className="border border-gray-300 rounded px-1 py-0.5 text-xs"
                    >
                        <option value="00:00">00:00 换日</option>
                        <option value="23:00">23:00 换日</option>
                    </select>
                </label>
            </div>
            <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
                <div className="font-medium text-gray-800">输入校正</div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="text-[10px] text-gray-500">分钟</label>
                        <input
                            type="number"
                            min={0}
                            max={59}
                            value={minute}
                            onChange={(e) => setMinute(Number(e.target.value))}
                            className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="text-[10px] text-gray-500">时区</label>
                        <input
                            value={timezone}
                            onChange={(e) => setTimezone(e.target.value)}
                            className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
                        />
                    </div>
                    <div className="col-span-3">
                        <label className="text-[10px] text-gray-500">经度（可选）</label>
                        <input
                            type="number"
                            value={longitude ?? ''}
                            onChange={(e) => {
                                const next = e.target.value.trim();
                                setLongitude(next ? Number(next) : undefined);
                            }}
                            className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
                        />
                    </div>
                </div>
            </div>
            <button
                onClick={onRecalculate}
                className="w-full py-2 bg-indigo-600 text-white rounded text-sm font-medium"
            >
                按当前设置重新排盘
            </button>
        </div>
    );
}

function ZiweiReadingView({ summary, sections }: { summary: string; sections: Array<{ key: string; title: string; content: string }> }) {
    return (
        <div className="p-3 space-y-3">
            <div className="rounded border border-indigo-200 bg-indigo-50 p-3">
                <div className="text-xs text-indigo-700 mb-1">摘要</div>
                <div className="text-sm text-gray-800">{summary}</div>
            </div>
            {sections.map((section) => (
                <div key={section.key} className="rounded border border-gray-200 bg-white p-3">
                    <div className="text-sm font-semibold text-gray-800 mb-1">{section.title}</div>
                    <div className="text-xs text-gray-600 leading-5">{section.content}</div>
                </div>
            ))}
        </div>
    );
}

function ZiweiAboutView({
    archives,
    hint,
    onSave,
    onDelete,
    onLoad,
    onExportJson,
    onExportPdf,
}: {
    archives: AstrologyRecord[];
    hint: string;
    onSave: () => void;
    onDelete: (id: string) => void;
    onLoad: (record: AstrologyRecord) => void;
    onExportJson: (record: AstrologyRecord) => void | Promise<void>;
    onExportPdf: (record: AstrologyRecord) => void | Promise<void>;
}) {
    return (
        <div className="p-3 space-y-3">
            <div className="rounded border border-gray-200 bg-white p-3">
                <div className="text-sm font-semibold text-gray-800">关于文墨天机基础版</div>
                <div className="mt-1 text-xs leading-5 text-gray-600">
                    当前页面采用 12 宫外环 + 中宫信息布局，支持本地档案保存、导出 JSON 与导出 PDF。
                </div>
            </div>
            <ZiweiArchiveView
                archives={archives}
                hint={hint}
                onSave={onSave}
                onDelete={onDelete}
                onLoad={onLoad}
                onExportJson={onExportJson}
                onExportPdf={onExportPdf}
            />
        </div>
    );
}

function ZiweiArchiveView({
    archives,
    hint,
    onSave,
    onDelete,
    onLoad,
    onExportJson,
    onExportPdf,
}: {
    archives: AstrologyRecord[];
    hint: string;
    onSave: () => void;
    onDelete: (id: string) => void;
    onLoad: (record: AstrologyRecord) => void;
    onExportJson: (record: AstrologyRecord) => void | Promise<void>;
    onExportPdf: (record: AstrologyRecord) => void | Promise<void>;
}) {
    return (
        <div className="space-y-3">
            <button
                onClick={onSave}
                className="w-full py-2 bg-green-600 text-white rounded text-sm font-medium"
            >
                保存当前命盘到档案
            </button>
            {hint && <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded p-2">{hint}</div>}
            <div className="space-y-2">
                {archives.length === 0 && (
                    <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-3">暂无本地档案</div>
                )}
                {archives.map((record) => (
                    <div key={record.id} className="rounded border border-gray-200 bg-white p-3">
                        <div>
                            <div className="text-sm font-medium text-gray-800">{record.title}</div>
                            <div className="text-[10px] text-gray-500 mt-1">
                                {new Date(record.updatedAt).toLocaleString()}
                            </div>
                        </div>
                        <div className="flex gap-1 mt-2 flex-wrap">
                            <button
                                onClick={() => onLoad(record)}
                                className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded"
                            >
                                加载
                            </button>
                            <button
                                onClick={() => { void onExportJson(record); }}
                                className="px-2 py-1 text-xs text-gray-700 border border-gray-200 rounded"
                            >
                                导出JSON
                            </button>
                            <button
                                onClick={() => { void onExportPdf(record); }}
                                className="px-2 py-1 text-xs text-indigo-700 border border-indigo-200 rounded"
                            >
                                导出PDF
                            </button>
                            <button
                                onClick={() => onDelete(record.id)}
                                className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ================================================================ */
/*  紫微盘面 Grid                                                     */
/* ================================================================ */

function ZiweiGrid({
    result,
    year,
    month,
    day,
    shichen,
    gender,
    activeMode,
    onModeChange,
}: {
    result: ZiweiResult;
    year: number;
    month: number;
    day: number;
    shichen: number;
    gender: string;
    activeMode: ZiweiMode;
    onModeChange: (mode: ZiweiMode) => void;
}) {
    const DIZHI_RING = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
    const { gongGrid, dizhiPositionMap } = useMemo(() => {
        const dizhiPos: Record<string, string> = {
            '巳': '0-0', '午': '0-1', '未': '0-2', '申': '0-3',
            '辰': '1-0', '酉': '1-3',
            '卯': '2-0', '戌': '2-3',
            '寅': '3-0', '丑': '3-1', '子': '3-2', '亥': '3-3',
        };
        const gridMap = new Map<string, GongInfo>();
        const posMap = new Map<string, { row: number; col: number }>();
        for (const g of result.gongs) {
            const pos = dizhiPos[g.dizhi];
            if (pos) {
                gridMap.set(pos, g);
                const [row, col] = pos.split('-').map(Number);
                posMap.set(g.dizhi, { row, col });
            }
        }
        return {
            gongGrid: gridMap,
            dizhiPositionMap: posMap,
        };
    }, [result]);

    const getGong = (row: number, col: number): GongInfo | null => gongGrid.get(`${row}-${col}`) || null;

    const [selectedDizhi, setSelectedDizhi] = useState<string | null>(null);
    const [timelineSelection, setTimelineSelection] = useState<TimelineSelection | null>(null);
    const [activeDaxianIdx, setActiveDaxianIdx] = useState(0);
    const [lineSegments, setLineSegments] = useState<Array<{ x1: number; y1: number; x2: number; y2: number }>>([]);
    const [linkedDizhis, setLinkedDizhis] = useState<string[]>([]);
    const [chartFrame, setChartFrame] = useState({ width: 0, height: 0 });
    const [density, setDensity] = useState<LayoutDensity>('normal');
    const rootRef = useRef<HTMLDivElement | null>(null);
    const modeBarRef = useRef<HTMLDivElement | null>(null);
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const baseTimeline = useMemo(
        () => result.gongs.map((gong, palaceIndex) => ({ gong, palaceIndex })),
        [result.gongs],
    );
    const daxianTimeline = useMemo(
        () =>
            [...baseTimeline]
                .sort((a, b) => a.gong.daxianStart - b.gong.daxianStart)
                .slice(0, 10)
                .map((entry, idx) => ({ ...entry, idx })),
        [baseTimeline],
    );
    const liunianAgePalaceMap = useMemo(() => {
        const ageMap = new Map<number, { palaceIndex: number; gong: GongInfo }>();
        result.gongs.forEach((gong, palaceIndex) => {
            gong.liunianAges.forEach((age) => {
                if (!ageMap.has(age)) {
                    ageMap.set(age, { palaceIndex, gong });
                }
            });
        });
        return ageMap;
    }, [result.gongs]);
    const activeDaxian = daxianTimeline[activeDaxianIdx] ?? daxianTimeline[0];
    const liunianByDaxian = useMemo(() => {
        if (!activeDaxian) return [];
        const inferredBirthYear = result.gongs.reduce((acc, gong) => {
            const startAge = gong.liunianAges[0] ?? 1;
            const candidate = gong.liunianYear - (startAge - 1);
            return acc === null ? candidate : Math.min(acc, candidate);
        }, null as number | null) ?? result.input.year;
        const startAge = activeDaxian.gong.daxianStart;
        const endAge = activeDaxian.gong.daxianEnd;
        const rows: Array<{
            idx: number;
            year: number;
            age: number;
            gong: GongInfo;
            palaceIndex: number;
            daxianIdx: number;
        }> = [];
        for (let age = startAge; age <= endAge; age += 1) {
            const mapped = liunianAgePalaceMap.get(age);
            const target = mapped ?? { palaceIndex: activeDaxian.palaceIndex, gong: activeDaxian.gong };
            rows.push({
                idx: age - startAge,
                year: inferredBirthYear + age - 1,
                age,
                gong: target.gong,
                palaceIndex: target.palaceIndex,
                daxianIdx: activeDaxian.idx,
            });
        }
        return rows;
    }, [activeDaxian, liunianAgePalaceMap, result.gongs, result.input.year]);

    const topDirections = ['南偏东', '正南方', '南偏西', ''];
    const bottomDirections = ['', '北偏东', '正北方', '北偏西'];
    const leftDirections = ['南偏东', '东偏南', '正东方', '东偏北'];
    const rightDirections = ['西偏南', '正西方', '西偏北', '北偏西'];

    useEffect(() => {
        const ming = result.gongs[result.mingGongIdx]?.dizhi ?? null;
        setSelectedDizhi((prev) => (prev && result.gongs.some(g => g.dizhi === prev) ? prev : ming));
        setTimelineSelection(null);
        setActiveDaxianIdx(0);
    }, [result]);

    useEffect(() => {
        const measure = () => {
            const root = rootRef.current;
            if (!root) return;

            const rootRect = root.getBoundingClientRect();
            const modeHeight = modeBarRef.current?.getBoundingClientRect().height ?? 0;
            const timelineHeight = timelineRef.current?.getBoundingClientRect().height ?? 0;
            const reservedHeight = modeHeight + timelineHeight + 8;
            const usableHeight = Math.max(220, rootRect.height - reservedHeight);
            const usableWidth = Math.max(220, rootRect.width);
            const nextFrame = {
                width: Math.floor(usableWidth),
                height: Math.floor(usableHeight),
            };
            setChartFrame((prev) => (
                Math.abs(prev.width - nextFrame.width) > 1 || Math.abs(prev.height - nextFrame.height) > 1
                    ? nextFrame
                    : prev
            ));

            const cellBudget = Math.min(nextFrame.width / 4, nextFrame.height / 4);
            if (cellBudget < 74) {
                setDensity('dense');
            } else if (cellBudget < 92) {
                setDensity('compact');
            } else {
                setDensity('normal');
            }
        };

        measure();
        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        if (resizeObserver && rootRef.current) resizeObserver.observe(rootRef.current);
        if (resizeObserver && modeBarRef.current) resizeObserver.observe(modeBarRef.current);
        if (resizeObserver && timelineRef.current) resizeObserver.observe(timelineRef.current);
        window.addEventListener('resize', measure);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, []);

    useEffect(() => {
        const updateSegments = () => {
            if (!overlayRef.current) {
                setLineSegments([]);
                setLinkedDizhis([]);
                return;
            }

            const overlayRect = overlayRef.current.getBoundingClientRect();
            const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
            const maxX = Math.max(0, overlayRect.width - 1);
            const maxY = Math.max(0, overlayRect.height - 1);
            const inset = 2;
            const nextLinked: string[] = [];
            const nextSegments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
            const pushLinked = (dizhi: string) => {
                if (!nextLinked.includes(dizhi)) nextLinked.push(dizhi);
            };

            const getAnchor = (dizhi: string) => {
                const el = cellRefs.current[dizhi];
                const pos = dizhiPositionMap.get(dizhi);
                if (!el || !pos) return null;

                const rect = el.getBoundingClientRect();
                const left = rect.left - overlayRect.left;
                const top = rect.top - overlayRect.top;
                const right = left + rect.width;
                const bottom = top + rect.height;
                const centerX = left + rect.width / 2;
                const centerY = top + rect.height / 2;

                const isTop = pos.row === 0;
                const isBottom = pos.row === 3;
                const isLeft = pos.col === 0;
                const isRight = pos.col === 3;
                const isCorner = (isTop || isBottom) && (isLeft || isRight);

                let x = centerX;
                let y = centerY;

                if (isCorner) {
                    x = isLeft ? right - inset : left + inset;
                    y = isTop ? bottom - inset : top + inset;
                } else if (isTop) {
                    y = bottom - inset;
                } else if (isBottom) {
                    y = top + inset;
                } else if (isLeft) {
                    x = right - inset;
                } else if (isRight) {
                    x = left + inset;
                }

                return {
                    dizhi,
                    x: clamp(x, 1, maxX),
                    y: clamp(y, 1, maxY),
                };
            };

            const siHuaOrder: Array<'化禄' | '化权' | '化科' | '化忌'> = ['化禄', '化权', '化科', '化忌'];
            const siHuaNodes = siHuaOrder.reduce<Array<{ hua: (typeof siHuaOrder)[number]; dizhi: string }>>((acc, hua) => {
                const gong = result.gongs.find(g =>
                    g.mainStars.some(star => star.siHua === hua) || g.auxStars.some(star => star.siHua === hua),
                );
                if (gong) {
                    acc.push({ hua, dizhi: gong.dizhi });
                }
                return acc;
            }, []);

            if (activeMode === '四化') {
                for (const node of siHuaNodes) {
                    pushLinked(node.dizhi);
                }
                setLineSegments([]);
                setLinkedDizhis(nextLinked);
                return;
            }

            if (activeMode === '飞星') {
                const anchors = siHuaNodes
                    .map(node => getAnchor(node.dizhi))
                    .filter((anchor): anchor is NonNullable<ReturnType<typeof getAnchor>> => anchor !== null);
                for (const anchor of anchors) {
                    pushLinked(anchor.dizhi);
                }
                for (let i = 0; i < anchors.length - 1; i += 1) {
                    const from = anchors[i];
                    const to = anchors[i + 1];
                    nextSegments.push({
                        x1: from.x,
                        y1: from.y,
                        x2: to.x,
                        y2: to.y,
                    });
                }
                setLineSegments(nextSegments);
                setLinkedDizhis(nextLinked);
                return;
            }

            if (!selectedDizhi || !cellRefs.current[selectedDizhi] || !dizhiPositionMap.get(selectedDizhi)) {
                setLineSegments([]);
                setLinkedDizhis([]);
                return;
            }

            const selectedIdx = DIZHI_RING.indexOf(selectedDizhi as (typeof DIZHI_RING)[number]);
            if (selectedIdx < 0) {
                setLineSegments([]);
                setLinkedDizhis([]);
                return;
            }
            const oppositeDizhi = DIZHI_RING[(selectedIdx + 6) % 12];
            // 三方：对宫前后各隔一宫（等价于本宫顺/逆隔四宫）。
            const prevOppositeGapDizhi = DIZHI_RING[(selectedIdx + 4) % 12];
            const nextOppositeGapDizhi = DIZHI_RING[(selectedIdx + 8) % 12];
            const relatedDizhis = [selectedDizhi, prevOppositeGapDizhi, oppositeDizhi, nextOppositeGapDizhi];

            const anchorMap = new Map<string, NonNullable<ReturnType<typeof getAnchor>>>();
            for (const dizhi of relatedDizhis) {
                const anchor = getAnchor(dizhi);
                if (anchor) {
                    anchorMap.set(dizhi, anchor);
                }
            }

            const selectedAnchor = anchorMap.get(selectedDizhi);
            const sanhePrevAnchor = anchorMap.get(prevOppositeGapDizhi);
            const oppositeAnchor = anchorMap.get(oppositeDizhi);
            const sanheNextAnchor = anchorMap.get(nextOppositeGapDizhi);

            if (!selectedAnchor || !sanhePrevAnchor || !oppositeAnchor || !sanheNextAnchor) {
                setLineSegments([]);
                setLinkedDizhis([]);
                return;
            }

            const targets = [sanhePrevAnchor, oppositeAnchor, sanheNextAnchor];
            for (const target of targets) {
                nextSegments.push({
                    x1: selectedAnchor.x,
                    y1: selectedAnchor.y,
                    x2: target.x,
                    y2: target.y,
                });
            }

            for (const dizhi of relatedDizhis) {
                pushLinked(dizhi);
            }

            setLineSegments(nextSegments);
            setLinkedDizhis(nextLinked);
        };

        const raf = requestAnimationFrame(updateSegments);
        window.addEventListener('resize', updateSegments);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', updateSegments);
        };
    }, [activeMode, chartFrame.height, chartFrame.width, dizhiPositionMap, result.gongs, selectedDizhi]);

    const renderPalace = (gong: GongInfo | null, key: string) => {
        if (!gong) {
            return <EmptyCell key={key} />;
        }
        return (
            <PalaceCell
                key={key}
                gong={gong}
                result={result}
                activeMode={activeMode}
                isSelected={gong.dizhi === selectedDizhi}
                isLinked={linkedDizhis.includes(gong.dizhi)}
                density={density}
                onSelect={() => {
                    setSelectedDizhi(gong.dizhi);
                    setTimelineSelection(null);
                }}
                setRef={(el) => {
                    cellRefs.current[gong.dizhi] = el;
                }}
            />
        );
    };

    const row1Left = getGong(1, 0);
    const row1Right = getGong(1, 3);
    const row2Left = getGong(2, 0);
    const row2Right = getGong(2, 3);
    const chartFrameStyle: CSSProperties =
        chartFrame.width > 0 && chartFrame.height > 0
            ? { width: chartFrame.width, height: chartFrame.height }
            : { width: '100%', height: '100%' };

    return (
        <div ref={rootRef} className="flex h-full min-h-0 flex-col p-1.5">
            <div className="flex min-h-0 flex-1 items-start justify-center">
                <div
                    className="relative mx-auto flex max-w-full flex-col overflow-hidden rounded-sm border border-gray-300 bg-white"
                    style={chartFrameStyle}
                >
                    <span className="absolute -top-1 -left-1 text-[11px] leading-none text-red-400">↖</span>
                    <span className="absolute -top-1 -right-1 text-[11px] leading-none text-blue-500">↗</span>
                    <span className="absolute -bottom-1 -left-1 text-[11px] leading-none text-red-500">↙</span>
                    <span className="absolute -bottom-1 -right-1 text-[11px] leading-none text-purple-500">↘</span>

                    <div className="shrink-0 grid grid-cols-4 px-4 pt-1">
                        {topDirections.map((dir, i) => (
                            <div key={i} className={`text-[9px] text-gray-500 text-center ${i === 0 ? 'text-right pr-3' : i === 3 ? 'text-left pl-3' : ''}`}>
                                {dir}
                            </div>
                        ))}
                    </div>

                    <div className="flex min-h-0 flex-1 items-stretch">
                        <div className="grid w-5 grid-rows-4 py-0.5">
                            {leftDirections.map((dir, idx) => (
                                <div key={idx} className="flex items-center justify-center">
                                    <span style={{ writingMode: 'vertical-rl' }} className="text-[9px] leading-none text-gray-500">
                                        {dir}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div ref={overlayRef} className="relative min-h-0 flex-1 overflow-hidden">
                            <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full">
                                {lineSegments.map((line, idx) => (
                                    <line
                                        key={`${selectedDizhi ?? 'none'}-${idx}`}
                                        x1={line.x1}
                                        y1={line.y1}
                                        x2={line.x2}
                                        y2={line.y2}
                                        stroke={activeMode === '飞星' ? '#4f46e5' : '#9ca3af'}
                                        strokeWidth={activeMode === '飞星' ? 1.25 : 1.1}
                                        strokeDasharray={activeMode === '飞星' ? '0' : '5 4'}
                                        strokeLinecap="round"
                                        opacity={activeMode === '飞星' ? 0.95 : 0.85}
                                    />
                                ))}
                            </svg>
                            <div className="relative z-10 grid h-full grid-cols-[repeat(4,minmax(0,1fr))] grid-rows-[repeat(4,minmax(0,1fr))] gap-px bg-gray-400 p-px">
                                {[0, 1, 2, 3].map(col => renderPalace(getGong(0, col), `0-${col}`))}

                                {renderPalace(row1Left, '1-0')}
                                <div className={`col-span-2 row-span-2 min-h-0 overflow-hidden bg-white ${density === 'dense' ? 'p-1' : 'p-1.5'}`}>
                                    <CenterPanel
                                        result={result}
                                        year={year}
                                        month={month}
                                        day={day}
                                        shichen={shichen}
                                        gender={gender}
                                        density={density}
                                    />
                                </div>
                                {renderPalace(row1Right, '1-3')}

                                {renderPalace(row2Left, '2-0')}
                                {renderPalace(row2Right, '2-3')}

                                {[0, 1, 2, 3].map(col => renderPalace(getGong(3, col), `3-${col}`))}
                            </div>
                        </div>

                        <div className="grid w-5 grid-rows-4 py-0.5">
                            {rightDirections.map((dir, idx) => (
                                <div key={idx} className="flex items-center justify-center">
                                    <span style={{ writingMode: 'vertical-rl' }} className="text-[9px] leading-none text-gray-500">
                                        {dir}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="shrink-0 grid grid-cols-4 px-4 pb-1">
                        {bottomDirections.map((dir, i) => (
                            <div key={i} className="text-[9px] text-gray-500 text-center">{dir}</div>
                        ))}
                    </div>
                </div>
            </div>

            <div ref={modeBarRef} className="mt-1 shrink-0 rounded-md border border-gray-300 bg-[#5e5e5e] p-0.5">
                <div className="grid grid-cols-3 gap-0.5">
                    {(['飞星', '三合', '四化'] as ZiweiMode[]).map(mode => (
                        <button
                            key={mode}
                            onClick={() => onModeChange(mode)}
                            className={`rounded py-1 text-[12px] ${
                                activeMode === mode
                                    ? 'bg-[#5b61d6] text-white'
                                    : 'bg-transparent text-gray-100'
                            }`}
                        >
                            {mode}
                        </button>
                    ))}
                </div>
            </div>

            <div ref={timelineRef}>
                <DaxianFooter
                    daxianTimeline={daxianTimeline}
                    liunianTimeline={liunianByDaxian}
                    activeDaxianIdx={activeDaxian?.idx ?? 0}
                    activeSelection={timelineSelection}
                    onSelect={(selection) => {
                        if (selection.type === '大限') {
                            setActiveDaxianIdx(selection.idx);
                        } else if (typeof selection.daxianIdx === 'number') {
                            setActiveDaxianIdx(selection.daxianIdx);
                        }
                        setTimelineSelection(selection);
                        setSelectedDizhi(selection.targetDizhi);
                    }}
                />
            </div>
        </div>
    );
}

/* ================================================================ */
/*  Palace Cell                                                      */
/* ================================================================ */

function PalaceCell({
    gong,
    result,
    activeMode,
    isSelected,
    isLinked,
    density,
    onSelect,
    setRef,
}: {
    gong: GongInfo;
    result: ZiweiResult;
    activeMode: ZiweiMode;
    isSelected: boolean;
    isLinked: boolean;
    density: LayoutDensity;
    onSelect: () => void;
    setRef: (el: HTMLDivElement | null) => void;
}) {
    const contentRef = useRef<HTMLDivElement | null>(null);
    const [contentSize, setContentSize] = useState({ width: 0, height: 0 });

    const isMingGong = gong.name === '命宫';
    const isShenGong = result.gongs[result.shenGongIdx]?.dizhi === gong.dizhi;
    const hasSiHua = gong.mainStars.some(star => Boolean(star.siHua)) || gong.auxStars.some(star => Boolean(star.siHua));

    useEffect(() => {
        const el = contentRef.current;
        if (!el) return;
        const update = () => {
            const next = {
                width: el.clientWidth,
                height: el.clientHeight,
            };
            setContentSize((prev) => (
                Math.abs(prev.width - next.width) > 1 || Math.abs(prev.height - next.height) > 1 ? next : prev
            ));
        };
        update();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        observer?.observe(el);
        window.addEventListener('resize', update);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', update);
        };
    }, []);

    const layoutPlan = useMemo(
        () =>
            computePalaceLayoutPlan({
                density,
                activeMode,
                isSelected,
                width: contentSize.width,
                height: contentSize.height,
                mainCount: gong.mainStars.length,
                auxCount: gong.auxStars.length,
                siHuaCount: gong.siHua.length,
            }),
        [activeMode, contentSize.height, contentSize.width, density, gong.auxStars.length, gong.mainStars.length, gong.siHua.length, isSelected],
    );

    const displayMainStars = gong.mainStars;
    const displayAuxStars = gong.auxStars;
    const displaySiHua = activeMode === '四化' && hasSiHua ? gong.siHua : [];
    const showYearPreview = layoutPlan.showYearPreview && layoutPlan.yearCount > 0;
    const liunianPreview = showYearPreview ? gong.liunianAges.slice(0, layoutPlan.yearCount).join(',') : '';
    const xiaoxianPreview = showYearPreview ? gong.xiaoxianAges.slice(0, layoutPlan.yearCount).join(',') : '';
    const isDense = density === 'dense';
    const cellPaddingClass = isDense ? 'px-1 py-0.5' : 'px-1.5 py-0.5';
    const bottomMetaSize = Math.max(6.5, 8 * layoutPlan.scale);
    const bottomTitleSize = Math.max(9, 11 * layoutPlan.scale);
    const ganZhiSize = Math.max(7.5, 9 * layoutPlan.scale);
    const shenSize = Math.max(6.8, 8 * layoutPlan.scale);

    const backgroundClass = 'bg-white';
    const linkedClass = isSelected
        ? 'ring-2 ring-indigo-400 ring-inset'
        : isLinked
            ? activeMode === '四化'
                ? 'ring-1 ring-violet-300 ring-inset'
                : 'ring-1 ring-indigo-200 ring-inset'
            : '';

    return (
        <div
            ref={setRef}
            onClick={onSelect}
            className={`grid h-full min-h-0 cursor-pointer grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden ${cellPaddingClass} text-[9px] ${backgroundClass} ${linkedClass}`}
        >
            <div className="flex items-start justify-between gap-1">
                <div className="text-[8px] text-gray-400">{gong.mainStars.length + gong.auxStars.length} 星</div>
                <div className="text-[8px] text-gray-300">{DIRECTION_LABELS[gong.dizhi] || ''}</div>
            </div>

            <div
                ref={contentRef}
                className={`min-h-0 ${layoutPlan.enableOverflowScroll ? 'overflow-y-auto' : 'overflow-hidden'}`}
                style={layoutPlan.enableOverflowScroll ? { scrollbarWidth: 'none', MsOverflowStyle: 'none' } : undefined}
            >
                <div className="mt-0.5 flex flex-wrap items-start gap-0.5">
                    {displayMainStars.map((star, i) => (
                        <MainStarColumn key={i} star={star} scale={layoutPlan.scale} />
                    ))}
                </div>

                {displayAuxStars.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                        {displayAuxStars.map((s, i) => (
                            <AuxStarColumn key={i} star={s} scale={layoutPlan.scale} />
                        ))}
                    </div>
                )}
                {displaySiHua.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                        {displaySiHua.map((tag) => (
                            <SiHuaTag key={tag} tag={tag} scale={layoutPlan.scale} />
                        ))}
                    </div>
                )}

                {showYearPreview && (
                    <div className={`mt-0.5 space-y-0.5 leading-none text-gray-500 ${isDense ? 'text-[6.5px]' : 'text-[7px]'}`}>
                        <div>流年:{liunianPreview}</div>
                        <div>小限:{xiaoxianPreview}</div>
                    </div>
                )}
            </div>

            <div className="flex items-end justify-between pt-0.5">
                <div>
                    <div className="text-gray-400" style={{ fontSize: bottomMetaSize }}>{gong.daxianStart}~{gong.daxianEnd}</div>
                    <div
                        className={`font-bold leading-none ${isMingGong ? 'text-red-600' : 'text-gray-700'}`}
                        style={{ fontSize: bottomTitleSize }}
                    >
                        {gong.name.replace('宫', '')}
                    </div>
                </div>
                <div className="text-right">
                    <div className="font-medium" style={{ color: TIANGAN_COLORS[gong.tiangan] || '#374151', fontSize: ganZhiSize }}>
                        {gong.tiangan}{gong.dizhi}
                    </div>
                    {isShenGong && <div className="text-blue-500" style={{ fontSize: shenSize }}>身</div>}
                </div>
            </div>
        </div>
    );
}

function MainStarColumn({ star, scale }: { star: StarInfo; scale: number }) {
    const brightnessColor = star.brightness ? BRIGHTNESS_COLORS[star.brightness] : '#374151';
    const siHuaColor = star.siHua ? SIHUA_COLORS[star.siHua] || '#374151' : null;
    const safeScale = clampScale(scale);
    const minWidth = Math.max(8.5, 12 * safeScale);
    const starNameSize = Math.max(6.5, 9 * safeScale);
    const metaSize = Math.max(5.4, 6.7 * safeScale);

    return (
        <div className="inline-flex flex-col items-center leading-none" style={{ minWidth }}>
            <span
                className="font-bold"
                style={{
                    color: brightnessColor,
                    writingMode: 'vertical-rl',
                    textOrientation: 'upright',
                    lineHeight: 0.9,
                    fontSize: starNameSize,
                }}
            >
                {star.name}
            </span>
            {star.brightness && (
                <span className="mt-0.5" style={{ color: brightnessColor, fontSize: metaSize }}>
                    {star.brightness}
                </span>
            )}
            {star.siHua && siHuaColor && (
                <span className="font-bold" style={{ color: siHuaColor, fontSize: metaSize }}>
                    {star.siHua.replace('化', '')}
                </span>
            )}
        </div>
    );
}

function AuxStarColumn({ star, scale }: { star: StarInfo; scale: number }) {
    const color = star.brightness ? BRIGHTNESS_COLORS[star.brightness] : '#718096';
    const siHuaColor = star.siHua ? SIHUA_COLORS[star.siHua] || null : null;
    const safeScale = clampScale(scale);
    const minWidth = Math.max(7, 9 * safeScale);
    const nameSize = Math.max(5.8, 7.1 * safeScale);
    const metaSize = Math.max(5, 5.8 * safeScale);

    return (
        <span className="inline-flex flex-col items-center leading-none" style={{ minWidth }}>
            <span
                className="font-medium"
                style={{ color, writingMode: 'vertical-rl', textOrientation: 'upright', fontSize: nameSize }}
            >
                {star.name}
            </span>
            {star.brightness && (
                <span className="mt-0.5" style={{ color, fontSize: metaSize }}>{star.brightness}</span>
            )}
            {star.siHua && siHuaColor && (
                <span className="font-bold" style={{ color: siHuaColor, fontSize: metaSize }}>
                    {star.siHua.replace('化', '')}
                </span>
            )}
        </span>
    );
}

function SiHuaTag({ tag, scale }: { tag: string; scale: number }) {
    const hua = ['化禄', '化权', '化科', '化忌'].find(item => tag.endsWith(item));
    const color = hua ? SIHUA_COLORS[hua] : '#4b5563';
    const safeScale = clampScale(scale);
    const fontSize = Math.max(5.8, 6.8 * safeScale);
    return (
        <span className="rounded border px-1" style={{ color, borderColor: `${color}55`, fontSize }}>
            {tag}
        </span>
    );
}

function EmptyCell() {
    return <div className="h-full bg-gray-50/70" />;
}

/* ================================================================ */
/*  Center Panel                                                     */
/* ================================================================ */

function CenterPanel({
    result,
    year,
    month,
    day,
    shichen,
    gender,
    density,
}: {
    result: ZiweiResult;
    year: number;
    month: number;
    day: number;
    shichen: number;
    gender: string;
    density: LayoutDensity;
}) {
    const shiChenLabel = formatShichenNumericRange(shichen);
    const inputCalendarLabel = result.input.calendar === 'solar' ? '阳历' : '农历';
    const isDense = density === 'dense';

    return (
        <div className="flex h-full flex-col justify-between overflow-hidden text-[9px]">
            <div className="text-center leading-tight">
                <div className={`${isDense ? 'text-[7px]' : 'text-[8px]'} text-gray-500`}>base 2.5.8</div>
            </div>

            <div className={`${isDense ? 'space-y-0 text-[9px]' : 'space-y-0.5 text-[10px]'} text-gray-700`}>
                <div>阴阳: {gender === '男' ? '阳男' : '阴女'} · {result.wuxingJu}</div>
                <div>输入: {inputCalendarLabel} {year}年{month}月{day}日 {shiChenLabel}</div>
                {!isDense && <div>年干支: {result.yearGanZhi} · 时区: {result.input.timezone}</div>}
                <div>命主: {result.mingZhu} · 身主: {result.shenZhu}</div>
            </div>

                <div className={`flex items-center gap-1.5 ${isDense ? 'text-[7px]' : 'text-[8px]'}`}>
                    <span className="text-gray-500">自化图示:</span>
                    <span style={{ color: SIHUA_COLORS['化禄'] }}>→禄</span>
                    <span style={{ color: SIHUA_COLORS['化权'] }}>→权</span>
                    <span style={{ color: SIHUA_COLORS['化科'] }}>→科</span>
                    <span style={{ color: SIHUA_COLORS['化忌'] }}>→忌</span>
                </div>
            {!isDense && (
                <div className="text-[8px] text-gray-500">
                    {result.input.calendar === 'solar' ? '阳历输入自动换算排盘' : '农历输入直接排盘'}
                </div>
            )}
        </div>
    );
}

/* ================================================================ */
/*  大限 Footer                                                      */
/* ================================================================ */

function DaxianFooter({
    daxianTimeline,
    liunianTimeline,
    activeDaxianIdx,
    activeSelection,
    onSelect,
}: {
    daxianTimeline: Array<{ idx: number; gong: GongInfo; palaceIndex: number }>;
    liunianTimeline: Array<{ idx: number; year: number; age: number; gong: GongInfo; palaceIndex: number; daxianIdx: number }>;
    activeDaxianIdx: number;
    activeSelection: TimelineSelection | null;
    onSelect: (selection: TimelineSelection) => void;
}) {
    const currentYear = new Date().getFullYear();

    return (
        <div className="mt-1 shrink-0 overflow-x-auto rounded-sm border border-gray-300 bg-white">
            <table className="w-full border-collapse text-[9px]">
                <tbody>
                    <tr className="bg-gray-50">
                        <td className="border border-gray-200 px-1 py-0.5 text-gray-600 font-medium">大限</td>
                        {daxianTimeline.map((entry) => {
                            const g = entry.gong;
                            const i = entry.idx;
                            const isActive = activeDaxianIdx === i;
                            return (
                                <td key={i} className={`border border-gray-200 px-0.5 py-0 text-center ${isActive ? 'bg-indigo-100' : ''}`}>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onSelect({
                                                type: '大限',
                                                idx: i,
                                                daxianIdx: i,
                                                palaceIndex: entry.palaceIndex,
                                                targetDizhi: g.dizhi,
                                                label: `${g.daxianStart}~${g.daxianEnd}`,
                                            })
                                        }
                                        className={`w-full py-0.5 ${isActive ? 'font-bold text-indigo-700' : 'text-gray-700'}`}
                                    >
                                        {g.daxianStart}~{g.daxianEnd}
                                    </button>
                                </td>
                            );
                        })}
                    </tr>
                    <tr>
                        <td className="border border-gray-200 px-1 py-0.5 text-gray-600 font-medium">流年</td>
                        {liunianTimeline.map((entry) => {
                            const i = entry.idx;
                            const yr = entry.year;
                            const isCurrentYear = yr === currentYear;
                            const isActive = activeSelection?.type === '流年' && activeSelection.idx === i;
                            return (
                                <td
                                    key={i}
                                    className={`border border-gray-200 px-0.5 py-0 text-center ${
                                        isActive ? 'bg-indigo-100' : isCurrentYear ? 'bg-red-50' : ''
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onSelect({
                                                type: '流年',
                                                idx: i,
                                                daxianIdx: entry.daxianIdx,
                                                palaceIndex: entry.palaceIndex,
                                                targetDizhi: entry.gong.dizhi,
                                                label: `${yr}年`,
                                            })
                                        }
                                        className={`w-full py-0.5 ${
                                            isActive
                                                ? 'font-bold text-indigo-700'
                                                : isCurrentYear
                                                    ? 'font-bold text-red-600'
                                                    : 'text-gray-600'
                                        }`}
                                    >
                                        {yr}年
                                    </button>
                                </td>
                            );
                        })}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}
