import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateManifestV2 } from '../protocol/UpdateManifestV2';
import {
  ackUpdatePrompt,
  canShowPublisherZone,
  getScopedVersionState,
  getUpdateStoreState,
  markApplied,
  resetUpdateStoreForTests,
  setLastError,
  setInstalledVersion,
  setManifestDetected,
} from '../updateStore';

function makeManifest(sequence: number, version: string): UpdateManifestV2 {
  return {
    kind: 'manifest_v2',
    schema_version: 2,
    manifest_id: `mf-${sequence}`,
    channel: 'stable',
    platform: 'android',
    sequence,
    version,
    version_code: sequence,
    artifacts: [
      {
        platform: 'android',
        kind: 'full',
        uri: `https://example.com/unimaker-${version}.apk`,
        sha256: 'cafebabe',
        size_bytes: 1024,
        shell_required: false,
      },
    ],
    rollout: {
      percent: 100,
      emergency: false,
      stages: [1, 10, 50, 100],
    },
    policy: {
      mandatory: false,
    },
    security: {
      mode: 'single_publisher_chain',
      threshold: 1,
      committee_keys: [],
      signatures: [],
      publisher_pubkey: 'publisher-a',
      attestation_threshold: 0,
    },
    metadata: {
      release_notes: {
        summary: `summary-${sequence}`,
        details: `details-${sequence}`,
        published_at_ms: 1771040000000 + sequence,
      },
    },
  };
}

