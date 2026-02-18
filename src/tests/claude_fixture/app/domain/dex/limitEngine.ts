import type { DexAssetCode } from './marketConfig';

const STORAGE_KEY = 'unimaker_dex_maker_daily_limit_v1';

export type PolicyGroupId = 'CN' | 'INTL';

interface GroupConsumedState {
  [assetCode: string]: number;
}

interface DailyLimitState {
  version: 1;
  dayKeyByGroup: Record<PolicyGroupId, string>;
  consumedByGroup: Record<PolicyGroupId, GroupConsumedState>;
}

export interface DailyLimitCheckInput {
  policyGroupId: PolicyGroupId;
  assetCode: DexAssetCode | string;
  qty: number;
  dailyLimit: number;
  nowMs?: number;
}

export interface DailyLimitCheckResult {
  ok: boolean;
  consumed: number;
  remaining: number;
  reason?: 'maker_daily_limit_exceeded';
}

function nowMs(): number {
  return Date.now();
}

function emptyState(): DailyLimitState {
  return {
    version: 1,
    dayKeyByGroup: {
      CN: '',
      INTL: '',
    },
    consumedByGroup: {
      CN: {},
      INTL: {},
    },
  };
}

function formatDayKey(tsMs: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(tsMs));
}

function resolveDayKey(policyGroupId: PolicyGroupId, tsMs: number): string {
  if (policyGroupId === 'CN') {
    return formatDayKey(tsMs, 'Asia/Shanghai');
  }
  return formatDayKey(tsMs, 'UTC');
}

function sanitizeState(raw: unknown): DailyLimitState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyState();
  }
  const input = raw as Record<string, unknown>;
  const state = emptyState();
  if (input.version === 1) {
    state.version = 1;
  }
  const dayKeyByGroup = input.dayKeyByGroup as Record<string, unknown> | undefined;
  if (dayKeyByGroup) {
    if (typeof dayKeyByGroup.CN === 'string') {
      state.dayKeyByGroup.CN = dayKeyByGroup.CN;
    }
    if (typeof dayKeyByGroup.INTL === 'string') {
      state.dayKeyByGroup.INTL = dayKeyByGroup.INTL;
    }
  }
  const consumedByGroup = input.consumedByGroup as Record<string, unknown> | undefined;
  if (consumedByGroup) {
    for (const groupId of ['CN', 'INTL'] as const) {
      const rawGroup = consumedByGroup[groupId];
      if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
        continue;
      }
      const group = rawGroup as Record<string, unknown>;
      const next: GroupConsumedState = {};
      for (const [assetCode, consumed] of Object.entries(group)) {
        const parsed = typeof consumed === 'number' ? consumed : Number(consumed);
        if (Number.isFinite(parsed) && parsed >= 0) {
          next[assetCode] = parsed;
        }
      }
      state.consumedByGroup[groupId] = next;
    }
  }
  return state;
}

function readState(): DailyLimitState {
  if (typeof localStorage === 'undefined') {
    return emptyState();
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return emptyState();
  }
  try {
    return sanitizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

function writeState(state: DailyLimitState): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureGroupDay(state: DailyLimitState, policyGroupId: PolicyGroupId, tsMs: number): DailyLimitState {
  const dayKey = resolveDayKey(policyGroupId, tsMs);
  const prevDay = state.dayKeyByGroup[policyGroupId];
  if (prevDay === dayKey) {
    return state;
  }
  const next = sanitizeState(state);
  next.dayKeyByGroup[policyGroupId] = dayKey;
  next.consumedByGroup[policyGroupId] = {};
  return next;
}

function normalizeAssetCode(assetCode: string): string {
  return assetCode.trim().toUpperCase();
}

function currentConsumed(state: DailyLimitState, policyGroupId: PolicyGroupId, assetCode: string): number {
  return state.consumedByGroup[policyGroupId][assetCode] ?? 0;
}

export function checkDailyLimit(input: DailyLimitCheckInput): DailyLimitCheckResult {
  const qty = Number(input.qty);
  const limit = Number(input.dailyLimit);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(limit) || limit <= 0) {
    return {
      ok: false,
      consumed: 0,
      remaining: 0,
      reason: 'maker_daily_limit_exceeded',
    };
  }

  const ts = input.nowMs ?? nowMs();
  const assetCode = normalizeAssetCode(input.assetCode);
  const state = ensureGroupDay(readState(), input.policyGroupId, ts);
  const consumed = currentConsumed(state, input.policyGroupId, assetCode);
  const remaining = Math.max(0, Number((limit - consumed).toFixed(8)));
  if (remaining + 1e-12 < qty) {
    return {
      ok: false,
      consumed,
      remaining,
      reason: 'maker_daily_limit_exceeded',
    };
  }
  return {
    ok: true,
    consumed,
    remaining,
  };
}

export function consumeDailyLimit(input: DailyLimitCheckInput): DailyLimitCheckResult {
  const check = checkDailyLimit(input);
  if (!check.ok) {
    return check;
  }

  const qty = Number(input.qty);
  const ts = input.nowMs ?? nowMs();
  const assetCode = normalizeAssetCode(input.assetCode);
  const next = ensureGroupDay(readState(), input.policyGroupId, ts);
  const consumed = currentConsumed(next, input.policyGroupId, assetCode) + qty;
  next.consumedByGroup[input.policyGroupId][assetCode] = Number(consumed.toFixed(8));
  writeState(next);
  const remaining = Math.max(0, Number((Number(input.dailyLimit) - consumed).toFixed(8)));
  return {
    ok: true,
    consumed: Number(consumed.toFixed(8)),
    remaining,
  };
}

export function getDailyLimitConsumed(
  policyGroupId: PolicyGroupId,
  assetCode: DexAssetCode | string,
  nowOverrideMs?: number,
): number {
  const state = ensureGroupDay(readState(), policyGroupId, nowOverrideMs ?? nowMs());
  return currentConsumed(state, policyGroupId, normalizeAssetCode(assetCode));
}

export function clearDailyLimitState(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}

