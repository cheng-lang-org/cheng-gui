import type { DexAssetCode } from './marketConfig';

const STORAGE_KEY = 'unimaker_dex_maker_daily_limit_v1';

export type PolicyGroupId = 'CN' | 'INTL';

interface GroupConsumedState {
  [assetCode: string]: number;
}

interface SessionConsumedState {
  [id: string]: number;
}

interface DailyLimitState {
  version: 1 | 2;
  dayKeyByGroup: Record<PolicyGroupId, string>;
  consumedByGroup: Record<PolicyGroupId, GroupConsumedState>;
  sessionDayKey: string;
  sessionConsumedById: SessionConsumedState;
  walletConsumedById: SessionConsumedState;
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

export interface SessionExposureInput {
  sessionId: string;
  walletId: string;
  amountRWAD: number;
  maxAmountRWAD?: number;
  nowMs?: number;
}

export interface SessionExposureResult {
  ok: boolean;
  consumed: number;
  remaining: number;
  reason?: 'session_daily_limit_exceeded';
}

function nowMs(): number {
  return Date.now();
}

function getLocalStorageSafe(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } | null {
  if (typeof localStorage === 'undefined' || !localStorage) {
    return null;
  }
  const storage = localStorage as unknown as {
    getItem?: (key: string) => string | null;
    setItem?: (key: string, value: string) => void;
  };
  if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return {
    getItem: storage.getItem.bind(localStorage),
    setItem: storage.setItem.bind(localStorage),
  };
}

function emptyState(): DailyLimitState {
  return {
    version: 2,
    dayKeyByGroup: {
      CN: '',
      INTL: '',
    },
    consumedByGroup: {
      CN: {},
      INTL: {},
    },
    sessionDayKey: '',
    sessionConsumedById: {},
    walletConsumedById: {},
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
  if (input.version === 1 || input.version === 2) {
    state.version = input.version;
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
  if (typeof input.sessionDayKey === 'string') {
    state.sessionDayKey = input.sessionDayKey;
  }
  const sessionConsumedById = input.sessionConsumedById as Record<string, unknown> | undefined;
  if (sessionConsumedById) {
    const next: SessionConsumedState = {};
    for (const [id, consumed] of Object.entries(sessionConsumedById)) {
      const parsed = typeof consumed === 'number' ? consumed : Number(consumed);
      if (id.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0) {
        next[id.trim()] = Number(parsed.toFixed(8));
      }
    }
    state.sessionConsumedById = next;
  }
  const walletConsumedById = input.walletConsumedById as Record<string, unknown> | undefined;
  if (walletConsumedById) {
    const next: SessionConsumedState = {};
    for (const [id, consumed] of Object.entries(walletConsumedById)) {
      const parsed = typeof consumed === 'number' ? consumed : Number(consumed);
      if (id.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0) {
        next[id.trim()] = Number(parsed.toFixed(8));
      }
    }
    state.walletConsumedById = next;
  }
  return state;
}

function readState(): DailyLimitState {
  const storage = getLocalStorageSafe();
  if (!storage) {
    return emptyState();
  }
  const raw = storage.getItem(STORAGE_KEY);
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
  const storage = getLocalStorageSafe();
  if (!storage) {
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function resolveSessionDayKey(tsMs: number): string {
  return formatDayKey(tsMs, 'UTC');
}

function ensureSessionDay(state: DailyLimitState, tsMs: number): DailyLimitState {
  const dayKey = resolveSessionDayKey(tsMs);
  if (state.sessionDayKey === dayKey) {
    return state;
  }
  const next = sanitizeState(state);
  next.version = 2;
  next.sessionDayKey = dayKey;
  next.sessionConsumedById = {};
  next.walletConsumedById = {};
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

function normalizeId(value: string): string {
  return value.trim();
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Number(value.toFixed(8));
}

function readConsumed(state: DailyLimitState, key: string, type: 'session' | 'wallet'): number {
  if (!key) {
    return 0;
  }
  if (type === 'session') {
    return state.sessionConsumedById[key] ?? 0;
  }
  return state.walletConsumedById[key] ?? 0;
}

export function checkSessionExposureLimit(input: SessionExposureInput): SessionExposureResult {
  const sessionId = normalizeId(input.sessionId);
  const walletId = normalizeId(input.walletId);
  const amountRWAD = normalizeAmount(input.amountRWAD);
  const maxAmountRWAD = normalizeAmount(input.maxAmountRWAD ?? 500);
  if (!sessionId || !walletId || amountRWAD <= 0 || maxAmountRWAD <= 0) {
    return {
      ok: false,
      consumed: 0,
      remaining: 0,
      reason: 'session_daily_limit_exceeded',
    };
  }
  const ts = input.nowMs ?? nowMs();
  const state = ensureSessionDay(readState(), ts);
  const consumedSession = readConsumed(state, sessionId, 'session');
  const consumedWallet = readConsumed(state, walletId, 'wallet');
  const consumed = Math.max(consumedSession, consumedWallet);
  const remaining = Math.max(0, Number((maxAmountRWAD - consumed).toFixed(8)));
  if (remaining + 1e-12 < amountRWAD) {
    return {
      ok: false,
      consumed,
      remaining,
      reason: 'session_daily_limit_exceeded',
    };
  }
  return { ok: true, consumed, remaining };
}

export function consumeSessionExposureLimit(input: SessionExposureInput): SessionExposureResult {
  const check = checkSessionExposureLimit(input);
  if (!check.ok) {
    return check;
  }
  const sessionId = normalizeId(input.sessionId);
  const walletId = normalizeId(input.walletId);
  const amountRWAD = normalizeAmount(input.amountRWAD);
  const maxAmountRWAD = normalizeAmount(input.maxAmountRWAD ?? 500);
  const ts = input.nowMs ?? nowMs();
  const state = ensureSessionDay(readState(), ts);
  const nextSession = normalizeAmount(readConsumed(state, sessionId, 'session') + amountRWAD);
  const nextWallet = normalizeAmount(readConsumed(state, walletId, 'wallet') + amountRWAD);
  state.version = 2;
  state.sessionConsumedById[sessionId] = nextSession;
  state.walletConsumedById[walletId] = nextWallet;
  writeState(state);
  const consumed = Math.max(nextSession, nextWallet);
  return {
    ok: true,
    consumed,
    remaining: Math.max(0, Number((maxAmountRWAD - consumed).toFixed(8))),
  };
}

export function getSessionExposureConsumed(sessionId: string, walletId: string, nowOverrideMs?: number): number {
  const normalizedSessionId = normalizeId(sessionId);
  const normalizedWalletId = normalizeId(walletId);
  if (!normalizedSessionId || !normalizedWalletId) {
    return 0;
  }
  const state = ensureSessionDay(readState(), nowOverrideMs ?? nowMs());
  return Math.max(
    readConsumed(state, normalizedSessionId, 'session'),
    readConsumed(state, normalizedWalletId, 'wallet'),
  );
}
