import { getCurrentPolicyGroupId } from '../../utils/region';
import { getFeatureFlag } from '../../utils/featureFlags';
import { getWalletPrivateKey, loadWallets } from '../../utils/walletChains';
import { clearSessionVault, loadSessionVault, saveSessionVault } from '../../utils/sessionVault';
import { getLibp2pRuntime, type RuntimeEvent } from '../../libp2p/runtime';
import { libp2pService } from '../../libp2p/service';
import { submitSignedTx } from '../rwad/rwadGateway';
import { signDexEnvelopePayload } from './codec';
import { DexC2CBridgeService, runDexToC2CFallback, type C2CToDexHedgeSignal } from './c2cBridge';
import { checkDailyLimit, consumeDailyLimit } from './limitEngine';
import { createMemorySecureSigner, type MemorySecureSigner } from './sessionSigner';
import {
  computeSessionPolicyRef,
  consumeSessionPolicyExposure,
  getSessionPolicyExposure,
  policyGateCanExecute,
  validatePolicy,
} from './sessionPolicyEngine';
import {
  DEX_MARKETS,
  getDexMakerFundConfig,
  getDexMarketConfigById,
  roundToLot,
  roundToTick,
  type DexAssetCode,
} from './marketConfig';
import {
  bestBidAsk,
  buildDepthFromOrders,
  dexOrderbookStore,
  estimateDepthFill,
  normalizeDexEnvelope,
  pickOpenOrders,
  pickRecentMatches,
  type DexOrderbookStore,
} from './orderbookStore';
import {
  computeEffectiveSpread,
  computeInventoryAdjBps,
  computeLatencyAdjBps,
  computeVolAdjBps,
  quotePriceWithSpread,
} from './spreadEngine';
import {
  DEX_RENDEZVOUS_NS,
  DEX_TOPICS,
  type DexC2CLinkV1,
  type DexMarketId,
  type DexMatchV1,
  type DexOrderRecord,
  type DexOrderType,
  type DexSide,
  type SecureSigner,
  type SessionContext,
  type DexSignerIdentity,
  type DexSnapshot,
  type DexTimeInForce,
} from './types';
import type { JsonValue } from '../../libp2p/definitions';

const DISCOVERY_INTERVAL_MS = 45_000;
const SNAPSHOT_INTERVAL_MS = 20_000;
const DEPTH_STALENESS_INTERVAL_MS = 5_000;

type DexListener = (snapshot: DexSnapshot) => void;

export interface SubmitDexOrderInput {
  marketId: DexMarketId;
  side: DexSide;
  type: DexOrderType;
  timeInForce?: DexTimeInForce;
  qty: number;
  price?: number;
  clientOrderId?: string;
  metadata?: Record<string, JsonValue>;
}

export interface SubmitDexOrderResult {
  ok: boolean;
  orderId?: string;
  reason?: string;
  filledQty?: number;
  fallbackOrderId?: string;
}

interface SettleResult {
  ok: boolean;
  lockTxHash?: string;
  releaseTxHash?: string;
  state?: 'PENDING' | 'LOCKED' | 'RELEASED' | 'FAILED';
  reason?: string;
}

export interface DexAsiSessionState {
  enabled: boolean;
  active: boolean;
  sessionId: string;
  expiresAt: number;
  signerMode: 'session' | 'root';
  policyRef: string;
  consumedRWAD: number;
  remainingRWAD: number;
  reason?: string;
}

type DexAsiSessionListener = (state: DexAsiSessionState) => void;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeQty(value: number): number {
  return Number(Math.max(0, value).toFixed(8));
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function p95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

function metric(name: string, fields: Record<string, JsonValue> = {}): void {
  const payload = {
    name,
    ts: Date.now(),
    fields,
  };
  console.info('[dex-metric]', payload);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dex-metric', { detail: payload }));
  }
}

function isOpenOrder(order: DexOrderRecord): boolean {
  return order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED';
}

function marketAssetCode(marketId: DexMarketId): DexAssetCode {
  return getDexMarketConfigById(marketId)?.baseAsset ?? 'BTC';
}

function shouldAllowFallback(input: SubmitDexOrderInput): boolean {
  const metadata = (input.metadata ?? {}) as Record<string, unknown>;
  if (metadata.noFallback === true || metadata.skipFallback === true) {
    return false;
  }
  if (typeof metadata.source === 'string' && metadata.source === 'c2c_hedge') {
    return false;
  }
  return true;
}

class DexSyncService {
  private runtime = getLibp2pRuntime();
  private listeners = new Set<DexListener>();
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeTopics: Array<() => void> = [];
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private stalenessTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private localPeerId = '';
  private defaultSigner: DexSignerIdentity | null = null;
  private sequenceByMarket: Record<DexMarketId, number> = {
    'BTC-USDC': 0,
    'BTC-USDT': 0,
    'XAU-USDC': 0,
    'XAU-USDT': 0,
  };
  private recentMatchConfirmLatencies: number[] = [];
  private c2cBridge = new DexC2CBridgeService();
  private asiSessionEnabled = false;
  private asiSessionContext: SessionContext | null = null;
  private asiPolicyRef = '';
  private asiSigner: MemorySecureSigner | null = null;
  private asiListeners = new Set<DexAsiSessionListener>();

