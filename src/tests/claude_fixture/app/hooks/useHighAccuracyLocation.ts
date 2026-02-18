import { useCallback, useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export interface CapturedLocation {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
    speed: number | null;
    heading: number | null;
  };
  timestamp: number;
}

export type HighAccuracyLocationErrorCode = 'permission_denied' | 'accuracy_too_low' | 'timeout' | 'unavailable';

export interface StrictLocationCaptureOptions {
  requiredAccuracyMeters?: number;
  timeoutMs?: number;
  maximumAgeMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAXIMUM_AGE_MS = 0;
const DEFAULT_REQUIRED_ACCURACY_METERS = 50;

export class HighAccuracyLocationError extends Error {
  readonly code: HighAccuracyLocationErrorCode;

  constructor(code: HighAccuracyLocationErrorCode, message: string) {
    super(message);
    this.name = 'HighAccuracyLocationError';
    this.code = code;
  }
}

function toCapturedLocation(position: GeolocationPosition | { coords: GeolocationCoordinates; timestamp: number }): CapturedLocation {
  return {
    coords: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      altitude: position.coords.altitude ?? null,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed ?? null,
      heading: position.coords.heading ?? null,
    },
    timestamp: position.timestamp,
  };
}

function ensureAccuracy(captured: CapturedLocation, requiredAccuracyMeters: number): void {
  const accuracy = captured.coords.accuracy;
  if (!Number.isFinite(accuracy)) {
    throw new HighAccuracyLocationError('unavailable', '无法获取有效的定位精度');
  }
  if (accuracy > requiredAccuracyMeters) {
    throw new HighAccuracyLocationError(
      'accuracy_too_low',
      `定位精度不足（当前 ±${Math.round(accuracy)}m，要求 ≤${requiredAccuracyMeters}m）`,
    );
  }
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '';
}

function normalizeUnknownError(error: unknown): HighAccuracyLocationError {
  if (error instanceof HighAccuracyLocationError) {
    return error;
  }
  const message = asErrorMessage(error).toLowerCase();
  if (message.includes('permission') || message.includes('denied') || message.includes('not authorized')) {
    return new HighAccuracyLocationError('permission_denied', '定位权限被拒绝，请在系统设置中开启定位权限');
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return new HighAccuracyLocationError('timeout', '定位超时，请重试');
  }
  if (message.includes('unavailable') || message.includes('position unavailable') || message.includes('location unavailable')) {
    return new HighAccuracyLocationError('unavailable', '定位服务不可用，请检查 GPS 开关');
  }
  return new HighAccuracyLocationError('unavailable', asErrorMessage(error) || '定位失败');
}

async function ensureNativeLocationPermission(): Promise<void> {
  const permissions = await Geolocation.checkPermissions().catch(() => null);
  const coarseBefore = (permissions as { coarseLocation?: string } | null)?.coarseLocation ?? '';
  const locationBefore = permissions?.location ?? 'prompt';
  const grantedBefore = locationBefore === 'granted' || coarseBefore === 'granted';
  if (grantedBefore) {
    return;
  }
  const requested = await Geolocation.requestPermissions().catch(() => null);
  const coarseAfter = (requested as { coarseLocation?: string } | null)?.coarseLocation ?? '';
  const locationAfter = requested?.location ?? 'denied';
  const grantedAfter = locationAfter === 'granted' || coarseAfter === 'granted';
  if (!grantedAfter) {
    throw new HighAccuracyLocationError('permission_denied', '定位权限被拒绝，请在系统设置中开启定位权限');
  }
}

async function captureFromNative(timeoutMs: number, maximumAgeMs: number): Promise<CapturedLocation> {
  await ensureNativeLocationPermission();
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: timeoutMs,
    maximumAge: maximumAgeMs,
  });
  return toCapturedLocation(position as unknown as GeolocationPosition);
}

async function captureFromWeb(timeoutMs: number, maximumAgeMs: number): Promise<CapturedLocation> {
  if (!navigator.geolocation) {
    throw new HighAccuracyLocationError('unavailable', '当前设备不支持 GPS 定位');
  }
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (result) => resolve(result),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new HighAccuracyLocationError('permission_denied', '定位权限被拒绝，请在浏览器设置中开启'));
          return;
        }
        if (error.code === error.TIMEOUT) {
          reject(new HighAccuracyLocationError('timeout', '定位超时，请重试'));
          return;
        }
        if (error.code === error.POSITION_UNAVAILABLE) {
          reject(new HighAccuracyLocationError('unavailable', '定位服务不可用，请检查 GPS 开关'));
          return;
        }
        reject(new HighAccuracyLocationError('unavailable', error.message || '定位失败'));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      },
    );
  });
  return toCapturedLocation(position);
}

export async function captureStrictHighAccuracyLocation(
  options: StrictLocationCaptureOptions = {},
): Promise<CapturedLocation> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maximumAgeMs = options.maximumAgeMs ?? DEFAULT_MAXIMUM_AGE_MS;
  const requiredAccuracyMeters = options.requiredAccuracyMeters ?? DEFAULT_REQUIRED_ACCURACY_METERS;
  try {
    const captured = Capacitor.isNativePlatform()
      ? await captureFromNative(timeoutMs, maximumAgeMs)
      : await captureFromWeb(timeoutMs, maximumAgeMs);
    ensureAccuracy(captured, requiredAccuracyMeters);
    return captured;
  } catch (error) {
    throw normalizeUnknownError(error);
  }
}

export function useHighAccuracyLocation() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [location, setLocation] = useState<CapturedLocation | null>(null);

  const fetchLocation = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const loc = await captureStrictHighAccuracyLocation();
      setLocation(loc);
      setStatus('success');
      return loc;
    } catch (err) {
      const normalized = normalizeUnknownError(err);
      setError(normalized.message);
      setStatus('error');
      throw normalized;
    }
  }, []);

  useEffect(() => {
    fetchLocation().catch(() => { });
  }, [fetchLocation]);

  return {
    location,
    error,
    status,
    fetchLocation,
    captureHighAccuracyLocation: fetchLocation,
  };
}
