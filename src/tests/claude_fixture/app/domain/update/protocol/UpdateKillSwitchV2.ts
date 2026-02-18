import type { UpdateManifestVrfProofV2 } from './UpdateManifestV2';
import { parseManifestVrfSecurity } from './UpdateManifestV2';

export interface UpdateKillSwitchV2 {
  kind: string;
  schema_version: number;
  sequence?: number;
  channel?: string;
  platform?: string;
  enabled: boolean;
  reason: string;
  issued_at_ms: number;
  expires_at_ms?: number;
  signer?: string;
  signature?: string;
  vrf?: UpdateManifestVrfProofV2;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

export function isLikelyKillSwitchV2(value: unknown): boolean {
  const obj = asObject(value);
  if (!obj) {
    return false;
  }
  const kind = asString(obj.kind).toLowerCase();
  if (kind.includes('killswitch') || kind.includes('kill_switch')) {
    return true;
  }
  return obj.enabled !== undefined && obj.platform !== undefined;
}

export function parseKillSwitchV2(value: unknown): UpdateKillSwitchV2 | null {
  const obj = asObject(value);
  if (!obj || !isLikelyKillSwitchV2(obj)) {
    return null;
  }
  const hasExpiry = obj.expires_at_ms !== undefined && obj.expires_at_ms !== null && String(obj.expires_at_ms).length > 0;
  const sequenceRaw = obj.sequence;
  const hasSequence = sequenceRaw !== undefined && sequenceRaw !== null && String(sequenceRaw).length > 0;
  return {
    kind: asString(obj.kind, 'killswitch_v2') || 'killswitch_v2',
    schema_version: Math.max(2, Math.trunc(asNumber(obj.schema_version, 2))),
    sequence: hasSequence ? Math.max(0, Math.trunc(asNumber(sequenceRaw, 0))) : undefined,
    channel: asString(obj.channel).trim() || undefined,
    platform: asString(obj.platform).trim() || undefined,
    enabled: asBoolean(obj.enabled, true),
    reason: asString(obj.reason, 'killswitch') || 'killswitch',
    issued_at_ms: Math.trunc(asNumber(obj.issued_at_ms ?? obj.timestamp_ms, Date.now())),
    expires_at_ms: hasExpiry ? Math.trunc(asNumber(obj.expires_at_ms, 0)) : undefined,
    signer: asString(obj.signer).trim() || undefined,
    signature: asString(obj.signature).trim() || undefined,
    vrf: parseManifestVrfSecurity(obj.vrf),
  };
}

export function killSwitchIsActive(killSwitch: UpdateKillSwitchV2, nowMs: number = Date.now()): boolean {
  if (!killSwitch.enabled) {
    return false;
  }
  if (killSwitch.expires_at_ms === undefined) {
    return true;
  }
  return nowMs <= killSwitch.expires_at_ms;
}

export function killSwitchAppliesTo(killSwitch: UpdateKillSwitchV2, channel: string, platform: string): boolean {
  if (killSwitch.channel && killSwitch.channel.toLowerCase() !== channel.toLowerCase()) {
    return false;
  }
  if (killSwitch.platform && killSwitch.platform.toLowerCase() !== platform.toLowerCase()) {
    return false;
  }
  return true;
}
