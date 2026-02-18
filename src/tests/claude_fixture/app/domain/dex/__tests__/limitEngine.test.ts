import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkDailyLimit, clearDailyLimitState, consumeDailyLimit, getDailyLimitConsumed } from '../limitEngine';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
});

beforeEach(() => {
  clearDailyLimitState();
  globalThis.localStorage.clear();
});

describe('dex maker daily limit engine', () => {
  it('consumes and rejects when limit exceeded', () => {
    const first = consumeDailyLimit({
      policyGroupId: 'INTL',
      assetCode: 'BTC',
      qty: 0.06,
      dailyLimit: 0.1,
    });
    expect(first.ok).toBe(true);
    expect(first.remaining).toBeCloseTo(0.04, 8);

    const second = checkDailyLimit({
      policyGroupId: 'INTL',
      assetCode: 'BTC',
      qty: 0.05,
      dailyLimit: 0.1,
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('maker_daily_limit_exceeded');
  });

  it('tracks consumption by policy group', () => {
    consumeDailyLimit({
      policyGroupId: 'CN',
      assetCode: 'USDT',
      qty: 200,
      dailyLimit: 1000,
    });
    consumeDailyLimit({
      policyGroupId: 'INTL',
      assetCode: 'USDT',
      qty: 300,
      dailyLimit: 1000,
    });

    expect(getDailyLimitConsumed('CN', 'USDT')).toBe(200);
    expect(getDailyLimitConsumed('INTL', 'USDT')).toBe(300);
  });

  it('resets when day key changes', () => {
    const ts1 = Date.UTC(2026, 1, 14, 0, 0, 0); // 2026-02-14
    const ts2 = Date.UTC(2026, 1, 15, 0, 1, 0); // 2026-02-15
    consumeDailyLimit({
      policyGroupId: 'INTL',
      assetCode: 'XAU',
      qty: 1,
      dailyLimit: 2,
      nowMs: ts1,
    });
    const before = getDailyLimitConsumed('INTL', 'XAU', ts1);
    const after = getDailyLimitConsumed('INTL', 'XAU', ts2);
    expect(before).toBe(1);
    expect(after).toBe(0);
  });
});
