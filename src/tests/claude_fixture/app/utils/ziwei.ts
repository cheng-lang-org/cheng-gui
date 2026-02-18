import { calculateZiweiChart } from '../domain/astrology/ziwei/engine';
import {
    GONG_NAMES,
    SI_HUA,
    type GongInfo,
    type GongName,
    type SiHua,
    type StarBrightness,
    type StarInfo,
    type ZiweiChartResult,
} from '../domain/astrology/ziwei/types';
import { BRIGHTNESS_COLORS, DIRECTION_LABELS, STAR_BRIGHTNESS_TABLE } from '../domain/astrology/ziwei/constants';
import type { AstrologyRuleProfile, BirthInput, CalendarType, Gender } from '../domain/astrology/types';

export {
    GONG_NAMES,
    SI_HUA,
    BRIGHTNESS_COLORS,
    DIRECTION_LABELS,
};

export type {
    GongInfo,
    GongName,
    SiHua,
    StarBrightness,
    StarInfo,
};

export type ZiweiResult = ZiweiChartResult;

export interface ZiweiCalculateOptions {
    calendar?: CalendarType;
    minute?: number;
    timezone?: string;
    longitude?: number;
    profile?: Partial<AstrologyRuleProfile>;
}

function shichenToHour(shichen: number): number {
    const idx = ((Math.floor(shichen) % 12) + 12) % 12;
    if (idx === 0) return 23;
    return idx * 2 - 1;
}

export function getStarBrightness(starName: string, dizhi: string): StarBrightness | null {
    const table = STAR_BRIGHTNESS_TABLE[starName];
    if (!table) return null;
    const DI_ZHI_12 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    const idx = DI_ZHI_12.indexOf(dizhi);
    if (idx < 0) return null;
    return table[idx] || null;
}

export function calculateZiwei(
    year: number,
    month: number,
    day: number,
    shichen: number,
    gender: Gender,
    options?: ZiweiCalculateOptions,
): ZiweiResult {
    const input: BirthInput = {
        calendar: options?.calendar ?? 'lunar',
        year,
        month,
        day,
        hour: shichenToHour(shichen),
        minute: options?.minute ?? 0,
        timezone: options?.timezone ?? 'Asia/Shanghai',
        longitude: options?.longitude,
        gender,
    };

    return calculateZiweiChart(input, options?.profile);
}
