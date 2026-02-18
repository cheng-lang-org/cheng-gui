import { describe, expect, it } from 'vitest';
import { calculateBazi } from '../../../utils/bazi';
import { calculateZiwei } from '../../../utils/ziwei';
import { Solar } from 'lunar-javascript';

describe('astrology engines', () => {
    it('calculates bazi pillars with stable output', () => {
        const result = calculateBazi(1986, 11, 13, 12, '男', { minute: 5, timezone: 'Asia/Shanghai' });
        expect(`${result.yearPillar.gan}${result.yearPillar.zhi}`).toBe('丙寅');
        expect(result.dayun.length).toBeGreaterThan(0);
    });

    it('calculates ziwei chart and major palaces', () => {
        const solar = Solar.fromYmdHms(1986, 11, 13, 12, 5, 0);
        const lunar = solar.getLunar();
        const result = calculateZiwei(lunar.getYear(), Math.abs(lunar.getMonth()), lunar.getDay(), 6, '男');
        expect(result.gongs.length).toBe(12);
        expect(result.gongs[result.mingGongIdx].name).toBe('命宫');
        expect(result.gongs[0].auxStars.length).toBeGreaterThan(5);
        expect(result.gongs[0].liunianAges.length).toBeGreaterThan(0);
        expect(result.gongs[0].xiaoxianAges.length).toBeGreaterThan(0);
    });

    it('matches wenmo-style liunian and xiaoxian age anchors', () => {
        const solar = Solar.fromYmdHms(1986, 11, 13, 12, 5, 0);
        const lunar = solar.getLunar();
        const result = calculateZiwei(lunar.getYear(), Math.abs(lunar.getMonth()), lunar.getDay(), 6, '男');

        const mingGong = result.gongs.find(g => g.name === '命宫');
        const zinvGong = result.gongs.find(g => g.name === '子女宫');

        expect(mingGong?.dizhi).toBe('巳');
        expect(mingGong?.liunianAges[0]).toBe(4);
        expect(mingGong?.xiaoxianAges[0]).toBe(2);
        expect(zinvGong?.dizhi).toBe('寅');
        expect(zinvGong?.liunianAges[0]).toBe(1);
    });

    it('supports solar input and converts to the same ziwei chart core as lunar input', () => {
        const solar = Solar.fromYmdHms(1986, 11, 13, 12, 5, 0);
        const lunar = solar.getLunar();

        const byLunar = calculateZiwei(lunar.getYear(), Math.abs(lunar.getMonth()), lunar.getDay(), 6, '男', {
            minute: 5,
            timezone: 'Asia/Shanghai',
            calendar: 'lunar',
        });
        const bySolar = calculateZiwei(1986, 11, 13, 6, '男', {
            minute: 5,
            timezone: 'Asia/Shanghai',
            calendar: 'solar',
        });

        expect(bySolar.yearGanZhi).toBe(byLunar.yearGanZhi);
        expect(bySolar.wuxingJu).toBe(byLunar.wuxingJu);
        expect(bySolar.gongs[0].dizhi).toBe(byLunar.gongs[0].dizhi);
        expect(bySolar.gongs[0].mainStars.map(s => s.name)).toEqual(byLunar.gongs[0].mainStars.map(s => s.name));
        expect(bySolar.gongs[0].liunianAges[0]).toBe(byLunar.gongs[0].liunianAges[0]);
        expect(bySolar.gongs[0].xiaoxianAges[0]).toBe(byLunar.gongs[0].xiaoxianAges[0]);
    });
});
