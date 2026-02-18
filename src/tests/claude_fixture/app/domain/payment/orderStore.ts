import type { UnifiedOrder } from './types';

interface OrderStoreState {
  targetToOrderId: Record<string, string>;
  orderToTarget: Record<string, string>;
  orders: Record<string, UnifiedOrder>;
}

const STORAGE_KEY = 'unimaker_payment_order_store_v1';

function emptyState(): OrderStoreState {
  return {
    targetToOrderId: {},
    orderToTarget: {},
    orders: {},
  };
}

function readState(): OrderStoreState {
  if (typeof localStorage === 'undefined') {
    return emptyState();
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OrderStoreState>;
    return {
      targetToOrderId: parsed.targetToOrderId ?? {},
      orderToTarget: parsed.orderToTarget ?? {},
      orders: parsed.orders ?? {},
    };
  } catch {
    return emptyState();
  }
}

function persist(state: OrderStoreState): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function emitOrderUpdate(order: UnifiedOrder): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent('unimaker:payment-order-updated', { detail: order }));
}

export function bindOrderTarget(targetKey: string, orderId: string): void {
  const state = readState();
  state.targetToOrderId[targetKey] = orderId;
  state.orderToTarget[orderId] = targetKey;
  persist(state);
}

export function getBoundOrderId(targetKey: string): string | null {
  const state = readState();
  return state.targetToOrderId[targetKey] ?? null;
}

export function getTargetByOrderId(orderId: string): string | null {
  const state = readState();
  return state.orderToTarget[orderId] ?? null;
}

export function saveOrderSnapshot(order: UnifiedOrder): void {
  const state = readState();
  state.orders[order.orderId] = order;
  persist(state);
  emitOrderUpdate(order);
}

export function getOrderSnapshot(orderId: string): UnifiedOrder | null {
  const state = readState();
  return state.orders[orderId] ?? null;
}

export function getOrderSnapshotForTarget(targetKey: string): UnifiedOrder | null {
  const state = readState();
  const orderId = state.targetToOrderId[targetKey];
  if (!orderId) {
    return null;
  }
  return state.orders[orderId] ?? null;
}
