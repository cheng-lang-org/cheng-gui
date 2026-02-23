import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  handlers: new Set<(event: Record<string, unknown>) => void>(),
  isNativePlatform: true,
  pubsubSubscribe: vi.fn(async () => true),
  pubsubUnsubscribe: vi.fn(async () => true),
  rendezvousAdvertise: vi.fn(async () => true),
  fetchFeedSnapshot: vi.fn(async () => ({ items: [] as Array<Record<string, unknown>> })),
  getLocalPeerId: vi.fn(async () => 'self-peer'),
  isStarted: vi.fn(async () => true),
  ensureStarted: vi.fn(async () => true),
  runtimeHealth: vi.fn(async () => ({ nativeReady: true, started: true, peerId: 'self-peer' })),
  bootstrapGetStatus: vi.fn(async () => ({} as Record<string, unknown>)),
  rendezvousDiscover: vi.fn(async () => [] as Array<Record<string, unknown>>),
  reconnectBootstrap: vi.fn(async () => true),
  boostConnectivity: vi.fn(async () => true),
  syncPeerstoreState: vi.fn(async () => ({} as Record<string, unknown>)),
  mdnsProbe: vi.fn(async () => true),
  setDiscoveryActive: vi.fn(async () => undefined),
  getConnectedPeers: vi.fn(async () => [] as string[]),
  joinViaRandomBootstrap: vi.fn(async () => ({ ok: true, connectedCount: 0 })),
  loadStoredPeers: vi.fn(async () => ({ peers: [] as Array<Record<string, unknown>> })),
  socialListDiscoveredPeers: vi.fn(async () => ({ peers: [] as Array<Record<string, unknown>>, totalCount: 0 })),
  registerPeerHints: vi.fn(async () => true),
  socialConnectPeer: vi.fn(async () => true),
  feedSubscribePeer: vi.fn(async () => true),
  feedUnsubscribePeer: vi.fn(async () => true),
}));

vi.mock('../../../libp2p/eventPump', () => ({
  libp2pEventPump: {
    subscribe: (handler: (event: Record<string, unknown>) => void) => {
      mock.handlers.add(handler);
      return () => {
        mock.handlers.delete(handler);
      };
    },
  },
}));

vi.mock('../../../libp2p/service', () => ({
  libp2pService: {
    isNativePlatform: () => mock.isNativePlatform,
    pubsubSubscribe: (...args: unknown[]) => mock.pubsubSubscribe(...args),
    pubsubUnsubscribe: (...args: unknown[]) => mock.pubsubUnsubscribe(...args),
    rendezvousAdvertise: (...args: unknown[]) => mock.rendezvousAdvertise(...args),
    reconnectBootstrap: (...args: unknown[]) => mock.reconnectBootstrap(...args),
    boostConnectivity: (...args: unknown[]) => mock.boostConnectivity(...args),
    syncPeerstoreState: (...args: unknown[]) => mock.syncPeerstoreState(...args),
    mdnsProbe: (...args: unknown[]) => mock.mdnsProbe(...args),
    mdnsSetEnabled: async () => true,
    mdnsSetInterval: async () => true,
    setDiscoveryActive: (...args: unknown[]) => mock.setDiscoveryActive(...args),
    getConnectedPeers: (...args: unknown[]) => mock.getConnectedPeers(...args),
    joinViaRandomBootstrap: (...args: unknown[]) => mock.joinViaRandomBootstrap(...args),
    fetchFeedSnapshot: (...args: unknown[]) => mock.fetchFeedSnapshot(...args),
    getLocalPeerId: (...args: unknown[]) => mock.getLocalPeerId(...args),
    isStarted: (...args: unknown[]) => mock.isStarted(...args),
    ensureStarted: (...args: unknown[]) => mock.ensureStarted(...args),
    runtimeHealth: (...args: unknown[]) => mock.runtimeHealth(...args),
    bootstrapGetStatus: (...args: unknown[]) => mock.bootstrapGetStatus(...args),
    rendezvousDiscover: (...args: unknown[]) => mock.rendezvousDiscover(...args),
    loadStoredPeers: (...args: unknown[]) => mock.loadStoredPeers(...args),
    socialListDiscoveredPeers: (...args: unknown[]) => mock.socialListDiscoveredPeers(...args),
    registerPeerHints: (...args: unknown[]) => mock.registerPeerHints(...args),
    socialConnectPeer: (...args: unknown[]) => mock.socialConnectPeer(...args),
    feedSubscribePeer: (...args: unknown[]) => mock.feedSubscribePeer(...args),
    feedUnsubscribePeer: (...args: unknown[]) => mock.feedUnsubscribePeer(...args),
  },
}));

import { UpdateTransport } from '../updateTransport';

