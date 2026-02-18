
const SOCIAL_APPS_KEY = 'social_added_apps_v1';

export function getSocialApps(): string[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(SOCIAL_APPS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function isSocialApp(appId: string): boolean {
    const apps = getSocialApps();
    return apps.includes(appId);
}

export function addSocialApp(appId: string): void {
    const apps = getSocialApps();
    if (!apps.includes(appId)) {
        apps.push(appId);
        localStorage.setItem(SOCIAL_APPS_KEY, JSON.stringify(apps));
    }
}

export function removeSocialApp(appId: string): void {
    const apps = getSocialApps();
    const next = apps.filter(id => id !== appId);
    localStorage.setItem(SOCIAL_APPS_KEY, JSON.stringify(next));
}
