/**
 * Global payment QR code store — persisted in localStorage.
 * Used by ProfilePage (manage) and PublishProductPage (auto-attach).
 */

const KEYS = {
    wechat: 'profile_wechat_qr',
    alipay: 'profile_alipay_qr',
    creditCardEnabled: 'profile_credit_card_enabled_v1',
    settlementWalletAddress: 'profile_custody_wallet_address_v1',
} as const;

export function getWechatQr(): string | null {
    return localStorage.getItem(KEYS.wechat) || null;
}

export function setWechatQr(url: string | null): void {
    if (url) {
        localStorage.setItem(KEYS.wechat, url);
    } else {
        localStorage.removeItem(KEYS.wechat);
    }
}

export function getAlipayQr(): string | null {
    return localStorage.getItem(KEYS.alipay) || null;
}

export function setAlipayQr(url: string | null): void {
    if (url) {
        localStorage.setItem(KEYS.alipay, url);
    } else {
        localStorage.removeItem(KEYS.alipay);
    }
}

export function getCreditCardEnabled(): boolean {
    return localStorage.getItem(KEYS.creditCardEnabled) === '1';
}

export function setCreditCardEnabled(enabled: boolean): void {
    localStorage.setItem(KEYS.creditCardEnabled, enabled ? '1' : '0');
}

export function getSettlementWalletAddress(): string {
    return (localStorage.getItem(KEYS.settlementWalletAddress) ?? '').trim();
}

export function setSettlementWalletAddress(address: string): void {
    const normalized = address.trim();
    if (!normalized) {
        localStorage.removeItem(KEYS.settlementWalletAddress);
        return;
    }
    localStorage.setItem(KEYS.settlementWalletAddress, normalized);
}
