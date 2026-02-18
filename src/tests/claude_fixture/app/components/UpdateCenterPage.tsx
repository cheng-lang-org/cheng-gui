import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, RefreshCcw, ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  canShowPublisherZone,
  compareVersionVector,
  getVrfChainState,
  getUpdateSnapshot,
  manualCheckForUpdates,
  publishKillSwitch,
  publishManifest,
  publishRevoke,
  subscribeUpdateSnapshot,
  syncInstalledVersionNow,
  triggerStoreUpgrade,
  loadOrCreateVrfPublisherKeypair,
  type UpdateManifestV2,
  type UpdateSnapshot,
} from '../domain/update';
import { useLocale } from '../i18n/LocaleContext';

interface UpdateCenterPageProps {
  onClose: () => void;
}

function formatTime(value: number): string {
  if (!value || value <= 0) {
    return '未同步';
  }
  return new Date(value).toLocaleString();
}

function toPositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) {
    return null;
  }
  return normalized;
}

function defaultArtifactUri(
  channel: string,
  platform: string,
  version?: string,
  versionCode?: number,
): string {
  const normalizedVersion = (version ?? '').trim() || '0.0.0';
  const normalizedCode = Number.isFinite(Number(versionCode))
    ? Math.max(0, Math.trunc(Number(versionCode)))
    : 0;
  return `p2p://unimaker/updates/${channel}/${platform}/v${normalizedVersion}/code-${normalizedCode}`;
}

interface PublishVersionBaseline {
  version: string;
  versionCode: number;
  sequence: number;
}

interface PublishDefaults extends PublishVersionBaseline {
  artifactUri: string;
  summary: string;
  details: string;
}

interface PublishManifestInput {
  version: string;
  versionCode: number;
  sequence: number;
  artifactUri: string;
  artifactSha256?: string;
  summary: string;
  details: string;
  shellRequired: boolean;
  emergency: boolean;
}

function normalizeVersionText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().replace(/^[vV]/, '') : '';
  return text;
}

function bumpPatchVersion(version: unknown): string {
  const normalized = normalizeVersionText(version);
  if (!normalized) {
    return '0.0.1';
  }
  const parts = normalized
    .split('.')
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? Math.max(0, Math.trunc(item)) : 0));
  while (parts.length < 3) {
    parts.push(0);
  }
  const last = parts.length - 1;
  parts[last] = (parts[last] ?? 0) + 1;
  return parts.join('.');
}

function derivePublishBaseline(snapshot: UpdateSnapshot, sequenceHead: number): PublishVersionBaseline {
  const normalizedHead = Number.isFinite(Number(sequenceHead))
    ? Math.max(0, Math.trunc(Number(sequenceHead)))
    : Math.max(0, Math.trunc(Number(snapshot.sequence) || 0));
  const candidates = [
    {
      version: snapshot.latest_version,
      versionCode: snapshot.latest_version_code,
      sequence: normalizedHead,
    },
    {
      version: snapshot.current_version,
      versionCode: snapshot.current_version_code,
      sequence: normalizedHead,
    },
    {
      version: snapshot.previous_version,
      versionCode: snapshot.previous_version_code,
      sequence: Math.max(0, normalizedHead - 1),
    },
  ];
  let baseline: PublishVersionBaseline = {
    version: '',
    versionCode: 0,
    sequence: 0,
  };
  for (const candidate of candidates) {
    if (compareVersionVector(candidate, baseline) > 0) {
      baseline = {
        version: normalizeVersionText(candidate.version),
        versionCode: Number.isFinite(Number(candidate.versionCode))
          ? Math.max(0, Math.trunc(Number(candidate.versionCode)))
          : 0,
        sequence: Number.isFinite(Number(candidate.sequence))
          ? Math.max(0, Math.trunc(Number(candidate.sequence)))
          : 0,
      };
    }
  }
  return baseline;
}

