import type { AstrologyRuleProfile, BirthInput } from '../types';
import { mergeProfile } from '../profile';
import { toSolarFromInput } from '../common/time';
import {
    DI_ZHI,
    TIAN_GAN,
    type BaziChartResult,
    type DayunPeriod,
    type DiZhi,
    type LiunianInfo,
    type Pillar,
    type TianGan,
} from './types';
import {
    GAN_WUXING,
    ZHI_WUXING,
    GAN_YINYANG,
    ZHI_YINYANG,
    ZHI_CANG_GAN,
    getShiShen,
    getWuxingStrength,
} from './constants';

function splitGanZhi(ganZhi: string): { gan: TianGan; zhi: DiZhi } {
    const gan = ganZhi.charAt(0) as TianGan;
    const zhi = ganZhi.charAt(1) as DiZhi;
    return { gan, zhi };
}

function toPillar(ganZhi: string, naYin: string): Pillar {
    const { gan, zhi } = splitGanZhi(ganZhi);
    return {
        gan,
        zhi,
        ganWuxing: GAN_WUXING[gan],
        zhiWuxing: ZHI_WUXING[zhi],
        ganYinyang: GAN_YINYANG[gan],
        zhiYinyang: ZHI_YINYANG[zhi],
        cangGan: ZHI_CANG_GAN[zhi],
        nayin: naYin,
        ganIdx: TIAN_GAN.indexOf(gan),
        zhiIdx: DI_ZHI.indexOf(zhi),
    };
}

function parseXunKong(value: string): [DiZhi, DiZhi] {
    if (!value || value.length < 2) return ['子', '丑'];
    const first = value.charAt(0) as DiZhi;
    const second = value.charAt(1) as DiZhi;
    return [first, second];
}

function normalizeShiShenZhi(value: string[] | string): string {
    if (Array.isArray(value)) {
        return value[0] || '未知';
    }
    return value || '未知';
}

function calculateDayMasterStrength(pillars: Pillar[], dayGan: TianGan): '强' | '弱' | '中和' {
    const myWx = GAN_WUXING[dayGan];
    let supportCount = 0;
    let total = 0;
    for (const p of pillars) {
        for (const wx of [p.ganWuxing, p.zhiWuxing]) {
            total += 1;
            if (wx === myWx) {
                supportCount += 1;
            }
            // 生我也算助力
            if ((wx === '木' && myWx === '火')
                || (wx === '火' && myWx === '土')
                || (wx === '土' && myWx === '金')
                || (wx === '金' && myWx === '水')
                || (wx === '水' && myWx === '木')) {
                supportCount += 1;
            }
        }
    }
    const ratio = supportCount / Math.max(total, 1);
    if (ratio >= 0.6) return '强';
    if (ratio <= 0.35) return '弱';
    return '中和';
}

function toDayunPeriods(daYunObjects: Array<{ getGanZhi: () => string; getStartAge: () => number; getEndAge: () => number; getStartYear: () => number }>): DayunPeriod[] {
    const result: DayunPeriod[] = [];
    for (const item of daYunObjects) {
        const ganZhi = item.getGanZhi();
        if (!ganZhi || ganZhi.length < 2) continue;
        const { gan, zhi } = splitGanZhi(ganZhi);
        result.push({
            startAge: item.getStartAge(),
            endAge: item.getEndAge(),
            startYear: item.getStartYear(),
            gan,
            zhi,
            ganWuxing: GAN_WUXING[gan],
            zhiWuxing: ZHI_WUXING[zhi],
        });
    }
    return result;
}

function toLiunian(startYear: number, count: number): LiunianInfo[] {
    const result: LiunianInfo[] = [];
    for (let i = 0; i < count; i++) {
        const year = startYear + i;
        const gan = TIAN_GAN[((year - 4) % 10 + 10) % 10];
        const zhi = DI_ZHI[((year - 4) % 12 + 12) % 12];
        result.push({ year, gan, zhi });
    }
    return result;
}

