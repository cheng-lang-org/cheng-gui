const PREFIX = 'feature_flag_';

function envFlag(name: string): string {
  const key = `VITE_FF_${name.toUpperCase()}`;
  const value = (import.meta.env[key] as string | undefined)?.trim().toLowerCase();
  return value ?? '';
}

function localFlag(name: string): string {
  if (typeof localStorage === 'undefined') {
    return '';
  }
  return (localStorage.getItem(`${PREFIX}${name}`) ?? '').trim().toLowerCase();
}

function parseFlagValue(value: string): boolean | null {
  if (!value) {
    return null;
  }
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'off', 'no', 'disabled'].includes(value)) {
    return false;
  }
  return null;
}

export function getFeatureFlag(name: string, defaultValue = false): boolean {
  const local = parseFlagValue(localFlag(name));
  if (local !== null) {
    return local;
  }
  const env = parseFlagValue(envFlag(name));
  if (env !== null) {
    return env;
  }
  return defaultValue;
}

export function setFeatureFlag(name: string, enabled: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(`${PREFIX}${name}`, enabled ? '1' : '0');
}