function b64(text: string): string {
  if (typeof btoa === 'function') {
    return btoa(text);
  }
  throw new Error('btoa_unavailable');
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('update transport authority convergence', () => {
  beforeEach(() => {
    mock.handlers.clear();
    mock.isNativePlatform = true;
    mock.pubsubSubscribe.mockClear();
    mock.pubsubUnsubscribe.mockClear();
    mock.rendezvousAdvertise.mockClear();
    mock.reconnectBootstrap.mockClear();
    mock.boostConnectivity.mockClear();
    mock.syncPeerstoreState.mockClear();
    mock.mdnsProbe.mockClear();
    mock.setDiscoveryActive.mockClear();
    mock.getConnectedPeers.mockReset();
    mock.getConnectedPeers.mockResolvedValue([]);
    mock.joinViaRandomBootstrap.mockClear();
    mock.loadStoredPeers.mockReset();
    mock.loadStoredPeers.mockResolvedValue({ peers: [] });
    mock.socialListDiscoveredPeers.mockReset();
    mock.socialListDiscoveredPeers.mockResolvedValue({ peers: [], totalCount: 0 });
    mock.registerPeerHints.mockClear();
    mock.socialConnectPeer.mockClear();
    mock.fetchFeedSnapshot.mockReset();
    mock.fetchFeedSnapshot.mockResolvedValue({ items: [] });
    mock.getLocalPeerId.mockReset();
    mock.getLocalPeerId.mockResolvedValue('self-peer');
    mock.isStarted.mockReset();
    mock.isStarted.mockResolvedValue(true);
    mock.ensureStarted.mockReset();
    mock.ensureStarted.mockResolvedValue(true);
    mock.runtimeHealth.mockReset();
    mock.runtimeHealth.mockResolvedValue({ nativeReady: true, started: true, peerId: 'self-peer' });
    mock.bootstrapGetStatus.mockReset();
    mock.bootstrapGetStatus.mockResolvedValue({});
    mock.rendezvousDiscover.mockReset();
    mock.rendezvousDiscover.mockResolvedValue([]);
    mock.feedSubscribePeer.mockReset();
    mock.feedSubscribePeer.mockResolvedValue(true);
    mock.feedUnsubscribePeer.mockReset();
    mock.feedUnsubscribePeer.mockResolvedValue(true);
  });

  afterEach(async () => {
    mock.handlers.clear();
  });

  it('subscribes update topics and dispatches gossipsub message', async () => {
    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });
    const messages: Array<{ kind: string; source: string }> = [];
    transport.subscribe((message) => {
      messages.push({ kind: message.kind, source: message.source });
    });

    await transport.start();
    expect(mock.pubsubSubscribe).toHaveBeenCalledTimes(4);
    expect(mock.rendezvousAdvertise).toHaveBeenCalled();

    for (const handler of mock.handlers) {
      handler({
        topic: 'pubsub.message',
        payload: {
          topic: '/unimaker/updates/v2/stable/android/manifest',
          payloadBase64: b64(JSON.stringify({ manifest_id: 'mf-100', sequence: 100 })),
        },
      });
    }
    await flush();

    expect(messages.some((item) => item.kind === 'manifest' && item.source === 'gossipsub')).toBe(true);
    await transport.stop();
  });

  it('uses feed snapshot to recover missed updates and subscribes discovered feed peers', async () => {
    mock.fetchFeedSnapshot.mockResolvedValue({
      items: [
        {
          payload: {
            topic: '/unimaker/updates/v2/stable/android/manifest',
            payload: {
              manifest_id: 'mf-101',
              sequence: 101,
            },
          },
        },
      ],
    });
    mock.rendezvousDiscover.mockImplementation(async (namespace: string) => {
      if (namespace.startsWith('/')) {
        return [{ peerId: 'peer-a' }, { peerId: 'self-peer' }];
      }
      return [];
    });

    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });
    const messages: Array<{ kind: string; source: string }> = [];
    transport.subscribe((message) => {
      messages.push({ kind: message.kind, source: message.source });
    });

    await transport.start();
    expect(mock.feedSubscribePeer).toHaveBeenCalledWith('peer-a');
    expect(mock.rendezvousDiscover).toHaveBeenCalledWith('unimaker/updates/v2/stable/android', 64);
    expect(mock.rendezvousDiscover).toHaveBeenCalledWith('/unimaker/updates/v2/stable/android', 64);
    expect(messages.some((item) => item.kind === 'manifest' && item.source === 'feed_snapshot')).toBe(true);
    await transport.stop();
  });

	it('accepts direct feed snapshot entry shape without payload wrapper', async () => {
    mock.fetchFeedSnapshot.mockResolvedValue({
      items: [
	        {
	          topic: '/unimaker/updates/v2/stable/android/manifest',
	          payload: {
	            manifest_id: 'mf-raw-102',
	            sequence: 102,
	            channel: 'stable',
	            platform: 'android',
	            version: '0.0.102',
	            version_code: 102,
	          },
	          ts: Date.now(),
	        },
	      ],
	    });

    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });
    const messages: Array<{ kind: string; source: string }> = [];
    transport.subscribe((message) => {
      messages.push({ kind: message.kind, source: message.source });
    });

    await transport.start();
    expect(messages.some((item) => item.kind === 'manifest' && item.source === 'feed_snapshot')).toBe(true);
    await transport.stop();
  });

  it('infers topic from feed snapshot bare envelope payload', async () => {
    mock.fetchFeedSnapshot.mockResolvedValue({
      items: [
        {
          payload: {
            kind: 'update_envelope_v2',
            schema_version: 2,
            nonce: 'n',
            expires_at_ms: Date.now() + 120000,
            payload_hash: 'x',
            payload: {
              kind: 'manifest_v2',
              schema_version: 2,
              manifest_id: 'mf-infer',
              channel: 'stable',
              platform: 'android',
              sequence: 500,
              version: '9.9.9',
              version_code: 999,
              artifacts: [],
              rollout: {
                percent: 100,
                emergency: false,
                stages: [1, 10, 50, 100],
              },
              policy: { mandatory: false },
              security: {
                mode: 'vrf_chain_v1',
                threshold: 0,
                committee_keys: [],
                signatures: [],
                attestation_threshold: 0,
                vrf: {
                  scheme: 'ed25519_sig_vrf_v1',
                  publisher_peer_id: 'p',
                  vrf_public_key_hex: 'a'.repeat(64),
                  prev_manifest_hash: '0'.repeat(64),
                  prev_vrf_output_hex: '0'.repeat(64),
                  vrf_input_hex: '0'.repeat(64),
                  vrf_proof_base64: '',
                  vrf_output_hex: '0'.repeat(64),
                },
              },
              metadata: {
                release_notes: {
                  summary: 'summary',
                  details: 'details',
                  published_at_ms: Date.now(),
                },
              },
            },
          },
        },
      ],
    });

    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });
    const messages: Array<{ kind: string; source: string }> = [];
    transport.subscribe((message) => {
      messages.push({ kind: message.kind, source: message.source });
    });

    await transport.start();
    expect(messages.some((item) => item.kind === 'manifest' && item.source === 'feed_snapshot')).toBe(true);
    await transport.stop();
  });

  it('manualCheck triggers feed refresh when previous poll missed data', async () => {
    let call = 0;
    mock.fetchFeedSnapshot.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return { items: [] };
      }
      return {
        items: [
          {
            payload: {
              topic: '/unimaker/updates/v2/stable/android/revoke',
              payload: { manifest_id: 'mf-200', reason: 'drill' },
            },
          },
        ],
      };
    });

    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });
    const messages: Array<{ kind: string; source: string }> = [];
    transport.subscribe((message) => {
      messages.push({ kind: message.kind, source: message.source });
    });

    await transport.start();
    expect(messages.length).toBe(0);

    const result = await transport.manualCheck();
    expect(messages.some((item) => item.kind === 'revoke' && item.source === 'feed_snapshot')).toBe(true);
    expect(result.connectivity_ok).toBe(true);
    expect(result.observed_messages).toBeGreaterThan(0);
    await transport.stop();
  });

  it('falls back to real-time discovered peers when rendezvous is empty', async () => {
    mock.rendezvousDiscover.mockResolvedValue([]);
    mock.socialListDiscoveredPeers.mockResolvedValue({
      peers: [
        { peerId: 'peer-realtime', multiaddrs: ['/ip4/10.0.0.8/tcp/4001'] },
      ],
      totalCount: 1,
    });

    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });

    await transport.start();
    expect(mock.feedSubscribePeer).toHaveBeenCalledWith('peer-realtime');
    await transport.stop();
  });

  it('manualCheck tolerates authority sync failure without throwing', async () => {
    mock.fetchFeedSnapshot.mockRejectedValue(new Error('snapshot_down'));
    mock.rendezvousDiscover.mockRejectedValue(new Error('rendezvous_down'));
    mock.socialListDiscoveredPeers.mockResolvedValue({ peers: [], totalCount: 0 });
    mock.getConnectedPeers.mockResolvedValue([]);

    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });
    await transport.start();

    const result = await transport.manualCheck();
    expect(result.connectivity_ok).toBe(false);
    expect(result.reason).toBe('no_remote_peers');
    await transport.stop();
  });

  it('reports native_not_ready when runtime is not ready', async () => {
    mock.fetchFeedSnapshot.mockRejectedValue(new Error('snapshot_down'));
    mock.rendezvousDiscover.mockRejectedValue(new Error('rendezvous_down'));
    mock.socialListDiscoveredPeers.mockResolvedValue({ peers: [], totalCount: 0 });
    mock.getConnectedPeers.mockResolvedValue([]);
    mock.getLocalPeerId.mockResolvedValue('');
    mock.isStarted.mockResolvedValue(false);
    mock.ensureStarted.mockResolvedValue(false);
    mock.runtimeHealth.mockResolvedValue({ nativeReady: false, started: false, peerId: '', lastError: 'native_lib_not_loaded' });

    const transport = new UpdateTransport({
      channel: 'stable',
      platform: 'android',
      authority_namespace: 'unimaker/updates/v2/stable/android',
    });
    await transport.start();

    const result = await transport.manualCheck();
    expect(result.connectivity_ok).toBe(false);
    expect(result.reason).toBe('native_not_ready');
    await transport.stop();
  });
});
