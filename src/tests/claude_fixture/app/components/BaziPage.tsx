/**
 * BaziPage — 八字排盘专业版页面
 * 模仿专业八字排盘应用的细盘界面
 * 包含: 四柱表格、大运、流年、五行旺衰
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import {
    calculateBazi,
    SHICHEN_LABELS,
    getGanColor,
    getZhiColor,
    getShiShen,
    SHISHEN_SHORT,
    WUXING_COLORS,
    WUXING_STRENGTH_COLORS,
    ZHI_CANG_GAN,
    type BaziResult,
    type WuxingStrengthLevel,
} from '../utils/bazi';
import { WENMO_BASIC_PROFILE } from '../domain/astrology/profile';
import { interpretBazi } from '../domain/astrology/interpretation';
import { listAstrologyRecords, removeAstrologyRecord, saveAstrologyRecord } from '../domain/astrology/storage';
import type { AstrologyRecord } from '../domain/astrology/types';
import { downloadAstrologyRecordJson, downloadAstrologyRecordPdf } from '../domain/astrology/export';

interface BaziPageProps {
    onClose: () => void;
}

type BaziTab = 'chart' | 'assist' | 'tips' | 'archive';
const BAZI_SETTINGS_KEY = 'astrology_bazi_settings_v1';

export default function BaziPage({ onClose }: BaziPageProps) {
    const [year, setYear] = useState(1990);
    const [month, setMonth] = useState(1);
    const [day, setDay] = useState(1);
    const [hour, setHour] = useState(23);
    const [minute, setMinute] = useState(0);
    const [gender, setGender] = useState<'男' | '女'>('男');
    const [timezone, setTimezone] = useState('Asia/Shanghai');
    const [longitude, setLongitude] = useState<number | undefined>(116.4);
    const [useTrueSolarTime, setUseTrueSolarTime] = useState(false);
    const [lateZiBoundary, setLateZiBoundary] = useState<'23:00' | '00:00'>('00:00');
    const [result, setResult] = useState<BaziResult | null>(null);
    const [activeTab, setActiveTab] = useState<BaziTab>('chart');
    const [activeSubTab, setActiveSubTab] = useState<string>('细盘');
    const [activeDayunIdx, setActiveDayunIdx] = useState(0);
    const [archives, setArchives] = useState<AstrologyRecord[]>([]);
    const [archiveHint, setArchiveHint] = useState('');

    const handleCalculate = () => {
        const r = calculateBazi(year, month, day, hour, gender, {
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
        // Find current dayun
        const currentYear = new Date().getFullYear();
        const age = currentYear - year;
        const idx = r.dayun.findIndex(d => age >= d.startAge && age <= d.endAge);
        if (idx >= 0) setActiveDayunIdx(idx);
    };

    const reading = useMemo(() => (result ? interpretBazi(result) : null), [result]);

    const refreshArchives = () => {
        setArchives(listAstrologyRecords('bazi'));
    };

    const handleSaveArchive = () => {
        if (!result) return;
        saveAstrologyRecord({
            type: 'bazi',
            title: `${year}年${month}月${day}日 八字`,
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
        setYear(input.year);
        setMonth(input.month);
        setDay(input.day);
        setHour(input.hour);
        setMinute(input.minute);
        setGender(input.gender);
        setTimezone(input.timezone);
        setLongitude(input.longitude);
        setUseTrueSolarTime(record.profile.useTrueSolarTime);
        setLateZiBoundary(record.profile.lateZiBoundary);

        const loaded = calculateBazi(input.year, input.month, input.day, input.hour, input.gender, {
            minute: input.minute,
            timezone: input.timezone,
            longitude: input.longitude,
            profile: record.profile,
        });
        setResult(loaded);
        setArchiveHint('已加载档案并重新排盘');
    };

    useEffect(() => {
        const raw = localStorage.getItem(BAZI_SETTINGS_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as {
                    minute?: number;
                    timezone?: string;
                    longitude?: number;
                    useTrueSolarTime?: boolean;
                    lateZiBoundary?: '23:00' | '00:00';
                };
                if (typeof parsed.minute === 'number') setMinute(parsed.minute);
                if (typeof parsed.timezone === 'string') setTimezone(parsed.timezone);
                if (typeof parsed.longitude === 'number') setLongitude(parsed.longitude);
                if (typeof parsed.useTrueSolarTime === 'boolean') setUseTrueSolarTime(parsed.useTrueSolarTime);
                if (parsed.lateZiBoundary === '23:00' || parsed.lateZiBoundary === '00:00') {
                    setLateZiBoundary(parsed.lateZiBoundary);
                }
            } catch {
                // ignore invalid persisted settings
            }
        }
        refreshArchives();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        localStorage.setItem(
            BAZI_SETTINGS_KEY,
            JSON.stringify({
                minute,
                timezone,
                longitude,
                useTrueSolarTime,
                lateZiBoundary,
            }),
        );
    }, [lateZiBoundary, longitude, minute, timezone, useTrueSolarTime]);

    useEffect(() => {
        handleCalculate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [day, gender, hour, lateZiBoundary, minute, month, timezone, useTrueSolarTime, year, longitude]);

    useEffect(() => {
        if (result) {
            setArchiveHint('');
        }
    }, [result]);

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col" style={{ fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 h-11 border-b border-gray-200 shrink-0 bg-gray-50">
                <button onClick={onClose} className="p-1 text-blue-600">
                    <ArrowLeft size={20} />
                </button>
                <div className="flex items-center gap-3">
                    <ChevronLeft size={18} className="text-blue-600 cursor-pointer" />
                    <h3 className="text-base font-bold text-gray-900">八字盘面</h3>
                    <ChevronRight size={18} className="text-blue-600 cursor-pointer" />
                    <RotateCw size={16} className="text-blue-600 cursor-pointer" onClick={handleCalculate} />
                </div>
                <ChevronRight size={18} className="text-blue-600" />
            </div>

            {activeTab === 'chart' && (
                <div className="flex border-b border-gray-200 shrink-0 bg-white">
                    {['基本', '命盘', '细盘', '大运'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveSubTab(tab)}
                            className={`flex-1 py-2 text-sm font-medium transition-colors ${activeSubTab === tab
                                    ? 'text-blue-600 border-b-2 border-blue-600'
                                    : 'text-gray-500'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            )}

            <div className="bg-white border-b p-3 space-y-2 shrink-0">
                <div className="text-xs text-gray-500 mb-1">输入出生信息</div>
                <div className="grid grid-cols-6 gap-1.5">
                    <div>
                        <label className="text-[10px] text-gray-400">年</label>
                        <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
                            className="w-full px-1.5 py-1 border border-gray-300 rounded text-xs" />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">月</label>
                        <input type="number" value={month} onChange={e => setMonth(Number(e.target.value))}
                            min={1} max={12}
                            className="w-full px-1.5 py-1 border border-gray-300 rounded text-xs" />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">日</label>
                        <input type="number" value={day} onChange={e => setDay(Number(e.target.value))}
                            min={1} max={31}
                            className="w-full px-1.5 py-1 border border-gray-300 rounded text-xs" />
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">时辰</label>
                        <select value={hour} onChange={e => setHour(Number(e.target.value))}
                            className="w-full px-0.5 py-1 border border-gray-300 rounded text-[10px]">
                            {SHICHEN_LABELS.map((label, i) => (
                                <option key={i} value={i === 0 ? 23 : i * 2 - 1}>{label.split(' ')[0]}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] text-gray-400">性别</label>
                        <select value={gender} onChange={e => setGender(e.target.value as '男' | '女')}
                            className="w-full px-1 py-1 border border-gray-300 rounded text-xs">
                            <option value="男">男</option>
                            <option value="女">女</option>
                        </select>
                    </div>
                    <div className="flex items-end">
                        <button onClick={handleCalculate}
                            className="w-full py-1 bg-blue-600 text-white rounded text-xs font-medium">
                            排盘
                        </button>
                    </div>
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 overflow-y-auto bg-white">
                {result && activeTab === 'chart' && activeSubTab === '细盘' && <XiPanView result={result} />}
                {result && activeTab === 'chart' && activeSubTab === '基本' && <JiBenView result={result} />}
                {result && activeTab === 'chart' && activeSubTab === '命盘' && <MingPanView result={result} />}
                {result && activeTab === 'chart' && activeSubTab === '大运' && (
                    <DaYunView result={result} activeDayunIdx={activeDayunIdx} setActiveDayunIdx={setActiveDayunIdx} />
                )}
                {activeTab === 'assist' && (
                    <AssistView
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
                )}
                {activeTab === 'tips' && reading && <TipsView summary={reading.summary} sections={reading.sections} />}
                {activeTab === 'archive' && (
                    <ArchiveView
                        archives={archives}
                        hint={archiveHint}
                        onSave={handleSaveArchive}
                        onDelete={handleDeleteArchive}
                        onLoad={handleLoadArchive}
                        onExportJson={downloadAstrologyRecordJson}
                        onExportPdf={downloadAstrologyRecordPdf}
                    />
                )}
            </div>

            {/* Bottom tab bar: 盘面 | 辅助 | 提示 | 档案 */}
            <div className="flex border-t border-gray-200 shrink-0 bg-gray-50">
                {[
                    { key: 'chart' as BaziTab, label: '盘面' },
                    { key: 'assist' as BaziTab, label: '辅助' },
                    { key: 'tips' as BaziTab, label: '提示' },
                    { key: 'archive' as BaziTab, label: '档案' },
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex-1 py-2.5 text-xs font-medium ${activeTab === tab.key
                                ? 'text-blue-600 border-t-2 border-blue-600 -mt-[1px]'
                                : 'text-gray-500'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ================================================================ */
/*  辅助 View                                                        */
/* ================================================================ */

function AssistView({
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
            <div className="rounded border border-gray-200 p-3 bg-gray-50">
                <div className="font-medium text-gray-800 mb-2">规则模板</div>
                <div className="text-xs text-gray-600">wenmo-basic-v1（锁定基础模板）</div>
            </div>

            <div className="rounded border border-gray-200 p-3 space-y-2">
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

            <div className="rounded border border-gray-200 p-3 space-y-2">
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
                className="w-full py-2 bg-blue-600 text-white rounded text-sm font-medium"
            >
                按当前设置重新排盘
            </button>
        </div>
    );
}

/* ================================================================ */
/*  解读 View                                                        */
/* ================================================================ */

function TipsView({ summary, sections }: { summary: string; sections: Array<{ key: string; title: string; content: string }> }) {
    return (
        <div className="p-3 space-y-3">
            <div className="rounded border border-blue-200 bg-blue-50 p-3">
                <div className="text-xs text-blue-700 mb-1">摘要</div>
                <div className="text-sm text-gray-800">{summary}</div>
            </div>
            {sections.map((section) => (
                <div key={section.key} className="rounded border border-gray-200 p-3">
                    <div className="text-sm font-semibold text-gray-800 mb-1">{section.title}</div>
                    <div className="text-xs text-gray-600 leading-5">{section.content}</div>
                </div>
            ))}
        </div>
    );
}

/* ================================================================ */
/*  档案 View                                                        */
/* ================================================================ */

function ArchiveView({
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
                    <div key={record.id} className="rounded border border-gray-200 p-3">
                        <div>
                            <div className="text-sm font-medium text-gray-800">{record.title}</div>
                            <div className="text-[10px] text-gray-500 mt-1">
                                {new Date(record.updatedAt).toLocaleString()}
                            </div>
                        </div>
                        <div className="flex gap-1 mt-2">
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
/*  基本 View                                                        */
/* ================================================================ */

function JiBenView({ result }: { result: BaziResult }) {
    return (
        <div className="p-3 space-y-3">
            <div className="text-center text-sm text-gray-600 bg-yellow-50 p-2 rounded">
                【点击六柱干支可看提示】
            </div>
            {/* Simple four pillar display */}
            <div className="grid grid-cols-4 gap-2">
                {[
                    { label: '时柱', pillar: result.hourPillar, ss: result.shiShen.hourGan },
                    { label: '日柱', pillar: result.dayPillar, ss: '日主' },
                    { label: '月柱', pillar: result.monthPillar, ss: result.shiShen.monthGan },
                    { label: '年柱', pillar: result.yearPillar, ss: result.shiShen.yearGan },
                ].map(({ label, pillar, ss }) => (
                    <div key={label} className="text-center border rounded p-2 bg-gray-50">
                        <div className="text-[10px] text-gray-500">{label}</div>
                        <div className="text-[10px] text-gray-400">{ss}</div>
                        <div className="text-2xl font-bold my-1" style={{ color: getGanColor(pillar.gan) }}>
                            {pillar.gan}
                        </div>
                        <div className="text-2xl font-bold" style={{ color: getZhiColor(pillar.zhi) }}>
                            {pillar.zhi}
                        </div>
                        <div className="text-[9px] text-gray-400 mt-1">{pillar.nayin}</div>
                    </div>
                ))}
            </div>
            {/* Wuxing count */}
            <div className="bg-gray-50 rounded p-2">
                <div className="text-xs font-medium text-gray-600 mb-1">五行统计</div>
                <div className="flex gap-2">
                    {Object.entries(result.wuxingCount).map(([wx, count]) => (
                        <div key={wx} className="flex items-center gap-1">
                            <span className="text-sm font-bold" style={{ color: WUXING_COLORS[wx] }}>{wx}</span>
                            <span className="text-xs text-gray-600">{count}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/* ================================================================ */
/*  命盘 View                                                        */
/* ================================================================ */

function MingPanView({ result }: { result: BaziResult }) {
    const pillars = [
        { label: '时柱', pillar: result.hourPillar, ss: result.shiShen.hourGan },
        { label: '日柱', pillar: result.dayPillar, ss: '日主' },
        { label: '月柱', pillar: result.monthPillar, ss: result.shiShen.monthGan },
        { label: '年柱', pillar: result.yearPillar, ss: result.shiShen.yearGan },
    ];

    return (
        <div className="p-2">
            <table className="w-full border-collapse text-center text-xs">
                <thead>
                    <tr className="bg-gray-50">
                        <th className="border border-gray-200 p-1 text-gray-500 w-12">日期</th>
                        {pillars.map(p => (
                            <th key={p.label} className="border border-gray-200 p-1 text-gray-600">{p.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {/* ShiShen row */}
                    <tr>
                        <td className="border border-gray-200 p-1 text-gray-400 text-[10px]">十神</td>
                        {pillars.map(p => (
                            <td key={p.label} className="border border-gray-200 p-0.5 text-[10px] text-gray-600">
                                {p.ss}
                            </td>
                        ))}
                    </tr>
                    {/* TianGan row */}
                    <tr>
                        <td className="border border-gray-200 p-1 text-gray-400 text-[10px]">天干</td>
                        {pillars.map(p => (
                            <td key={p.label} className="border border-gray-200 p-1">
                                <span className="text-2xl font-bold" style={{ color: getGanColor(p.pillar.gan) }}>
                                    {p.pillar.gan}
                                </span>
                            </td>
                        ))}
                    </tr>
                    {/* DiZhi row */}
                    <tr>
                        <td className="border border-gray-200 p-1 text-gray-400 text-[10px]">地支</td>
                        {pillars.map(p => (
                            <td key={p.label} className="border border-gray-200 p-1">
                                <span className="text-2xl font-bold" style={{ color: getZhiColor(p.pillar.zhi) }}>
                                    {p.pillar.zhi}
                                </span>
                            </td>
                        ))}
                    </tr>
                    {/* CangGan row */}
                    <tr>
                        <td className="border border-gray-200 p-1 text-gray-400 text-[10px]">藏干</td>
                        {pillars.map(p => (
                            <td key={p.label} className="border border-gray-200 p-0.5 text-[10px]">
                                {p.pillar.cangGan.map((g, i) => (
                                    <span key={i} className="mr-0.5" style={{ color: getGanColor(g) }}>{g}</span>
                                ))}
                            </td>
                        ))}
                    </tr>
                    {/* NaYin row */}
                    <tr>
                        <td className="border border-gray-200 p-1 text-gray-400 text-[10px]">纳音</td>
                        {pillars.map(p => (
                            <td key={p.label} className="border border-gray-200 p-0.5 text-[10px] text-gray-600">
                                {p.pillar.nayin}
                            </td>
                        ))}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

/* ================================================================ */
/*  细盘 View (main professional view)                               */
/* ================================================================ */

function XiPanView({ result }: { result: BaziResult }) {
    // Find current dayun for display
    const currentYear = new Date().getFullYear();
    const age = currentYear - result.birthYear;
    const currentDayun = result.dayun.find(d => age >= d.startAge && age <= d.endAge);
    // Find current liunian
    const currentLiunian = result.liunian.find(l => l.year === currentYear);

    const headerColumns = [
        { label: '日期', sub: '' },
        { label: '时柱', sub: '' },
        { label: '日柱', sub: '' },
        { label: '月柱', sub: '' },
        { label: '年柱', sub: '' },
        { label: '大运', sub: currentDayun ? `${age}岁` : '' },
        { label: '流年', sub: currentLiunian ? String(currentLiunian.year) : '' },
    ];

    const pillars = [result.hourPillar, result.dayPillar, result.monthPillar, result.yearPillar];
    const shiShenLabels = [result.shiShen.hourGan, '日主', result.shiShen.monthGan, result.shiShen.yearGan];

    // Dayun and liunian GanZhi
    const dayunGanColor = currentDayun ? getGanColor(currentDayun.gan) : '#374151';
    const dayunZhiColor = currentDayun ? getZhiColor(currentDayun.zhi) : '#374151';
    const liunianGanColor = currentLiunian ? getGanColor(currentLiunian.gan) : '#374151';
    const liunianZhiColor = currentLiunian ? getZhiColor(currentLiunian.zhi) : '#374151';

    return (
        <div className="text-xs">
            {/* Info hint */}
            <div className="text-center text-[11px] text-gray-500 py-1 bg-yellow-50 border-b border-gray-100">
                【未起大运显示小运,十步大运要打开设置】
            </div>

            {/* Main table */}
            <table className="w-full border-collapse">
                {/* Header: 日期 | 时柱 | 日柱 | 月柱 | 年柱 | 大运 | 流年 */}
                <thead>
                    <tr className="bg-gray-50">
                        {headerColumns.map(col => (
                            <th key={col.label} className="border border-gray-200 px-1 py-1 text-[10px] text-gray-600 font-medium">
                                {col.label}
                            </th>
                        ))}
                    </tr>
                    {/* Age/year sub-header */}
                    <tr className="bg-white">
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-gray-400 text-center">岁</td>
                        <td colSpan={4} className="border border-gray-200 px-1 py-0.5 text-[9px] text-center text-gray-500">
                            【点击六柱干支可看提示】
                        </td>
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-center font-medium text-green-600">
                            {currentDayun ? `${currentDayun.startAge}岁` : ''}
                        </td>
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-center font-medium text-green-600">
                            {currentDayun ? `${currentDayun.startAge + 2}岁` : ''}
                        </td>
                    </tr>
                    <tr className="bg-white">
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-gray-400 text-center">年</td>
                        <td colSpan={4} className="border border-gray-200"></td>
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-center text-green-600">
                            {currentDayun ? currentDayun.startYear : ''}
                        </td>
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-center text-green-600">
                            {currentLiunian ? currentLiunian.year : ''}
                        </td>
                    </tr>
                </thead>
                <tbody>
                    {/* ShiShen row for TianGan */}
                    <tr>
                        <td className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-400"></td>
                        {shiShenLabels.map((ss, i) => (
                            <td key={i} className="border border-gray-200 p-0.5 text-center">
                                <span className="text-[9px] text-gray-500">{SHISHEN_SHORT[ss] || ss}</span>
                            </td>
                        ))}
                        <td className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-500">
                            {currentDayun ? (SHISHEN_SHORT[getShiShen(result.dayGan, currentDayun.gan)] || '') : ''}
                        </td>
                        <td className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-500">
                            {currentLiunian ? (SHISHEN_SHORT[getShiShen(result.dayGan, currentLiunian.gan)] || '') : ''}
                        </td>
                    </tr>
                    {/* TianGan row */}
                    <tr>
                        <td className="border border-gray-200 p-1 text-center text-[10px] text-gray-400">天干</td>
                        {pillars.map((p, i) => (
                            <td key={i} className="border border-gray-200 p-1 text-center">
                                <span className="text-xl font-bold" style={{ color: getGanColor(p.gan) }}>
                                    {p.gan}
                                </span>
                                {i === 1 && (
                                    <sup className="text-[8px] ml-0.5 text-gray-400">
                                        {result.gender === '男' ? '♂' : '♀'}{result.dayPillar.ganYinyang}
                                    </sup>
                                )}
                            </td>
                        ))}
                        <td className="border border-gray-200 p-1 text-center">
                            {currentDayun && (
                                <span className="text-xl font-bold" style={{ color: dayunGanColor }}>
                                    {currentDayun.gan}
                                </span>
                            )}
                        </td>
                        <td className="border border-gray-200 p-1 text-center">
                            {currentLiunian && (
                                <span className="text-xl font-bold" style={{ color: liunianGanColor }}>
                                    {currentLiunian.gan}
                                </span>
                            )}
                        </td>
                    </tr>
                    {/* DiZhi ShiShen row */}
                    <tr>
                        <td className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-400"></td>
                        {pillars.map((p, i) => {
                            const mainCangGan = ZHI_CANG_GAN[p.zhi][0];
                            const ss = i === 1 ? '' : getShiShen(result.dayGan, mainCangGan);
                            return (
                                <td key={i} className="border border-gray-200 p-0.5 text-center">
                                    <span className="text-[9px] text-gray-500">{SHISHEN_SHORT[ss] || ''}</span>
                                </td>
                            );
                        })}
                        <td className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-500">
                            {currentDayun ? (SHISHEN_SHORT[getShiShen(result.dayGan, ZHI_CANG_GAN[currentDayun.zhi][0])] || '') : ''}
                        </td>
                        <td className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-500">
                            {currentLiunian ? (SHISHEN_SHORT[getShiShen(result.dayGan, ZHI_CANG_GAN[currentLiunian.zhi][0])] || '') : ''}
                        </td>
                    </tr>
                    {/* DiZhi row */}
                    <tr>
                        <td className="border border-gray-200 p-1 text-center text-[10px] text-gray-400">地支</td>
                        {pillars.map((p, i) => (
                            <td key={i} className="border border-gray-200 p-1 text-center">
                                <span className="text-xl font-bold" style={{ color: getZhiColor(p.zhi) }}>
                                    {p.zhi}
                                </span>
                            </td>
                        ))}
                        <td className="border border-gray-200 p-1 text-center">
                            {currentDayun && (
                                <span className="text-xl font-bold" style={{ color: dayunZhiColor }}>
                                    {currentDayun.zhi}
                                </span>
                            )}
                        </td>
                        <td className="border border-gray-200 p-1 text-center">
                            {currentLiunian && (
                                <span className="text-xl font-bold" style={{ color: liunianZhiColor }}>
                                    {currentLiunian.zhi}
                                </span>
                            )}
                        </td>
                    </tr>
                    {/* 流月天干 row */}
                    <tr>
                        <td className="border border-gray-200 p-0.5 text-center text-[8px] text-gray-400">流月天</td>
                        {pillars.map((p, i) => (
                            <td key={i} className="border border-gray-200 p-0.5 text-center">
                                <div className="flex flex-wrap justify-center gap-0.5">
                                    {p.cangGan.map((g, j) => (
                                        <span key={j} className="text-[8px]" style={{ color: getGanColor(g) }}>
                                            {SHISHEN_SHORT[getShiShen(result.dayGan, g)] || ''}
                                        </span>
                                    ))}
                                </div>
                            </td>
                        ))}
                        <td className="border border-gray-200"></td>
                        <td className="border border-gray-200"></td>
                    </tr>
                    {/* 流月地支 row */}
                    <tr>
                        <td className="border border-gray-200 p-0.5 text-center text-[8px] text-gray-400">流月支</td>
                        {pillars.map((p, i) => (
                            <td key={i} className="border border-gray-200 p-0.5 text-center">
                                <div className="flex flex-wrap justify-center gap-0.5">
                                    {p.cangGan.map((g, j) => (
                                        <span key={j} className="text-[8px]" style={{ color: getGanColor(g) }}>{g}</span>
                                    ))}
                                </div>
                            </td>
                        ))}
                        <td className="border border-gray-200"></td>
                        <td className="border border-gray-200"></td>
                    </tr>
                    {/* 星运 row */}
                    <tr>
                        <td className="border border-gray-200 p-0.5 text-center text-[8px] text-gray-400">星运</td>
                        {pillars.map((p, i) => (
                            <td key={i} className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-600">
                                {[result.xingYun.hour, result.xingYun.day, result.xingYun.month, result.xingYun.year][i]}
                            </td>
                        ))}
                        <td className="border border-gray-200"></td>
                        <td className="border border-gray-200"></td>
                    </tr>
                    {/* 自坐 row */}
                    <tr>
                        <td className="border border-gray-200 p-0.5 text-center text-[8px] text-gray-400">自坐</td>
                        {pillars.map((p, i) => (
                            <td key={i} className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-600">
                                {[result.xingYun.hour, result.xingYun.day, result.xingYun.month, result.xingYun.year][i]}
                            </td>
                        ))}
                        <td className="border border-gray-200"></td>
                        <td className="border border-gray-200"></td>
                    </tr>
                    {/* 空亡 row */}
                    <tr>
                        <td className="border border-gray-200 p-0.5 text-center text-[8px] text-gray-400">空亡</td>
                        {pillars.map((_p, i) => (
                            <td key={i} className="border border-gray-200 p-0.5 text-center text-[9px] text-gray-500">
                                {i < 2 ? `${result.kongWang.day[0]}${result.kongWang.day[1]}` : `${result.kongWang.year[0]}${result.kongWang.year[1]}`}
                            </td>
                        ))}
                        <td className="border border-gray-200"></td>
                        <td className="border border-gray-200"></td>
                    </tr>
                </tbody>
            </table>

            {/* DaYun info */}
            <div className="text-center text-[10px] text-gray-500 py-1 bg-gray-50 border-b border-gray-200">
                出生後{result.dayunStartAge}年{result.dayunStartAge < 5 ? Math.floor(result.dayunStartAge * 12) : ''}月開始行大運,每交大運年{
                    result.dayPillar.ganYinyang === '阳' ? '12' : '1'
                }月起運(西曆)
            </div>

            {/* DaYun timeline */}
            <DayunTimeline result={result} />

            {/* LiuNian row */}
            <LiunianRow result={result} />

            {/* WuXing Strength bar */}
            <WuxingStrengthBar result={result} />

            {/* Hint panel */}
            <div className="text-center py-2 border-t border-gray-200">
                <button className="text-[11px] text-blue-600 px-3 py-1 border border-blue-300 rounded">
                    【细盘六柱提示】
                </button>
            </div>
        </div>
    );
}

/* ================================================================ */
/*  大运 Timeline                                                    */
/* ================================================================ */

function DayunTimeline({ result }: { result: BaziResult }) {
    const currentYear = new Date().getFullYear();
    const age = currentYear - result.birthYear;

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[480px]">
                <tbody>
                    {/* DaYun age header */}
                    <tr className="bg-gray-50">
                        <td className="border border-gray-200 px-1 py-0.5 text-[8px] text-gray-400 text-center w-8"></td>
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-center text-gray-500">
                            1-{result.dayunStartAge}
                        </td>
                        {result.dayun.map((d, i) => {
                            const isActive = age >= d.startAge && age <= d.endAge;
                            return (
                                <td key={i} className={`border border-gray-200 px-0.5 py-0.5 text-[9px] text-center ${isActive ? 'bg-green-50 font-bold text-green-700' : 'text-gray-600'
                                    }`}>
                                    {d.startAge}岁
                                </td>
                            );
                        })}
                    </tr>
                    {/* DaYun year row */}
                    <tr>
                        <td className="border border-gray-200 px-1 py-0.5 text-[8px] text-gray-400 text-center"></td>
                        <td className="border border-gray-200 px-1 py-0.5 text-[9px] text-center text-gray-400">
                            {result.birthYear}
                        </td>
                        {result.dayun.map((d, i) => {
                            const isActive = age >= d.startAge && age <= d.endAge;
                            return (
                                <td key={i} className={`border border-gray-200 px-0.5 py-0.5 text-[9px] text-center ${isActive ? 'bg-green-50 font-bold text-green-700' : 'text-gray-500'
                                    }`}>
                                    {d.startYear}
                                </td>
                            );
                        })}
                    </tr>
                    {/* DaYun GanZhi row */}
                    <tr>
                        <td className="border border-gray-200 px-1 py-0.5 text-[8px] text-gray-400 text-center">大運</td>
                        <td className="border border-gray-200 px-1 py-0.5 text-center text-[9px] text-gray-400">
                            小
                        </td>
                        {result.dayun.map((d, i) => {
                            const isActive = age >= d.startAge && age <= d.endAge;
                            return (
                                <td key={i} className={`border border-gray-200 px-0.5 py-1 text-center ${isActive ? 'bg-green-50' : ''
                                    }`}>
                                    <span className="text-sm font-bold" style={{ color: getGanColor(d.gan) }}>{d.gan}</span>
                                    <span className="text-sm font-bold" style={{ color: getZhiColor(d.zhi) }}>{d.zhi}</span>
                                </td>
                            );
                        })}
                    </tr>
                </tbody>
            </table>

            {/* Clickable hint */}
            <div className="text-center text-[10px] text-blue-500 py-1 bg-blue-50 border-b border-gray-200">
                【點擊大運和流年的干支可切換到上面】
            </div>
        </div>
    );
}

/* ================================================================ */
/*  流年 Row                                                         */
/* ================================================================ */

function LiunianRow({ result }: { result: BaziResult }) {
    const currentYear = new Date().getFullYear();

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[480px]">
                <tbody>
                    {/* Year header */}
                    <tr className="bg-gray-50">
                        <td className="border border-gray-200 px-1 py-0.5 text-[8px] text-gray-400 text-center w-8">流年</td>
                        {result.liunian.map((l, i) => {
                            const isActive = l.year === currentYear;
                            return (
                                <td key={i} className={`border border-gray-200 px-0.5 py-0.5 text-[9px] text-center ${isActive ? 'bg-red-50 font-bold text-red-600' : 'text-gray-500'
                                    }`}>
                                    {l.year}
                                </td>
                            );
                        })}
                    </tr>
                    {/* GanZhi row */}
                    <tr>
                        <td className="border border-gray-200 px-1 py-0.5 text-[8px] text-gray-400 text-center">流年</td>
                        {result.liunian.map((l, i) => {
                            const isActive = l.year === currentYear;
                            return (
                                <td key={i} className={`border border-gray-200 px-0.5 py-1 text-center ${isActive ? 'bg-red-50' : ''
                                    }`}>
                                    <span className="text-[10px] font-bold" style={{ color: getGanColor(l.gan) }}>{l.gan}</span>
                                    <sup className="text-[7px] text-gray-400">
                                        {SHISHEN_SHORT[getShiShen(result.dayGan, l.gan)] || ''}
                                    </sup>
                                    <br />
                                    <span className="text-[10px] font-bold" style={{ color: getZhiColor(l.zhi) }}>{l.zhi}</span>
                                </td>
                            );
                        })}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

/* ================================================================ */
/*  五行旺衰 Bar                                                     */
/* ================================================================ */

function WuxingStrengthBar({ result }: { result: BaziResult }) {
    const WUXING_ORDER = ['水', '木', '金', '土', '火'] as const;

    return (
        <div className="flex border-t border-gray-200">
            {WUXING_ORDER.map(wx => {
                const level: WuxingStrengthLevel = result.wuxingStrength[wx] || '休';
                const color = WUXING_STRENGTH_COLORS[level];
                const bgColor = WUXING_COLORS[wx];
                return (
                    <div key={wx} className="flex-1 flex items-center justify-center gap-0.5 py-2"
                        style={{ backgroundColor: `${bgColor}15` }}>
                        <span className="text-sm font-bold" style={{ color: bgColor }}>{wx}</span>
                        <span className="text-sm font-bold" style={{ color }}>{level}</span>
                    </div>
                );
            })}
        </div>
    );
}

/* ================================================================ */
/*  大运 Detail View                                                 */
/* ================================================================ */

function DaYunView({
    result,
    activeDayunIdx,
    setActiveDayunIdx,
}: {
    result: BaziResult;
    activeDayunIdx: number;
    setActiveDayunIdx: (idx: number) => void;
}) {
    const currentYear = new Date().getFullYear();
    const age = currentYear - result.birthYear;
    const activeDayun = result.dayun[activeDayunIdx];

    return (
        <div className="p-3 space-y-3">
            {/* DaYun selector */}
            <div className="flex gap-1 overflow-x-auto pb-1">
                {result.dayun.map((d, i) => {
                    const isActive = i === activeDayunIdx;
                    const isCurrent = age >= d.startAge && age <= d.endAge;
                    return (
                        <button
                            key={i}
                            onClick={() => setActiveDayunIdx(i)}
                            className={`shrink-0 px-2 py-1.5 rounded text-xs border transition-colors ${isActive
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : isCurrent
                                        ? 'bg-green-50 text-green-700 border-green-300'
                                        : 'bg-gray-50 text-gray-600 border-gray-200'
                                }`}
                        >
                            <div className="font-bold">
                                <span style={{ color: isActive ? 'white' : getGanColor(d.gan) }}>{d.gan}</span>
                                <span style={{ color: isActive ? 'white' : getZhiColor(d.zhi) }}>{d.zhi}</span>
                            </div>
                            <div className="text-[9px] opacity-70">{d.startAge}-{d.endAge}岁</div>
                        </button>
                    );
                })}
            </div>

            {/* Active DaYun detail */}
            {activeDayun && (
                <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-800">
                            第{activeDayunIdx + 1}步大运
                        </span>
                        <span className="text-xs text-gray-500">
                            {activeDayun.startYear}-{activeDayun.startYear + 9}年
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-center">
                            <div className="text-3xl font-bold" style={{ color: getGanColor(activeDayun.gan) }}>
                                {activeDayun.gan}
                            </div>
                            <div className="text-[10px] text-gray-500">{activeDayun.ganWuxing}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-3xl font-bold" style={{ color: getZhiColor(activeDayun.zhi) }}>
                                {activeDayun.zhi}
                            </div>
                            <div className="text-[10px] text-gray-500">{activeDayun.zhiWuxing}</div>
                        </div>
                        <div className="flex-1 text-xs text-gray-600 space-y-1">
                            <div>十神 (天干): {getShiShen(result.dayGan, activeDayun.gan)}</div>
                            <div>十神 (地支): {getShiShen(result.dayGan, ZHI_CANG_GAN[activeDayun.zhi][0])}</div>
                            <div>年龄: {activeDayun.startAge}~{activeDayun.endAge}岁</div>
                        </div>
                    </div>

                    {/* 10-year LiuNian within this DaYun */}
                    <div className="border-t pt-2 mt-2">
                        <div className="text-[10px] text-gray-500 mb-1">此步大运流年</div>
                        <div className="grid grid-cols-5 gap-1">
                            {Array.from({ length: 10 }, (_, i) => {
                                const y = activeDayun.startYear + i;
                                const ganIdx = ((y - 4) % 10 + 10) % 10;
                                const zhiIdx = ((y - 4) % 12 + 12) % 12;
                                const gan = (['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const)[ganIdx];
                                const zhi = (['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const)[zhiIdx];
                                const isCurrent = y === currentYear;
                                return (
                                    <div key={i} className={`text-center p-1 rounded border ${isCurrent ? 'bg-red-50 border-red-300' : 'border-gray-200'
                                        }`}>
                                        <div className="text-[9px] text-gray-400">{y}</div>
                                        <div className="text-xs font-bold">
                                            <span style={{ color: getGanColor(gan) }}>{gan}</span>
                                            <span style={{ color: getZhiColor(zhi) }}>{zhi}</span>
                                        </div>
                                        <div className="text-[8px] text-gray-400">
                                            {activeDayun.startAge + i}岁
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