function buildPublishDefaults(snapshot: UpdateSnapshot, sequenceHead: number): PublishDefaults {
  const baseline = derivePublishBaseline(snapshot, sequenceHead);
  const nextVersion = bumpPatchVersion(baseline.version);
  const nextVersionCode = Math.max(1, baseline.versionCode + 1);
  const nextSequence = Math.max(1, sequenceHead + 1);
  return {
    version: nextVersion,
    versionCode: nextVersionCode,
    sequence: nextSequence,
    artifactUri: defaultArtifactUri(snapshot.channel, snapshot.platform, nextVersion, nextVersionCode),
    summary: `发布 v${nextVersion} 全网自动更新`,
    details: [
      `版本号: v${nextVersion}`,
      `版本码: ${nextVersionCode}`,
      `渠道: ${snapshot.channel}`,
      `平台: ${snapshot.platform}`,
      '更新内容: 请补充本次真实变更。',
    ].join('\n'),
  };
}

function buildReleaseDetails(
  channel: string,
  platform: string,
  version: string,
  versionCode: number,
  fallback?: string,
): string {
  const normalizedFallback = (fallback ?? '').trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }
  return [
    `版本号: v${version}`,
    `版本码: ${versionCode}`,
    `渠道: ${channel}`,
    `平台: ${platform}`,
    '更新内容: 自动发布当前安装版本。',
  ].join('\n');
}

function hasVerifiedVersionUpdate(snapshot: UpdateSnapshot): boolean {
  const latestVersion = (snapshot.latest_version ?? '').trim();
  if (!snapshot.latest_manifest_verified || !latestVersion) {
    return false;
  }
  return compareVersionVector(
    {
      version: snapshot.latest_version,
      versionCode: snapshot.latest_version_code,
      sequence: snapshot.latest_manifest_verified_sequence,
    },
    {
      version: snapshot.current_version,
      versionCode: snapshot.current_version_code,
      sequence: Math.max(0, snapshot.sequence - 1),
    },
  ) > 0;
}

