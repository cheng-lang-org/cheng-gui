import type { DiZhi, TianGan, WuxingStrengthLevel } from './types';

export const GAN_WUXING: Record<TianGan, string> = {
    '甲': '木', '乙': '木',
    '丙': '火', '丁': '火',
    '戊': '土', '己': '土',
    '庚': '金', '辛': '金',
    '壬': '水', '癸': '水',
};

export const ZHI_WUXING: Record<DiZhi, string> = {
    '子': '水', '丑': '土', '寅': '木', '卯': '木',
    '辰': '土', '巳': '火', '午': '火', '未': '土',
    '申': '金', '酉': '金', '戌': '土', '亥': '水',
};

export const GAN_YINYANG: Record<TianGan, '阳' | '阴'> = {
    '甲': '阳', '乙': '阴', '丙': '阳', '丁': '阴', '戊': '阳',
    '己': '阴', '庚': '阳', '辛': '阴', '壬': '阳', '癸': '阴',
};

export const ZHI_YINYANG: Record<DiZhi, '阳' | '阴'> = {
    '子': '阳', '丑': '阴', '寅': '阳', '卯': '阴', '辰': '阳', '巳': '阴',
    '午': '阳', '未': '阴', '申': '阳', '酉': '阴', '戌': '阳', '亥': '阴',
};

export const ZHI_CANG_GAN: Record<DiZhi, TianGan[]> = {
    '子': ['癸'],
    '丑': ['己', '癸', '辛'],
    '寅': ['甲', '丙', '戊'],
    '卯': ['乙'],
    '辰': ['戊', '乙', '癸'],
    '巳': ['丙', '庚', '戊'],
    '午': ['丁', '己'],
    '未': ['己', '丁', '乙'],
    '申': ['庚', '壬', '戊'],
    '酉': ['辛'],
    '戌': ['戊', '辛', '丁'],
    '亥': ['壬', '甲'],
};

export const WUXING_COLORS: Record<string, string> = {
    '木': '#22c55e',
    '火': '#ef4444',
    '土': '#ca8a04',
    '金': '#6b7280',
    '水': '#3b82f6',
};

export const WUXING_STRENGTH_COLORS: Record<WuxingStrengthLevel, string> = {
    '旺': '#e53e3e',
    '相': '#38a169',
    '休': '#3182ce',
    '囚': '#d69e2e',
    '死': '#718096',
};

export const SHICHEN_LABELS = [
    '子时 (23-01)', '丑时 (01-03)', '寅时 (03-05)', '卯时 (05-07)',
    '辰时 (07-09)', '巳时 (09-11)', '午时 (11-13)', '未时 (13-15)',
    '申时 (15-17)', '酉时 (17-19)', '戌时 (19-21)', '亥时 (21-23)',
];

export const SHISHEN_SHORT: Record<string, string> = {
    '比肩': '比', '劫财': '劫', '食神': '食', '伤官': '伤',
    '偏财': '偏财', '正财': '正财', '七杀': '杀', '正官': '官',
    '偏印': '枭', '正印': '印', '日主': '日主', '未知': '?',
};

const WUXING_SHENG: Record<string, string> = {
    '木': '火', '火': '土', '土': '金', '金': '水', '水': '木',
};
const WUXING_KE: Record<string, string> = {
    '木': '土', '火': '金', '土': '水', '金': '木', '水': '火',
};

export function getWuxingStrength(monthZhi: DiZhi): Record<string, WuxingStrengthLevel> {
    const wang = ZHI_WUXING[monthZhi];
    const result: Record<string, WuxingStrengthLevel> = {};
    result[wang] = '旺';
    result[WUXING_SHENG[wang]] = '相';

    for (const wx of ['木', '火', '土', '金', '水']) {
        if (WUXING_SHENG[wx] === wang) {
            result[wx] = '休';
        }
        if (WUXING_KE[wx] === wang) {
            result[wx] = '囚';
        }
    }
    result[WUXING_KE[wang]] = '死';
    return result;
}

export function getShiShen(dayGan: TianGan, otherGan: TianGan): string {
    if (dayGan === otherGan) return '比肩';
    const myWx = GAN_WUXING[dayGan];
    const otherWx = GAN_WUXING[otherGan];
    const sameYinYang = GAN_YINYANG[dayGan] === GAN_YINYANG[otherGan];

    if (myWx === otherWx) return sameYinYang ? '比肩' : '劫财';
    if (WUXING_SHENG[myWx] === otherWx) return sameYinYang ? '食神' : '伤官';
    if (WUXING_KE[myWx] === otherWx) return sameYinYang ? '偏财' : '正财';
    if (WUXING_KE[otherWx] === myWx) return sameYinYang ? '七杀' : '正官';
    if (WUXING_SHENG[otherWx] === myWx) return sameYinYang ? '偏印' : '正印';
    return '未知';
}

export function getWuxingColor(wx: string): string {
    return WUXING_COLORS[wx] || '#374151';
}

export function getGanColor(gan: TianGan): string {
    return getWuxingColor(GAN_WUXING[gan]);
}

export function getZhiColor(zhi: DiZhi): string {
    return getWuxingColor(ZHI_WUXING[zhi]);
}
