import type { JsonValue } from '../../libp2p/definitions';

export interface PaymentTelemetryEvent {
  name: string;
  ts: number;
  fields: Record<string, JsonValue>;
}

export function trackPaymentEvent(name: string, fields: Record<string, JsonValue> = {}): void {
  const payload: PaymentTelemetryEvent = {
    name,
    ts: Date.now(),
    fields,
  };
  // Keep this as a stable debug stream for mobile shell diagnostics.
  // eslint-disable-next-line no-console
  console.info('[payment-metric]', payload);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('unimaker:payment-metric', { detail: payload }));
  }
}