  subscribe(listener: DexListener): () => void {
    this.listeners.add(listener);
    listener(dexOrderbookStore.getSnapshot());
    if (!this.unsubscribeStore) {
      this.unsubscribeStore = dexOrderbookStore.subscribe((snapshot) => {
        for (const cb of this.listeners) {
          cb(snapshot);
        }
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unsubscribeStore) {
        this.unsubscribeStore();
        this.unsubscribeStore = null;
      }
    };
  }

  subscribeAsiSession(listener: DexAsiSessionListener): () => void {
    this.asiListeners.add(listener);
    listener(this.getAsiSessionState());
    return () => {
      this.asiListeners.delete(listener);
    };
  }

  getAsiSessionState(): DexAsiSessionState {
    if (!this.asiSessionEnabled || !this.asiSessionContext) {
      return {
        enabled: this.asiSessionEnabled,
        active: false,
        sessionId: '',
        expiresAt: 0,
        signerMode: 'root',
        policyRef: '',
        consumedRWAD: 0,
        remainingRWAD: 500,
      };
    }
    const exposure = getSessionPolicyExposure(this.asiSessionContext);
    return {
      enabled: this.asiSessionEnabled,
      active: this.asiSessionContext.policy.expiresAt > Date.now(),
      sessionId: this.asiSessionContext.policy.sessionId,
      expiresAt: this.asiSessionContext.policy.expiresAt,
      signerMode: this.asiSessionContext.signerMode,
      policyRef: this.asiPolicyRef,
      consumedRWAD: exposure.consumedRWAD,
      remainingRWAD: exposure.remainingRWAD,
    };
  }

  private emitAsiState(reason?: string): void {
    const next = this.getAsiSessionState();
    const payload = reason ? { ...next, reason } : next;
    for (const listener of this.asiListeners) {
      listener(payload);
    }
    metric('asi_session_state', {
      enabled: payload.enabled ? 1 : 0,
      active: payload.active ? 1 : 0,
      sessionId: payload.sessionId,
      expiresAt: payload.expiresAt,
      consumed: payload.consumedRWAD,
      remaining: payload.remainingRWAD,
      reason: payload.reason ?? '',
    });
  }

  private resolveAsiSigner(signer: DexSignerIdentity): MemorySecureSigner {
    if (this.asiSigner) {
      return this.asiSigner;
    }
    this.asiSigner = createMemorySecureSigner(signer.privateKeyPkcs8, signer.address);
    return this.asiSigner;
  }

  private restoreAsiSessionIfNeeded(): void {
    const restored = loadSessionVault();
    if (!restored || !this.defaultSigner) {
      return;
    }
    if (restored.sessionContext.policy.walletId !== this.defaultSigner.address) {
      clearSessionVault();
      return;
    }
    this.asiSessionContext = restored.sessionContext;
    this.asiPolicyRef = restored.policyHash || computeSessionPolicyRef(restored.sessionContext.policy);
    this.asiSessionEnabled = true;
    this.emitAsiState('session_restored');
  }

  async start(): Promise<boolean> {
    if (this.started) {
      return true;
    }
    if (!getFeatureFlag('dex_clob_v1', true)) {
      return false;
    }
    const runtimeStarted = await this.runtime.start();
    if (!runtimeStarted) {
      return false;
    }
    this.localPeerId = (await libp2pService.getLocalPeerId().catch(() => '')).trim();
    if (libp2pService.isNativePlatform()) {
      void libp2pService.rendezvousAdvertise(DEX_RENDEZVOUS_NS, 300_000);
    }

    await this.ensureDefaultSigner();
    this.restoreAsiSessionIfNeeded();
    this.subscribeTopics();
    await this.refreshFeedSnapshot();
    await this.refreshDiscovery();

    this.discoveryTimer = setInterval(() => {
      void this.refreshDiscovery();
    }, DISCOVERY_INTERVAL_MS);
    this.snapshotTimer = setInterval(() => {
      void this.refreshFeedSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
    this.stalenessTimer = setInterval(() => {
      this.emitDepthStalenessMetrics();
    }, DEPTH_STALENESS_INTERVAL_MS);

    if (getFeatureFlag('dex_c2c_bridge_v1', true)) {
      this.c2cBridge.start({
        getLocalAddresses: () => {
          const addresses = new Set<string>();
          if (this.defaultSigner?.address) {
            addresses.add(this.defaultSigner.address);
          }
          return addresses;
        },
        onHedgeSignal: async (signal) => this.handleC2CHedgeSignal(signal),
        emitLink: async (link) => {
          await this.publishLink(link);
        },
      });
    }

    this.started = true;
    return true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.c2cBridge.stop();

    for (const unsubscribe of this.unsubscribeTopics) {
      unsubscribe();
    }
    this.unsubscribeTopics = [];

    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = null;
    }

    await this.runtime.stop();
  }

  getSnapshot(): DexSnapshot {
    return dexOrderbookStore.getSnapshot();
  }

  getDefaultSigner(): DexSignerIdentity | null {
    return this.defaultSigner;
  }

  setDefaultSigner(signer: DexSignerIdentity | null): void {
    const prevAddress = this.defaultSigner?.address ?? '';
    this.defaultSigner = signer;
    this.asiSigner = null;
    if (!signer) {
      this.disableAsiSession('signer_cleared');
      return;
    }
    if (this.asiSessionContext && this.asiSessionContext.policy.walletId !== signer.address) {
      this.disableAsiSession('wallet_changed');
      return;
    }
    if (!this.asiSessionContext && prevAddress !== signer.address) {
      this.restoreAsiSessionIfNeeded();
    }
  }

  async enableAsiSession(): Promise<{ ok: boolean; reason?: string; state?: DexAsiSessionState }> {
    const signer = this.defaultSigner;
    if (!signer) {
      return { ok: false, reason: 'missing_signer' };
    }
    const secureSigner = this.resolveAsiSigner(signer);
    try {
      const issued = await secureSigner.issueSession(signer.address);
      this.asiSessionContext = issued.sessionContext;
      this.asiPolicyRef = issued.policyRef;
      this.asiSessionEnabled = true;
      saveSessionVault({
        sessionContext: issued.sessionContext,
        policyHash: issued.policyRef,
      });
      this.emitAsiState('session_enabled');
      metric('asi_session_start_count', { value: 1, signer: signer.address, sessionId: issued.sessionContext.policy.sessionId });
      return {
        ok: true,
        state: this.getAsiSessionState(),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'session_issue_failed';
      this.emitAsiState(reason);
      return { ok: false, reason };
    }
  }

  disableAsiSession(reason = 'session_disabled'): void {
    const sessionId = this.asiSessionContext?.policy.sessionId ?? '';
    if (sessionId && this.asiSigner) {
      void this.asiSigner.destroySession(sessionId);
    }
    this.asiSessionEnabled = false;
    this.asiSessionContext = null;
    this.asiPolicyRef = '';
    clearSessionVault();
    this.emitAsiState(reason);
  }

  private ensureSessionActive(signer: DexSignerIdentity): { ok: boolean; reason?: string } {
    if (!this.asiSessionEnabled) {
      return { ok: true };
    }
    if (!this.asiSessionContext) {
      return { ok: false, reason: 'asi_session_missing' };
    }
    if (this.asiSessionContext.policy.walletId !== signer.address) {
      return { ok: false, reason: 'asi_wallet_mismatch' };
    }
    if (this.asiSessionContext.policy.expiresAt <= Date.now()) {
      this.disableAsiSession('session_expired');
      metric('asi_session_expiry_count', { value: 1, signer: signer.address });
      return { ok: false, reason: 'asi_session_expired' };
    }
    return { ok: true };
  }

  private activeSessionContext(signer: DexSignerIdentity): SessionContext | null {
    const ready = this.ensureSessionActive(signer);
    if (!ready.ok) {
      return null;
    }
    return this.asiSessionEnabled ? this.asiSessionContext : null;
  }

  private resolveSessionSigner(): SecureSigner | null {
    if (this.asiSigner) {
      return this.asiSigner;
    }
    if (!this.defaultSigner) {
      return null;
    }
    this.asiSigner = createMemorySecureSigner(this.defaultSigner.privateKeyPkcs8, this.defaultSigner.address);
    return this.asiSigner;
  }

  async submitOrder(input: SubmitDexOrderInput, signerOverride?: DexSignerIdentity): Promise<SubmitDexOrderResult> {
    const started = await this.start();
    if (!started) {
      return { ok: false, reason: 'runtime_unavailable' };
    }

    const signer = signerOverride ?? this.defaultSigner;
    if (!signer) {
      return { ok: false, reason: 'missing_signer' };
    }
    const sessionReady = this.ensureSessionActive(signer);
    if (!sessionReady.ok) {
      return { ok: false, reason: sessionReady.reason ?? 'asi_session_unavailable' };
    }
    const sessionContext = this.activeSessionContext(signer);
    const sessionSigner = this.resolveSessionSigner();
    if (sessionContext && !sessionSigner) {
      return { ok: false, reason: 'asi_session_signer_unavailable' };
    }

    const market = getDexMarketConfigById(input.marketId);
    if (!market) {
      return { ok: false, reason: 'unsupported_market' };
    }

    const qty = roundToLot(Number(input.qty), market.lotSize);
    if (qty <= 0) {
      return { ok: false, reason: 'invalid_qty' };
    }

    const policyGroupId = getCurrentPolicyGroupId();
    const makerFund = getDexMakerFundConfig(market.baseAsset);
    const dailyLimit = makerFund?.dailyLimit ?? qty;
    const check = checkDailyLimit({
      policyGroupId,
      assetCode: market.baseAsset,
      qty,
      dailyLimit,
    });
    if (!check.ok) {
      return {
        ok: false,
        reason: check.reason ?? 'maker_daily_limit_exceeded',
      };
    }

    const spread = this.computeSpread(input.marketId, signer.address, makerFund?.baseSpreadBps ?? 10, makerFund?.maxSpreadBps ?? 30);
    metric('dex_spread_bps', {
      marketId: input.marketId,
      value: spread.effectiveSpreadBps,
      base: spread.baseSpreadBps,
      max: spread.maxSpreadBps,
      volAdj: spread.volAdjBps,
      invAdj: spread.invAdjBps,
      latencyAdj: spread.latencyAdjBps,
    });

    const timeInForce = input.timeInForce ?? (input.type === 'MARKET' ? 'IOC' : 'GTC');
    const depth = dexOrderbookStore.getDepth(input.marketId);
    const { bid, ask } = bestBidAsk(depth);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask || 0;
    const derivedPrice = input.type === 'MARKET'
      ? quotePriceWithSpread(mid, input.side, spread.effectiveSpreadBps)
      : input.price ?? quotePriceWithSpread(mid || 1, input.side, spread.effectiveSpreadBps);
    const price = derivedPrice > 0 ? roundToTick(derivedPrice, market.tickSize) : undefined;
    const estimatedNotionalRWAD = Number((qty * Math.max(0, price ?? mid ?? 0)).toFixed(8));

    if (sessionContext) {
      if (estimatedNotionalRWAD <= 0) {
        metric('asi_policy_reject_count', {
          value: 1,
          reason: 'POLICY_DENIED_AMOUNT',
          action: 'placeLimitOrder',
          marketId: input.marketId,
        });
        metric('asi_reject_reason_rate', {
          reason: 'POLICY_DENIED_AMOUNT',
          action: 'placeLimitOrder',
          marketId: input.marketId,
          value: 1,
        });
        return {
          ok: false,
          reason: 'POLICY_DENIED_AMOUNT',
        };
      }
      const policyCheck = policyGateCanExecute({
        sessionContext,
        contract: 'unimaker.dex',
        method: 'placeLimitOrder',
        txKind: 'order',
        amountRWAD: estimatedNotionalRWAD,
      });
      if (!policyCheck.ok) {
        metric('asi_policy_reject_count', {
          value: 1,
          reason: policyCheck.code ?? policyCheck.reason ?? 'POLICY_DENIED_INVALID_POLICY',
          action: 'placeLimitOrder',
          marketId: input.marketId,
        });
        metric('asi_reject_reason_rate', {
          reason: policyCheck.code ?? policyCheck.reason ?? 'POLICY_DENIED_INVALID_POLICY',
          action: 'placeLimitOrder',
          marketId: input.marketId,
          value: 1,
        });
        return {
          ok: false,
          reason: policyCheck.code ?? policyCheck.reason ?? 'POLICY_DENIED_INVALID_POLICY',
        };
      }
    }

    const now = Date.now();
    const orderPayload: DexOrderRecord = {
      orderId: nowId('dex-ord'),
      clientOrderId: input.clientOrderId,
      marketId: input.marketId,
      side: input.side,
      type: input.type,
      timeInForce,
      price,
      qty,
      remainingQty: qty,
      makerAddress: signer.address,
      makerPeerId: signer.peerId || this.localPeerId,
      createdAtMs: now,
      expiresAtMs: now + 30 * 60 * 1000,
      metadata: input.metadata,
      status: 'OPEN',
      filledQty: 0,
      settlementState: 'PENDING',
      source: 'local',
    };

    const published = await this.publishOrder(orderPayload, signer, sessionContext, sessionSigner);
    if (!published) {
      return {
        ok: false,
        reason: 'order_publish_failed',
      };
    }

    const consumed = consumeDailyLimit({
      policyGroupId,
      assetCode: market.baseAsset,
      qty,
      dailyLimit,
    });
    if (!consumed.ok) {
      dexOrderbookStore.patchOrder(orderPayload.orderId, {
        status: 'REJECTED',
        settlementState: 'FAILED',
      });
      return {
        ok: false,
        reason: consumed.reason ?? 'maker_daily_limit_exceeded',
      };
    }

    if (sessionContext) {
      const consumedSession = consumeSessionPolicyExposure(sessionContext, estimatedNotionalRWAD);
      if (!consumedSession.ok) {
        dexOrderbookStore.patchOrder(orderPayload.orderId, {
          status: 'REJECTED',
          settlementState: 'FAILED',
        });
        metric('asi_policy_reject_count', {
          value: 1,
          reason: consumedSession.code ?? consumedSession.reason ?? 'POLICY_DENIED_LIMIT',
          action: 'placeLimitOrder',
          marketId: input.marketId,
        });
        metric('asi_reject_reason_rate', {
          reason: consumedSession.code ?? consumedSession.reason ?? 'POLICY_DENIED_LIMIT',
          action: 'placeLimitOrder',
          marketId: input.marketId,
          value: 1,
        });
        return {
          ok: false,
          reason: consumedSession.code ?? consumedSession.reason ?? 'POLICY_DENIED_LIMIT',
        };
      }
      this.emitAsiState('session_exposure_consumed');
    }

    metric('dex_order_submit_total', { marketId: input.marketId, side: input.side, type: input.type, tif: timeInForce });

    const matchResult = await this.tryMatch(orderPayload.orderId, signer, sessionContext, sessionSigner);
    await this.publishDepthFromOpenOrders(input.marketId, signer);

    if (matchResult.filledQty <= 0 && getFeatureFlag('dex_c2c_bridge_v1', true) && shouldAllowFallback(input)) {
      const fallback = await runDexToC2CFallback({
        marketId: input.marketId,
        side: input.side,
        qty,
        signer,
        orderId: orderPayload.orderId,
        orderbookStore: dexOrderbookStore as DexOrderbookStore,
        emitLink: async (link) => this.publishLink(link),
      });
      if (fallback.ok) {
        metric('dex_c2c_fallback_total', {
          marketId: input.marketId,
          side: input.side,
          value: 1,
          c2cOrderId: fallback.c2cOrderId ?? '',
        });
        return {
          ok: true,
          orderId: orderPayload.orderId,
          filledQty: matchResult.filledQty,
          fallbackOrderId: fallback.c2cOrderId,
        };
      }
    }

    return {
      ok: true,
      orderId: orderPayload.orderId,
      filledQty: matchResult.filledQty,
    };
  }

  private async ensureDefaultSigner(): Promise<void> {
    if (this.defaultSigner) {
      return;
    }
    const rwadWallet = loadWallets().find((item) => item.chain === 'rwad');
    if (!rwadWallet) {
      return;
    }
    const privateKeyPkcs8 = await getWalletPrivateKey(rwadWallet).catch(() => '');
    if (!privateKeyPkcs8) {
      return;
    }
    this.defaultSigner = {
      address: rwadWallet.address,
      peerId: this.localPeerId,
      privateKeyPkcs8,
    };
  }

  private subscribeTopics(): void {
    for (const topic of Object.values(DEX_TOPICS)) {
      const unsubscribe = this.runtime.subscribe(topic, (event) => {
        void this.handleRuntimeEvent(event);
      });
      this.unsubscribeTopics.push(unsubscribe);
    }
  }

  private async handleRuntimeEvent(event: RuntimeEvent): Promise<void> {
    const envelope = normalizeDexEnvelope(event.payload);
    if (!envelope) {
      return;
    }
    const applied = await dexOrderbookStore.applyEnvelope(envelope, 'p2p');
    if (!applied) {
      return;
    }
    const payload = asRecord(envelope.payload) ?? {};
    if (envelope.schema === DEX_TOPICS.match) {
      metric('dex_match_total', {
        marketId: asString(payload.marketId),
        value: 1,
      });
    }
    if (envelope.schema === DEX_TOPICS.depth) {
      metric('dex_depth_staleness_ms', {
        marketId: asString(payload.marketId),
        value: 0,
      });
    }
  }

  private async refreshFeedSnapshot(): Promise<void> {
    const items = await this.runtime.fetchSnapshot().catch(() => []);
    for (const item of items) {
      if (!Object.values(DEX_TOPICS).includes(item.topic as (typeof DEX_TOPICS)[keyof typeof DEX_TOPICS])) {
        continue;
      }
      const envelope = normalizeDexEnvelope(item.payload);
      if (!envelope) {
        continue;
      }
      await dexOrderbookStore.applyEnvelope(envelope, 'p2p', { checkReplay: false }).catch(() => false);
      const payload = asRecord(envelope.payload) ?? {};
      const marketId = asString(payload.marketId) as DexMarketId;
      if (marketId === 'BTC-USDC' || marketId === 'BTC-USDT' || marketId === 'XAU-USDC' || marketId === 'XAU-USDT') {
        this.sequenceByMarket[marketId] = Math.max(
          this.sequenceByMarket[marketId],
          typeof payload.sequence === 'number' ? payload.sequence : 0,
        );
      }
    }
  }

  private async refreshDiscovery(): Promise<void> {
    const peers = await this.runtime.discover(DEX_RENDEZVOUS_NS, 64).catch(() => []);
    if (libp2pService.isNativePlatform()) {
      for (const peer of peers) {
        if (!peer.peerId || peer.peerId === this.localPeerId) {
          continue;
        }
        await libp2pService.feedSubscribePeer(peer.peerId).catch(() => false);
      }
      void libp2pService.rendezvousAdvertise(DEX_RENDEZVOUS_NS, 300_000);
    }
  }

  private computeSpread(marketId: DexMarketId, makerAddress: string, baseSpreadBps: number, maxSpreadBps: number) {
    const snapshot = dexOrderbookStore.getSnapshot();
    const now = Date.now();
    const recentPrices = snapshot.matches
      .filter((item) => item.marketId === marketId && now - item.ts <= 60_000)
      .map((item) => item.price);
    const volatilityBps = computeVolAdjBps(recentPrices);

    let boughtQty = 0;
    let soldQty = 0;
    for (const order of snapshot.orders) {
      if (order.marketId !== marketId || order.makerAddress !== makerAddress) {
        continue;
      }
      if (order.side === 'BUY') {
        boughtQty += order.filledQty;
      } else {
        soldQty += order.filledQty;
      }
    }
    const inventoryAdjBps = computeInventoryAdjBps(boughtQty - soldQty, Math.max(1e-8, boughtQty + soldQty || 1));
    const latencyP95Ms = p95(this.recentMatchConfirmLatencies);
    const latencyAdjBps = computeLatencyAdjBps(latencyP95Ms);
    return computeEffectiveSpread({
      baseSpreadBps,
      maxSpreadBps,
      volatilityBps,
      inventorySkew: (inventoryAdjBps / Math.max(1, baseSpreadBps)) * 0.5,
      latencyP95Ms: latencyP95Ms + latencyAdjBps * 10,
    });
  }

  private nextSequence(marketId: DexMarketId): number {
    const current = Math.max(this.sequenceByMarket[marketId], dexOrderbookStore.getLastSequence(marketId));
    const next = current + 1;
    this.sequenceByMarket[marketId] = next;
    return next;
  }

  private async publishOrder(
    order: DexOrderRecord,
    signer: DexSignerIdentity,
    sessionContext: SessionContext | null,
    sessionSigner: SecureSigner | null,
  ): Promise<boolean> {
    try {
      const usingSession = Boolean(sessionContext && sessionSigner);
      const policyRef = sessionContext ? computeSessionPolicyRef(sessionContext.policy) : undefined;
      const envelope = await signDexEnvelopePayload({
        schema: DEX_TOPICS.order,
        topic: DEX_TOPICS.order,
        signer: usingSession ? sessionContext!.policy.sessionPubKey : signer.address,
        privateKeyPkcs8: usingSession ? undefined : signer.privateKeyPkcs8,
        signBytes: usingSession
          ? (payload) => sessionSigner!.signEnvelope(sessionContext!, payload)
          : undefined,
        sessionContext: usingSession ? sessionContext! : undefined,
        policyRef: usingSession ? policyRef : undefined,
        payload: {
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          marketId: order.marketId,
          side: order.side,
          type: order.type,
          timeInForce: order.timeInForce,
          price: order.price,
          qty: order.qty,
          remainingQty: order.remainingQty,
          makerAddress: order.makerAddress,
          makerPeerId: order.makerPeerId,
          createdAtMs: order.createdAtMs,
          expiresAtMs: order.expiresAtMs,
          metadata: order.metadata,
        } as unknown as JsonValue,
      });
      if (usingSession) {
        const policy = validatePolicy(sessionContext!, envelope);
        if (!policy.ok) {
          return false;
        }
      }
      dexOrderbookStore.applyVerifiedEnvelope(envelope, 'local');
      const published = await this.runtime.publish(DEX_TOPICS.order, envelope as unknown as JsonValue);
      if (!published) {
        dexOrderbookStore.patchOrder(order.orderId, {
          status: 'REJECTED',
          settlementState: 'FAILED',
        });
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private sortedRestingOpposites(order: DexOrderRecord): DexOrderRecord[] {
    const snapshot = dexOrderbookStore.getSnapshot();
    const oppositeSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    const rows = snapshot.orders.filter((item) => (
      item.marketId === order.marketId &&
      item.orderId !== order.orderId &&
      item.side === oppositeSide &&
      isOpenOrder(item) &&
      item.price !== undefined &&
      item.price > 0
    ));

    rows.sort((a, b) => {
      if (order.side === 'BUY') {
        if ((a.price ?? 0) !== (b.price ?? 0)) {
          return (a.price ?? 0) - (b.price ?? 0);
        }
      } else if ((a.price ?? 0) !== (b.price ?? 0)) {
        return (b.price ?? 0) - (a.price ?? 0);
      }
      return a.createdAtMs - b.createdAtMs;
    });
    return rows;
  }

  private crossesPrice(taker: DexOrderRecord, maker: DexOrderRecord): boolean {
    if (taker.type === 'MARKET') {
      return true;
    }
    if (taker.price === undefined || maker.price === undefined) {
      return false;
    }
    if (taker.side === 'BUY') {
      return taker.price + 1e-12 >= maker.price;
    }
    return taker.price <= maker.price + 1e-12;
  }

  private estimatePotentialFill(order: DexOrderRecord): number {
    let remaining = order.qty;
    for (const resting of this.sortedRestingOpposites(order)) {
      if (!this.crossesPrice(order, resting)) {
        break;
      }
      const take = Math.min(remaining, resting.remainingQty);
      remaining -= take;
      if (remaining <= 0) {
        return order.qty;
      }
    }
    return normalizeQty(order.qty - remaining);
  }

  private async tryMatch(
    orderId: string,
    signer: DexSignerIdentity,
    sessionContext: SessionContext | null,
    sessionSigner: SecureSigner | null,
  ): Promise<{ filledQty: number }> {
    let taker = dexOrderbookStore.getSnapshot().orders.find((item) => item.orderId === orderId);
    if (!taker) {
      return { filledQty: 0 };
    }
    if (!isOpenOrder(taker)) {
      return { filledQty: taker.filledQty };
    }

    if (taker.timeInForce === 'FOK') {
      const potential = this.estimatePotentialFill(taker);
      if (potential + 1e-12 < taker.qty) {
        dexOrderbookStore.patchOrder(taker.orderId, {
          status: 'REJECTED',
          settlementState: 'FAILED',
        });
        return { filledQty: 0 };
      }
    }

    for (const maker of this.sortedRestingOpposites(taker)) {
      taker = dexOrderbookStore.getSnapshot().orders.find((item) => item.orderId === orderId);
      if (!taker || !isOpenOrder(taker) || taker.remainingQty <= 0) {
        break;
      }
      if (!this.crossesPrice(taker, maker)) {
        break;
      }

      const fillQty = normalizeQty(Math.min(taker.remainingQty, maker.remainingQty));
      if (fillQty <= 0) {
        continue;
      }
      const matchPrice = maker.price ?? taker.price ?? 0;
      if (matchPrice <= 0) {
        continue;
      }
      const sequence = this.nextSequence(taker.marketId);
      const match: DexMatchV1 = {
        matchId: nowId('dex-match'),
        marketId: taker.marketId,
        makerOrderId: maker.orderId,
        takerOrderId: taker.orderId,
        buyOrderId: taker.side === 'BUY' ? taker.orderId : maker.orderId,
        sellOrderId: taker.side === 'SELL' ? taker.orderId : maker.orderId,
        price: matchPrice,
        qty: fillQty,
        notionalQuote: normalizeQty(fillQty * matchPrice),
        sequence,
        ts: Date.now(),
        settlementState: 'PENDING',
      };
      const takerOrder = taker;

      let matchEnvelope: Awaited<ReturnType<typeof signDexEnvelopePayload>> | null = null;
      try {
        matchEnvelope = await signDexEnvelopePayload({
          schema: DEX_TOPICS.match,
          topic: DEX_TOPICS.match,
          signer: sessionContext && sessionSigner ? sessionContext.policy.sessionPubKey : signer.address,
          privateKeyPkcs8: sessionContext && sessionSigner ? undefined : signer.privateKeyPkcs8,
          signBytes: sessionContext && sessionSigner
            ? (payload) => sessionSigner.signEnvelope(sessionContext, payload)
            : undefined,
          sessionContext: sessionContext ?? undefined,
          policyRef: sessionContext ? computeSessionPolicyRef(sessionContext.policy) : undefined,
          payload: match as unknown as JsonValue,
        });
      } catch {
        break;
      }
      if (sessionContext) {
        const policy = validatePolicy(sessionContext, matchEnvelope);
        if (!policy.ok) {
          return { filledQty: taker.filledQty };
        }
      }
      dexOrderbookStore.applyVerifiedEnvelope(matchEnvelope, 'local');
      await this.runtime.publish(DEX_TOPICS.match, matchEnvelope as unknown as JsonValue);
      metric('dex_match_total', {
        marketId: takerOrder.marketId,
        value: 1,
      });

      const updatedTaker = dexOrderbookStore.getSnapshot().orders.find((item) => item.orderId === takerOrder.orderId);
      const settled = await this.settleMatch(match, takerOrder, maker, signer, sessionContext, sessionSigner);
      if (!settled.ok) {
        metric('dex_settle_failed_total', {
          marketId: takerOrder.marketId,
          value: 1,
          reason: settled.reason ?? 'settle_failed',
        });
      } else {
        const latencyMs = Math.max(0, Date.now() - takerOrder.createdAtMs);
        this.recentMatchConfirmLatencies.push(latencyMs);
        if (this.recentMatchConfirmLatencies.length > 200) {
          this.recentMatchConfirmLatencies = this.recentMatchConfirmLatencies.slice(-80);
        }
      }

      if (!updatedTaker || updatedTaker.remainingQty <= 0) {
        break;
      }
    }

    const finalOrder = dexOrderbookStore.getSnapshot().orders.find((item) => item.orderId === orderId);
    if (finalOrder && finalOrder.remainingQty > 0 && (finalOrder.timeInForce === 'IOC' || finalOrder.type === 'MARKET')) {
      dexOrderbookStore.patchOrder(orderId, {
        status: finalOrder.filledQty > 0 ? 'PARTIALLY_FILLED' : 'CANCELLED',
      });
      if (finalOrder.filledQty > 0) {
        dexOrderbookStore.patchOrder(orderId, {
          status: 'CANCELLED',
        });
      }
    }

    const done = dexOrderbookStore.getSnapshot().orders.find((item) => item.orderId === orderId);
    return {
      filledQty: done?.filledQty ?? 0,
    };
  }

  private async settleMatch(
    match: DexMatchV1,
    taker: DexOrderRecord,
    maker: DexOrderRecord,
    signer: DexSignerIdentity,
    sessionContext: SessionContext | null,
    sessionSigner: SecureSigner | null,
  ): Promise<SettleResult> {
    if (signer.address !== taker.makerAddress && signer.address !== maker.makerAddress) {
      return { ok: true };
    }
    const market = getDexMarketConfigById(match.marketId);
    if (!market) {
      return { ok: false, reason: 'unsupported_market' };
    }

    const buyOrder = taker.side === 'BUY' ? taker : maker;
    const sellOrder = taker.side === 'SELL' ? taker : maker;
    const escrowId = `dex1:${match.marketId}:${match.matchId}:${Math.random().toString(16).slice(2, 8)}`;
    let lockTxHash = '';
    let releaseTxHash = '';

    // Buyer side signs escrow lock.
    if (signer.address === buyOrder.makerAddress || buyOrder.makerAddress === sellOrder.makerAddress) {
      if (sessionContext) {
        const settlePolicy = policyGateCanExecute({
          sessionContext,
          contract: 'unimaker.dex',
          method: 'settleMatch',
          txKind: 'settle',
          amountRWAD: match.notionalQuote,
        });
        if (!settlePolicy.ok) {
          metric('asi_policy_reject_count', {
            value: 1,
            reason: settlePolicy.code ?? settlePolicy.reason ?? 'POLICY_DENIED_INVALID_POLICY',
            action: 'settleMatch',
            marketId: match.marketId,
          });
          metric('asi_reject_reason_rate', {
            reason: settlePolicy.code ?? settlePolicy.reason ?? 'POLICY_DENIED_INVALID_POLICY',
            action: 'settleMatch',
            marketId: match.marketId,
            value: 1,
          });
          return { ok: false, reason: settlePolicy.code ?? settlePolicy.reason ?? 'POLICY_DENIED_INVALID_POLICY' };
        }
      }
      const lock = await submitSignedTx({
        chainId: 'rwad-main',
        sender: signer.address,
        privateKeyPkcs8: signer.privateKeyPkcs8,
        sessionContext: sessionContext ?? undefined,
        secureSigner: sessionContext ? sessionSigner ?? undefined : undefined,
        policyRef: sessionContext ? computeSessionPolicyRef(sessionContext.policy) : undefined,
        txType: 'rwad_escrow_lock',
        payload: {
          escrow_id: escrowId,
          payer: buyOrder.makerAddress,
          payee: sellOrder.makerAddress,
          amount: match.notionalQuote,
          expires_at: Date.now() + 30 * 60 * 1000,
        },
        encoding: 'cbor',
      });
      if (!lock.ok) {
        this.patchMatchSettlement(match.matchId, {
          settlementState: 'FAILED',
          escrowId,
          lockTxHash: lock.txHash || undefined,
        });
        return { ok: false, reason: lock.reason ?? 'escrow_lock_failed', state: 'FAILED' };
      }
      lockTxHash = lock.txHash;
      this.patchMatchSettlement(match.matchId, {
        settlementState: 'LOCKED',
        escrowId,
        lockTxHash: lock.txHash || undefined,
      });
    }

    // Seller side signs asset transfer/release.
    if (signer.address === sellOrder.makerAddress || buyOrder.makerAddress === sellOrder.makerAddress) {
      const release = await submitSignedTx({
        chainId: 'rwad-main',
        sender: signer.address,
        privateKeyPkcs8: signer.privateKeyPkcs8,
        txType: 'asset_transfer',
        payload: {
          ref: escrowId,
          from: sellOrder.makerAddress,
          to: buyOrder.makerAddress,
          asset_id: market.assetId,
          amount: match.qty,
        },
        encoding: 'cbor',
      });
      if (!release.ok) {
        this.patchMatchSettlement(match.matchId, {
          settlementState: 'FAILED',
          escrowId,
          lockTxHash: lockTxHash || undefined,
          releaseTxHash: release.txHash || undefined,
        });
        return { ok: false, reason: release.reason ?? 'asset_release_failed', state: 'FAILED' };
      }
      releaseTxHash = release.txHash;
      this.patchMatchSettlement(match.matchId, {
        settlementState: 'RELEASED',
        escrowId,
        lockTxHash: lockTxHash || undefined,
        releaseTxHash: release.txHash || undefined,
      });
      return {
        ok: true,
        lockTxHash: lockTxHash || undefined,
        releaseTxHash: release.txHash || undefined,
        state: 'RELEASED',
      };
    }

    // If only one side participated locally, we leave it LOCKED/PENDING for remote peer completion.
    return {
      ok: true,
      lockTxHash: lockTxHash || undefined,
      state: lockTxHash ? 'LOCKED' : 'PENDING',
    };
  }

  private patchMatchSettlement(matchId: string, patch: Partial<DexMatchV1>): void {
    const snapshot = dexOrderbookStore.getSnapshot();
    const match = snapshot.matches.find((item) => item.matchId === matchId);
    if (!match) {
      return;
    }
    dexOrderbookStore.upsertMatch({
      ...match,
      ...patch,
      source: 'local',
    });
  }

  private async publishDepthFromOpenOrders(marketId: DexMarketId, signer?: DexSignerIdentity): Promise<void> {
    const openOrders = pickOpenOrders(dexOrderbookStore.getSnapshot(), marketId);
    const depth = buildDepthFromOrders({
      marketId,
      sequence: this.nextSequence(marketId),
      orders: openOrders,
      maxLevels: 24,
    });
    if (!signer) {
      dexOrderbookStore.upsertDepth({
        ...depth,
        updatedAtMs: Date.now(),
      });
      return;
    }

    const envelope = await signDexEnvelopePayload({
      schema: DEX_TOPICS.depth,
      topic: DEX_TOPICS.depth,
      signer: signer.address,
      privateKeyPkcs8: signer.privateKeyPkcs8,
      payload: depth as unknown as JsonValue,
    });
    dexOrderbookStore.applyVerifiedEnvelope(envelope, 'local');
    await this.runtime.publish(DEX_TOPICS.depth, envelope as unknown as JsonValue);
  }

  private async publishLink(link: DexC2CLinkV1): Promise<void> {
    const signer = this.defaultSigner;
    if (!signer) {
      dexOrderbookStore.upsertLink({
        ...link,
        source: 'local',
      });
      return;
    }
    const envelope = await signDexEnvelopePayload({
      schema: DEX_TOPICS.link,
      topic: DEX_TOPICS.link,
      signer: signer.address,
      privateKeyPkcs8: signer.privateKeyPkcs8,
      payload: link as unknown as JsonValue,
    });
    dexOrderbookStore.applyVerifiedEnvelope(envelope, 'local');
    await this.runtime.publish(DEX_TOPICS.link, envelope as unknown as JsonValue);
  }

  private async handleC2CHedgeSignal(signal: C2CToDexHedgeSignal): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
    if (!this.defaultSigner) {
      return { ok: false, reason: 'missing_signer' };
    }
    const result = await this.submitOrder(
      {
        marketId: signal.marketId,
        side: signal.side,
        type: 'MARKET',
        timeInForce: 'IOC',
        qty: signal.qty,
        metadata: {
          source: 'c2c_hedge',
          relatedTradeId: signal.relatedTradeId,
          noFallback: true,
        },
      },
      this.defaultSigner,
    );
    if (result.ok) {
      metric('dex_c2c_hedge_total', {
        marketId: signal.marketId,
        relatedTradeId: signal.relatedTradeId,
        value: 1,
      });
    }
    return {
      ok: result.ok,
      orderId: result.orderId,
      reason: result.reason,
    };
  }

  private emitDepthStalenessMetrics(): void {
    const snapshot = dexOrderbookStore.getSnapshot();
    const now = Date.now();
    for (const market of DEX_MARKETS) {
      const depth = snapshot.depths.find((item) => item.marketId === market.marketId);
      const stalenessMs = depth ? Math.max(0, now - depth.updatedAtMs) : 99_999;
      metric('dex_depth_staleness_ms', {
        marketId: market.marketId,
        value: stalenessMs,
      });
    }
  }
}

const dexSync = new DexSyncService();

export function subscribeDexSnapshot(listener: DexListener): () => void {
  return dexSync.subscribe(listener);
}

export function getDexSnapshot(): DexSnapshot {
  return dexSync.getSnapshot();
}

export function startDexSync(): Promise<boolean> {
  return dexSync.start();
}

export function stopDexSync(): Promise<void> {
  return dexSync.stop();
}

export function submitDexOrder(input: SubmitDexOrderInput, signer?: DexSignerIdentity): Promise<SubmitDexOrderResult> {
  return dexSync.submitOrder(input, signer);
}

export function setDexDefaultSigner(signer: DexSignerIdentity | null): void {
  dexSync.setDefaultSigner(signer);
}

export function getDexDefaultSigner(): DexSignerIdentity | null {
  return dexSync.getDefaultSigner();
}

export function enableDexAsiSession(): Promise<{ ok: boolean; reason?: string; state?: DexAsiSessionState }> {
  return dexSync.enableAsiSession();
}

export function disableDexAsiSession(reason?: string): void {
  dexSync.disableAsiSession(reason);
}

export function getDexAsiSessionState(): DexAsiSessionState {
  return dexSync.getAsiSessionState();
}

export function subscribeDexAsiSessionState(listener: (state: DexAsiSessionState) => void): () => void {
  return dexSync.subscribeAsiSession(listener);
}

export function getDexOrderbookStore(): DexOrderbookStore {
  return dexOrderbookStore as DexOrderbookStore;
}

export function getDexMarketTrades(marketId: DexMarketId, limit = 40) {
  return pickRecentMatches(dexOrderbookStore.getSnapshot(), marketId, limit);
}

export function estimateDexMarketFill(input: {
  marketId: DexMarketId;
  side: DexSide;
  qty: number;
}): { filledQty: number; avgPrice: number; bestPrice: number; slippageBps: number } {
  return estimateDepthFill({
    side: input.side,
    qty: input.qty,
    depth: dexOrderbookStore.getDepth(input.marketId),
  });
}
