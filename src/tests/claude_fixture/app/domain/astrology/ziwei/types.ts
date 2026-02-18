import type { AstrologyRuleProfile, BirthInput } from '../types';

export const GONG_NAMES = [
    '命宫', '兄弟宫', '夫妻宫', '子女宫', '财帛宫', '疾厄宫',
    '迁移宫', '仆役宫', '官禄宫', '田宅宫', '福德宫', '父母宫',
] as const;
export type GongName = typeof GONG_NAMES[number];

export const SI_HUA = ['化禄', '化权', '化科', '化忌'] as const;
export type SiHua = typeof SI_HUA[number];

export type StarBrightness = '庙' | '旺' | '得' | '利' | '平' | '不' | '陷';

export interface StarInfo {
    name: string;
    brightness: StarBrightness | null;
    siHua: string | null;
}

export interface GongInfo {
    name: GongName;
    dizhi: string;
    tiangan: string;
    mainStars: StarInfo[];
    auxStars: StarInfo[];
    siHua: string[];
    daxianStart: number;
    daxianEnd: number;
    liunianYear: number;
    liunianAges: number[];
    xiaoxianAges: number[];
    gridRow: number;
    gridCol: number;
}

export interface ZiweiChartResult {
    gongs: GongInfo[];
    mingGongIdx: number;
    shenGongIdx: number;
    wuxingJu: string;
    juNumber: number;
    yearGanZhi: string;
    mingZhu: string;
    shenZhu: string;
    input: BirthInput;
    profile: AstrologyRuleProfile;
}
