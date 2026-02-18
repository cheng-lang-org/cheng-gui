export type RegionPolicyGroupId = 'CN' | 'INTL';

export interface RegionPolicy {
    policyGroupId: RegionPolicyGroupId;
    isDomestic: boolean;
    countryCode: string;
    source: 'ipapi' | 'ipwhois' | 'ipinfo' | 'cache' | 'locale_fallback';
    updatedAt: number;
}

const REGION_POLICY_KEY = 'unimaker_region_policy_v1';
const REGION_POLICY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const REGION_EVENT = 'unimaker:region-policy-updated';

function nowMs(): number {
    return Date.now();
}

function normalizeCountryCode(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().toUpperCase();
}

function fallbackPolicy(): RegionPolicy {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const lang = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
    const domesticByTimezone = timezone === 'Asia/Shanghai' || timezone === 'Asia/Chongqing' || timezone === 'Asia/Urumqi';
    const domesticByLang = lang.startsWith('zh-cn');
    const isDomestic = domesticByTimezone || domesticByLang;
    return {
        policyGroupId: isDomestic ? 'CN' : 'INTL',
        isDomestic,
        countryCode: isDomestic ? 'CN' : '',
        source: 'locale_fallback',
        updatedAt: nowMs(),
    };
}

function mapCountryToPolicy(countryCode: string, source: RegionPolicy['source']): RegionPolicy {
    const normalized = normalizeCountryCode(countryCode);
    const isDomestic = normalized === 'CN';
    return {
        policyGroupId: isDomestic ? 'CN' : 'INTL',
        isDomestic,
        countryCode: normalized,
        source,
        updatedAt: nowMs(),
    };
}

function readStoredPolicy(): RegionPolicy | null {
    if (typeof localStorage === 'undefined') {
        return null;
    }
    const raw = localStorage.getItem(REGION_POLICY_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<RegionPolicy>;
        if (parsed?.policyGroupId !== 'CN' && parsed?.policyGroupId !== 'INTL') {
            return null;
        }
        return {
            policyGroupId: parsed.policyGroupId,
            isDomestic: Boolean(parsed.isDomestic),
            countryCode: normalizeCountryCode(parsed.countryCode),
            source: (parsed.source as RegionPolicy['source']) ?? 'cache',
            updatedAt: Number(parsed.updatedAt) || nowMs(),
        };
    } catch {
        return null;
    }
}

function writeStoredPolicy(policy: RegionPolicy): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    localStorage.setItem(REGION_POLICY_KEY, JSON.stringify(policy));
}

function isPolicyExpired(policy: RegionPolicy): boolean {
    return nowMs() - policy.updatedAt > REGION_POLICY_MAX_AGE_MS;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } finally {
        clearTimeout(timer);
    }
}

async function detectFromIpApi(): Promise<RegionPolicy | null> {
    try {
        const response = await fetchWithTimeout('https://ipapi.co/json/', 2800);
        if (!response.ok) {
            return null;
        }
        const payload = (await response.json()) as { country_code?: string };
        const countryCode = normalizeCountryCode(payload.country_code);
        if (!countryCode) {
            return null;
        }
        return mapCountryToPolicy(countryCode, 'ipapi');
    } catch {
        return null;
    }
}

async function detectFromIpWhoIs(): Promise<RegionPolicy | null> {
    try {
        const response = await fetchWithTimeout('https://ipwho.is/', 2800);
        if (!response.ok) {
            return null;
        }
        const payload = (await response.json()) as { success?: boolean; country_code?: string };
        if (payload.success === false) {
            return null;
        }
        const countryCode = normalizeCountryCode(payload.country_code);
        if (!countryCode) {
            return null;
        }
        return mapCountryToPolicy(countryCode, 'ipwhois');
    } catch {
        return null;
    }
}

async function detectFromIpInfo(): Promise<RegionPolicy | null> {
    try {
        const response = await fetchWithTimeout('https://ipinfo.io/json', 2800);
        if (!response.ok) {
            return null;
        }
        const payload = (await response.json()) as { country?: string };
        const countryCode = normalizeCountryCode(payload.country);
        if (!countryCode) {
            return null;
        }
        return mapCountryToPolicy(countryCode, 'ipinfo');
    } catch {
        return null;
    }
}

function emitRegionPolicy(policy: RegionPolicy): void {
    if (typeof window === 'undefined') {
        return;
    }
    window.dispatchEvent(new CustomEvent(REGION_EVENT, { detail: policy }));
}

export function getRegionPolicySync(): RegionPolicy {
    const stored = readStoredPolicy();
    if (stored) {
        return stored;
    }
    return fallbackPolicy();
}

export async function ensureRegionPolicy(force = false): Promise<RegionPolicy> {
    const stored = readStoredPolicy();
    if (!force && stored && !isPolicyExpired(stored)) {
        return { ...stored, source: 'cache' };
    }

    const fromIpApi = await detectFromIpApi();
    if (fromIpApi) {
        writeStoredPolicy(fromIpApi);
        emitRegionPolicy(fromIpApi);
        return fromIpApi;
    }

    const fromIpWhoIs = await detectFromIpWhoIs();
    if (fromIpWhoIs) {
        writeStoredPolicy(fromIpWhoIs);
        emitRegionPolicy(fromIpWhoIs);
        return fromIpWhoIs;
    }

    const fromIpInfo = await detectFromIpInfo();
    if (fromIpInfo) {
        writeStoredPolicy(fromIpInfo);
        emitRegionPolicy(fromIpInfo);
        return fromIpInfo;
    }

    const fallback = stored ?? fallbackPolicy();
    writeStoredPolicy(fallback);
    emitRegionPolicy(fallback);
    return fallback;
}

export function subscribeRegionPolicy(listener: (policy: RegionPolicy) => void): () => void {
    if (typeof window === 'undefined') {
        return () => { /* noop */ };
    }
    const handler = (event: Event): void => {
        const detail = (event as CustomEvent<RegionPolicy>).detail;
        if (!detail) {
            return;
        }
        listener(detail);
    };
    window.addEventListener(REGION_EVENT, handler as EventListener);
    return () => {
        window.removeEventListener(REGION_EVENT, handler as EventListener);
    };
}

export function detectDomesticUser(): boolean {
    return getRegionPolicySync().isDomestic;
}

export function getCurrentPolicyGroupId(): RegionPolicyGroupId {
    return getRegionPolicySync().policyGroupId;
}

/** Returns the currency label: 积分 for China users, RWAD for overseas */
export function getCurrencyLabel(): string {
    return detectDomesticUser() ? '积分' : 'RWAD';
}
