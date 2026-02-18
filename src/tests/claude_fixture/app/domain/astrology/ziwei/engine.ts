import type { AstrologyRuleProfile, BirthInput } from '../types';
import { mergeProfile } from '../profile';
import { hourMinuteToShichen, toSolarFromInput } from '../common/time';
import { BRIGHTNESS_COLORS, DIRECTION_LABELS, DIZHI_GRID_POS, STAR_BRIGHTNESS_TABLE } from './constants';
import {
    GONG_NAMES,
    SI_HUA,
    type GongInfo,
    type StarBrightness,
    type StarInfo,
    type ZiweiChartResult,
} from './types';

const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
const DI_ZHI_12 = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

const NAYIN_JU: Record<string, number> = {
    '甲子': 4, '乙丑': 4, '丙寅': 6, '丁卯': 6, '戊辰': 3, '己巳': 3,
    '庚午': 5, '辛未': 5, '壬申': 4, '癸酉': 4, '甲戌': 6, '乙亥': 6,
    '丙子': 2, '丁丑': 2, '戊寅': 5, '己卯': 5, '庚辰': 4, '辛巳': 4,
    '壬午': 3, '癸未': 3, '甲申': 2, '乙酉': 2, '丙戌': 5, '丁亥': 5,
    '戊子': 6, '己丑': 6, '庚寅': 3, '辛卯': 3, '壬辰': 2, '癸巳': 2,
    '甲午': 4, '乙未': 4, '丙申': 6, '丁酉': 6, '戊戌': 3, '己亥': 3,
    '庚子': 5, '辛丑': 5, '壬寅': 4, '癸卯': 4, '甲辰': 6, '乙巳': 6,
    '丙午': 2, '丁未': 2, '戊申': 5, '己酉': 5, '庚戌': 4, '辛亥': 4,
    '壬子': 3, '癸丑': 3, '甲寅': 2, '乙卯': 2, '丙辰': 5, '丁巳': 5,
    '戊午': 6, '己未': 6, '庚申': 3, '辛酉': 3, '壬戌': 2, '癸亥': 2,
};

const JU_NAMES: Record<number, string> = {
    2: '水二局', 3: '木三局', 4: '金四局', 5: '土五局', 6: '火六局',
};

const MING_ZHU_TABLE = ['贪狼', '巨门', '禄存', '文曲', '廉贞', '武曲', '破军',
    '武曲', '廉贞', '文曲', '禄存', '巨门'];
const SHEN_ZHU_TABLE = ['铃星', '天相', '天梁', '天同', '文昌', '天机',
    '火星', '天相', '天梁', '天同', '文昌', '天机'];
const TIANMA_BY_GROUP = [2, 8, 5, 11] as const;
const XIANCHI_BY_GROUP = [9, 3, 0, 6] as const;
const HUAGAI_BY_GROUP = [4, 10, 7, 1] as const;
const HUOXING_START_BY_GROUP = [2, 8, 5, 11] as const;
const LINGXING_START_BY_GROUP = [10, 4, 1, 7] as const;
const TIANGUAN_TABLE = [7, 4, 5, 2, 3, 9, 11, 9, 10, 6] as const;
const TIANFU_TABLE = [9, 8, 0, 11, 1, 3, 5, 4, 6, 2] as const;
const TIANCHU_TABLE = [5, 6, 0, 9, 5, 6, 2, 3, 11, 0] as const;

function getStarBrightness(starName: string, dizhi: string): StarBrightness | null {
    const table = STAR_BRIGHTNESS_TABLE[starName];
    if (!table) return null;
    const idx = DI_ZHI_12.indexOf(dizhi as typeof DI_ZHI_12[number]);
    if (idx < 0) return null;
    return table[idx] || null;
}

function getMingGongTianGan(yearGanIdx: number, mingGongZhiIdx: number): number {
    const yinGanIdx = (yearGanIdx % 5) * 2 + 2;
    const dist = ((mingGongZhiIdx - 2) % 12 + 12) % 12;
    return (yinGanIdx + dist) % 10;
}

