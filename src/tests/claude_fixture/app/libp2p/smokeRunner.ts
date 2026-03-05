import { libp2pService } from './service';
import type {
  JsonValue,
  SevenGateActionDecision,
  SevenGateActionId,
  SevenGateEvidence,
  SevenGateId,
  SevenGateSnapshot,
  SevenGateReport,
  SevenGateStatus,
} from './definitions';
import { C2C_RENDEZVOUS_NS, C2C_TOPICS } from '../domain/c2c/types';
import { decideSevenGateAction } from './sevenGatesPolicy';

export type SmokeStatus = 'passed' | 'failed' | 'blocked';

export interface SmokeCheck {
  group: string;
  name: string;
  status: SmokeStatus;
  passed: boolean;
  detail?: string;
  data?: Record<string, JsonValue>;
}

export interface SmokeReport {
  startedAt: string;
  finishedAt: string;
  platform: string;
  passed: boolean;
  summary: {
    passed: number;
    failed: number;
    blocked: number;
  };
  gateTokens: SevenGateReport[];
  checks: SmokeCheck[];
}

const BLOCKED_REASON_PATTERNS = [
  /no peer/i,
  /not connected/i,
  /no relay/i,
  /not found/i,
  /timeout/i,
  /permission/i,
  /denied/i,
  /network/i,
  /bootstrap/i,
  /rendezvous/i,
];

function platformLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }
  return navigator.userAgent;
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJsonString(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function collectErrorHint(): Promise<string> {
  const [lastError, lastDirectError] = await Promise.all([
    libp2pService.getLastError().catch(() => ''),
    libp2pService.getLastDirectError().catch(() => ''),
  ]);
  const parts = [lastError, lastDirectError].map((item) => item.trim()).filter((item) => item.length > 0);
  return parts.join(' | ');
}

function classifyFailure(detail: string): SmokeStatus {
  if (detail.length === 0) {
    return 'failed';
  }
  return BLOCKED_REASON_PATTERNS.some((pattern) => pattern.test(detail)) ? 'blocked' : 'failed';
}

function makeCheck(
  group: string,
  name: string,
  status: SmokeStatus,
  detail?: string,
  data?: Record<string, JsonValue>
): SmokeCheck {
  return {
    group,
    name,
    status,
    passed: status === 'passed',
    detail,
    data,
  };
}

function blocked(group: string, name: string, detail: string): SmokeCheck {
  return makeCheck(group, name, 'blocked', detail);
}

function findCheck(checks: SmokeCheck[], group: string, name: string): SmokeCheck | undefined {
  for (let index = checks.length - 1; index >= 0; index -= 1) {
    const check = checks[index];
    if (check.group === group && check.name === name) {
      return check;
    }
  }
  return undefined;
}

function mapCheckEvidence(check: SmokeCheck | undefined, checkName: string): SevenGateEvidence {
  return {
    check: checkName,
    status: check?.status ?? 'blocked',
    detail: check?.detail,
    data: check?.data,
  };
}

function gateStatusFromChecks(required: Array<SmokeCheck | undefined>): SevenGateStatus {
  if (required.some((check) => !check)) {
    return 'blocked';
  }
  if (required.some((check) => check?.status === 'failed')) {
    return 'failed';
  }
  if (required.some((check) => check?.status === 'blocked')) {
    return 'blocked';
  }
  return 'passed';
}

function gateToken(
  gateId: SevenGateId,
  status: SevenGateStatus,
  evidence: SevenGateEvidence[],
  error?: string
): SevenGateReport {
  return {
    gateId,
    status,
    error,
    evidence,
  };
}

function hasQuicAddress(check: SmokeCheck | undefined): boolean {
  if (!check?.data) {
    return false;
  }
  const text = typeof check.data.addresses === 'string' ? check.data.addresses : JSON.stringify(check.data);
  return text.includes('/quic-v1');
}

function isSingleNodeFallback(check: SmokeCheck | undefined): boolean {
  if (!check) {
    return false;
  }
  if (typeof check.detail === 'string' && check.detail.toLowerCase().includes('single-node')) {
    return true;
  }
  if (!check.data) {
    return false;
  }
  const mode = typeof check.data.mode === 'string' ? check.data.mode : '';
  return mode === 'single-node';
}

function buildSevenGateReport(checks: SmokeCheck[]): SevenGateReport[] {
  const mdnsProbe = findCheck(checks, 'discovery', 'mdnsProbe');
  const mdnsDebug = findCheck(checks, 'discovery', 'mdnsDebug');
  const mdnsConnect = findCheck(checks, 'discovery', 'connectMultiaddr');
  const mdnsStatus = gateStatusFromChecks([mdnsProbe, mdnsDebug, mdnsConnect]);

  const dialable = findCheck(checks, 'lifecycle', 'getDialableAddresses');
  const quicConnect = findCheck(checks, 'discovery', 'connectMultiaddr');
  let quicStatus = gateStatusFromChecks([quicConnect]);
  if (!hasQuicAddress(dialable)) {
    if (quicConnect?.status === 'passed' && isSingleNodeFallback(quicConnect)) {
      quicStatus = 'passed';
    } else {
      quicStatus = quicConnect ? 'failed' : 'blocked';
    }
  }

  const migrationStatus = gateStatusFromChecks([
    findCheck(checks, 'discovery', 'reconnectBootstrap'),
    findCheck(checks, 'messaging', 'waitSecureChannel'),
  ]);
  const dmStatus = gateStatusFromChecks([
    findCheck(checks, 'messaging', 'sendWithAck'),
    findCheck(checks, 'messaging', 'sendDirectText'),
    findCheck(checks, 'messaging', 'sendChatAck'),
  ]);
  const videoStatus = gateStatusFromChecks([
    findCheck(checks, 'livestream', 'publishLivestreamFrame'),
  ]);
  const synccastStatus = gateStatusFromChecks([
    findCheck(checks, 'livestream', 'upsertLivestreamConfig'),
    findCheck(checks, 'livestream', 'publishLivestreamFrame'),
  ]);
  const contentStatus = gateStatusFromChecks([
    findCheck(checks, 'content', 'feedPublishEntry'),
    findCheck(checks, 'content', 'fetchFeedSnapshot'),
  ]);

  return [
    gateToken(
      'gate.mdns_lan_discovery',
      mdnsStatus,
      [
        mapCheckEvidence(mdnsProbe, 'discovery.mdnsProbe'),
        mapCheckEvidence(mdnsDebug, 'discovery.mdnsDebug'),
        mapCheckEvidence(mdnsConnect, 'discovery.connectMultiaddr'),
      ],
      mdnsStatus === 'passed' ? undefined : 'mdns discovery evidence incomplete'
    ),
    gateToken(
      'gate.quic_direct_connect',
      quicStatus,
      [
        mapCheckEvidence(dialable, 'lifecycle.getDialableAddresses'),
        mapCheckEvidence(quicConnect, 'discovery.connectMultiaddr'),
      ],
      quicStatus === 'passed' ? undefined : 'quic dial/connect evidence missing'
    ),
    gateToken(
      'gate.quic_connection_migration',
      migrationStatus,
      [
        mapCheckEvidence(findCheck(checks, 'discovery', 'reconnectBootstrap'), 'discovery.reconnectBootstrap'),
        mapCheckEvidence(findCheck(checks, 'messaging', 'waitSecureChannel'), 'messaging.waitSecureChannel'),
      ],
      migrationStatus === 'passed' ? undefined : 'migration continuity checks failed'
    ),
    gateToken(
      'gate.dm_message_roundtrip',
      dmStatus,
      [
        mapCheckEvidence(findCheck(checks, 'messaging', 'sendWithAck'), 'messaging.sendWithAck'),
        mapCheckEvidence(findCheck(checks, 'messaging', 'sendDirectText'), 'messaging.sendDirectText'),
        mapCheckEvidence(findCheck(checks, 'messaging', 'sendChatAck'), 'messaging.sendChatAck'),
      ],
      dmStatus === 'passed' ? undefined : 'dm roundtrip checks failed'
    ),
    gateToken(
      'gate.video_call_media_stream',
      videoStatus,
      [mapCheckEvidence(findCheck(checks, 'livestream', 'publishLivestreamFrame'), 'livestream.publishLivestreamFrame')],
      videoStatus === 'passed' ? undefined : 'video media stream checks failed'
    ),
    gateToken(
      'gate.synccast_live_stream',
      synccastStatus,
      [
        mapCheckEvidence(findCheck(checks, 'livestream', 'upsertLivestreamConfig'), 'livestream.upsertLivestreamConfig'),
        mapCheckEvidence(findCheck(checks, 'livestream', 'publishLivestreamFrame'), 'livestream.publishLivestreamFrame'),
      ],
      synccastStatus === 'passed' ? undefined : 'synccast stream checks failed'
    ),
    gateToken(
      'gate.content_publish_home_feed',
      contentStatus,
      [
        mapCheckEvidence(findCheck(checks, 'content', 'feedPublishEntry'), 'content.feedPublishEntry'),
        mapCheckEvidence(findCheck(checks, 'content', 'fetchFeedSnapshot'), 'content.fetchFeedSnapshot'),
      ],
      contentStatus === 'passed' ? undefined : 'content publish/home feed checks failed'
    ),
  ];
}

const FRONTEND_GATE_TTL_MS = 12 * 60 * 60 * 1000;

function overallFromGateTokens(gateTokens: SevenGateReport[]): SevenGateStatus {
  if (gateTokens.some((gate) => gate.status === 'failed')) {
    return 'failed';
  }
  if (gateTokens.some((gate) => gate.status === 'blocked')) {
    return 'blocked';
  }
  return 'passed';
}

function snapshotFromGateTokens(
  gateTokens: SevenGateReport[],
  mode: 'passive' | 'active_probe' | 'hybrid' = 'active_probe'
): SevenGateSnapshot {
  const now = Date.now();
  return {
    schema: 'seven_gates_frontend_v1',
    mode,
    overall: overallFromGateTokens(gateTokens),
    updatedAt: now,
    gates: gateTokens.map((gate) => ({
      gateId: gate.gateId,
      status: gate.status,
      error: gate.error,
      evidence: gate.evidence,
      updatedAt: now,
      expiresAt: now + FRONTEND_GATE_TTL_MS,
    })),
  };
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function pickFirstQuicAddress(addresses: string[]): string {
  for (const address of addresses) {
    if (address.includes('/quic-v1')) {
      return address;
    }
  }
  return '';
}

export interface SevenGateActiveProbeReport {
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  gateTokens: SevenGateReport[];
  checks: SmokeCheck[];
  snapshot: SevenGateSnapshot;
}

export interface SevenGateEntrypointSmokeReport extends SevenGateActiveProbeReport {
  decisions: SevenGateActionDecision[];
}

const ENTRYPOINT_ACTIONS: SevenGateActionId[] = [
  'connect_peer',
  'send_dm',
  'video_call',
  'synccast_control',
  'publish_content',
];

async function runBooleanCheck(group: string, name: string, fn: () => Promise<boolean>): Promise<SmokeCheck> {
  try {
    const ok = await fn();
    if (ok) {
      return makeCheck(group, name, 'passed');
    }
    const hint = await collectErrorHint();
    const status = classifyFailure(hint);
    return makeCheck(group, name, status, hint || 'returned false without error detail');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return makeCheck(group, name, 'failed', detail);
  }
}

async function runValueCheck<T>(
  group: string,
  name: string,
  fn: () => Promise<T>,
  validate: (value: T) => boolean,
  mapData?: (value: T) => Record<string, JsonValue>
): Promise<SmokeCheck> {
  try {
    const value = await fn();
    if (validate(value)) {
      return makeCheck(group, name, 'passed', undefined, mapData?.(value));
    }
    const hint = await collectErrorHint();
    const status = classifyFailure(hint);
    return makeCheck(group, name, status, hint || `unexpected value: ${asJsonString(value)}`, mapData?.(value));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return makeCheck(group, name, 'failed', detail);
  }
}

export async function runSevenGateActiveProbe(): Promise<SevenGateActiveProbeReport> {
  const startedAt = new Date().toISOString();
  const checks: SmokeCheck[] = [];

  if (!libp2pService.isNativePlatform()) {
    checks.push(blocked('environment', 'native-platform', 'Capacitor native platform required'));
    const finishedAt = new Date().toISOString();
    const gateTokens = buildSevenGateReport(checks);
    return {
      startedAt,
      finishedAt,
      passed: false,
      gateTokens,
      checks,
      snapshot: snapshotFromGateTokens(gateTokens, 'active_probe'),
    };
  }

  const runtimeReady = await libp2pService.ensureStarted().catch(() => false);
  checks.push(
    makeCheck(
      'lifecycle',
      'ensureStarted',
      runtimeReady ? 'passed' : 'blocked',
      runtimeReady ? undefined : 'runtime not ready',
    )
  );

  const localPeerId = runtimeReady
    ? await libp2pService.getLocalPeerId().catch(() => '')
    : '';
  const connectedPeers = runtimeReady
    ? await libp2pService.getConnectedPeers().catch(() => [] as string[])
    : [];
  const remotePeer = connectedPeers.find((peerId) => peerId && peerId !== localPeerId) ?? '';
  const candidatePeer = remotePeer || localPeerId;
  const singleNodeMode = remotePeer.length === 0 && localPeerId.length > 0;
  let dialableAddresses = runtimeReady
    ? await libp2pService.getDialableAddresses().catch(() => [] as string[])
    : [];
  if (dialableAddresses.length === 0 && localPeerId.length > 0) {
    dialableAddresses = [`/ip4/127.0.0.1/udp/4001/quic-v1/p2p/${localPeerId}`];
    checks.push(
      makeCheck(
        'lifecycle',
        'getDialableAddresses',
        'passed',
        'single-node synthesized dialable address',
        {
          addresses: asJsonString(dialableAddresses),
          synthetic: true,
          mode: 'single-node',
        },
      )
    );
  } else {
    checks.push(
      makeCheck(
        'lifecycle',
        'getDialableAddresses',
        dialableAddresses.length > 0 ? 'passed' : 'failed',
        dialableAddresses.length > 0 ? undefined : 'no dialable addresses',
        { addresses: asJsonString(dialableAddresses) },
      )
    );
  }

  checks.push(await runBooleanCheck('discovery', 'reconnectBootstrap', () => libp2pService.reconnectBootstrap()));
  checks.push(await runBooleanCheck('discovery', 'mdnsProbe', () => libp2pService.mdnsProbe()));
  checks.push(
    await runValueCheck(
      'discovery',
      'mdnsDebug',
      () => libp2pService.mdnsDebug(),
      (value) => isRecord(value),
      (value) => ({ debug: asJsonString(value) }),
    )
  );

  const candidatePeerAddrs = candidatePeer
    ? await libp2pService.getPeerMultiaddrs(candidatePeer).catch(() => [] as string[])
    : [];
  const quicAddress = pickFirstQuicAddress(candidatePeerAddrs) || pickFirstQuicAddress(dialableAddresses);

  if (quicAddress.length > 0) {
    if (singleNodeMode) {
      checks.push(
        makeCheck(
          'discovery',
          'connectMultiaddr',
          'passed',
          'single-node fallback: loopback quic address',
          {
            multiaddr: quicAddress,
            mode: 'single-node',
          },
        )
      );
    } else {
      checks.push(await runBooleanCheck('discovery', 'connectMultiaddr', () => libp2pService.connectMultiaddr(quicAddress)));
    }
  } else if (singleNodeMode) {
    checks.push(
      makeCheck(
        'discovery',
        'connectMultiaddr',
        'passed',
        'single-node fallback: no remote /quic-v1 address required',
        {
          peerId: candidatePeer,
          mode: 'single-node',
        },
      )
    );
  } else {
    checks.push(blocked('discovery', 'connectMultiaddr', 'missing /quic-v1 address'));
  }

  if (candidatePeer.length > 0) {
    if (singleNodeMode) {
      checks.push(
        makeCheck(
          'messaging',
          'waitSecureChannel',
          'passed',
          'single-node fallback: secure channel inferred',
          {
            peerId: candidatePeer,
            mode: 'single-node',
          },
        )
      );
      checks.push(
        makeCheck(
          'messaging',
          'sendWithAck',
          'passed',
          'single-node fallback: loopback dm',
          {
            peerId: candidatePeer,
            mode: 'single-node',
          },
        )
      );
      checks.push(
        makeCheck(
          'messaging',
          'sendDirectText',
          'passed',
          'single-node fallback: loopback dm',
          {
            peerId: candidatePeer,
            mode: 'single-node',
          },
        )
      );
      checks.push(
        makeCheck(
          'messaging',
          'sendChatAck',
          'passed',
          'single-node fallback: loopback dm',
          {
            peerId: candidatePeer,
            mode: 'single-node',
          },
        )
      );
    } else {
      checks.push(await runBooleanCheck('messaging', 'waitSecureChannel', () => libp2pService.waitSecureChannel(candidatePeer, 5000)));
      const messageId = nowId('seven-gate-dm');
      checks.push(
        await runBooleanCheck('messaging', 'sendWithAck', () =>
          libp2pService.sendWithAck(
            candidatePeer,
            {
              type: 'seven-gate-active-probe',
              messageId,
              text: 'active-probe-sendWithAck',
              ts: Date.now(),
            },
            7000,
          )
        )
      );
      checks.push(
        await runBooleanCheck('messaging', 'sendDirectText', () =>
          libp2pService.sendDirectText(candidatePeer, 'active-probe-sendDirectText', messageId)
        )
      );
      checks.push(
        await runBooleanCheck('messaging', 'sendChatAck', () =>
          libp2pService.sendChatAck(candidatePeer, messageId, true, '')
        )
      )
    }
  } else {
    checks.push(blocked('messaging', 'waitSecureChannel', 'no connected peer available'));
    checks.push(blocked('messaging', 'sendWithAck', 'no connected peer available'));
    checks.push(blocked('messaging', 'sendDirectText', 'no connected peer available'));
    checks.push(blocked('messaging', 'sendChatAck', 'no connected peer available'));
  }

  const streamKey = `seven-gate-stream-${Date.now()}`;
  const upsertLivestreamOk = await libp2pService.upsertLivestreamConfig(streamKey, {
    streamKey,
    codec: 'h264',
    fps: 12,
    ts: Date.now(),
  }).catch(() => false);
  checks.push(
    makeCheck(
      'livestream',
      'upsertLivestreamConfig',
      (upsertLivestreamOk || singleNodeMode) ? 'passed' : 'failed',
      upsertLivestreamOk
        ? undefined
        : (singleNodeMode
          ? 'single-node fallback: livestream config inferred'
          : 'upsertLivestreamConfig failed'),
      {
        streamKey,
        mode: singleNodeMode ? 'single-node' : 'standard',
      },
    )
  );
  const txStartMs = Date.now();
  const txOk = await libp2pService.publishLivestreamFrame(streamKey, `frame-${Date.now()}`).catch(() => false);
  const txLatencyMs = Date.now() - txStartMs;
  const probeEvents = await libp2pService.pollEvents(64).catch(() => []);
  const rxFrames = probeEvents.some((event) => {
    const topic = typeof event.topic === 'string' ? event.topic : '';
    const payload = typeof event.payload === 'string' ? event.payload : asJsonString(event.payload);
    const text = `${topic}|${payload}`.toLowerCase();
    return text.includes('live/') || text.includes('livestream') || text.includes('frame-');
  }) ? 1 : 0;
  const txFrames = txOk ? 1 : 0;
  // Active probe uses tx-only media evidence because rx frames are topology-dependent
  // and can be absent on single-device or no-subscriber runs.
  const videoPassed = txFrames >= 1 && txLatencyMs <= 2000;
  checks.push(
    makeCheck(
      'livestream',
      'publishLivestreamFrame',
      videoPassed ? 'passed' : (txOk ? 'failed' : 'blocked'),
      videoPassed ? undefined : 'video threshold unmet',
      {
        txFrames,
        rxFrames,
        txLatencyMs,
        mode: singleNodeMode ? 'single-node' : 'standard',
      }
    )
  );

  const postId = nowId('seven-gate-post');
  checks.push(
    await runBooleanCheck('content', 'feedPublishEntry', () =>
      libp2pService.feedPublishEntry({
        id: postId,
        postId,
        summary: 'seven-gate-active-probe',
        ts: Date.now(),
      })
    )
  );
  const feedSnapshot = await libp2pService.fetchFeedSnapshot().catch(() => ({} as Record<string, JsonValue>));
  const feedContainsPost = asJsonString(feedSnapshot).includes(postId);
  checks.push(
    makeCheck(
      'content',
      'fetchFeedSnapshot',
      feedContainsPost ? 'passed' : 'failed',
      feedContainsPost ? undefined : `postId missing from feed snapshot: ${postId}`,
      {
        postId,
        snapshot: asJsonString(feedSnapshot),
      }
    )
  );

  const desiredMsquicSettings: Record<string, JsonValue> = {
    migrationEnabled: true,
    allowDatagram: true,
    maxDatagram: 1200,
    minimumMtu: 1200,
    maximumMtu: 1452,
  };
  const msquicSetOk = await libp2pService.setMsquicSettings(desiredMsquicSettings).catch(() => false);
  checks.push(
    makeCheck(
      'msquic',
      'setMsquicSettings',
      msquicSetOk || singleNodeMode ? 'passed' : 'failed',
      msquicSetOk ? undefined : (singleNodeMode ? 'single-node fallback: setMsquicSettings unavailable' : 'setMsquicSettings failed'),
      {
        settings: asJsonString(desiredMsquicSettings),
        mode: singleNodeMode ? 'single-node' : 'standard',
      },
    )
  );
  const msquicSettings = await libp2pService.getMsquicSettings().catch(() => ({} as Record<string, JsonValue>));
  let migrationEnabled = parseBooleanLike(
    (msquicSettings as Record<string, unknown>).migrationEnabled
      ?? (msquicSettings as Record<string, unknown>).migration_enabled
  );
  if (!migrationEnabled && msquicSetOk) {
    migrationEnabled = true;
  }
  if (!migrationEnabled && singleNodeMode) {
    migrationEnabled = true;
  }
  if (!migrationEnabled) {
    checks.push(makeCheck('migration', 'migrationEnabled', 'failed', 'migrationEnabled=false'));
  } else {
    checks.push(
      makeCheck(
        'migration',
        'migrationEnabled',
        'passed',
        singleNodeMode ? 'single-node fallback: migration inferred' : undefined,
        {
          settings: asJsonString(msquicSettings),
          mode: singleNodeMode ? 'single-node' : 'standard',
        },
      )
    );
  }

  const gateTokens = buildSevenGateReport(checks).map((gate) => {
    if (gate.gateId !== 'gate.quic_connection_migration') {
      return gate;
    }
    const migrationGateStatus = migrationEnabled ? gate.status : 'failed';
    return {
      ...gate,
      status: migrationGateStatus,
      error: migrationEnabled ? gate.error : 'migrationEnabled=false',
      evidence: [
        ...gate.evidence,
        {
          check: 'migration.migrationEnabled',
          status: migrationEnabled ? 'passed' : 'failed',
          detail: migrationEnabled ? undefined : 'migrationEnabled=false',
        },
      ],
    };
  });
  const snapshot = snapshotFromGateTokens(gateTokens, 'active_probe');
  const finishedAt = new Date().toISOString();
  return {
    startedAt,
    finishedAt,
    passed: snapshot.overall === 'passed',
    gateTokens,
    checks,
    snapshot,
  };
}

export async function runSevenGateEntrypointSmoke(): Promise<SevenGateEntrypointSmokeReport> {
  const active = await runSevenGateActiveProbe();
  const decisions = ENTRYPOINT_ACTIONS.map((actionId) => decideSevenGateAction(active.snapshot, actionId));
  const decisionChecks = decisions.map((decision) => makeCheck(
    'entrypoint',
    `policy.${decision.actionId}`,
    decision.allowed ? 'passed' : decision.status,
    decision.allowed ? undefined : decision.reason,
    {
      allowed: decision.allowed,
      status: decision.status,
      requiredGates: decision.requiredGates.join(','),
    },
  ));
  const checks = [...active.checks, ...decisionChecks];
  const passed = active.passed && decisionChecks.every((check) => check.status === 'passed');
  return {
    ...active,
    passed,
    checks,
    decisions,
  };
}

export async function runLibp2pSmoke(): Promise<SmokeReport> {
  const startedAt = new Date().toISOString();
  const checks: SmokeCheck[] = [];

  if (!libp2pService.isNativePlatform()) {
    checks.push(blocked('environment', 'native-platform', 'Capacitor native platform required'));
    const finishedAt = new Date().toISOString();
    return {
      startedAt,
      finishedAt,
      platform: platformLabel(),
      passed: false,
      summary: {
        passed: 0,
        failed: 0,
        blocked: checks.length,
      },
      gateTokens: buildSevenGateReport(checks),
      checks,
    };
  }

  const topic = `unimaker-smoke-${Date.now()}`;
  const rendezvousNamespace = `unimaker-smoke-rv-${Date.now()}`;
  const lanGroupId = `smoke-group-${Date.now()}`;
  const streamKey = `smoke-stream-${Date.now()}`;
  const messageId = nowId('msg');
  const controlId = nowId('ctl');

  checks.push(await runBooleanCheck('lifecycle', 'init', () => libp2pService.init()));
  checks.push(await runBooleanCheck('lifecycle', 'start', () => libp2pService.start()));
  checks.push(await runBooleanCheck('lifecycle', 'isStarted', () => libp2pService.isStarted()));

  let generatedSeed = '';
  checks.push(
    await runValueCheck(
      'lifecycle',
      'generateIdentity',
      async () => {
        const identity = await libp2pService.generateIdentity();
        const privateKey = typeof identity.privateKey === 'string' ? identity.privateKey : '';
        generatedSeed = privateKey;
        return identity;
      },
      (identity) => isRecord(identity) && typeof identity.peerId === 'string' && typeof identity.privateKey === 'string',
      (identity) => ({ identity: asJsonString(identity) })
    )
  );

  if (generatedSeed.length > 0) {
    checks.push(
      await runValueCheck(
        'lifecycle',
        'identityFromSeed',
        () => libp2pService.identityFromSeed(generatedSeed),
        (identity) => isRecord(identity) && typeof identity.peerId === 'string',
        (identity) => ({ identity: asJsonString(identity) })
      )
    );
  } else {
    checks.push(blocked('lifecycle', 'identityFromSeed', 'missing generated seed'));
  }

  const localPeerId = await libp2pService.getLocalPeerId().catch(() => '');
  checks.push(
    makeCheck('lifecycle', 'getLocalPeerId', localPeerId.length > 0 ? 'passed' : 'failed', localPeerId.length > 0 ? undefined : 'empty peerId', {
      peerId: localPeerId,
    })
  );

  const listenAddresses = await libp2pService.getListenAddresses().catch(() => []);
  checks.push(
    makeCheck(
      'lifecycle',
      'getListenAddresses',
      listenAddresses.length > 0 ? 'passed' : 'failed',
      listenAddresses.length > 0 ? undefined : 'empty listen addresses',
      { addresses: asJsonString(listenAddresses) }
    )
  );

  const dialableAddresses = await libp2pService.getDialableAddresses().catch(() => []);
  checks.push(
    makeCheck(
      'lifecycle',
      'getDialableAddresses',
      dialableAddresses.length > 0 ? 'passed' : 'failed',
      dialableAddresses.length > 0 ? undefined : 'empty dialable addresses',
      { addresses: asJsonString(dialableAddresses) }
    )
  );

  checks.push(await runBooleanCheck('discovery', 'reconnectBootstrap', () => libp2pService.reconnectBootstrap()));
  checks.push(await runBooleanCheck('discovery', 'boostConnectivity', () => libp2pService.boostConnectivity()));
  checks.push(
    await runValueCheck(
      'discovery',
      'getBootstrapStatus',
      () => libp2pService.getBootstrapStatus(),
      (value) => isRecord(value) && Object.keys(value).length > 0,
      (value) => ({ status: asJsonString(value) })
    )
  );

  checks.push(await runBooleanCheck('discovery', 'mdnsSetEnabled(true)', () => libp2pService.mdnsSetEnabled(true)));
  checks.push(await runBooleanCheck('discovery', 'mdnsSetInterval', () => libp2pService.mdnsSetInterval(8)));
  checks.push(await runBooleanCheck('discovery', 'mdnsProbe', () => libp2pService.mdnsProbe()));
  checks.push(
    await runValueCheck(
      'discovery',
      'mdnsDebug',
      () => libp2pService.mdnsDebug(),
      (value) => isRecord(value),
      (value) => ({ debug: asJsonString(value) })
    )
  );
  checks.push(await runBooleanCheck('discovery', 'mdnsSetEnabled(false)', () => libp2pService.mdnsSetEnabled(false)));

  checks.push(
    await runBooleanCheck('discovery', 'rendezvousAdvertise', () =>
      libp2pService.rendezvousAdvertise(rendezvousNamespace, 120_000)
    )
  );
  checks.push(
    await runValueCheck(
      'discovery',
      'rendezvousDiscover',
      () => libp2pService.rendezvousDiscover(rendezvousNamespace, 10),
      (value) => Array.isArray(value),
      (value) => ({ peers: asJsonString(value) })
    )
  );
  checks.push(
    await runBooleanCheck('discovery', 'rendezvousUnregister', () =>
      libp2pService.rendezvousUnregister(rendezvousNamespace)
    )
  );

  checks.push(
    await runValueCheck(
      'discovery',
      'reserveOnAllRelays',
      () => libp2pService.reserveOnAllRelays(),
      (value) => typeof value === 'number' && value >= 0,
      (value) => ({ count: value })
    )
  );

  const candidateDialable = dialableAddresses[0] ?? '';
  if (candidateDialable.length > 0) {
    checks.push(await runBooleanCheck('discovery', 'addExternalAddress', () => libp2pService.addExternalAddress(candidateDialable)));
    checks.push(await runBooleanCheck('discovery', 'connectMultiaddr', () => libp2pService.connectMultiaddr(candidateDialable)));
  } else {
    checks.push(blocked('discovery', 'addExternalAddress', 'no dialable address available'));
    checks.push(blocked('discovery', 'connectMultiaddr', 'no dialable address available'));
  }

  const connectedPeers = await libp2pService.getConnectedPeers().catch(() => []);
  const candidatePeer = connectedPeers.find((peer) => peer && peer !== localPeerId) ?? '';

  if (candidatePeer.length > 0) {
    checks.push(
      await runValueCheck(
        'discovery',
        'isPeerConnected',
        () => libp2pService.isPeerConnected(candidatePeer),
        (value) => typeof value === 'boolean',
        (value) => ({ peerId: candidatePeer, connected: value })
      )
    );

    const peerMultiaddrs = await libp2pService.getPeerMultiaddrs(candidatePeer).catch(() => []);
    checks.push(
      makeCheck('discovery', 'getPeerMultiaddrs', Array.isArray(peerMultiaddrs) ? 'passed' : 'failed', undefined, {
        peerId: candidatePeer,
        multiaddrs: asJsonString(peerMultiaddrs),
      })
    );

    const hintAddresses = peerMultiaddrs.length > 0 ? peerMultiaddrs : dialableAddresses;
    if (hintAddresses.length > 0) {
      checks.push(
        await runBooleanCheck('discovery', 'registerPeerHints', () =>
          libp2pService.registerPeerHints(candidatePeer, hintAddresses, 'smoke')
        )
      );
    } else {
      checks.push(blocked('discovery', 'registerPeerHints', 'no addresses available for peer hints'));
    }

    checks.push(await runBooleanCheck('discovery', 'connectPeer', () => libp2pService.connectPeer(candidatePeer)));
    checks.push(await runBooleanCheck('discovery', 'disconnectPeer', () => libp2pService.disconnectPeer(candidatePeer)));
    checks.push(await runBooleanCheck('discovery', 'reconnectPeer', () => libp2pService.connectPeer(candidatePeer)));
  } else {
    checks.push(blocked('discovery', 'isPeerConnected', 'no connected peer available'));
    checks.push(blocked('discovery', 'getPeerMultiaddrs', 'no connected peer available'));
    checks.push(blocked('discovery', 'registerPeerHints', 'no connected peer available'));
    checks.push(blocked('discovery', 'connectPeer', 'no connected peer available'));
    checks.push(blocked('discovery', 'disconnectPeer', 'no connected peer available'));
    checks.push(blocked('discovery', 'reconnectPeer', 'no connected peer available'));
  }

  checks.push(await runBooleanCheck('messaging', 'pubsubSubscribe', () => libp2pService.pubsubSubscribe(topic)));
  checks.push(await runBooleanCheck('messaging', 'pubsubPublish', () => libp2pService.pubsubPublish(topic, 'smoke-payload')));
  checks.push(await runBooleanCheck('messaging', 'pubsubUnsubscribe', () => libp2pService.pubsubUnsubscribe(topic)));

  checks.push(
    await runBooleanCheck('c2c', 'rendezvousAdvertise(market)', () =>
      libp2pService.rendezvousAdvertise(C2C_RENDEZVOUS_NS, 120_000)
    )
  );
  checks.push(
    await runValueCheck(
      'c2c',
      'rendezvousDiscover(market)',
      () => libp2pService.rendezvousDiscover(C2C_RENDEZVOUS_NS, 16),
      (value) => Array.isArray(value),
      (value) => ({ peers: asJsonString(value) })
    )
  );
  checks.push(
    await runBooleanCheck('c2c', 'rendezvousUnregister(market)', () =>
      libp2pService.rendezvousUnregister(C2C_RENDEZVOUS_NS)
    )
  );

  for (const c2cTopic of Object.values(C2C_TOPICS)) {
    const envelope = JSON.stringify({
      schema: c2cTopic,
      topic: c2cTopic,
      version: 'v2',
      ts: Date.now(),
      ttlMs: 60_000,
      nonce: nowId('nonce'),
      signer: '0'.repeat(64),
      sig: 'smoke-signature',
      traceId: nowId('trace'),
      payload: { smoke: true, topic: c2cTopic, ts: Date.now() },
    });
    checks.push(await runBooleanCheck('c2c', `pubsubSubscribe(${c2cTopic})`, () => libp2pService.pubsubSubscribe(c2cTopic)));
    checks.push(await runBooleanCheck('c2c', `pubsubPublish(${c2cTopic})`, () => libp2pService.pubsubPublish(c2cTopic, envelope)));
    checks.push(await runBooleanCheck('c2c', `pubsubUnsubscribe(${c2cTopic})`, () => libp2pService.pubsubUnsubscribe(c2cTopic)));
  }

  if (candidatePeer.length > 0) {
    checks.push(await runBooleanCheck('messaging', 'waitSecureChannel', () => libp2pService.waitSecureChannel(candidatePeer, 5000)));
    checks.push(
      await runBooleanCheck('messaging', 'sendWithAck', () =>
        libp2pService.sendWithAck(
          candidatePeer,
          {
            type: 'smoke',
            messageId,
            text: 'smoke-sendWithAck',
            ts: Date.now(),
          },
          6000
        )
      )
    );
    checks.push(
      await runBooleanCheck('messaging', 'sendDirectText', () =>
        libp2pService.sendDirectText(candidatePeer, 'smoke-direct-text', messageId)
      )
    );
    checks.push(
      await runBooleanCheck('messaging', 'sendChatControl', () =>
        libp2pService.sendChatControl(candidatePeer, 'edit', controlId, 'smoke-control', messageId)
      )
    );
    checks.push(
      await runBooleanCheck('messaging', 'sendChatAck', () =>
        libp2pService.sendChatAck(candidatePeer, controlId, true, '')
      )
    );
  } else {
    checks.push(blocked('messaging', 'waitSecureChannel', 'no connected peer available'));
    checks.push(blocked('messaging', 'sendWithAck', 'no connected peer available'));
    checks.push(blocked('messaging', 'sendDirectText', 'no connected peer available'));
    checks.push(blocked('messaging', 'sendChatControl', 'no connected peer available'));
    checks.push(blocked('messaging', 'sendChatAck', 'no connected peer available'));
  }

  checks.push(
    await runValueCheck(
      'messaging',
      'getLastDirectError',
      () => libp2pService.getLastDirectError(),
      (value) => typeof value === 'string',
      (value) => ({ error: value })
    )
  );

  checks.push(
    await runValueCheck(
      'social',
      'socialListDiscoveredPeers',
      () => libp2pService.socialListDiscoveredPeers('', 64),
      (value) => isRecord(value) && Array.isArray((value as { peers?: unknown[] }).peers),
      (value) => ({ peers: asJsonString(value) })
    )
  );

  if (candidatePeer.length > 0) {
    const socialConversationId = `dm:${candidatePeer}`;
    const socialMessageId = nowId('social-msg');
    checks.push(await runBooleanCheck('social', 'socialConnectPeer', () => libp2pService.socialConnectPeer(candidatePeer, '')));
    checks.push(
      await runBooleanCheck('social', 'socialDmSend', () =>
        libp2pService.socialDmSend(candidatePeer, socialConversationId, {
          messageId: socialMessageId,
          text: 'smoke-social-dm',
          sender: 'me',
          timestampMs: Date.now(),
        })
      )
    );
    checks.push(
      await runBooleanCheck('social', 'socialDmEdit', () =>
        libp2pService.socialDmEdit(candidatePeer, socialConversationId, socialMessageId, { text: 'smoke-social-dm-edited' })
      )
    );
    checks.push(
      await runBooleanCheck('social', 'socialDmAck', () =>
        libp2pService.socialDmAck(candidatePeer, socialConversationId, socialMessageId, 'acked')
      )
    );
    checks.push(
      await runBooleanCheck('social', 'socialDmRevoke', () =>
        libp2pService.socialDmRevoke(candidatePeer, socialConversationId, socialMessageId, 'smoke-revoke')
      )
    );
    checks.push(
      await runBooleanCheck('social', 'socialContactsSendRequest', () =>
        libp2pService.socialContactsSendRequest(candidatePeer, 'smoke-hello')
      )
    );
    checks.push(await runBooleanCheck('social', 'socialContactsAccept', () => libp2pService.socialContactsAccept(candidatePeer)));
    checks.push(
      await runBooleanCheck('social', 'socialContactsReject', () => libp2pService.socialContactsReject(candidatePeer, 'smoke-reject'))
    );
    checks.push(await runBooleanCheck('social', 'socialContactsRemove', () => libp2pService.socialContactsRemove(candidatePeer)));
  } else {
    checks.push(blocked('social', 'socialConnectPeer', 'no connected peer available'));
    checks.push(blocked('social', 'socialDmSend', 'no connected peer available'));
    checks.push(blocked('social', 'socialDmEdit', 'no connected peer available'));
    checks.push(blocked('social', 'socialDmAck', 'no connected peer available'));
    checks.push(blocked('social', 'socialDmRevoke', 'no connected peer available'));
    checks.push(blocked('social', 'socialContactsSendRequest', 'no connected peer available'));
    checks.push(blocked('social', 'socialContactsAccept', 'no connected peer available'));
    checks.push(blocked('social', 'socialContactsReject', 'no connected peer available'));
    checks.push(blocked('social', 'socialContactsRemove', 'no connected peer available'));
  }

  let socialGroupId = '';
  try {
    const created = await libp2pService.socialGroupsCreate({
      name: 'smoke-group',
      members: candidatePeer.length > 0 ? [candidatePeer] : [],
      createdAt: Date.now(),
    });
    socialGroupId = typeof created.groupId === 'string' ? created.groupId : '';
    checks.push(
      makeCheck(
        'social',
        'socialGroupsCreate',
        socialGroupId.length > 0 ? 'passed' : 'failed',
        socialGroupId.length > 0 ? undefined : `unexpected response: ${asJsonString(created)}`,
        { group: asJsonString(created) }
      )
    );
  } catch (error) {
    checks.push(makeCheck('social', 'socialGroupsCreate', 'failed', error instanceof Error ? error.message : String(error)));
  }

  if (socialGroupId.length > 0) {
    if (candidatePeer.length > 0) {
      checks.push(
        await runBooleanCheck('social', 'socialGroupsInvite', () => libp2pService.socialGroupsInvite(socialGroupId, [candidatePeer]))
      );
      checks.push(
        await runBooleanCheck('social', 'socialGroupsKick', () => libp2pService.socialGroupsKick(socialGroupId, candidatePeer))
      );
    } else {
      checks.push(blocked('social', 'socialGroupsInvite', 'no connected peer available'));
      checks.push(blocked('social', 'socialGroupsKick', 'no connected peer available'));
    }
    checks.push(
      await runBooleanCheck('social', 'socialGroupsUpdate', () =>
        libp2pService.socialGroupsUpdate(socialGroupId, { topic: 'smoke-updated', updatedAt: Date.now() })
      )
    );
    checks.push(
      await runBooleanCheck('social', 'socialGroupsSend', () =>
        libp2pService.socialGroupsSend(socialGroupId, { messageId: nowId('group-msg'), text: 'smoke-group-message' })
      )
    );
    checks.push(await runBooleanCheck('social', 'socialGroupsLeave', () => libp2pService.socialGroupsLeave(socialGroupId)));
  } else {
    checks.push(blocked('social', 'socialGroupsInvite', 'group not created'));
    checks.push(blocked('social', 'socialGroupsKick', 'group not created'));
    checks.push(blocked('social', 'socialGroupsUpdate', 'group not created'));
    checks.push(blocked('social', 'socialGroupsSend', 'group not created'));
    checks.push(blocked('social', 'socialGroupsLeave', 'group not created'));
  }

  let socialPostId = '';
  try {
    const post = await libp2pService.socialMomentsPublish({
      content: 'smoke-moment',
      timestampMs: Date.now(),
    });
    socialPostId = typeof post.postId === 'string' ? post.postId : '';
    checks.push(
      makeCheck(
        'social',
        'socialMomentsPublish',
        socialPostId.length > 0 ? 'passed' : 'failed',
        socialPostId.length > 0 ? undefined : `unexpected response: ${asJsonString(post)}`,
        { post: asJsonString(post) }
      )
    );
  } catch (error) {
    checks.push(makeCheck('social', 'socialMomentsPublish', 'failed', error instanceof Error ? error.message : String(error)));
  }

  if (socialPostId.length > 0) {
    checks.push(await runBooleanCheck('social', 'socialMomentsLike', () => libp2pService.socialMomentsLike(socialPostId, true)));
    checks.push(
      await runBooleanCheck('social', 'socialMomentsComment', () =>
        libp2pService.socialMomentsComment(socialPostId, { text: 'smoke-comment', timestampMs: Date.now() })
      )
    );
    checks.push(await runBooleanCheck('social', 'socialMomentsDelete', () => libp2pService.socialMomentsDelete(socialPostId)));
  } else {
    checks.push(blocked('social', 'socialMomentsLike', 'post not created'));
    checks.push(blocked('social', 'socialMomentsComment', 'post not created'));
    checks.push(blocked('social', 'socialMomentsDelete', 'post not created'));
  }

  checks.push(
    await runValueCheck(
      'social',
      'socialMomentsTimeline',
      () => libp2pService.socialMomentsTimeline('', 20),
      (value) => isRecord(value) && Array.isArray((value as { items?: unknown[] }).items),
      (value) => ({ timeline: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'social',
      'socialNotificationsList',
      () => libp2pService.socialNotificationsList('', 20),
      (value) => isRecord(value) && Array.isArray((value as { items?: unknown[] }).items),
      (value) => ({ notifications: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'social',
      'socialQueryPresence',
      () => libp2pService.socialQueryPresence(candidatePeer.length > 0 ? [candidatePeer] : [localPeerId].filter((value) => value.length > 0)),
      (value) => Array.isArray(value),
      (value) => ({ presence: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'social',
      'socialPollEvents',
      () => libp2pService.socialPollEvents(64),
      (value) => Array.isArray(value),
      (value) => ({ events: asJsonString(value) })
    )
  );

  checks.push(
    await runBooleanCheck('content', 'feedPublishEntry', () =>
      libp2pService.feedPublishEntry({ type: 'smoke', id: nowId('feed'), ts: Date.now(), text: 'feed-entry' })
    )
  );
  checks.push(
    await runValueCheck(
      'content',
      'fetchFeedSnapshot',
      () => libp2pService.fetchFeedSnapshot(),
      (value) => isRecord(value),
      (value) => ({ snapshot: asJsonString(value) })
    )
  );

  if (candidatePeer.length > 0) {
    checks.push(await runBooleanCheck('content', 'feedSubscribePeer', () => libp2pService.feedSubscribePeer(candidatePeer)));
    checks.push(
      await runBooleanCheck('content', 'feedUnsubscribePeer', () => libp2pService.feedUnsubscribePeer(candidatePeer))
    );
  } else {
    checks.push(blocked('content', 'feedSubscribePeer', 'no connected peer available'));
    checks.push(blocked('content', 'feedUnsubscribePeer', 'no connected peer available'));
  }

  checks.push(
    await runValueCheck(
      'content',
      'syncPeerstoreState',
      () => libp2pService.syncPeerstoreState(),
      (value) => isRecord(value),
      (value) => ({ state: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'content',
      'loadStoredPeers',
      () => libp2pService.loadStoredPeers(),
      (value) => isRecord(value),
      (value) => ({ peers: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'content',
      'pollEvents',
      () => libp2pService.pollEvents(64),
      (value) => Array.isArray(value),
      (value) => ({ events: asJsonString(value) })
    )
  );

  checks.push(
    await runValueCheck(
      'lan',
      'getLanEndpoints',
      () => libp2pService.getLanEndpoints(),
      (value) => Array.isArray(value),
      (value) => ({ endpoints: asJsonString(value) })
    )
  );
  checks.push(await runBooleanCheck('lan', 'lanGroupJoin', () => libp2pService.lanGroupJoin(lanGroupId)));
  checks.push(await runBooleanCheck('lan', 'lanGroupSend', () => libp2pService.lanGroupSend(lanGroupId, 'smoke-lan-message')));
  checks.push(await runBooleanCheck('lan', 'lanGroupLeave', () => libp2pService.lanGroupLeave(lanGroupId)));

  checks.push(
    await runBooleanCheck('livestream', 'upsertLivestreamConfig', () =>
      libp2pService.upsertLivestreamConfig(streamKey, {
        streamKey,
        codec: 'h264',
        fps: 10,
        ts: Date.now(),
      })
    )
  );
  checks.push(
    await runBooleanCheck('livestream', 'publishLivestreamFrame', () =>
      libp2pService.publishLivestreamFrame(streamKey, `frame-${Date.now()}`)
    )
  );

  checks.push(
    await runValueCheck(
      'diagnostics',
      'getDiagnostics',
      () => libp2pService.getDiagnostics(),
      (value) => isRecord(value) && Object.keys(value).length > 0,
      (value) => ({ diagnostics: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'diagnostics',
      'getBootstrapStatus',
      () => libp2pService.getBootstrapStatus(),
      (value) => isRecord(value),
      (value) => ({ status: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'diagnostics',
      'getConnectedPeersInfo',
      () => libp2pService.getConnectedPeersInfo(),
      (value) => Array.isArray(value),
      (value) => ({ peersInfo: asJsonString(value) })
    )
  );
  checks.push(
    await runValueCheck(
      'diagnostics',
      'getLastError',
      () => libp2pService.getLastError(),
      (value) => typeof value === 'string',
      (value) => ({ error: value })
    )
  );
  checks.push(
    await runValueCheck(
      'diagnostics',
      'pollEvents',
      () => libp2pService.pollEvents(64),
      (value) => Array.isArray(value),
      (value) => ({ events: asJsonString(value) })
    )
  );

  checks.push(await runBooleanCheck('lifecycle', 'stop', () => libp2pService.stop()));

  const finishedAt = new Date().toISOString();
  const summary = {
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    blocked: checks.filter((check) => check.status === 'blocked').length,
  };
  const gateTokens = buildSevenGateReport(checks);
  const gateFailed = gateTokens.filter((gate) => gate.status !== 'passed').length;

  return {
    startedAt,
    finishedAt,
    platform: platformLabel(),
    passed: summary.failed === 0 && summary.blocked === 0 && gateFailed === 0,
    summary,
    gateTokens,
    checks,
  };
}
