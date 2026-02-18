import type {
  ByopProofReviewItem,
  ByopProofMetadataV1,
  KycTier,
  LegacyPaymentFields,
  OrderState,
  PaymentProfile,
  PaymentProof,
  PaymentIntent,
  PaymentRail,
  PaymentState,
  ProofVerification,
  ProofVerificationMethod,
  ProofVerificationState,
  RevealPaymentResult,
  TradeScene,
  UnifiedOrder,
} from './types';
import { getOrderSnapshot, saveOrderSnapshot } from './orderStore';
import { trackPaymentEvent } from './paymentTelemetry';
import type { JsonValue } from '../../libp2p/definitions';

const PAYMENT_GATEWAY_URL = (import.meta.env.VITE_PAYMENT_GATEWAY_URL as string | undefined)?.trim() || 'http://127.0.0.1:8787';
const PAYMENT_INTERNAL_TOKEN = (import.meta.env.VITE_PAYMENT_INTERNAL_TOKEN as string | undefined)?.trim() || '';
const LOCAL_ACTOR_KEY = 'unimaker_payment_actor_id_v1';
const LOCAL_PROFILE_KEY = 'unimaker_payment_local_profiles_v1';
const LOCAL_PROFILE_INDEX_KEY = 'unimaker_payment_profile_index_v1';
const LOCAL_ORDER_KEY = 'unimaker_payment_local_orders_v1';
const LOCAL_PROOF_KEY = 'unimaker_payment_local_proofs_v1';
const CONTENT_STORAGE_KEY = 'unimaker_distributed_contents_v1';

interface LocalProfileState {
  profiles: Record<string, PaymentProfile>;
}

interface LocalOrderState {
  orders: Record<string, UnifiedOrder>;
}

interface LocalProofState {
  proofs: Record<string, PaymentProof[]>;
}

interface LocalProfileIndexState {
  byDigest: Record<string, string>;
}

interface ApiOrderResponse {
  order: UnifiedOrder;
}