function ziweiStartGong(lunarDay: number, juNumber: number): number {
    const day = Math.max(1, Math.min(30, Math.floor(lunarDay)));
    const ju = Math.max(2, Math.min(6, Math.floor(juNumber)));
    const x = (ju - (day % ju)) % ju;
    const y = (day + x) / ju;

    let k = y;
    if (x !== 0) {
        k = x % 2 === 0 ? y + x : y - x;
    }
    return ((2 + (k - 1)) % 12 + 12) % 12;
}

function getMingZhu(mingGongZhiIdx: number): string {
    return MING_ZHU_TABLE[mingGongZhiIdx] || '贪狼';
}

function getShenZhu(yearZhiIdx: number): string {
    return SHEN_ZHU_TABLE[yearZhiIdx] || '铃星';
}

function isYangGan(ganIdx: number): boolean {
    return ganIdx % 2 === 0;
}

function isForwardDaxian(gender: '男' | '女', yearGanIdx: number): boolean {
    const yangGan = isYangGan(yearGanIdx);
    return (gender === '男' && yangGan) || (gender === '女' && !yangGan);
}

function getSanHeGroup(yearZhiIdx: number): number {
    if (yearZhiIdx === 8 || yearZhiIdx === 0 || yearZhiIdx === 4) return 0; // 申子辰
    if (yearZhiIdx === 2 || yearZhiIdx === 6 || yearZhiIdx === 10) return 1; // 寅午戌
    if (yearZhiIdx === 11 || yearZhiIdx === 3 || yearZhiIdx === 7) return 2; // 亥卯未
    return 3; // 巳酉丑
}

function getLiunianStartAge(yearZhiIdx: number, palaceZhiIdx: number): number {
    return ((palaceZhiIdx - yearZhiIdx + 12) % 12) + 1;
}

function getXiaoxianStartZhiIdx(yearZhiIdx: number): number {
    // 依生年三合局的墓库对宫起一岁：
    // 申子辰 -> 戌；寅午戌 -> 辰；亥卯未 -> 丑；巳酉丑 -> 未
    if (yearZhiIdx === 8 || yearZhiIdx === 0 || yearZhiIdx === 4) return 10;
    if (yearZhiIdx === 2 || yearZhiIdx === 6 || yearZhiIdx === 10) return 4;
    if (yearZhiIdx === 11 || yearZhiIdx === 3 || yearZhiIdx === 7) return 1;
    return 7;
}

function getGuChenGuaSu(yearZhiIdx: number): { guChen: number; guaSu: number } {
    if (yearZhiIdx === 2 || yearZhiIdx === 3 || yearZhiIdx === 4) return { guChen: 5, guaSu: 1 }; // 寅卯辰
    if (yearZhiIdx === 5 || yearZhiIdx === 6 || yearZhiIdx === 7) return { guChen: 8, guaSu: 4 }; // 巳午未
    if (yearZhiIdx === 8 || yearZhiIdx === 9 || yearZhiIdx === 10) return { guChen: 11, guaSu: 7 }; // 申酉戌
    return { guChen: 2, guaSu: 10 }; // 亥子丑
}

function toAgeSeries(startAge: number, maxAge = 120): number[] {
    const normalized = Math.max(1, Math.min(12, Math.floor(startAge)));
    const result: number[] = [];
    for (let age = normalized; age <= maxAge; age += 12) {
        result.push(age);
    }
    return result;
}

function placeStar(gongs: GongInfo[], zhiIdx: number, starName: string, target: 'main' | 'aux') {
    const targetZhi = DI_ZHI_12[((zhiIdx % 12) + 12) % 12];
    const palace = gongs.find((g) => g.dizhi === targetZhi);
    if (!palace) return;
    if (palace.mainStars.some((star) => star.name === starName) || palace.auxStars.some((star) => star.name === starName)) {
        return;
    }
    const star: StarInfo = {
        name: starName,
        brightness: getStarBrightness(starName, palace.dizhi),
        siHua: null,
    };
    if (target === 'main') palace.mainStars.push(star);
    else palace.auxStars.push(star);
}