export default function UpdateCenterPage({ onClose }: UpdateCenterPageProps) {
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>(() => getUpdateSnapshot());
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [checkStatus, setCheckStatus] = useState('');
  const [manifestVersion, setManifestVersion] = useState('');
  const [manifestVersionCode, setManifestVersionCode] = useState('');
  const [manifestSequence, setManifestSequence] = useState('');
  const [manifestArtifactUri, setManifestArtifactUri] = useState('');
  const [manifestArtifactSha256, setManifestArtifactSha256] = useState('');
  const [manifestSummary, setManifestSummary] = useState('');
  const [manifestDetails, setManifestDetails] = useState('');
  const [manifestShellRequired, setManifestShellRequired] = useState(true);
  const [manifestEmergency, setManifestEmergency] = useState(false);
  const [publisherPublicKey, setPublisherPublicKey] = useState('');
  const [showAdvancedPublishForm, setShowAdvancedPublishForm] = useState(false);
  const autoFillKeyRef = useRef('');
  const [revokeDraft, setRevokeDraft] = useState('{\n  "kind": "update_revoke_v2",\n  "reason": "manual revoke"\n}');
  const [killDraft, setKillDraft] = useState('{\n  "kind": "update_killswitch_v2",\n  "enabled": true,\n  "reason": "manual kill"\n}');

  useEffect(() => {
    return subscribeUpdateSnapshot((next) => {
      setSnapshot(next);
    });
  }, []);

  useEffect(() => {
    void syncInstalledVersionNow().catch(() => {
      // Keep UI functional even if native bridge is temporarily unavailable.
    });
  }, []);

  useEffect(() => {
    if (!canShowPublisherZone(snapshot.channel, snapshot.platform)) {
      setPublisherPublicKey('');
      return;
    }
    void loadOrCreateVrfPublisherKeypair()
      .then((keypair) => {
        setPublisherPublicKey(keypair.publicKeyHex);
      })
      .catch(() => {
        setPublisherPublicKey('');
      });
  }, [snapshot.channel, snapshot.platform, snapshot.latest_manifest_verified, snapshot.latest_version, snapshot.current_version]);

  const publishSequenceHead = useMemo(() => {
    const snapshotSequence = Number.isFinite(Number(snapshot.sequence))
      ? Math.max(0, Math.trunc(Number(snapshot.sequence)))
      : 0;
    const vrfState = getVrfChainState(snapshot.channel, snapshot.platform);
    const vrfSequence = Number.isFinite(Number(vrfState.last_sequence))
      ? Math.max(0, Math.trunc(Number(vrfState.last_sequence)))
      : 0;
    return Math.max(snapshotSequence, vrfSequence);
  }, [snapshot.channel, snapshot.platform, snapshot.sequence]);

  useEffect(() => {
    const preferredVersion = (snapshot.current_version ?? snapshot.latest_version ?? '').trim();
    const preferredVersionCodeRaw = Number(snapshot.current_version_code ?? snapshot.latest_version_code ?? 0);
    const preferredVersionCode = Number.isFinite(preferredVersionCodeRaw)
      ? Math.max(0, Math.trunc(preferredVersionCodeRaw))
      : 0;
    if (!manifestVersion && preferredVersion) {
      setManifestVersion(preferredVersion);
    }
    if (!manifestVersionCode && preferredVersionCode > 0) {
      setManifestVersionCode(String(preferredVersionCode));
    }
    if (!manifestSequence) {
      setManifestSequence(String(Math.max(1, publishSequenceHead + 1)));
    }
    if (!manifestArtifactUri || manifestArtifactUri.includes('example.com')) {
      setManifestArtifactUri(defaultArtifactUri(snapshot.channel, snapshot.platform, preferredVersion, preferredVersionCode));
    }
    if (!manifestSummary && snapshot.update_summary) {
      setManifestSummary(snapshot.update_summary);
    }
    if (!manifestDetails && snapshot.update_details) {
      setManifestDetails(snapshot.update_details);
    }
    if (!manifestSummary && !snapshot.update_summary && preferredVersion) {
      setManifestSummary(`发布 v${preferredVersion} 全网自动更新`);
    }
    if (!manifestDetails && !snapshot.update_details && preferredVersion) {
      setManifestDetails([
        `版本号: v${preferredVersion}`,
        `版本码: ${preferredVersionCode > 0 ? preferredVersionCode : '-'}`,
        `渠道: ${snapshot.channel}`,
        `平台: ${snapshot.platform}`,
        '更新内容: 请补充本次真实变更。',
      ].join('\n'));
    }
  }, [
    manifestArtifactUri,
    manifestDetails,
    manifestSequence,
    manifestSummary,
    manifestVersion,
    manifestVersionCode,
    snapshot.latest_version,
    snapshot.latest_version_code,
    publishSequenceHead,
    snapshot.update_details,
    snapshot.update_summary,
  ]);

  const statusColor = useMemo(() => {
    if (snapshot.state === 'APPLIED') {
      return 'text-green-600';
    }
    if (snapshot.state === 'FAILED' || snapshot.state === 'REVOKED') {
      return 'text-red-600';
    }
    return 'text-blue-600';
  }, [snapshot.state]);

  const canOpenStore = snapshot.shell_required;
  const showPublisherTools = canShowPublisherZone(snapshot.channel, snapshot.platform);
  const hasNewerVerifiedVersion = hasVerifiedVersionUpdate(snapshot);
  const hasVerifiedLatest = snapshot.latest_manifest_verified && Boolean((snapshot.latest_version ?? '').trim());
  const latestVersionLabel = hasVerifiedLatest
    ? `v${snapshot.latest_version}`
    : (snapshot.current_version ? `v${snapshot.current_version}` : '-');
  const publishDefaults = useMemo(() => buildPublishDefaults(snapshot, publishSequenceHead), [publishSequenceHead, snapshot]);
  const oneClickPublishVersion = publishDefaults.version;
  const oneClickPublishVersionCode = publishDefaults.versionCode;
  const oneClickPublishSequence = publishDefaults.sequence;
  const oneClickPublishArtifactUri = (manifestArtifactUri ?? '').trim()
    || defaultArtifactUri(snapshot.channel, snapshot.platform, oneClickPublishVersion, oneClickPublishVersionCode);

  useEffect(() => {
    if (!showPublisherTools) {
      return;
    }
    const autoFillKey = `${snapshot.channel}|${snapshot.platform}|${publishDefaults.sequence}|${publishDefaults.version}|${publishDefaults.versionCode}`;
    if (autoFillKeyRef.current === autoFillKey) {
      return;
    }
    const formVersionCode = toPositiveInt(manifestVersionCode) ?? 0;
    const formSequenceRaw = Number(manifestSequence);
    const formSequence = Number.isFinite(formSequenceRaw) ? Math.max(0, Math.trunc(formSequenceRaw)) : 0;
    const formComparison = compareVersionVector(
      {
        version: manifestVersion,
        versionCode: formVersionCode,
        sequence: formSequence,
      },
      publishDefaults,
    );

    if (!manifestVersion || formComparison < 0) {
      setManifestVersion(publishDefaults.version);
    }
    if (!manifestVersionCode || formVersionCode < publishDefaults.versionCode || formComparison < 0) {
      setManifestVersionCode(String(publishDefaults.versionCode));
    }
    if (!manifestSequence || formSequence < publishDefaults.sequence || formComparison < 0) {
      setManifestSequence(String(publishDefaults.sequence));
    }
    if (
      !manifestArtifactUri
      || manifestArtifactUri.includes('example.com')
      || formComparison < 0
    ) {
      setManifestArtifactUri(publishDefaults.artifactUri);
    }
    if (!manifestSummary.trim()) {
      setManifestSummary(publishDefaults.summary);
    }
    if (!manifestDetails.trim()) {
      setManifestDetails(publishDefaults.details);
    }
    autoFillKeyRef.current = autoFillKey;
  }, [
    manifestArtifactUri,
    manifestDetails,
    manifestSequence,
    manifestSummary,
    manifestVersion,
    manifestVersionCode,
    publishDefaults,
    showPublisherTools,
    snapshot.channel,
    snapshot.platform,
  ]);

  const upgradeHint = useMemo(() => {
    if (
      snapshot.previous_version &&
      snapshot.current_version &&
      snapshot.previous_version.trim() &&
      snapshot.current_version.trim()
    ) {
      return `${t.update_center_upgraded_label || '已从'} v${snapshot.previous_version} ${
        t.update_center_upgraded_to || '升级到'
      } v${snapshot.current_version}`;
    }
    return '';
  }, [snapshot.current_version, snapshot.previous_version, t.update_center_upgraded_label, t.update_center_upgraded_to]);

  const publishManifestWithInput = async (input: PublishManifestInput): Promise<void> => {
    const version = input.version.trim();
    const summary = input.summary.trim();
    const details = input.details.trim();
    if (!version || !summary || !details) {
      setPublishStatus(t.update_center_release_notes_required || '版本号、更新摘要、更新详情必须填写');
      return;
    }
    const versionCode = Math.max(0, Math.trunc(Number(input.versionCode)));
    if (!versionCode) {
      setPublishStatus(t.update_center_version_code_invalid || '版本码必须是正整数');
      return;
    }
    const sequenceInput = Number(input.sequence);
    const fallbackSequence = Math.max(1, publishSequenceHead + 1);
    const sequence = Number.isFinite(sequenceInput) ? Math.max(fallbackSequence, Math.trunc(sequenceInput)) : fallbackSequence;
    const artifactUri = input.artifactUri.trim();
    if (!artifactUri) {
      setPublishStatus(t.update_center_artifact_uri_required || '安装包地址不能为空');
      return;
    }
    const publishBaseline = derivePublishBaseline(snapshot, publishSequenceHead);
    const publishVersionComparison = compareVersionVector(
      {
        version,
        versionCode,
      },
      {
        version: publishBaseline.version,
        versionCode: publishBaseline.versionCode,
      },
    );
    if (publishVersionComparison < 0) {
      setPublishStatus(`发布版本必须高于已知版本，建议使用默认值 v${publishDefaults.version} / code ${publishDefaults.versionCode}`);
      return;
    }
    if (publishVersionComparison === 0 && sequence <= publishSequenceHead) {
      setPublishStatus(`版本未变化时，发布序列必须大于当前序列（当前 ${publishSequenceHead}）`);
      return;
    }

    const manifest: UpdateManifestV2 = {
      kind: 'manifest_v2',
      schema_version: 2,
      manifest_id: `mf-${snapshot.channel}-${snapshot.platform}-${sequence}`,
      channel: snapshot.channel,
      platform: snapshot.platform,
      sequence,
      version,
      version_code: versionCode,
      artifacts: [
        {
          platform: snapshot.platform,
          kind: 'full',
          uri: artifactUri,
          sha256: input.artifactSha256?.trim() || undefined,
          size_bytes: 0,
          shell_required: input.shellRequired,
        },
      ],
      rollout: {
        percent: 100,
        emergency: input.emergency,
        stages: [1, 10, 50, 100],
      },
      policy: {
        mandatory: false,
      },
      security: {
        mode: 'vrf_chain_v1',
        threshold: 0,
        committee_keys: [],
        signatures: [],
        attestation_threshold: 0,
      },
      metadata: {
        release_notes: {
          summary,
          details,
          published_at_ms: Date.now(),
        },
      },
    };

    setPublishing(true);
    try {
      const result = await publishManifest({
        manifest,
        channel: snapshot.channel,
        platform: snapshot.platform,
      });
      const transportStatus = `Gossip=${result.pubsub_ok ? 'OK' : 'FAIL'}, Feed=${result.feed_ok ? 'OK' : 'FAIL'}`;
      setPublishStatus(
        result.ok
          ? `${t.update_center_publish_manifest_success || 'Manifest 已发布'}: ${result.topic} (${transportStatus})`
          : `${t.update_center_publish_manifest_failed || 'Manifest 发布失败'}: ${result.error ?? 'unknown'} (${transportStatus})`,
      );
      if (result.ok) {
        setManifestSequence(String(sequence + 1));
        setShowAdvancedPublishForm(false);
      }
    } catch (error) {
      setPublishStatus(`${t.update_center_publish_failed || '发布失败'}: ${error}`);
    } finally {
      setPublishing(false);
    }
  };

  const publishManifestFromForm = async (): Promise<void> => {
    const version = manifestVersion.trim();
    const versionCode = toPositiveInt(manifestVersionCode);
    const sequenceInput = Number(manifestSequence);
    const fallbackSequence = Math.max(1, publishSequenceHead + 1);
    const sequence = Number.isFinite(sequenceInput) ? Math.max(fallbackSequence, Math.trunc(sequenceInput)) : fallbackSequence;
    await publishManifestWithInput({
      version,
      versionCode: versionCode ?? 0,
      sequence,
      artifactUri: manifestArtifactUri.trim(),
      artifactSha256: manifestArtifactSha256.trim() || undefined,
      summary: manifestSummary.trim(),
      details: manifestDetails.trim(),
      shellRequired: manifestShellRequired,
      emergency: manifestEmergency,
    });
  };

  const oneClickPublishManifest = async (): Promise<void> => {
    await publishManifestWithInput({
      version: oneClickPublishVersion,
      versionCode: oneClickPublishVersionCode,
      sequence: oneClickPublishSequence,
      artifactUri: oneClickPublishArtifactUri,
      artifactSha256: manifestArtifactSha256.trim() || undefined,
      summary: manifestSummary.trim() || `发布 v${oneClickPublishVersion} 全网自动更新`,
      details: buildReleaseDetails(
        snapshot.channel,
        snapshot.platform,
        oneClickPublishVersion,
        oneClickPublishVersionCode,
        manifestDetails,
      ),
      shellRequired: manifestShellRequired,
      emergency: manifestEmergency,
    });
  };

  const fillPublisherDefaults = (): void => {
    setManifestVersion(publishDefaults.version);
    setManifestVersionCode(String(publishDefaults.versionCode));
    setManifestSequence(String(publishDefaults.sequence));
    setManifestArtifactUri(publishDefaults.artifactUri);
    setManifestSummary(publishDefaults.summary);
    setManifestDetails(publishDefaults.details);
  };

  const handleManualCheck = async (): Promise<void> => {
    const before = getUpdateSnapshot();
    setCheckStatus('正在检查更新...');
    setBusy(true);
    try {
      await manualCheckForUpdates();
      const after = getUpdateSnapshot();
      if (after.last_manual_check_reason === 'no_remote_peers') {
        setCheckStatus(t.update_center_check_no_remote_peers || '网络可用，但暂无可连接节点');
        return;
      }
      if (after.last_error === 'network_unreachable' || after.last_manual_check_reason === 'network_unreachable') {
        setCheckStatus('检查失败: network_unreachable');
        return;
      }
      if (after.last_error === 'native_not_ready' || after.last_manual_check_reason === 'native_not_ready') {
        setCheckStatus('检查失败: native_not_ready');
        return;
      }
      if (after.vrf_candidate_status === 'waiting_history') {
        setCheckStatus('已收到候选，等待历史链补齐');
        return;
      }
      const afterHasVersionUpdate = hasVerifiedVersionUpdate(after);
      const hasFreshContent = afterHasVersionUpdate && Boolean(after.update_summary || after.update_details);
      const hasNewVersion = afterHasVersionUpdate && (
        !hasVerifiedVersionUpdate(before) ||
        (after.latest_version ?? '') !== (before.latest_version ?? '') ||
        (after.latest_version_code ?? 0) > (before.latest_version_code ?? 0) ||
        (after.latest_manifest_verified_sequence ?? 0) > (before.latest_manifest_verified_sequence ?? 0)
      );
      if (hasNewVersion || hasFreshContent) {
        setCheckStatus('已同步到最新更新信息');
      } else {
        setCheckStatus('已检查，暂未发现新更新');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setCheckStatus(`检查失败: ${reason}`);
    } finally {
      setBusy(false);
    }
  };

  const publishWithDraft = async (kind: 'revoke' | 'killswitch'): Promise<void> => {
    setPublishing(true);
    try {
      if (kind === 'revoke') {
        const payload = JSON.parse(revokeDraft) as Record<string, unknown>;
        const result = await publishRevoke({
          payload: payload as any,
          channel: snapshot.channel,
          platform: snapshot.platform,
        });
        setPublishStatus(result.ok ? `Revoke 已发布: ${result.topic}` : `Revoke 发布失败: ${result.error ?? 'unknown'}`);
      } else {
        const payload = JSON.parse(killDraft) as Record<string, unknown>;
        const result = await publishKillSwitch({
          payload: payload as any,
          channel: snapshot.channel,
          platform: snapshot.platform,
        });
        setPublishStatus(result.ok ? `KillSwitch 已发布: ${result.topic}` : `KillSwitch 发布失败: ${result.error ?? 'unknown'}`);
      }
    } catch (error) {
      setPublishStatus(`${t.update_center_publish_failed || '发布失败'}: ${error}`);
    } finally {
      setPublishing(false);
    }
  };

  const vrfCarrierLabel = snapshot.vrf_candidate_carriers.length > 0
    ? snapshot.vrf_candidate_carriers.join(' + ')
    : '-';
  const vrfCandidateStatusLabel = useMemo(() => {
    switch (snapshot.vrf_candidate_status) {
      case 'waiting_carrier':
        return t.update_center_vrf_status_waiting_carrier || '候选已收到，等待策略阈值';
      case 'waiting_history':
        return t.update_center_vrf_status_waiting_history || '已收到候选，等待历史链补齐';
      case 'confirmed':
        return t.update_center_vrf_status_confirmed || '候选已确认';
      case 'none':
      default:
        return t.update_center_vrf_status_none || '未收到更新候选';
    }
  }, [
    snapshot.vrf_candidate_status,
    t.update_center_vrf_status_waiting_carrier,
    t.update_center_vrf_status_waiting_history,
    t.update_center_vrf_status_confirmed,
    t.update_center_vrf_status_none,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <button
          onClick={onClose}
          className="rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100"
          aria-label="返回"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-base font-semibold text-gray-900">{t.update_center_title || '更新中心'}</h1>
          <p className="text-xs text-gray-500">{t.update_center_subtitle || 'V2 全网一致性更新'}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-24">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-gray-900">{t.update_center_version_compare || '版本对比'}</div>
          <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
            <div className="rounded-lg bg-gray-50 p-2">
              <div>{t.update_center_previous_version || '上一版本'}</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{snapshot.previous_version ? `v${snapshot.previous_version}` : '-'}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-2">
              <div>{t.update_center_current_version || '当前版本'}</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{snapshot.current_version ? `v${snapshot.current_version}` : '-'}</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-2">
              <div>{t.update_center_latest_version || '最新版本'}</div>
              <div className="mt-1 text-sm font-semibold text-blue-900">{latestVersionLabel}</div>
              {!hasNewerVerifiedVersion ? (
                <div className="mt-1 text-[11px] text-blue-700">{t.update_center_no_release_notes || '当前已是最新版本'}</div>
              ) : null}
            </div>
          </div>
          {upgradeHint ? (
            <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              {upgradeHint}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">{t.update_center_state || '状态'}</span>
            <span className={`text-sm font-semibold ${statusColor}`}>{snapshot.state}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-gray-700">
            <div>
              <div className="text-xs text-gray-500">{t.update_center_manifest_sequence || 'Manifest 序列'}</div>
              <div>{snapshot.sequence || 0}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">{t.update_center_manifest_id || 'Manifest ID'}</div>
              <div className="truncate">{snapshot.manifest_id || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">VRF 载体状态</div>
              <div>{vrfCandidateStatusLabel} ({vrfCarrierLabel})</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">{t.update_center_last_checked || '最近检查'}</div>
              <div>{formatTime(snapshot.last_checked_at_ms)}</div>
            </div>
          </div>
        </section>

        {hasNewerVerifiedVersion ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">{t.update_center_release_notes || '更新内容'}</div>
                <div className="text-xs text-gray-500">
                  {t.update_center_release_published_at || '发布时间'}: {formatTime(snapshot.update_published_at_ms ?? 0)}
                </div>
              </div>
              <button
                onClick={() => setShowDetails((prev) => !prev)}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700"
              >
                {showDetails
                  ? (t.update_center_hide_details || '收起详情')
                  : (t.update_center_show_details || '更新详情')}
                {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
              {snapshot.update_summary || (t.update_center_no_release_notes || '暂无更新摘要')}
            </div>
            {showDetails ? (
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
                {snapshot.update_details || (t.update_center_no_release_notes || '暂无更新详情')}
              </pre>
            ) : null}
          </section>
        ) : null}

        {snapshot.last_error ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="flex items-center gap-2 font-medium">
              <TriangleAlert size={16} />
              {t.update_center_last_error || '最近失败原因'}
            </div>
            <div className="mt-1 break-all">{snapshot.last_error}</div>
          </section>
        ) : null}

        {snapshot.state === 'REVOKED' ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="flex items-center gap-2 font-medium">
              <ShieldAlert size={16} />
              {t.update_center_revoked_title || '当前更新已被撤销/止血'}
            </div>
            <div className="mt-1">{t.update_center_revoked_desc || '已自动阻断安装并清理暂存。'}</div>
          </section>
        ) : null}

        {snapshot.state === 'STAGED' && snapshot.shell_required ? (
          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            <div className="font-medium">{t.update_center_staged_title || '壳包已下载并暂存'}</div>
            <div className="mt-1">
              {t.update_center_staged_desc
                || '应用前台使用时不会强制打断，切到后台后会继续安装流程。iOS 需通过 App Store/TestFlight 完成壳包升级。'}
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="space-y-2">
            <button
              disabled={busy}
              onClick={() => {
                void handleManualCheck();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw size={16} className={busy ? 'animate-spin' : ''} />
              {t.update_center_manual_check || '手动检查更新'}
            </button>
            {checkStatus ? (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {checkStatus}
              </div>
            ) : null}

            {canOpenStore ? (
              <button
                onClick={() => {
                  void triggerStoreUpgrade({
                    appStoreUrl: 'https://apps.apple.com',
                    testFlightUrl: 'https://testflight.apple.com',
                  });
                }}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {t.update_center_open_store_upgrade || '打开 App Store / TestFlight 升级壳包'}
              </button>
            ) : null}
          </div>
        </section>

        {showPublisherTools ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-sm font-semibold text-gray-900">{t.update_center_publisher_title || '发布节点操作'}</div>
            <p className="mt-1 text-xs text-gray-500">
              {t.update_center_publisher_hint || '发布 Manifest 必须填写版本号、版本码和更新内容（摘要/详情）。'}
            </p>
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              系统自动托管 VRF 密钥，无需手工私钥。当前发布者公钥: {publisherPublicKey ? `${publisherPublicKey.slice(0, 20)}...` : '初始化中'}
            </div>
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-800">准发布节点一键发布</div>
              <div className="mt-1 text-xs text-emerald-700">
                当前将发布 v{oneClickPublishVersion} / code {oneClickPublishVersionCode} / sequence {oneClickPublishSequence}
              </div>
              <button
                disabled={publishing}
                onClick={() => {
                  void oneClickPublishManifest();
                }}
                className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {publishing ? '发布中...' : '一键发布当前版本'}
              </button>
            </div>

            <button
              onClick={() => setShowAdvancedPublishForm((prev) => !prev)}
              className="mt-3 flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <span>高级发布参数</span>
              {showAdvancedPublishForm ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showAdvancedPublishForm ? (
              <div className="mt-3 space-y-2">
                <button
                  onClick={fillPublisherDefaults}
                  className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
                >
                  一键填充发布必填项
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    <span>{t.update_center_publish_version || '版本号'}</span>
                    <input
                      value={manifestVersion}
                      onChange={(event) => setManifestVersion(event.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                      placeholder="0.0.5"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    <span>{t.update_center_publish_version_code || '版本码'}</span>
                    <input
                      value={manifestVersionCode}
                      onChange={(event) => setManifestVersionCode(event.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                      placeholder="5"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  <span>{t.update_center_publish_sequence || '序列号'}</span>
                  <input
                    value={manifestSequence}
                    onChange={(event) => setManifestSequence(event.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                    placeholder={String(Math.max(1, publishSequenceHead + 1))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  <span>{t.update_center_publish_artifact_uri || '安装包地址'}</span>
                  <input
                    value={manifestArtifactUri}
                    onChange={(event) => setManifestArtifactUri(event.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                    placeholder="p2p://unimaker/updates/stable/android/..."
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  <span>{t.update_center_publish_artifact_sha256 || '安装包 SHA256（可选）'}</span>
                  <input
                    value={manifestArtifactSha256}
                    onChange={(event) => setManifestArtifactSha256(event.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1.5 font-mono text-xs text-gray-900"
                    placeholder="e3b0c44298fc1c149afbf4c8996fb924..."
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  <span>{t.update_center_publish_summary || '更新摘要'}</span>
                  <input
                    value={manifestSummary}
                    onChange={(event) => setManifestSummary(event.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                    placeholder={t.update_center_summary_placeholder || '例如：修复卡顿并优化节点同步'}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-600">
                  <span>{t.update_center_publish_details || '更新详情'}</span>
                  <textarea
                    className="h-24 w-full rounded-lg border border-gray-300 p-2 text-xs text-gray-900"
                    value={manifestDetails}
                    onChange={(event) => setManifestDetails(event.target.value)}
                    placeholder={t.update_center_details_placeholder || '例如：1) 修复... 2) 优化... 3) 安全加固...'}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={manifestShellRequired}
                      onChange={(event) => setManifestShellRequired(event.target.checked)}
                    />
                    {t.update_center_publish_shell_required || '需要壳包升级'}
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={manifestEmergency}
                      onChange={(event) => setManifestEmergency(event.target.checked)}
                    />
                    {t.update_center_publish_emergency || '紧急模式'}
                  </label>
                </div>
                <button
                  disabled={publishing}
                  onClick={() => {
                    void publishManifestFromForm();
                  }}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {t.update_center_publish_manifest || '发布 Manifest'}
                </button>
                <textarea
                  className="h-20 w-full rounded-lg border border-gray-300 p-2 font-mono text-xs"
                  value={revokeDraft}
                  onChange={(event) => setRevokeDraft(event.target.value)}
                />
                <button
                  disabled={publishing}
                  onClick={() => {
                    void publishWithDraft('revoke');
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {t.update_center_publish_revoke || '发布 Revoke'}
                </button>
                <textarea
                  className="h-20 w-full rounded-lg border border-gray-300 p-2 font-mono text-xs"
                  value={killDraft}
                  onChange={(event) => setKillDraft(event.target.value)}
                />
                <button
                  disabled={publishing}
                  onClick={() => {
                    void publishWithDraft('killswitch');
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {t.update_center_publish_killswitch || '发布 KillSwitch'}
                </button>
              </div>
            ) : null}
            {publishStatus ? <div className="mt-2 text-xs text-gray-600">{publishStatus}</div> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