interface ApiProfileResponse {
  paymentProfile: {
    paymentProfileId: string;
    ownerId: string;
    policyGroupId: string;
    kycTier: KycTier;
    visibility: 'ORDER_ONLY';
    wechatQr?: string;
    alipayQr?: string;
    walletAddress?: string;
    creditCardEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

interface ApiProofResponse {
  order: UnifiedOrder;
  proof: PaymentProof;
  verification?: ProofVerification | null;
}

interface ApiPaymentIntentResponse {
  order: UnifiedOrder;
  paymentIntent: PaymentIntent;
}

interface ApiByopProofLatestResponse {
  order: UnifiedOrder;
  proof: PaymentProof;
  verification: ProofVerification | null;
}

interface ApiByopReviewQueueResponse {
  items: ByopProofReviewItem[];
}

export interface PaymentRuntimePolicy {
  policyGroups: string[];
  cnStartupByopOnly: boolean;
  disableOfficialForCn: boolean;
  disableOfficialForIntl: boolean;
  disabledScenes: string[];
  disabledRails: string[];
  disabledPolicyGroups: string[];
  byopProofRequireStructured?: boolean;
  byopUnlockRequiresVerified?: boolean;
  byopAutoVerifyEnabled?: boolean;
  byopScreenshotMaxBytes?: number;
  byopOcrProviderConfigured?: boolean;
  ts: string;
}

export interface EnsurePaymentProfileInput {
  ownerId: string;
  policyGroupId?: string;
  kycTier?: KycTier;
  wechatQr?: string | null;
  alipayQr?: string | null;
  walletAddress?: string;
  creditCardEnabled?: boolean;
}

export interface CreateUnifiedOrderInput {
  scene: TradeScene;
  buyerId: string;
  sellerId: string;
  paymentProfileId: string;
  amountCny: number;
  preferredRail?: PaymentRail;
  policyGroupId?: string;
  metadata?: Record<string, unknown>;
  buyerKycTier?: KycTier;
  sellerKycTier?: KycTier;
}

export interface SubmitByopProofInput {
  proofType?: string;
  proofRef?: string;
  proofHash?: string;
  metadata: ByopProofMetadataV1 | Record<string, unknown>;
}

export type OfficialPaymentProvider = 'WECHAT' | 'ALIPAY';

export interface PublishPaymentMetaInput {
  scene: TradeScene;
  ownerId: string;
  policyGroupId?: string;
  amountCny?: number;
  wechatQr?: string | null;
  alipayQr?: string | null;
  walletAddress?: string;
  creditCardEnabled?: boolean;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

function readProfiles(): LocalProfileState {
  return readJson<LocalProfileState>(LOCAL_PROFILE_KEY, { profiles: {} });
}

function writeProfiles(next: LocalProfileState): void {
  writeJson(LOCAL_PROFILE_KEY, next);
}

function readOrders(): LocalOrderState {
  return readJson<LocalOrderState>(LOCAL_ORDER_KEY, { orders: {} });
}

function writeOrders(next: LocalOrderState): void {
  writeJson(LOCAL_ORDER_KEY, next);
}

function readProofs(): LocalProofState {
  return readJson<LocalProofState>(LOCAL_PROOF_KEY, { proofs: {} });
}

function writeProofs(next: LocalProofState): void {
  writeJson(LOCAL_PROOF_KEY, next);
}

function readProfileIndex(): LocalProfileIndexState {
  return readJson<LocalProfileIndexState>(LOCAL_PROFILE_INDEX_KEY, { byDigest: {} });
}

function writeProfileIndex(next: LocalProfileIndexState): void {
  writeJson(LOCAL_PROFILE_INDEX_KEY, next);
}

function hashDigest(raw: string): string {
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function normalizeQr(raw?: string | null): string {
  return (raw ?? '').trim();
}

function profileDigest(input: EnsurePaymentProfileInput): string {
  return hashDigest(
    [
      input.ownerId,
      input.policyGroupId ?? 'CN',
      normalizeQr(input.wechatQr),
      normalizeQr(input.alipayQr),
      input.walletAddress ?? '',
      input.creditCardEnabled ? '1' : '0',
    ].join('|'),
  );
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function mapProfileResponse(raw: ApiProfileResponse['paymentProfile']): PaymentProfile {
  return {
    paymentProfileId: raw.paymentProfileId,
    ownerId: raw.ownerId,
    policyGroupId: raw.policyGroupId,
    kycTier: raw.kycTier,
    visibility: raw.visibility,
    rails: {
      wechatQr: raw.wechatQr,
      alipayQr: raw.alipayQr,
      walletAddress: raw.walletAddress,
      creditCardEnabled: raw.creditCardEnabled,
    },
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function isByopProofMetadataV1(value: Record<string, unknown> | ByopProofMetadataV1): value is ByopProofMetadataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value.channel === 'string'
    && typeof value.tradeNo === 'string'
    && typeof value.paidAmountCny === 'number'
    && Number.isFinite(value.paidAmountCny)
    && typeof value.paidAt === 'string'
    && typeof value.purchaseSnapshot === 'object'
    && value.purchaseSnapshot !== null
    && !Array.isArray(value.purchaseSnapshot)
  );
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PAYMENT_GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!response.ok) {
    throw new Error(payload.error ?? payload.message ?? `http_${response.status}`);
  }
  return payload;
}

function internalHeaders(): HeadersInit {
  if (!PAYMENT_INTERNAL_TOKEN) {
    return {};
  }
  return {
    'x-internal-token': PAYMENT_INTERNAL_TOKEN,
  };
}

function upsertLocalProfile(input: EnsurePaymentProfileInput): PaymentProfile {
  const profilesState = readProfiles();
  const profileIndex = readProfileIndex();
  const digest = profileDigest(input);
  const indexedId = profileIndex.byDigest[digest];
  if (indexedId && profilesState.profiles[indexedId]) {
    return profilesState.profiles[indexedId];
  }

  const profile: PaymentProfile = {
    paymentProfileId: randomId('pp_local'),
    ownerId: input.ownerId,
    policyGroupId: input.policyGroupId ?? 'CN',
    kycTier: input.kycTier ?? 'L1',
    visibility: 'ORDER_ONLY',
    rails: {
      wechatQr: normalizeQr(input.wechatQr) || undefined,
      alipayQr: normalizeQr(input.alipayQr) || undefined,
      walletAddress: input.walletAddress,
      creditCardEnabled: Boolean(input.creditCardEnabled),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  profilesState.profiles[profile.paymentProfileId] = profile;
  profileIndex.byDigest[digest] = profile.paymentProfileId;
  writeProfiles(profilesState);
  writeProfileIndex(profileIndex);
  return profile;
}

function upsertLocalOrder(order: UnifiedOrder): void {
  const next = readOrders();
  next.orders[order.orderId] = order;
  writeOrders(next);
  saveOrderSnapshot(order);
}

function getLocalOrder(orderId: string): UnifiedOrder | null {
  const cached = getOrderSnapshot(orderId);
  if (cached) {
    return cached;
  }
  const local = readOrders().orders[orderId];
  return local ?? null;
}

export function resolveActorId(): string {
  if (typeof localStorage === 'undefined') {
    return 'web_guest';
  }
  const existing = localStorage.getItem(LOCAL_ACTOR_KEY);
  if (existing && existing.trim()) {
    return existing.trim();
  }
  const fromPeer = (localStorage.getItem('unimaker_local_peer_id_v1') ?? '').trim();
  const actor = fromPeer || randomId('actor');
  localStorage.setItem(LOCAL_ACTOR_KEY, actor);
  return actor;
}

export function extractLegacyPaymentFields(extra: Record<string, unknown> | undefined): LegacyPaymentFields {
  if (!extra) {
    return {};
  }

  const readString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  let wechatQr = readString(extra.wechatQr) ?? readString(extra.wechatQrCode);
  let alipayQr = readString(extra.alipayQr) ?? readString(extra.alipayQrCode);

  const paymentQr = extra.paymentQr;
  if (paymentQr && typeof paymentQr === 'object' && !Array.isArray(paymentQr)) {
    const record = paymentQr as Record<string, unknown>;
    wechatQr = wechatQr ?? readString(record.wechat);
    alipayQr = alipayQr ?? readString(record.alipay);
  }

  return {
    wechatQr,
    alipayQr,
  };
}

export async function ensurePaymentProfileRef(input: EnsurePaymentProfileInput): Promise<string | null> {
  const hasAnyRail =
    Boolean(normalizeQr(input.wechatQr)) ||
    Boolean(normalizeQr(input.alipayQr)) ||
    Boolean(input.walletAddress?.trim()) ||
    Boolean(input.creditCardEnabled);

  if (!hasAnyRail) {
    return null;
  }

  const digest = profileDigest(input);
  const profileIndex = readProfileIndex();
  const localProfiles = readProfiles();
  const existingId = profileIndex.byDigest[digest];
  if (existingId && localProfiles.profiles[existingId]) {
    return existingId;
  }

  try {
    const response = await requestJson<ApiProfileResponse>('/v1/payment-profiles', {
      method: 'POST',
      body: JSON.stringify({
        ownerId: input.ownerId,
        policyGroupId: input.policyGroupId ?? 'CN',
        kycTier: input.kycTier ?? 'L1',
        rails: {
          wechatQr: normalizeQr(input.wechatQr) || undefined,
          alipayQr: normalizeQr(input.alipayQr) || undefined,
        },
        walletAddress: input.walletAddress,
        creditCardEnabled: Boolean(input.creditCardEnabled),
      }),
    });
    const profile = mapProfileResponse(response.paymentProfile);
    localProfiles.profiles[profile.paymentProfileId] = profile;
    profileIndex.byDigest[digest] = profile.paymentProfileId;
    writeProfiles(localProfiles);
    writeProfileIndex(profileIndex);
    trackPaymentEvent('payment_profile_created_remote', { paymentProfileId: profile.paymentProfileId });
    return profile.paymentProfileId;
  } catch (error) {
    const fallback = upsertLocalProfile(input);
    trackPaymentEvent('payment_profile_created_local_fallback', {
      paymentProfileId: fallback.paymentProfileId,
      reason: (error as Error).message,
    });
    return fallback.paymentProfileId;
  }
}

export async function resolvePaymentProfileRefFromContentExtra(
  extra: Record<string, unknown> | undefined,
  ownerId: string,
): Promise<string | null> {
  const ref = extra?.paymentProfileRef;
  if (typeof ref === 'string' && ref.trim().length > 0) {
    return ref.trim();
  }
  const legacy = extractLegacyPaymentFields(extra);
  if (!legacy.wechatQr && !legacy.alipayQr) {
    return null;
  }
  return ensurePaymentProfileRef({
    ownerId,
    policyGroupId: 'CN',
    wechatQr: legacy.wechatQr,
    alipayQr: legacy.alipayQr,
    kycTier: 'L1',
  });
}

export async function migrateLegacyPaymentFieldsInLocalFeed(): Promise<number> {
  if (typeof localStorage === 'undefined') {
    return 0;
  }
  const raw = localStorage.getItem(CONTENT_STORAGE_KEY);
  if (!raw) {
    return 0;
  }
  let items: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return 0;
    }
    items = parsed as Array<Record<string, unknown>>;
  } catch {
    return 0;
  }

  let changed = 0;
  for (const item of items) {
    const extra = (item.extra && typeof item.extra === 'object' && !Array.isArray(item.extra)
      ? (item.extra as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    if (typeof extra.paymentProfileRef === 'string' && extra.paymentProfileRef.trim()) {
      continue;
    }

    const ownerId = typeof item.userId === 'string' && item.userId.trim() ? item.userId : resolveActorId();
    const ref = await resolvePaymentProfileRefFromContentExtra(extra, ownerId);
    if (!ref) {
      continue;
    }

    extra.paymentProfileRef = ref;
    delete extra.paymentQr;
    delete extra.wechatQr;
    delete extra.alipayQr;
    delete extra.wechatQrCode;
    delete extra.alipayQrCode;
    item.extra = extra;
    changed += 1;
  }

  if (changed > 0) {
    localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(items));
    trackPaymentEvent('legacy_payment_profile_migrated', { count: changed });
  }

  return changed;
}

export async function createUnifiedOrder(input: CreateUnifiedOrderInput): Promise<UnifiedOrder> {
  try {
    const response = await requestJson<{ order: UnifiedOrder }>('/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        preferredRail: input.preferredRail ?? 'BYOP_WECHAT',
        policyGroupId: input.policyGroupId ?? 'CN',
        metadata: input.metadata ?? {},
        buyerKycTier: input.buyerKycTier ?? 'L1',
        sellerKycTier: input.sellerKycTier ?? 'L1',
      }),
    });
    upsertLocalOrder(response.order);
    return response.order;
  } catch (error) {
    const now = new Date().toISOString();
    const order: UnifiedOrder = {
      orderId: randomId('ord_local'),
      scene: input.scene,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      paymentProfileId: input.paymentProfileId,
      amountCny: Number(input.amountCny.toFixed(2)),
      preferredRail: input.preferredRail ?? 'BYOP_WECHAT',
      orderState: 'CREATED',
      paymentState: 'UNPAID',
      policyGroupId: input.policyGroupId ?? 'CN',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    };
    upsertLocalOrder(order);
    trackPaymentEvent('order_created_local_fallback', {
      orderId: order.orderId,
      reason: (error as Error).message,
    });
    return order;
  }
}

function patchLocalOrder(orderId: string, patch: Partial<UnifiedOrder>): UnifiedOrder {
  const local = getLocalOrder(orderId);
  if (!local) {
    throw new Error('order_not_found');
  }
  const updated: UnifiedOrder = {
    ...local,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  upsertLocalOrder(updated);
  return updated;
}

export async function acceptUnifiedOrder(orderId: string, sellerId: string): Promise<UnifiedOrder> {
  try {
    const response = await requestJson<ApiOrderResponse>(`/v1/orders/${encodeURIComponent(orderId)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ sellerId }),
    });
    upsertLocalOrder(response.order);
    return response.order;
  } catch {
    return patchLocalOrder(orderId, {
      orderState: 'AWAIT_PAY',
      paymentState: 'PROOF_PENDING',
    });
  }
}

export async function submitByopProof(
  orderId: string,
  buyerId: string,
  proof: SubmitByopProofInput,
): Promise<{ order: UnifiedOrder; proof: PaymentProof; verification: ProofVerification | null }> {
  const proofType = proof.proofType?.trim() || 'BYOP_RECEIPT_V1';
  const structured = isByopProofMetadataV1(proof.metadata) ? proof.metadata : null;
  const proofRef = proof.proofRef?.trim() || structured?.tradeNo?.trim() || '';
  if (!proofRef) {
    throw new Error('proof_ref_required');
  }
  try {
    const response = await requestJson<ApiProofResponse>(`/v1/orders/${encodeURIComponent(orderId)}/pay/byop-proof`, {
      method: 'POST',
      body: JSON.stringify({
        buyerId,
        proofType,
        proofRef,
        proofHash: proof.proofHash,
        metadata: proof.metadata,
      }),
    });
    upsertLocalOrder(response.order);
    return {
      order: response.order,
      proof: response.proof,
      verification: response.verification ?? null,
    };
  } catch {
    const updatedOrder = patchLocalOrder(orderId, {
      orderState: 'PAY_PROOF_SUBMITTED',
      paymentState: 'PAID_UNVERIFIED',
    });
    const proofRecord: PaymentProof = {
      proofId: randomId('proof_local'),
      orderId,
      buyerId,
      proofType,
      proofRef,
      proofHash: proof.proofHash,
      metadata: proof.metadata,
      submittedAt: new Date().toISOString(),
    };
    const state = readProofs();
    const queue = state.proofs[orderId] ?? [];
    queue.push(proofRecord);
    state.proofs[orderId] = queue;
    writeProofs(state);
    return {
      order: updatedOrder,
      proof: proofRecord,
      verification: null,
    };
  }
}

export async function createOfficialPaymentIntent(
  orderId: string,
  provider: OfficialPaymentProvider,
  returnUrl?: string,
): Promise<{ order: UnifiedOrder; paymentIntent: PaymentIntent }> {
  const payload = await requestJson<ApiPaymentIntentResponse>(`/v1/orders/${encodeURIComponent(orderId)}/pay/create`, {
    method: 'POST',
    body: JSON.stringify({
      provider,
      returnUrl: returnUrl ?? 'unimaker://pay/return',
    }),
  });
  upsertLocalOrder(payload.order);
  return payload;
}

export async function getPaymentRuntimePolicy(): Promise<PaymentRuntimePolicy | null> {
  try {
    return await requestJson<PaymentRuntimePolicy>('/v1/policy/runtime');
  } catch {
    return null;
  }
}

export async function getUnifiedOrder(orderId: string): Promise<UnifiedOrder> {
  try {
    const response = await requestJson<ApiOrderResponse>(`/v1/orders/${encodeURIComponent(orderId)}`);
    upsertLocalOrder(response.order);
    return response.order;
  } catch {
    const local = getLocalOrder(orderId);
    if (!local) {
      throw new Error('order_not_found');
    }
    return local;
  }
}

export async function getLatestByopProof(orderId: string): Promise<ApiByopProofLatestResponse> {
  try {
    const response = await requestJson<ApiByopProofLatestResponse>(
      `/v1/orders/${encodeURIComponent(orderId)}/pay/byop-proof/latest`,
    );
    upsertLocalOrder(response.order);
    return response;
  } catch {
    const localOrder = getLocalOrder(orderId);
    if (!localOrder) {
      throw new Error('order_not_found');
    }
    const localProofs = readProofs().proofs[orderId] ?? [];
    const latest = localProofs[localProofs.length - 1];
    if (!latest) {
      throw new Error('proof_not_found');
    }
    return {
      order: localOrder,
      proof: latest,
      verification: null,
    };
  }
}

export async function listByopProofReviewQueue(input?: {
  states?: ProofVerificationState[];
  limit?: number;
}): Promise<ByopProofReviewItem[]> {
  const query = new URLSearchParams();
  if (Array.isArray(input?.states) && input?.states.length > 0) {
    query.set('states', input.states.join(','));
  }
  if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) {
    query.set('limit', String(Math.max(1, Math.min(100, Math.floor(input.limit)))));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await requestJson<ApiByopReviewQueueResponse>(`/v1/internal/byop-proof/review-queue${suffix}`, {
    headers: internalHeaders(),
  });
  return Array.isArray(response.items) ? response.items : [];
}

export async function verifyByopProof(
  orderId: string,
  input: {
    proofId?: string;
    verdict: Exclude<ProofVerificationState, 'PENDING'>;
    method?: ProofVerificationMethod;
    confidence?: number;
    reasonCodes?: string[];
    extractedFields?: Record<string, unknown>;
    reviewerId?: string;
  },
): Promise<{ order: UnifiedOrder; proof: PaymentProof; verification: ProofVerification | null }> {
  const response = await requestJson<ApiProofResponse>(`/v1/orders/${encodeURIComponent(orderId)}/pay/byop-proof/verify`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({
      proofId: input.proofId,
      verdict: input.verdict,
      method: input.method ?? 'MANUAL',
      confidence: input.confidence,
      reasonCodes: input.reasonCodes ?? [],
      extractedFields: input.extractedFields ?? {},
      reviewerId: input.reviewerId,
    }),
  });
  upsertLocalOrder(response.order);
  return {
    order: response.order,
    proof: response.proof,
    verification: response.verification ?? null,
  };
}

export async function revealPaymentForOrder(orderId: string, buyerId: string): Promise<RevealPaymentResult> {
  try {
    const response = await requestJson<RevealPaymentResult>('/v1/access/reveal-payment', {
      method: 'POST',
      body: JSON.stringify({ orderId, buyerId }),
    });
    upsertLocalOrder(response.order);
    return response;
  } catch {
    const order = getLocalOrder(orderId);
    if (!order) {
      throw new Error('order_not_found');
    }
    if (order.buyerId !== buyerId) {
      throw new Error('buyer_mismatch');
    }
    const profiles = readProfiles();
    const profile = profiles.profiles[order.paymentProfileId];
    if (!profile) {
      throw new Error('payment_profile_not_found');
    }

    if (order.orderState === 'CREATED') {
      patchLocalOrder(orderId, {
        orderState: 'AWAIT_PAY',
        paymentState: order.paymentState === 'UNPAID' ? 'PROOF_PENDING' : order.paymentState,
      });
    }

    return {
      accessToken: randomId('atk_local'),
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
      order: getLocalOrder(orderId) ?? order,
      paymentProfile: {
        paymentProfileId: profile.paymentProfileId,
        rails: {
          wechatQr: profile.rails.wechatQr,
          alipayQr: profile.rails.alipayQr,
          walletAddress: profile.rails.walletAddress,
          creditCardEnabled: profile.rails.creditCardEnabled,
        },
      },
    };
  }
}

export async function openOrderDispute(orderId: string, openedBy: string, reason: string): Promise<UnifiedOrder> {
  try {
    const response = await requestJson<ApiOrderResponse>(`/v1/orders/${encodeURIComponent(orderId)}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ openedBy, reason }),
    });
    upsertLocalOrder(response.order);
    return response.order;
  } catch {
    return patchLocalOrder(orderId, { orderState: 'DISPUTED' });
  }
}