describe('update store', () => {
  const originalLocalStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  beforeEach(() => {
    const memory = new Map<string, string>();
    (globalThis as unknown as { localStorage?: Storage }).localStorage = {
      getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
      key: (index: number) => Array.from(memory.keys())[index] ?? null,
      get length() {
        return memory.size;
      },
    } as Storage;
    resetUpdateStoreForTests();
  });

  afterEach(() => {
    (globalThis as unknown as { localStorage?: Storage }).localStorage = originalLocalStorage;
  });

  it('tracks prompt visibility and supports prompt ack dedupe', () => {
    const manifest = makeManifest(10, '2.2.5');
    setManifestDetected(manifest);

    let snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.latest_version).toBe('2.2.5');
    expect(snapshot.latest_manifest_verified).toBe(true);
    expect(snapshot.latest_manifest_source).toBe('network_manifest');
    expect(snapshot.show_update_prompt).toBe(true);

    ackUpdatePrompt(manifest.channel, manifest.platform, manifest.sequence);
    snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.show_update_prompt).toBe(false);

    setManifestDetected(manifest);
    snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.show_update_prompt).toBe(false);
  });

  it('migrates previous/current versions on markApplied and keeps scoped state', () => {
    const first = makeManifest(11, '2.2.5');
    const second = makeManifest(12, '2.3.0');

    markApplied(first);
    let snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('2.2.5');
    expect(snapshot.previous_version).toBeUndefined();

    markApplied(second);
    snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('2.3.0');
    expect(snapshot.previous_version).toBe('2.2.5');

    const scoped = getScopedVersionState('stable', 'android');
    expect(scoped?.sequence).toBe(12);
    expect(scoped?.current_version).toBe('2.3.0');
    expect(scoped?.previous_version).toBe('2.2.5');
  });

  it('hydrates scoped version state from local storage after module reload', async () => {
    const first = makeManifest(20, '3.0.0');
    const second = makeManifest(21, '3.1.0');
    markApplied(first);
    markApplied(second);

    const raw = localStorage.getItem('unimaker_update_store_v2');
    expect(raw).toContain('applied_version_by_scope');

    vi.resetModules();
    const reloaded = await import('../updateStore');
    const scoped = reloaded.getScopedVersionState('stable', 'android');
    expect(scoped?.sequence).toBe(21);
    expect(scoped?.current_version).toBe('3.1.0');
    expect(scoped?.previous_version).toBe('3.0.0');
  });

  it('seeds current/latest version from installed app info before manifest arrives', () => {
    setInstalledVersion('stable', 'android', '1.0.2', 3);
    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('1.0.2');
    expect(snapshot.current_version_code).toBe(3);
    expect(snapshot.latest_version).toBe('1.0.2');
    expect(snapshot.latest_version_code).toBe(3);
    expect(snapshot.latest_manifest_verified).toBe(true);
    expect(snapshot.latest_manifest_source).toBe('installed_package');
    expect(canShowPublisherZone('stable', 'android')).toBe(false);
    const scoped = getScopedVersionState('stable', 'android');
    expect(scoped?.current_version).toBe('1.0.2');
    expect(scoped?.current_version_code).toBe(3);
    expect(scoped?.previous_version).toBeUndefined();
  });

  it('promotes installed baseline when installed version is newer than verified latest', () => {
    setManifestDetected(makeManifest(3, '1.0.3'));
    setInstalledVersion('stable', 'android', '1.0.4', 4);
    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('1.0.4');
    expect(snapshot.current_version_code).toBe(4);
    expect(snapshot.latest_version).toBe('1.0.4');
    expect(snapshot.latest_version_code).toBe(4);
    expect(snapshot.latest_manifest_verified).toBe(true);
    expect(snapshot.latest_manifest_source).toBe('installed_package');
    expect(canShowPublisherZone('stable', 'android')).toBe(false);
  });

  it('promotes installed baseline even when only version text is newer', () => {
    setManifestDetected(makeManifest(3, '1.0.3'));
    setInstalledVersion('stable', 'android', '1.0.4');
    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('1.0.4');
    expect(snapshot.latest_version).toBe('1.0.4');
    expect(snapshot.latest_manifest_verified).toBe(true);
    expect(snapshot.latest_manifest_source).toBe('installed_package');
  });

  it('keeps latest version when remote latest is newer than installed version', () => {
    setManifestDetected(makeManifest(6, '1.0.6'));
    setInstalledVersion('stable', 'android', '1.0.4', 4);
    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('1.0.4');
    expect(snapshot.current_version_code).toBe(4);
    expect(snapshot.latest_version).toBe('1.0.6');
    expect(snapshot.latest_version_code).toBe(6);
    expect(snapshot.latest_manifest_source).toBe('network_manifest');
  });

  it('does not downgrade verified latest when a newer sequence carries an older version', () => {
    setManifestDetected(makeManifest(6, '1.0.6'));
    setInstalledVersion('stable', 'android', '1.0.4', 4);
    const olderManifest = {
      ...makeManifest(99, '1.0.3'),
      version_code: 3,
    };
    setManifestDetected(olderManifest);
    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('1.0.4');
    expect(snapshot.latest_version).toBe('1.0.6');
    expect(snapshot.latest_manifest_verified).toBe(true);
    expect(snapshot.latest_manifest_source).toBe('network_manifest');
  });

  it('shows publisher zone only for verified newer remote version', () => {
    setInstalledVersion('stable', 'android', '0.0.9', 9);
    expect(canShowPublisherZone('stable', 'android')).toBe(false);

    const latest = {
      ...makeManifest(10, '0.0.10'),
      version_code: 10,
    };
    setManifestDetected(latest);
    expect(canShowPublisherZone('stable', 'android')).toBe(true);

    markApplied(latest);
    expect(canShowPublisherZone('stable', 'android')).toBe(false);
  });

  it('keeps network source when installed version is equal to verified network latest', () => {
    setManifestDetected({
      ...makeManifest(4, '1.0.4'),
      version_code: 4,
    });
    setInstalledVersion('stable', 'android', '1.0.4', 4);
    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.latest_manifest_verified).toBe(true);
    expect(snapshot.latest_manifest_source).toBe('network_manifest');
    expect(canShowPublisherZone('stable', 'android')).toBe(false);
  });

  it('hides publisher zone when network is unreachable even if newer network manifest exists', () => {
    setInstalledVersion('stable', 'android', '0.0.9', 9);
    setManifestDetected({
      ...makeManifest(10, '0.0.10'),
      version_code: 10,
    });
    expect(canShowPublisherZone('stable', 'android')).toBe(true);
    setLastError('network_unreachable');
    expect(canShowPublisherZone('stable', 'android')).toBe(false);
  });

  it('captures previous version on first applied manifest after installed baseline is known', () => {
    setInstalledVersion('stable', 'android', '0.0.2', 8);
    markApplied({
      ...makeManifest(9, '0.0.3'),
      version_code: 9,
    });
    const snapshot = getUpdateStoreState().snapshot;
    expect(snapshot.current_version).toBe('0.0.3');
    expect(snapshot.previous_version).toBe('0.0.2');
    expect(snapshot.current_version_code).toBe(9);
    expect(snapshot.previous_version_code).toBe(8);
  });
});
