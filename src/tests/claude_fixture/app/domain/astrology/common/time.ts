import { Lunar, Solar } from 'lunar-javascript';
import type { BirthInput } from '../types';

export interface SolarParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

function clampInt(value: number, min: number, max: number): number {
    const n = Math.floor(Number.isFinite(value) ? value : min);
    return Math.max(min, Math.min(max, n));
}

function normalizeBirthInput(input: BirthInput): BirthInput {
    return {
        ...input,
        year: clampInt(input.year, 1, 9999),
        month: clampInt(input.month, 1, 12),
        day: clampInt(input.day, 1, 31),
        hour: clampInt(input.hour, 0, 23),
        minute: clampInt(input.minute, 0, 59),
        timezone: input.timezone || 'Asia/Shanghai',
    };
}

export function addMinutes(parts: SolarParts, deltaMinutes: number): SolarParts {
    const dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0));
    dt.setUTCMinutes(dt.getUTCMinutes() + Math.floor(deltaMinutes));
    return {
        year: dt.getUTCFullYear(),
        month: dt.getUTCMonth() + 1,
        day: dt.getUTCDate(),
        hour: dt.getUTCHours(),
        minute: dt.getUTCMinutes(),
    };
}

export function getTimezoneOffsetMinutes(timezone: string, parts: SolarParts): number {
    try {
        const dt = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0));
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'shortOffset',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
        const tzName = formatter.formatToParts(dt).find((p) => p.type === 'timeZoneName')?.value || 'GMT+8';
        const match = tzName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
        if (!match) return 8 * 60;
        const sign = match[1] === '-' ? -1 : 1;
        const hh = Number(match[2] || 0);
        const mm = Number(match[3] || 0);
        return sign * (hh * 60 + mm);
    } catch {
        return 8 * 60;
    }
}

export function trueSolarCorrectionMinutes(timezone: string, longitude: number, parts: SolarParts): number {
    const offsetMinutes = getTimezoneOffsetMinutes(timezone, parts);
    const standardMeridian = (offsetMinutes / 60) * 15;
    return Math.round((longitude - standardMeridian) * 4);
}

export function toSolarParts(input: BirthInput, useTrueSolarTime: boolean): SolarParts {
    const normalized = normalizeBirthInput(input);
    let solar: SolarParts;

    if (normalized.calendar === 'solar') {
        solar = {
            year: normalized.year,
            month: normalized.month,
            day: normalized.day,
            hour: normalized.hour,
            minute: normalized.minute,
        };
    } else {
        const lunar = Lunar.fromYmdHms(
            normalized.year,
            normalized.month,
            Math.min(normalized.day, 30),
            normalized.hour,
            normalized.minute,
            0,
        );
        const s = lunar.getSolar();
        solar = {
            year: s.getYear(),
            month: s.getMonth(),
            day: s.getDay(),
            hour: s.getHour(),
            minute: s.getMinute(),
        };
    }

    if (useTrueSolarTime && typeof normalized.longitude === 'number') {
        const delta = trueSolarCorrectionMinutes(normalized.timezone, normalized.longitude, solar);
        return addMinutes(solar, delta);
    }
    return solar;
}

export function toSolarFromInput(input: BirthInput, useTrueSolarTime: boolean): ReturnType<typeof Solar.fromYmdHms> {
    const s = toSolarParts(input, useTrueSolarTime);
    return Solar.fromYmdHms(s.year, s.month, s.day, s.hour, s.minute, 0);
}

export function hourMinuteToShichen(hour: number, minute: number): number {
    const h = ((Math.floor(hour) % 24) + 24) % 24;
    const m = ((Math.floor(minute) % 60) + 60) % 60;
    const totalMinutes = h * 60 + m;
    return Math.floor(((Math.floor(totalMinutes / 60) + 1) % 24) / 2);
}
