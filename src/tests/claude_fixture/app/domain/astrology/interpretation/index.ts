import type { InterpretationResult } from '../types';
import type { BaziChartResult } from '../bazi/types';
import type { ZiweiChartResult } from '../ziwei/types';

function topWuxing(result: BaziChartResult): string[] {
    return Object.entries(result.wuxingCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k]) => k);
}

export function interpretBazi(result: BaziChartResult): InterpretationResult {
    const [first, second] = topWuxing(result);
    const summary = `日主${result.dayPillar.gan}，五行以${first}${second ? `、${second}` : ''}为主，整体格局偏${result.dayMasterStrength}。`;

    return {
        summary,
        sections: [
            {
                key: 'pattern',
                title: '格局摘要',
                content: `四柱为 ${result.yearPillar.gan}${result.yearPillar.zhi} ${result.monthPillar.gan}${result.monthPillar.zhi} ${result.dayPillar.gan}${result.dayPillar.zhi} ${result.hourPillar.gan}${result.hourPillar.zhi}。`,
            },
            {
                key: 'dayun',
                title: '大运趋势',
                content: `起运年龄约 ${result.dayunStartAge} 岁，当前可重点观察近两步大运与流年同频变化。`,
            },
            {
                key: 'risk',
                title: '关注点',
                content: `请结合空亡(${result.kongWang.day.join('')})与月令旺衰(${result.monthPillar.zhi})做综合判断，避免单点结论。`,
            },
        ],
        qaHints: ['事业走势如何？', '财运在什么阶段更稳？', '未来三年应避开的决策是什么？'],
    };
}

export function interpretZiwei(result: ZiweiChartResult): InterpretationResult {
    const ming = result.gongs[result.mingGongIdx];
    const shen = result.gongs[result.shenGongIdx];
    const mingStars = ming?.mainStars.map((s) => s.name).join('、') || '无';

    return {
        summary: `命宫在${ming?.dizhi || '未知'}位，主星${mingStars}，身宫落于${shen?.name || '未知'}。`,
        sections: [
            {
                key: 'ming',
                title: '命身宫重点',
                content: `命宫(${ming?.name || '-'})与身宫(${shen?.name || '-'})联动，宜优先观察四化落宫。`,
            },
            {
                key: 'hua',
                title: '四化提示',
                content: `本命四化以年干${result.yearGanZhi.charAt(0)}触发，建议重点查看化禄/化忌所在宫位主题。`,
            },
            {
                key: 'daxian',
                title: '大限节奏',
                content: `五行局为${result.wuxingJu}，按十年节奏观察宫位轮转，结合流年做细化。`,
            },
        ],
        qaHints: ['当前大限最重要的宫位是哪一宫？', '四化对事业宫影响如何？', '未来三年适合主动变动吗？'],
    };
}
