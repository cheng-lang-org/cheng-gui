import type { AstrologyRecord } from './types';

const STORAGE_KEY = 'astrology_records_v1';

function now(): number {
    return Date.now();
}

function safeParse(raw: string | null): AstrologyRecord[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeAll(records: AstrologyRecord[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function listAstrologyRecords(type?: 'bazi' | 'ziwei'): AstrologyRecord[] {
    const all = safeParse(localStorage.getItem(STORAGE_KEY));
    const filtered = type ? all.filter((r) => r.type === type) : all;
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveAstrologyRecord(record: Omit<AstrologyRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): AstrologyRecord {
    const all = safeParse(localStorage.getItem(STORAGE_KEY));
    const existingIdx = record.id ? all.findIndex((x) => x.id === record.id) : -1;

    if (existingIdx >= 0) {
        const merged: AstrologyRecord = {
            ...all[existingIdx],
            ...record,
            id: all[existingIdx].id,
            createdAt: all[existingIdx].createdAt,
            updatedAt: now(),
        };
        all[existingIdx] = merged;
        writeAll(all);
        return merged;
    }

    const created: AstrologyRecord = {
        ...record,
        id: `astro_${now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now(),
        updatedAt: now(),
    };
    all.push(created);
    writeAll(all);
    return created;
}

export function removeAstrologyRecord(id: string): void {
    const all = safeParse(localStorage.getItem(STORAGE_KEY));
    writeAll(all.filter((x) => x.id !== id));
}

export function clearAstrologyRecords(): void {
    localStorage.removeItem(STORAGE_KEY);
}
