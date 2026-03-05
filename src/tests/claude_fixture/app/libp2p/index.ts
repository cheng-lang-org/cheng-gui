import { registerPlugin } from '@capacitor/core';
import type { Libp2pBridgePlugin } from './definitions';
import { invokeWebBridgeFallback, shouldEnableWebBridgeFallback } from './webBridgeFallback';

const baseBridge = registerPlugin<Libp2pBridgePlugin>('Libp2pBridge');

function shouldFallbackFromError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : `${error ?? ''}`;
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized.includes('native_platform_required')
    || normalized.includes('bridge_method_unavailable')
    || normalized.includes('plugin is not implemented')
    || normalized.includes('unimplemented')
    || normalized.includes('unavailable')
    || normalized.includes('not available')
    || normalized.includes('not implemented');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function containsNodeInitError(value: unknown): boolean {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  return text.includes('node_init_failed_without_detail')
    || text.includes('native_platform_required')
    || text.includes('native_bridge_unavailable');
}

function shouldFallbackFromResult(method: string, result: unknown): boolean {
  const normalizedMethod = method.trim();
  const record = asRecord(result);
  if (!record) {
    return false;
  }
  if ((normalizedMethod === 'init' || normalizedMethod === 'start') && record.ok === false) {
    return true;
  }
  if (normalizedMethod === 'isStarted') {
    return record.started === false;
  }
  if (normalizedMethod === 'getLocalPeerId') {
    const peerId = typeof record.peerId === 'string' ? record.peerId.trim() : '';
    return peerId.length === 0;
  }
  if (normalizedMethod === 'runtimeHealth') {
    const started = Boolean(record.started ?? record.isStarted);
    const nativeReady = Boolean(record.native_ready ?? record.nativeReady);
    const errorText = record.last_error ?? record.lastError;
    if (!started && !nativeReady && containsNodeInitError(errorText)) {
      return true;
    }
  }
  return false;
}

const bridgeWithFallback = new Proxy(baseBridge as unknown as Record<string, unknown>, {
  get(target, prop, receiver) {
    if (prop === 'then') {
      return undefined;
    }
    if (typeof prop !== 'string') {
      return Reflect.get(target, prop, receiver);
    }
    const baseMember = Reflect.get(target, prop, receiver);
    const fallbackEnabled = shouldEnableWebBridgeFallback();
    if (!fallbackEnabled) {
      return typeof baseMember === 'function' ? (baseMember as Function).bind(target) : baseMember;
    }
    return async (payload?: Record<string, unknown>) => {
      if (typeof baseMember === 'function') {
        try {
          const nativeResult = await (baseMember as (args?: Record<string, unknown>) => Promise<unknown>)(payload);
          if (!shouldFallbackFromResult(prop, nativeResult)) {
            return nativeResult;
          }
        } catch (error) {
          if (!shouldFallbackFromError(error)) {
            throw error;
          }
        }
      }
      return invokeWebBridgeFallback(prop, payload ?? {});
    };
  },
});

export const Libp2pBridge = bridgeWithFallback as unknown as Libp2pBridgePlugin;

export * from './definitions';