export async function resolveOrderDispute(orderId: string, resolverId: string, resolution: string): Promise<UnifiedOrder> {
  try {
    const response = await requestJson<ApiOrderResponse>(`/v1/orders/${encodeURIComponent(orderId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolverId, resolution }),
    });
    upsertLocalOrder(response.order);
    return response.order;
  } catch {
    return patchLocalOrder(orderId, {
      orderState: 'COMPLETED',
      paymentState: 'PAID_VERIFIED',
    });
  }
}

export async function createPublishPaymentMeta(input: PublishPaymentMetaInput): Promise<Record<string, JsonValue>> {
  const paymentProfileRef = await ensurePaymentProfileRef({
    ownerId: input.ownerId,
    policyGroupId: input.policyGroupId ?? 'CN',
    kycTier: 'L1',
    wechatQr: input.wechatQr,
    alipayQr: input.alipayQr,
    walletAddress: input.walletAddress,
    creditCardEnabled: input.creditCardEnabled,
  });

  const meta: Record<string, JsonValue> = {
    tradeScene: input.scene,
    policyGroupId: input.policyGroupId ?? 'CN',
    settlementPrimary: (input.policyGroupId ?? 'CN') === 'CN' || Boolean(input.creditCardEnabled) ? 'FIAT' : 'RWAD',
  };

  if (paymentProfileRef) {
    meta.paymentProfileRef = paymentProfileRef;
  }

  if (typeof input.amountCny === 'number' && Number.isFinite(input.amountCny) && input.amountCny > 0) {
    meta.amountCny = Number(input.amountCny.toFixed(2));
  }

  if (input.walletAddress?.trim()) {
    meta.walletAddress = input.walletAddress.trim();
  }

  if (input.creditCardEnabled) {
    meta.creditCardEnabled = true;
  }

  return meta;
}

function extractOrderIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const candidates = ['orderId', 'order_id', 'out_trade_no', 'merchantOrderId'];
    for (const key of candidates) {
      const value = parsed.searchParams.get(key);
      if (value && value.trim()) {
        return value.trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function queryOrderFromReturnUrl(url: string): Promise<UnifiedOrder | null> {
  const orderId = extractOrderIdFromUrl(url);
  if (!orderId) {
    return null;
  }
  try {
    const order = await getUnifiedOrder(orderId);
    trackPaymentEvent('payment_return_order_query', {
      orderId,
      state: order.orderState,
      paymentState: order.paymentState,
    });
    return order;
  } catch (error) {
    trackPaymentEvent('payment_return_order_query_failed', {
      orderId,
      reason: (error as Error).message,
    });
    return null;
  }
}

export function registerPaymentReturnListener(onUrl: (url: string) => void): () => void {
  const appPlugin = (globalThis as { Capacitor?: { Plugins?: { App?: { addListener?: (event: string, cb: (payload: { url: string }) => void) => { remove: () => Promise<void> } } } } }).Capacitor?.Plugins?.App;
  let listener: { remove: () => Promise<void> } | null = null;

  if (appPlugin?.addListener) {
    listener = appPlugin.addListener('appUrlOpen', (payload) => {
      onUrl(payload.url);
    });
  }

  const hashHandler = (): void => {
    if (typeof window === 'undefined') {
      return;
    }
    const current = window.location.href;
    if (current.includes('orderId=') || current.includes('out_trade_no=')) {
      onUrl(current);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', hashHandler);
    window.addEventListener('popstate', hashHandler);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', hashHandler);
      window.removeEventListener('popstate', hashHandler);
    }
    if (listener) {
      void listener.remove();
    }
  };
}

export function isOrderUnlockReady(order: UnifiedOrder | null): boolean {
  if (!order) {
    return false;
  }
  const unlockableStates: OrderState[] = ['FULFILLING', 'COMPLETED'];
  const unlockablePayments: PaymentState[] = ['PAID_VERIFIED'];
  return unlockableStates.includes(order.orderState) && unlockablePayments.includes(order.paymentState);
}
