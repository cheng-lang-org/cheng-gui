import { calculateBaziChart, formatBaziChart } from '../domain/astrology/bazi/engine';
import {
    DI_ZHI,
    TIAN_GAN,
    type BaziChartResult,
    type DayunPeriod,
    type DiZhi,
    type LiunianInfo,
    type Pillar,
    type TianGan,
    type WuxingStrengthLevel,
} from '../domain/astrology/bazi/types';
import {
    GAN_WUXING,
    ZHI_WUXING,
    GAN_YINYANG,
    ZHI_YINYANG,
    ZHI_CANG_GAN,
    SHICHEN_LABELS,
    SHISHEN_SHORT,
    WUXING_COLORS,
    WUXING_STRENGTH_COLORS,
    getGanColor,
    getShiShen,
    getWuxingColor,
    getZhiColor,
} from '../domain/astrology/bazi/constants';
import type { AstrologyRuleProfile, BirthInput, Gender } from '../domain/astrology/types';

export {
    TIAN_GAN,
    DI_ZHI,
    GAN_WUXING,
    ZHI_WUXING,
    GAN_YINYANG,
    ZHI_YINYANG,
    ZHI_CANG_GAN,
    SHICHEN_LABELS,
    SHISHEN_SHORT,
    WUXING_COLORS,
    WUXING_STRENGTH_COLORS,
    getShiShen,
    getWuxingColor,
    getGanColor,
    getZhiColor,
};

export type { TianGan, DiZhi, Pillar, DayunPeriod, LiunianInfo, WuxingStrengthLevel };

export type BaziResult = BaziChartResult;

export interface BaziCalculateOptions {
    minute?: number;
    timezone?: string;
    longitude?: number;
    profile?: Partial<AstrologyRuleProfile>;
}

export function hourToShichen(hour: number): number {
    return Math.floor(((hour + 1) % 24) / 2);
}

export function calculateBazi(
    year: number,
    month: number,
    day: number,
    hour: number,
    gender: Gender = '男',
    options?: BaziCalculateOptions,
): BaziResult {
    const input: BirthInput = {
        calendar: 'solar',
        year,
        month,
        day,
        hour,
        minute: options?.minute ?? 0,
        timezone: options?.timezone ?? 'Asia/Shanghai',
        longitude: options?.longitude,
        gender,
    };

    const mergedProfile: Partial<AstrologyRuleProfile> = {
        ...(options?.profile || {}),
    };

    return calculateBaziChart(input, mergedProfile);
}

export function formatBazi(result: BaziResult): string {
    return formatBaziChart(result);
}