export function calculateZiweiChart(
    input: BirthInput,
    partialProfile?: Partial<AstrologyRuleProfile>,
): ZiweiChartResult {
    const profile = mergeProfile(partialProfile);
    const solar = toSolarFromInput(input, profile.useTrueSolarTime);
    const lunar = solar.getLunar();

    const lunarYear = lunar.getYear();
    const lunarMonth = Math.abs(lunar.getMonth());
    const lunarDay = lunar.getDay();
    const shichen = hourMinuteToShichen(solar.getHour(), solar.getMinute());

    const yearGanZhi = lunar.getYearInGanZhi();
    const yearGan = yearGanZhi.charAt(0);
    const yearZhi = yearGanZhi.charAt(1);
    const rawYearGanIdx = TIAN_GAN.indexOf(yearGan as typeof TIAN_GAN[number]);
    const rawYearZhiIdx = DI_ZHI_12.indexOf(yearZhi as typeof DI_ZHI_12[number]);
    const yearGanIdx = rawYearGanIdx >= 0 ? rawYearGanIdx : 0;
    const yearZhiIdx = rawYearZhiIdx >= 0 ? rawYearZhiIdx : 0;

    const mingGongZhiIdx = ((2 + (lunarMonth - 1) - shichen) % 12 + 12) % 12;
    const shenGongZhiIdx = ((2 + (lunarMonth - 1) + shichen) % 12 + 12) % 12;

    const mingGongGanIdx = getMingGongTianGan(yearGanIdx, mingGongZhiIdx);
    const mingGongGanZhi = TIAN_GAN[mingGongGanIdx] + DI_ZHI_12[mingGongZhiIdx];

    const juNumber = NAYIN_JU[mingGongGanZhi] || 4;
    const wuxingJu = JU_NAMES[juNumber] || '金四局';

    const mingZhu = getMingZhu(mingGongZhiIdx);
    const shenZhu = getShenZhu(yearZhiIdx);

    const forward = isForwardDaxian(input.gender, yearGanIdx);
    const xiaoxianForward = input.gender === '男';
    const xiaoxianStartZhiIdx = getXiaoxianStartZhiIdx(yearZhiIdx);

    const gongs: GongInfo[] = GONG_NAMES.map((name, i) => {
        const zhiIdx = ((mingGongZhiIdx - i) % 12 + 12) % 12;
        const ganIdx = getMingGongTianGan(yearGanIdx, zhiIdx);
        const dizhi = DI_ZHI_12[zhiIdx] as string;
        const gridPos = DIZHI_GRID_POS[dizhi] || [0, 0];

        const step = forward ? i : (12 - i) % 12;
        const daxianStart = juNumber + step * 10;
        const liunianStartAge = getLiunianStartAge(yearZhiIdx, zhiIdx);
        const xiaoxianStep = xiaoxianForward
            ? ((zhiIdx - xiaoxianStartZhiIdx + 12) % 12)
            : ((xiaoxianStartZhiIdx - zhiIdx + 12) % 12);
        const xiaoxianStartAge = xiaoxianStep + 1;

        return {
            name,
            dizhi,
            tiangan: TIAN_GAN[ganIdx] as string,
            mainStars: [],
            auxStars: [],
            siHua: [],
            daxianStart,
            daxianEnd: daxianStart + 9,
            liunianYear: solar.getYear() + liunianStartAge - 1,
            liunianAges: toAgeSeries(liunianStartAge),
            xiaoxianAges: toAgeSeries(xiaoxianStartAge),
            gridRow: gridPos[0],
            gridCol: gridPos[1],
        };
    });

    const ziweiGongZhi = ziweiStartGong(lunarDay, juNumber);

    const ZIWEI_CHAIN: [string, number][] = [
        ['紫微', 0], ['天机', -1], ['太阳', -3], ['武曲', -4], ['天同', -5], ['廉贞', -7],
    ];
    const TIANFU_CHAIN: [string, number][] = [
        ['天府', 0], ['太阴', 1], ['贪狼', 2], ['巨门', 3],
        ['天相', 4], ['天梁', 5], ['七杀', 6], ['破军', 10],
    ];

    for (const [starName, offset] of ZIWEI_CHAIN) {
        placeStar(gongs, ziweiGongZhi + offset, starName, 'main');
    }

    const tianfuGongZhi = ((12 - ziweiGongZhi + 4) % 12 + 12) % 12;
    for (const [starName, offset] of TIANFU_CHAIN) {
        placeStar(gongs, tianfuGongZhi + offset, starName, 'main');
    }

    const wenchangZhi = ((10 - shichen) % 12 + 12) % 12;
    const wenquZhi = (4 + shichen) % 12;
    const zuofuZhi = (4 + lunarMonth - 1) % 12;
    const youbiZhi = ((10 - lunarMonth + 1) % 12 + 12) % 12;

    const TIANKUI_TABLE = [1, 0, 11, 11, 1, 0, 7, 6, 3, 3];
    const TIANYUE_TABLE = [7, 8, 9, 9, 7, 8, 1, 2, 5, 5];
    const LUCUN_TABLE = [2, 3, 5, 6, 5, 6, 8, 9, 11, 0];

    const tiankuiZhi = TIANKUI_TABLE[yearGanIdx];
    const tianyueZhi = TIANYUE_TABLE[yearGanIdx];
    const lucunZhi = LUCUN_TABLE[yearGanIdx];
    const qingyangZhi = (lucunZhi + 1) % 12;
    const tuoluoZhi = ((lucunZhi - 1) + 12) % 12;
    const sanheGroup = getSanHeGroup(yearZhiIdx);
    const tianmaZhi = TIANMA_BY_GROUP[sanheGroup];
    const xianchiZhi = XIANCHI_BY_GROUP[sanheGroup];
    const huagaiZhi = HUAGAI_BY_GROUP[sanheGroup];
    const huoxingZhi = (HUOXING_START_BY_GROUP[sanheGroup] + shichen) % 12;
    const lingxingZhi = (LINGXING_START_BY_GROUP[sanheGroup] + shichen) % 12;
    const dikongZhi = ((11 - shichen) % 12 + 12) % 12;
    const dijieZhi = (11 + shichen) % 12;
    const hongluanZhi = ((3 - yearZhiIdx) % 12 + 12) % 12;
    const tianxiZhi = (hongluanZhi + 6) % 12;
    const tianyaoZhi = (yearZhiIdx + 1) % 12;
    const tiankuZhi = ((6 - yearZhiIdx) % 12 + 12) % 12;
    const tianxuZhi = (tiankuZhi + 6) % 12;
    const { guChen: guchenZhi, guaSu: guasuZhi } = getGuChenGuaSu(yearZhiIdx);
    const tianguanZhi = TIANGUAN_TABLE[yearGanIdx];
    const tianfuMinorZhi = TIANFU_TABLE[yearGanIdx];
    const tianchuZhi = TIANCHU_TABLE[yearGanIdx];
    const tianxingZhi = (8 + lunarMonth - 1) % 12;
    const tianyueMinorZhi = (lunarMonth * 2 + yearZhiIdx) % 12;
    const yinshaZhi = (yearZhiIdx + 7) % 12;
    const tianwuZhi = (lunarMonth + yearZhiIdx) % 12;
    const jieshenZhi = (yearZhiIdx + lunarMonth + 3) % 12;
    const longchiZhi = (4 + yearZhiIdx) % 12;
    const fenggeZhi = ((10 - yearZhiIdx) % 12 + 12) % 12;
    const feilianZhi = (yearZhiIdx + 4) % 12;
    const posuiZhi = (yearZhiIdx + 8) % 12;
    const taifuZhi = (wenchangZhi + 2) % 12;
    const fenggaoZhi = ((wenquZhi - 2) % 12 + 12) % 12;
    const tiancaiZhi = mingGongZhiIdx;
    const tianshouZhi = shenGongZhiIdx;
    const tianshangZhi = (mingGongZhiIdx + 6) % 12;
    const tianshiZhi = (shenGongZhiIdx + 6) % 12;
    const tiandeZhi = (yearGanIdx + 3) % 12;
    const yuedeZhi = (lunarMonth + 1) % 12;
    const niangjieZhi = (yearZhiIdx + 5) % 12;
    const tiankongZhi = (lucunZhi + 6) % 12;
    const jietianZhi = (yearZhiIdx + lunarDay) % 12;
    const yuedeheZhi = (yuedeZhi + 6) % 12;

    const auxPlacements: [string, number][] = [
        ['文昌', wenchangZhi],
        ['文曲', wenquZhi],
        ['左辅', zuofuZhi],
        ['右弼', youbiZhi],
        ['天魁', tiankuiZhi],
        ['天钺', tianyueZhi],
        ['禄存', lucunZhi],
        ['擎羊', qingyangZhi],
        ['陀罗', tuoluoZhi],
        ['火星', huoxingZhi],
        ['铃星', lingxingZhi],
        ['地空', dikongZhi],
        ['地劫', dijieZhi],
        ['天马', tianmaZhi],
        ['红鸾', hongluanZhi],
        ['天喜', tianxiZhi],
        ['咸池', xianchiZhi],
        ['天姚', tianyaoZhi],
        ['天哭', tiankuZhi],
        ['天虚', tianxuZhi],
        ['孤辰', guchenZhi],
        ['寡宿', guasuZhi],
        ['华盖', huagaiZhi],
        ['天官', tianguanZhi],
        ['天福', tianfuMinorZhi],
        ['天厨', tianchuZhi],
        ['天刑', tianxingZhi],
        ['天月', tianyueMinorZhi],
        ['阴煞', yinshaZhi],
        ['天巫', tianwuZhi],
        ['解神', jieshenZhi],
        ['龙池', longchiZhi],
        ['凤阁', fenggeZhi],
        ['蜚廉', feilianZhi],
        ['破碎', posuiZhi],
        ['台辅', taifuZhi],
        ['封诰', fenggaoZhi],
        ['天才', tiancaiZhi],
        ['天寿', tianshouZhi],
        ['天伤', tianshangZhi],
        ['天使', tianshiZhi],
        ['天德', tiandeZhi],
        ['月德', yuedeZhi],
        ['年解', niangjieZhi],
        ['天空', tiankongZhi],
        ['截空', jietianZhi],
        ['月德合', yuedeheZhi],
    ];

    for (const [starName, zhiIdx] of auxPlacements) {
        placeStar(gongs, zhiIdx, starName, 'aux');
    }

    const siHuaTable: string[][] = [
        ['廉贞', '破军', '武曲', '太阳'],
        ['天机', '天梁', '紫微', '太阴'],
        ['天同', '天机', '文昌', '廉贞'],
        ['太阴', '天同', '天机', '巨门'],
        ['贪狼', '太阴', '右弼', '天机'],
        ['武曲', '贪狼', '天梁', '文曲'],
        ['太阳', '武曲', '太阴', '天同'],
        ['巨门', '太阳', '文曲', '文昌'],
        ['天梁', '紫微', '左辅', '武曲'],
        ['破军', '巨门', '太阴', '贪狼'],
    ];

    const yearSiHua = siHuaTable[yearGanIdx] || siHuaTable[0];
    for (let i = 0; i < 4; i++) {
        const starName = yearSiHua[i];
        const huaName = SI_HUA[i];

        for (const g of gongs) {
            const mainMatch = g.mainStars.find((s) => s.name === starName);
            if (mainMatch) {
                mainMatch.siHua = huaName;
                g.siHua.push(`${starName}${huaName}`);
                break;
            }
            const auxMatch = g.auxStars.find((s) => s.name === starName);
            if (auxMatch) {
                auxMatch.siHua = huaName;
                g.siHua.push(`${starName}${huaName}`);
                break;
            }
        }
    }

    const shenGongIdx = gongs.findIndex((g) => g.dizhi === DI_ZHI_12[shenGongZhiIdx]);

    return {
        gongs,
        mingGongIdx: 0,
        shenGongIdx: shenGongIdx >= 0 ? shenGongIdx : 0,
        wuxingJu,
        juNumber,
        yearGanZhi,
        mingZhu,
        shenZhu,
        input,
        profile,
    };
}

export { BRIGHTNESS_COLORS, DIRECTION_LABELS };