export function calculateBaziChart(
    input: BirthInput,
    partialProfile?: Partial<AstrologyRuleProfile>,
): BaziChartResult {
    const profile = mergeProfile(partialProfile);
    const solar = toSolarFromInput(input, profile.useTrueSolarTime);
    const lunar = solar.getLunar();
    const ec = lunar.getEightChar();
    ec.setSect(profile.lateZiBoundary === '23:00' ? 1 : 2);

    const yearPillar = toPillar(ec.getYear(), ec.getYearNaYin());
    const monthPillar = toPillar(ec.getMonth(), ec.getMonthNaYin());
    const dayPillar = toPillar(ec.getDay(), ec.getDayNaYin());
    const hourPillar = toPillar(ec.getTime(), ec.getTimeNaYin());

    const dayGan = dayPillar.gan;
    const pillars = [yearPillar, monthPillar, dayPillar, hourPillar];

    const wuxingCount: Record<string, number> = { '木': 0, '火': 0, '土': 0, '金': 0, '水': 0 };
    for (const p of pillars) {
        wuxingCount[p.ganWuxing] += 1;
        wuxingCount[p.zhiWuxing] += 1;
    }

    const shiShen = {
        yearGan: ec.getYearShiShenGan(),
        monthGan: ec.getMonthShiShenGan(),
        hourGan: ec.getTimeShiShenGan(),
        yearZhi: normalizeShiShenZhi(ec.getYearShiShenZhi()),
        monthZhi: normalizeShiShenZhi(ec.getMonthShiShenZhi()),
        hourZhi: normalizeShiShenZhi(ec.getTimeShiShenZhi()),
    };

    const shiShenZhi = {
        yearZhi: normalizeShiShenZhi(ec.getYearShiShenZhi()),
        monthZhi: normalizeShiShenZhi(ec.getMonthShiShenZhi()),
        dayZhi: normalizeShiShenZhi(ec.getDayShiShenZhi()),
        hourZhi: normalizeShiShenZhi(ec.getTimeShiShenZhi()),
    };

    const dayMasterStrength = calculateDayMasterStrength(pillars, dayGan);

    const napilar = {
        year: ec.getYearNaYin(),
        month: ec.getMonthNaYin(),
        day: ec.getDayNaYin(),
        hour: ec.getTimeNaYin(),
    };

    const yun = ec.getYun(input.gender === '男' ? 1 : 0, 2);
    const dayun = toDayunPeriods(yun.getDaYun(12));
    const dayunStartAge = dayun[0]?.startAge || Math.max(1, yun.getStartYear());

    const currentYear = new Date().getFullYear();
    const liunian = toLiunian(currentYear - 1, 12);

    const xingYun = {
        year: ec.getYearDiShi(),
        month: ec.getMonthDiShi(),
        day: ec.getDayDiShi(),
        hour: ec.getTimeDiShi(),
    };

    const kongWang = {
        day: parseXunKong(ec.getDayXunKong()),
        year: parseXunKong(ec.getYearXunKong()),
    };

    const wuxingStrength = getWuxingStrength(monthPillar.zhi);

    return {
        yearPillar,
        monthPillar,
        dayPillar,
        hourPillar,
        dayGan,
        wuxingCount,
        shiShen,
        dayMasterStrength,
        gender: input.gender,
        napilar,
        dayun,
        dayunStartAge,
        liunian,
        xingYun,
        kongWang,
        wuxingStrength,
        birthYear: solar.getYear(),
        shiShenZhi,
        input,
        profile,
    };
}

export function formatBaziChart(result: BaziChartResult): string {
    return [result.yearPillar, result.monthPillar, result.dayPillar, result.hourPillar]
        .map((p) => `${p.gan}${p.zhi}`)
        .join(' ');
}

export function getShiShenByGan(dayGan: TianGan, otherGan: TianGan): string {
    return getShiShen(dayGan, otherGan);
}
