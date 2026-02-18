import type { AstrologyRuleProfile, BirthInput, Gender } from '../types';

export const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
export const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

export type TianGan = typeof TIAN_GAN[number];
export type DiZhi = typeof DI_ZHI[number];

export type WuxingStrengthLevel = '旺' | '相' | '休' | '囚' | '死';

export interface Pillar {
    gan: TianGan;
    zhi: DiZhi;
    ganWuxing: string;
    zhiWuxing: string;
    ganYinyang: '阳' | '阴';
    zhiYinyang: '阳' | '阴';
    cangGan: TianGan[];
    nayin: string;
    ganIdx: number;
    zhiIdx: number;
}

export interface DayunPeriod {
    startAge: number;
    endAge: number;
    startYear: number;
    gan: TianGan;
    zhi: DiZhi;
    ganWuxing: string;
    zhiWuxing: string;
}

export interface LiunianInfo {
    year: number;
    gan: TianGan;
    zhi: DiZhi;
}

export interface BaziChartResult {
    yearPillar: Pillar;
    monthPillar: Pillar;
    dayPillar: Pillar;
    hourPillar: Pillar;
    dayGan: TianGan;
    wuxingCount: Record<string, number>;
    shiShen: {
        yearGan: string;
        monthGan: string;
        hourGan: string;
        yearZhi: string;
        monthZhi: string;
        hourZhi: string;
    };
    dayMasterStrength: '强' | '弱' | '中和';
    gender: Gender;
    napilar: { year: string; month: string; day: string; hour: string };
    dayun: DayunPeriod[];
    dayunStartAge: number;
    liunian: LiunianInfo[];
    xingYun: { year: string; month: string; day: string; hour: string };
    kongWang: { day: [DiZhi, DiZhi]; year: [DiZhi, DiZhi] };
    wuxingStrength: Record<string, WuxingStrengthLevel>;
    birthYear: number;
    shiShenZhi: {
        yearZhi: string;
        monthZhi: string;
        dayZhi: string;
        hourZhi: string;
    };
    input: BirthInput;
    profile: AstrologyRuleProfile;
}
