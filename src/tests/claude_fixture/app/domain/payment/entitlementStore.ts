export interface AppEntitlement {
  appId: string;
  orderId: string;
  grantedAt: string;
}

interface EntitlementState {
  appEntitlements: Record<string, AppEntitlement>;
}

const STORAGE_KEY = 'unimaker_app_entitlements_v1';

function emptyState(): EntitlementState {
  return {
    appEntitlements: {},
  };
}

function readState(): EntitlementState {
  if (typeof localStorage === 'undefined') {
    return emptyState();
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<EntitlementState>;
    return {
      appEntitlements: parsed.appEntitlements ?? {},
    };
  } catch {
    return emptyState();
  }
}

function writeState(next: EntitlementState): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getAppEntitlements(): Record<string, AppEntitlement> {
  return readState().appEntitlements;
}

export function getAppEntitlement(appId: string): AppEntitlement | null {
  const normalized = appId.trim();
  if (!normalized) {
    return null;
  }
  return getAppEntitlements()[normalized] ?? null;
}

export function grantAppEntitlement(appId: string, orderId: string): AppEntitlement {
  const normalizedAppId = appId.trim();
  const normalizedOrderId = orderId.trim();
  const next: AppEntitlement = {
    appId: normalizedAppId,
    orderId: normalizedOrderId,
    grantedAt: new Date().toISOString(),
  };
  const state = readState();
  state.appEntitlements[normalizedAppId] = next;
  writeState(state);
  return next;
}

export function revokeAppEntitlement(appId: string): void {
  const normalized = appId.trim();
  if (!normalized) {
    return;
  }
  const state = readState();
  delete state.appEntitlements[normalized];
  writeState(state);
}
