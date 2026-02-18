import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Activity,
  ArrowLeft,
  MessageCircle,
  Users,
  ChevronRight,
  ChevronDown,
  X,
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import ChatPage from './ChatPage';
import ContentDetailPage from './ContentDetailPage';
import {
  ensureConversation,
} from '../data/socialData';
import {
  getDistributedContentsByPeer,
  resolveDistributedContentDetail,
  subscribeDistributedContents,
  syncDistributedContentFromNetwork,
  type DistributedContent,
} from '../data/distributedContent';
import { libp2pService } from '../libp2p/service';
import { libp2pEventPump } from '../libp2p/eventPump';
import { useLocale } from '../i18n/LocaleContext';
import type { Translations } from '../i18n/translations';

interface Node {
  peerId: string;
  nickname: string;
  avatar: string;
  domain?: string;
  status: 'online' | 'offline';
  latency: number;
  connections: number;
  bandwidth: string;
  systemProfile: NodeSystemProfile;
  multiaddrs: string[];
  sources: NodeSourceTag[];
  joinedAt: number;
  location: string;
  region: string;
  uptime: string;
  services: string[];
  bio: string;
  lastSeenAt: number;
}

type NodeSourceTag = 'mDNS' | 'DHT' | 'Connected' | 'LAN' | 'WAN' | 'Rendezvous';

interface NodeSystemProfile {
  osName: string;
  osVersion: string;
  cpuModel: string;
  cpuFrequencyMHz: number;
  cpuCores: number;
  memoryFrequencyMHz: number;
  memoryTotalBytes: number;
  diskType: string;
  diskTotalBytes: number;
  diskAvailableBytes: number;
  gpuModel: string;
  gpuMemoryBytes: number;
  uplinkBps: number;
  downlinkBps: number;
  uplinkTotalBytes: number;
  downlinkTotalBytes: number;
  totalTransferBytes: number;
  relayBottleneckBps: number;
  isRelayed: boolean;
}

interface GlobalResourceSummary {
  nodeCount: number;
  onlineCount: number;
  connectedPeers: number;
  cpuCoresTotal: number;
  memoryTotalBytes: number;
  diskTotalBytes: number;
  diskAvailableBytes: number;
  gpuVramTotalBytes: number;
  uplinkBps: number;
  downlinkBps: number;
  uplinkTotalBytes: number;
  downlinkTotalBytes: number;
  totalTransferBytes: number;
}

interface NodeDetailProps {
  node: Node;
  onBack: () => void;
  onAction: (action: NodeActionType) => void;
  onViewContent?: () => void;
  isBandwidthProbeRunning?: boolean;
}

interface NodePublishedContentPageProps {
  node: Node;
  items: DistributedContent[];
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSelectContent: (content: DistributedContent) => void;
}

interface NodeDraft {
  peerId: string;
  nickname: string;
  domain: string;
  location: string;
  region: string;
  bio: string;
}

interface BootstrapPeer {
  peerId: string;
  multiaddrs: string[];
  lastSeenAt: number;
}

interface DiscoveredPeerRow {
  peerId: string;
  multiaddrs: string[];
  sources: NodeSourceTag[];
}

interface MeasuredBandwidthSnapshot {
  uplinkBps: number;
  downlinkBps: number;
  isRelayed: boolean;
  relayBottleneckBps: number;
}

type NodeActionType = 'chat' | 'redPacket' | 'location' | 'voice' | 'video' | 'group';

const emptyNodeDraft: NodeDraft = {
  peerId: '',
  nickname: '',
  domain: '',
  location: '',
  region: '',
  bio: '',
};

function nodeAvatar(seed: string): string {
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

function normalizePeerId(value: string): string {
  return value.trim();
}

function isLikelyPeerId(peerId: string): boolean {
  const value = peerId.trim();
  if (!value) return false;
  if (value.startsWith('did:')) {
    if (value.length < 8 || value.length > 192) return false;
    return /^[A-Za-z0-9:._%-]+$/.test(value);
  }
  if (value.length < 8 || value.length >= 63) return false;
  if ((value.startsWith('12D3Koo') || value.startsWith('16Uiu2')) && value.length >= 24) {
    return true;
  }
  if (value.startsWith('Qm') && value.length >= 30) {
    return true;
  }
  return false;
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return fallback;
}

function parseText(value: unknown, fallback = '--'): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseArrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parseStringArray(parsed);
      } catch {
        return [];
      }
    }
    return trimmed
      .split(/[,;\n|]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      output.push(entry.trim());
    }
  }
  return output;
}

function normalizeMultiaddrForPeer(addr: string, peerId: string): string {
  const trimmed = addr.trim();
  if (!trimmed) return '';
  if (trimmed.includes('/p2p/')) return trimmed;
  if (!peerId) return trimmed;
  return `${trimmed.replace(/\/+$/, '')}/p2p/${peerId}`;
}

function isDialablePeerMultiaddr(addr: string): boolean {
  const normalized = addr.trim();
  if (!normalized) return false;
  if (!normalized.includes('/p2p/')) return false;
  if (normalized.includes('/ip4/0.0.0.0/')) return false;
  if (normalized.includes('/ip6/::/')) return false;
  return true;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function pickDialMultiaddr(peerId: string, addresses: string[]): string {
  const normalized = uniqueStrings(addresses.map((item) => normalizeMultiaddrForPeer(item, peerId)).filter(Boolean));
  const quic = normalized.find((item) => item.includes('/quic'));
  if (quic) return quic;
  const tcp = normalized.find((item) => item.includes('/tcp/'));
  if (tcp) return tcp;
  return normalized[0] ?? '';
}

function parseEventPayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (typeof payload === 'string' && payload.trim().length > 0) {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parseBootstrapPeers(raw: unknown): BootstrapPeer[] {
  const root = parseObject(raw);
  const peers = Array.isArray(raw)
    ? raw
    : Array.isArray(root.peers)
      ? root.peers
      : Array.isArray(root.bootstrapPeers)
        ? root.bootstrapPeers
        : [];
  const output: BootstrapPeer[] = [];
  const seen = new Set<string>();
  for (const item of peers) {
    const row = parseObject(item);
    const peerId = normalizePeerId(parseText(row.peerId, parseText(row.peer_id, '')));
    if (!peerId || !isLikelyPeerId(peerId) || seen.has(peerId)) continue;
    const multiaddrs = uniqueStrings(
      [...parseStringArray(row.multiaddrs), ...parseStringArray(row.addresses)]
        .map((entry) => normalizeMultiaddrForPeer(entry, peerId))
        .filter(Boolean)
    );
    if (multiaddrs.length === 0) continue;
    seen.add(peerId);
    output.push({
      peerId,
      multiaddrs,
      lastSeenAt: parseNumber(row.lastSeenAt, 0),
    });
  }
  return output.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function toSourceTag(value: string): NodeSourceTag | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('mdns') || normalized.includes('bonjour')) return 'mDNS';
  if (normalized.includes('dht')) return 'DHT';
  if (normalized.includes('connected') || normalized.includes('direct')) return 'Connected';
  if (normalized.includes('lan') || normalized.includes('local')) return 'LAN';
  if (normalized.includes('wan') || normalized.includes('internet') || normalized.includes('public')) return 'WAN';
  if (normalized.includes('rendezvous') || normalized === 'rdv' || normalized.includes('relay')) return 'Rendezvous';
  return null;
}

function splitSourceHints(value: string): string[] {
  return value
    .split(/[,\s|/;:+-]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDiscoveredPeers(raw: unknown): DiscoveredPeerRow[] {
  const root = parseObject(raw);
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(root.peers)
      ? root.peers
      : Array.isArray(root.discoveredPeers)
        ? root.discoveredPeers
        : [];
  const output: DiscoveredPeerRow[] = [];
  for (const rowRaw of rows) {
    const row = parseObject(rowRaw);
    const peerId = normalizePeerId(parseText(row.peerId, parseText(row.peer_id, '')));
    if (!peerId || !isLikelyPeerId(peerId)) continue;
    const multiaddrs = uniqueStrings(
      [...parseStringArray(row.multiaddrs), ...parseStringArray(row.addresses)]
        .map((item) => normalizeMultiaddrForPeer(item, peerId))
        .filter((item) => isDialablePeerMultiaddr(item))
    );
    const sourceCandidates = uniqueStrings([
      ...parseStringArray(row.sources),
      ...parseStringArray(row.sourceTags),
      parseText(row.source, ''),
      parseText(row.discoverySource, ''),
      parseText(row.discovery_source, ''),
      parseText(row.medium, ''),
      parseText(row.transport, ''),
    ].flatMap(splitSourceHints));
    const sources = sourceCandidates
      .map(toSourceTag)
      .filter((item): item is NodeSourceTag => Boolean(item));
    output.push({
      peerId,
      multiaddrs,
      sources,
    });
  }
  return output;
}

function parseRendezvousPeerMap(raw: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const root = parseObject(raw);
  const peers = Array.isArray(raw)
    ? raw
    : Array.isArray(root.peers)
      ? root.peers
      : [];
  for (const entry of peers) {
    const row = parseObject(entry);
    const peerId = normalizePeerId(parseText(row.peerId, parseText(row.peer_id, '')));
    if (!peerId || !isLikelyPeerId(peerId)) {
      continue;
    }
    const addresses = uniqueStrings(
      [...parseStringArray(row.addresses), ...parseStringArray(row.multiaddrs)]
        .map((item) => normalizeMultiaddrForPeer(item, peerId))
        .filter((item) => isDialablePeerMultiaddr(item))
    );
    if (addresses.length === 0) {
      continue;
    }
    result[peerId] = uniqueStrings([...(result[peerId] ?? []), ...addresses]);
  }
  return result;
}

function parseAndroidMdnsPeerMap(raw: unknown): Record<string, string[]> {
  const root = parseObject(raw);
  const androidBridge = parseObject(root.androidBridge);
  const peersRaw = Array.isArray(androidBridge.peers)
    ? androidBridge.peers
    : Array.isArray(root.peers)
      ? root.peers
      : Array.isArray(root.mdnsPeers)
        ? root.mdnsPeers
        : [];
  const out: Record<string, string[]> = {};
  for (const rowRaw of peersRaw) {
    const row = parseObject(rowRaw);
    const peerId = normalizePeerId(parseText(row.peerId, parseText(row.peer_id, '')));
    if (!peerId || !isLikelyPeerId(peerId)) {
      continue;
    }
    const addrs = uniqueStrings(
      [
        ...parseStringArray(row.addresses),
        ...parseStringArray(row.multiaddrs),
      ]
        .map((item) => normalizeMultiaddrForPeer(item, peerId))
        .filter((item) => isDialablePeerMultiaddr(item))
    );
    if (addrs.length === 0) {
      continue;
    }
    out[peerId] = uniqueStrings([...(out[peerId] ?? []), ...addrs]);
  }
  return out;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const fixed = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(fixed)} ${units[index]}`;
}

function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return `${formatBytes(value)}/s`;
}

function defaultSystemProfile(): NodeSystemProfile {
  return {
    osName: 'unknown',
    osVersion: '--',
    cpuModel: 'unknown',
    cpuFrequencyMHz: 0,
    cpuCores: 0,
    memoryFrequencyMHz: 0,
    memoryTotalBytes: 0,
    diskType: 'unknown',
    diskTotalBytes: 0,
    diskAvailableBytes: 0,
    gpuModel: 'unknown',
    gpuMemoryBytes: 0,
    uplinkBps: 0,
    downlinkBps: 0,
    uplinkTotalBytes: 0,
    downlinkTotalBytes: 0,
    totalTransferBytes: 0,
    relayBottleneckBps: 0,
    isRelayed: false,
  };
}

function defaultGlobalResourceSummary(): GlobalResourceSummary {
  return {
    nodeCount: 0,
    onlineCount: 0,
    connectedPeers: 0,
    cpuCoresTotal: 0,
    memoryTotalBytes: 0,
    diskTotalBytes: 0,
    diskAvailableBytes: 0,
    gpuVramTotalBytes: 0,
    uplinkBps: 0,
    downlinkBps: 0,
    uplinkTotalBytes: 0,
    downlinkTotalBytes: 0,
    totalTransferBytes: 0,
  };
}

function buildGlobalResourceSummary(
  nodes: Node[],
  diagnostics: Record<string, unknown>,
  localProfile: NodeSystemProfile,
  localPeerId: string,
): GlobalResourceSummary {
  const summary = defaultGlobalResourceSummary();
  const networkResources = parseObject(diagnostics.networkResources);
  const includeLocal = localPeerId.trim().length > 0;
  const onlinePeers = nodes.filter((node) => isRecentlyOnline(node));

  summary.connectedPeers = parseNumber(diagnostics.connectedCount, nodes.filter((item) => item.status === 'online').length);
  summary.nodeCount = parseNumber(networkResources.nodeCount, nodes.length + (includeLocal ? 1 : 0));
  summary.onlineCount = parseNumber(networkResources.onlineCount, onlinePeers.length + (includeLocal ? 1 : 0));
  summary.connectedPeers = parseNumber(networkResources.connectedPeers, summary.connectedPeers);

  let fallbackCpuCores = localProfile.cpuCores;
  let fallbackMemoryTotal = localProfile.memoryTotalBytes;
  let fallbackDiskTotal = localProfile.diskTotalBytes;
  let fallbackDiskAvailable = localProfile.diskAvailableBytes;
  let fallbackGpuVram = localProfile.gpuMemoryBytes;
  let fallbackUplinkBps = localProfile.uplinkBps;
  let fallbackDownlinkBps = localProfile.downlinkBps;
  let fallbackUplinkTotal = localProfile.uplinkTotalBytes;
  let fallbackDownlinkTotal = localProfile.downlinkTotalBytes;
  for (const node of nodes) {
    fallbackCpuCores += node.systemProfile.cpuCores;
    fallbackMemoryTotal += node.systemProfile.memoryTotalBytes;
    fallbackDiskTotal += node.systemProfile.diskTotalBytes;
    fallbackDiskAvailable += node.systemProfile.diskAvailableBytes;
    fallbackGpuVram += node.systemProfile.gpuMemoryBytes;
    fallbackUplinkBps += node.systemProfile.uplinkBps;
    fallbackDownlinkBps += node.systemProfile.downlinkBps;
    fallbackUplinkTotal += node.systemProfile.uplinkTotalBytes;
    fallbackDownlinkTotal += node.systemProfile.downlinkTotalBytes;
  }

  summary.cpuCoresTotal = parseNumber(networkResources.cpuCoresTotal, fallbackCpuCores);
  summary.memoryTotalBytes = parseNumber(networkResources.memoryTotalBytes, fallbackMemoryTotal);
  summary.diskTotalBytes = parseNumber(networkResources.diskTotalBytes, fallbackDiskTotal);
  summary.diskAvailableBytes = parseNumber(networkResources.diskAvailableBytes, fallbackDiskAvailable);
  summary.gpuVramTotalBytes = parseNumber(networkResources.gpuVramTotalBytes, fallbackGpuVram);
  summary.uplinkBps = parseNumber(networkResources.uplinkBps, fallbackUplinkBps);
  summary.downlinkBps = parseNumber(networkResources.downlinkBps, fallbackDownlinkBps);
  summary.uplinkTotalBytes = parseNumber(networkResources.uplinkTotalBytes, fallbackUplinkTotal);
  summary.downlinkTotalBytes = parseNumber(networkResources.downlinkTotalBytes, fallbackDownlinkTotal);
  summary.totalTransferBytes = parseNumber(
    networkResources.totalTransferBytes,
    summary.uplinkTotalBytes + summary.downlinkTotalBytes,
  );
  if (summary.totalTransferBytes <= 0) summary.totalTransferBytes = summary.uplinkTotalBytes + summary.downlinkTotalBytes;
  return summary;
}

function readSystemProfile(raw: unknown): NodeSystemProfile {
  const profile = defaultSystemProfile();
  const root = parseObject(raw);
  const os = parseObject(root.os);
  const cpu = parseObject(root.cpu);
  const memory = parseObject(root.memory);
  const disk = parseObject(root.disk);
  const gpu = parseObject(root.gpu);
  const bandwidth = parseObject(root.bandwidth);

  profile.osName = parseText(os.name, profile.osName);
  profile.osVersion = parseText(os.version, profile.osVersion);
  profile.cpuModel = parseText(cpu.model, profile.cpuModel);
  profile.cpuFrequencyMHz = parseNumber(cpu.frequencyMHz, profile.cpuFrequencyMHz);
  profile.cpuCores = parseNumber(cpu.cores, profile.cpuCores);
  profile.memoryFrequencyMHz = parseNumber(memory.frequencyMHz, profile.memoryFrequencyMHz);
  profile.memoryTotalBytes = parseNumber(memory.totalBytes, profile.memoryTotalBytes);
  profile.diskType = parseText(disk.type, profile.diskType);
  profile.diskTotalBytes = parseNumber(disk.totalBytes, profile.diskTotalBytes);
  profile.diskAvailableBytes = parseNumber(disk.availableBytes, profile.diskAvailableBytes);
  profile.gpuModel = parseText(gpu.model, profile.gpuModel);
  profile.gpuMemoryBytes = parseNumber(gpu.vramBytes, profile.gpuMemoryBytes);
  profile.uplinkBps = parseNumber(bandwidth.uplinkBps, profile.uplinkBps);
  profile.downlinkBps = parseNumber(bandwidth.downlinkBps, profile.downlinkBps);
  profile.uplinkTotalBytes = parseNumber(bandwidth.uplinkTotalBytes, profile.uplinkTotalBytes);
  profile.downlinkTotalBytes = parseNumber(bandwidth.downlinkTotalBytes, profile.downlinkTotalBytes);
  profile.uplinkBps = parseNumber(bandwidth.measuredUplinkBps, profile.uplinkBps);
  profile.downlinkBps = parseNumber(bandwidth.measuredDownlinkBps, profile.downlinkBps);
  profile.totalTransferBytes = parseNumber(
    bandwidth.totalTransferBytes,
    profile.uplinkTotalBytes + profile.downlinkTotalBytes
  );
  if (profile.totalTransferBytes <= 0) {
    profile.totalTransferBytes = profile.uplinkTotalBytes + profile.downlinkTotalBytes;
  }
  profile.relayBottleneckBps = parseNumber(bandwidth.relayBottleneckBps, profile.relayBottleneckBps);
  profile.isRelayed =
    bandwidth.isRelayed === true ||
    root.isRelayed === true ||
    (profile.relayBottleneckBps > 0 && (profile.uplinkBps > 0 || profile.downlinkBps > 0));
  return profile;
}

function buildBaseNode(peerId: string, nickname: string, t: Translations): Node {
  const profile = defaultSystemProfile();
  return {
    peerId,
    nickname,
    avatar: nodeAvatar(peerId),
    status: 'offline',
    latency: 0,
    connections: 0,
    bandwidth: `${formatRate(profile.downlinkBps)} ↓ / ${formatRate(profile.uplinkBps)} ↑`,
    systemProfile: profile,
    multiaddrs: [],
    sources: [],
    joinedAt: 0,
    location: '--',
    region: '--',
    uptime: '--',
    services: [t.nodes_instantMsg, t.nodes_nodeDiscovery],
    bio: t.nodes_noBio,
    lastSeenAt: 0,
  };
}

function toBandwidthLabel(profile: NodeSystemProfile): string {
  return `${formatRate(profile.downlinkBps)} ↓ / ${formatRate(profile.uplinkBps)} ↑`;
}

function buildNativeNodes(
  localPeerId: string,
  peersInfo: Record<string, unknown>[],
  connectedPeers: string[],
  mdnsHints: Record<string, string[]>,
  rendezvousHints: Record<string, string[]>,
  t: Translations
): Node[] {
  const now = Date.now();
  const connectedSet = new Set(connectedPeers.map((item) => normalizePeerId(item)).filter(Boolean));
  const result = new Map<string, Node>();

  for (const row of peersInfo) {
    const source = parseObject(row);
    const peerId = normalizePeerId(parseText(source.peerId, ''));
    if (!peerId || !isLikelyPeerId(peerId) || peerId === localPeerId) {
      continue;
    }
    const isConnected = connectedSet.has(peerId);
    const profile = readSystemProfile(source.systemProfile);
    const connectionCount = parseNumber(source.connectionCount, 0);
    const latencyMs = parseNumber(source.latencyMs, -1);
    const directMultiaddrs = uniqueStrings(
      [
        ...parseStringArray(source.multiaddrs),
        ...parseStringArray(source.addresses),
      ]
        .map((item) => normalizeMultiaddrForPeer(item, peerId))
        .filter((item) => isDialablePeerMultiaddr(item))
    );
    const multiaddrs = uniqueStrings([
      ...directMultiaddrs,
      ...(mdnsHints[peerId] ?? []),
      ...(rendezvousHints[peerId] ?? []),
    ]);
    const sources: NodeSourceTag[] = [];
    if (mdnsHints[peerId]?.length) sources.push('mDNS', 'LAN');
    if (rendezvousHints[peerId]?.length) sources.push('Rendezvous', 'WAN');
    if (isConnected) sources.push('Connected');
    const nickname = `${t.nodes_defaultNickname} ${peerId.slice(0, 6)}`;
    const node: Node = {
      ...buildBaseNode(peerId, nickname, t),
      peerId,
      nickname,
      status: isConnected ? 'online' : 'offline',
      latency: latencyMs,
      connections: connectionCount,
      bandwidth: toBandwidthLabel(profile),
      systemProfile: profile,
      multiaddrs,
      sources,
      joinedAt: now,
      location: `${profile.osName} ${profile.osVersion}`.trim() || 'Connected peer',
      region: profile.diskType,
      services: [t.nodes_instantMsg, t.nodes_nodeDiscovery, 'LAN', 'WAN'],
      bio: `${t.nodes_sourceLabel}: ${sources.length > 0 ? sources.join(' / ') : t.nodes_sourceUnknown}`,
      lastSeenAt: now,
    };
    result.set(peerId, node);
  }

  for (const [peerIdRaw, addresses] of Object.entries(mdnsHints)) {
    const peerId = normalizePeerId(peerIdRaw);
    if (!peerId || !isLikelyPeerId(peerId) || peerId === localPeerId || result.has(peerId)) {
      continue;
    }
    const isConnected = connectedSet.has(peerId);
    const node: Node = {
      ...buildBaseNode(peerId, `${t.nodes_defaultNickname} ${peerId.slice(0, 6)}`, t),
      peerId,
      status: isConnected ? 'online' : 'offline',
      bandwidth: toBandwidthLabel(defaultSystemProfile()),
      multiaddrs: uniqueStrings(addresses ?? []),
      sources: isConnected ? ['mDNS', 'LAN', 'Connected'] : ['mDNS', 'LAN'],
      joinedAt: now,
      location: 'mDNS LAN',
      region: '--',
      services: [t.nodes_nodeDiscovery, 'LAN'],
      bio: t.nodes_sourceMdns,
      lastSeenAt: now,
    };
    result.set(peerId, node);
  }

  for (const [peerIdRaw, addresses] of Object.entries(rendezvousHints)) {
    const peerId = normalizePeerId(peerIdRaw);
    if (!peerId || !isLikelyPeerId(peerId) || peerId === localPeerId || result.has(peerId)) {
      continue;
    }
    const isConnected = connectedSet.has(peerId);
    const node: Node = {
      ...buildBaseNode(peerId, `${t.nodes_defaultNickname} ${peerId.slice(0, 6)}`, t),
      peerId,
      status: isConnected ? 'online' : 'offline',
      bandwidth: toBandwidthLabel(defaultSystemProfile()),
      multiaddrs: uniqueStrings(addresses ?? []),
      sources: isConnected ? ['Rendezvous', 'WAN', 'Connected'] : ['Rendezvous', 'WAN'],
      joinedAt: now,
      location: 'Rendezvous WAN',
      region: '--',
      services: [t.nodes_nodeDiscovery, 'WAN'],
      bio: t.nodes_sourceRendezvous,
      lastSeenAt: now,
    };
    result.set(peerId, node);
  }

  // Keep node list truthful to runtime connections: if peer detail payload is delayed,
  // still surface a minimal online card for connected peers.
  for (const peerIdRaw of connectedPeers) {
    const peerId = normalizePeerId(peerIdRaw);
    if (!peerId || !isLikelyPeerId(peerId) || peerId === localPeerId || result.has(peerId)) {
      continue;
    }
    const fallbackMultiaddrs = uniqueStrings([
      ...(mdnsHints[peerId] ?? []),
      ...(rendezvousHints[peerId] ?? []),
    ]).filter((addr) => isDialablePeerMultiaddr(addr));
    if (fallbackMultiaddrs.length === 0) {
      continue;
    }
    const fallbackSources: NodeSourceTag[] = ['Connected'];
    if (mdnsHints[peerId]?.length) {
      fallbackSources.push('mDNS', 'LAN');
    }
    if (rendezvousHints[peerId]?.length) {
      fallbackSources.push('Rendezvous', 'WAN');
    }
    result.set(peerId, {
      ...buildBaseNode(peerId, `${t.nodes_defaultNickname} ${peerId.slice(0, 6)}`, t),
      peerId,
      status: 'online',
      connections: 1,
      multiaddrs: fallbackMultiaddrs,
      sources: fallbackSources,
      joinedAt: now,
      location: 'Connected peer',
      region: '--',
      services: [t.nodes_nodeDiscovery],
      bio: `${t.nodes_sourceLabel}: ${fallbackSources.join(' / ')}`,
      lastSeenAt: now,
    });
  }

  return [...result.values()].sort((a, b) => {
    const statusDiff = Number(b.status === 'online') - Number(a.status === 'online');
    if (statusDiff !== 0) return statusDiff;
    return b.joinedAt - a.joinedAt;
  });
}

function applyMeasuredBandwidthOverlay(
  nodes: Node[],
  measured: Record<string, MeasuredBandwidthSnapshot>
): Node[] {
  return nodes.map((node) => {
    const snapshot = measured[node.peerId];
    if (!snapshot) {
      return node;
    }
    const systemProfile: NodeSystemProfile = {
      ...node.systemProfile,
      uplinkBps: snapshot.uplinkBps,
      downlinkBps: snapshot.downlinkBps,
      isRelayed: snapshot.isRelayed,
      relayBottleneckBps: snapshot.relayBottleneckBps,
    };
    return {
      ...node,
      systemProfile,
      bandwidth: `${formatRate(systemProfile.downlinkBps)} ↓ / ${formatRate(systemProfile.uplinkBps)} ↑`,
    };
  });
}

function formatContentTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / (1000 * 60));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

function NodePublishedContentPage({
  node,
  items,
  loading,
  onBack,
  onRefresh,
  onSelectContent,
}: NodePublishedContentPageProps) {
  return (
    <div className="h-full flex flex-col bg-white">
      <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          aria-label="返回节点详情"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="font-semibold text-gray-900 truncate max-w-[60%]">{node.nickname || node.peerId.slice(0, 12)}</h2>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 text-xs rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          刷新
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && items.length === 0 && (
          <div className="text-center text-sm text-gray-500 py-8">正在同步该节点已发布内容...</div>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-10">
            暂无可展示内容
          </div>
        )}

        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectContent(item)}
              className="w-full text-left border border-gray-200 rounded-xl bg-white overflow-hidden hover:shadow-md transition-all"
            >
              {(item.type === 'image' || item.type === 'video') && item.media && (
                <div className="w-full h-40 bg-gray-100">
                  <ImageWithFallback src={item.media} alt={item.content} className="w-full h-full object-cover" />
                </div>
              )}
              {item.type === 'audio' && (
                <div className="w-full h-28 bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center text-sm">
                  音频内容
                </div>
              )}
              <div className="p-3">
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">{item.publishCategory}</div>
                <div className="text-sm text-gray-900 line-clamp-3">{item.content}</div>
                <div className="mt-2 text-xs text-gray-400">{formatContentTime(item.timestamp)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function isRecentlyOnline(node: Node): boolean {
  if (node.status === 'online') return true;
  if (!node.lastSeenAt) return false;
  return Date.now() - node.lastSeenAt < 5 * 60 * 1000;
}

function NodeDetail({ node, onBack, onAction, onViewContent, isBandwidthProbeRunning = false }: NodeDetailProps) {
  const { t } = useLocale();
  const online = isRecentlyOnline(node);

  return (
    <div className="h-full flex flex-col bg-white">
      <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 z-10">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          aria-label={t.nodes_backToList}
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="font-semibold text-gray-900">{t.nodes_detail}</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="p-4 border border-gray-200 rounded-2xl bg-gradient-to-r from-blue-50 to-purple-50">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 truncate">{node.domain || node.peerId}</h3>
            <span
              className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${online ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}
            >
              {online ? t.nodes_online : t.nodes_offline}
            </span>
          </div>
          {node.domain && <p className="text-xs text-gray-600 break-all font-mono">{node.peerId}</p>}
          {node.bio && <p className="text-sm text-gray-700 mt-2">{node.bio}</p>}
        </div>

        <div className="p-4 border border-gray-200 rounded-xl bg-white">
          <h4 className="font-medium text-gray-900 mb-3">{t.nodes_hardwareTitle}</h4>
          <div className="space-y-2 text-sm text-gray-700">
            <div>{t.nodes_os}：{node.systemProfile.osName} {node.systemProfile.osVersion}</div>
            <div>{t.nodes_cpu}：{node.systemProfile.cpuModel} / {node.systemProfile.cpuFrequencyMHz || '--'} MHz / {node.systemProfile.cpuCores || '--'} cores</div>
            <div>{t.nodes_memory}：{formatBytes(node.systemProfile.memoryTotalBytes)} / {node.systemProfile.memoryFrequencyMHz || '--'} MHz</div>
            <div>{t.nodes_disk}：{node.systemProfile.diskType} / {formatBytes(node.systemProfile.diskTotalBytes)} / {formatBytes(node.systemProfile.diskAvailableBytes)}</div>
            <div>{t.nodes_gpu}：{node.systemProfile.gpuModel} / {formatBytes(node.systemProfile.gpuMemoryBytes)}</div>
            <div>{t.nodes_connections}：{node.connections}</div>
            <div>{t.nodes_downlink}：{formatRate(node.systemProfile.downlinkBps)}</div>
            <div>{t.nodes_uplink}：{formatRate(node.systemProfile.uplinkBps)}</div>
            <div>{t.nodes_relayPath}：{node.systemProfile.isRelayed ? t.nodes_yes : t.nodes_no}</div>
            <div>{t.nodes_bottleneck}：{node.systemProfile.isRelayed ? formatRate(node.systemProfile.relayBottleneckBps) : '--'}</div>

            {isBandwidthProbeRunning && (
              <div className="text-purple-600">{t.nodes_probeRunning}</div>
            )}
          </div>
        </div>

        {/* 该节点发布内容入口 */}
        <button
          onClick={() => onViewContent?.()}
          className="w-full p-4 border border-gray-200 rounded-xl bg-white hover:shadow-md transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <Activity size={18} className="text-blue-600" />
            </div>
            <div className="text-left">
              <div className="font-medium text-gray-900 text-sm">{t.nodes_publishedContent}</div>
              <div className="text-xs text-gray-500">{t.nodes_viewAllContent}</div>
            </div>
          </div>
          <ChevronRight size={18} className="text-gray-400" />
        </button>

        {/* 发消息 */}
        <button
          onClick={() => onAction('chat')}
          className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-medium"
        >
          <MessageCircle size={18} />
          {t.nodes_sendMessage}
        </button>
      </div>
    </div>
  );
}

type SourceFilter = 'all' | NodeSourceTag;

export default function NodesPage() {
  const { t } = useLocale();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedNodeContentOwner, setSelectedNodeContentOwner] = useState<Node | null>(null);
  const [selectedNodeContents, setSelectedNodeContents] = useState<DistributedContent[]>([]);
  const [selectedNodeContent, setSelectedNodeContent] = useState<DistributedContent | null>(null);
  const [selectedNodeContentLoading, setSelectedNodeContentLoading] = useState(false);
  const [chatSession, setChatSession] = useState<{
    id: string;
    name: string;
    avatar: string;
    isGroup: boolean;
    initialAction?: 'dm' | 'redPacket' | 'location' | 'voice' | 'videoCall';
  } | null>(null);
  const [socialHint, setSocialHint] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPeerIds, setSelectedPeerIds] = useState<Set<string>>(new Set());

  const [showAddNode, setShowAddNode] = useState(false);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft>(emptyNodeDraft);
  const [nodeDraftError, setNodeDraftError] = useState('');
  const [localPeerId, setLocalPeerId] = useState(() => normalizePeerId(localStorage.getItem('profile_local_peer_id_v1') ?? ''));
  const [bootstrapPeers, setBootstrapPeers] = useState<BootstrapPeer[]>([]);
  const [bootstrapJoining, setBootstrapJoining] = useState(false);
  const [nativeConnectedPeers, setNativeConnectedPeers] = useState<string[]>([]);
  const [nativeDiagnostics, setNativeDiagnostics] = useState<Record<string, unknown>>({});
  const [mdnsDebugState, setMdnsDebugState] = useState<Record<string, unknown>>({});
  const [runtimeHealthState, setRuntimeHealthState] = useState<{
    nativeReady: boolean;
    started: boolean;
    peerId: string;
    lastError: string;
  }>({
    nativeReady: false,
    started: false,
    peerId: '',
    lastError: '',
  });
  const [nativeError, setNativeError] = useState('');
  const [runtimeStatusHint, setRuntimeStatusHint] = useState('');
  const [bandwidthProbePeerId, setBandwidthProbePeerId] = useState('');
  const [nativeStatusLoading, setNativeStatusLoading] = useState(false);
  const [isResourceExpanded, setIsResourceExpanded] = useState(false);
  const measuredBandwidthRef = useRef<Record<string, MeasuredBandwidthSnapshot>>({});
  const lastRendezvousRefreshAtRef = useRef(0);
  const lastMdnsDebugRefreshAtRef = useRef(0);
  const localPeerIdRef = useRef(normalizePeerId(localStorage.getItem('profile_local_peer_id_v1') ?? ''));
  const bootstrapAutoJoinRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAtRef = useRef(0);
  const lastAutoConnectAttemptAtRef = useRef<Record<string, number>>({});

  const refreshNativeStatus = async () => {
    setNativeStatusLoading(true);
    try {
      let runtimeFailureReason = '';
      const identityPeerId = normalizePeerId(await libp2pService.ensurePeerIdentity().catch(() => ''));
      if (identityPeerId.length > 0) {
        setLocalPeerId(identityPeerId);
        localPeerIdRef.current = identityPeerId;
        localStorage.setItem('profile_local_peer_id_v1', identityPeerId);
      }
      const started = await libp2pService.ensureStarted().catch(() => false);
      if (!started) {
        setRuntimeStatusHint('runtime starting');
      }
      const runtimeHealth = await libp2pService.runtimeHealth().catch(() => ({
        nativeReady: false,
        started: false,
        peerId: '',
        lastError: 'runtime_health_unavailable',
      }));
      const runtimePeerId = normalizePeerId(runtimeHealth.peerId ?? identityPeerId ?? '');
      const runtimeStarted = parseBoolean(runtimeHealth.started, false);
      const effectiveStarted = runtimeStarted || started;
      const runtimeNativeReady = parseBoolean(runtimeHealth.nativeReady, false) || effectiveStarted;
      setRuntimeHealthState({
        nativeReady: runtimeNativeReady,
        started: effectiveStarted,
        peerId: runtimePeerId,
        lastError: (runtimeHealth.lastError ?? '').trim(),
      });
      const runtimeReady = runtimeNativeReady || effectiveStarted;
      const persistedPeerId = normalizePeerId(localStorage.getItem('profile_local_peer_id_v1') ?? '');
      if (!runtimeReady && !started) {
        const bridgeLastError = await libp2pService.getLastError().catch(() => '');
        const runtimeError = runtimeHealth.lastError?.trim() ?? '';
        const detailText = runtimeError || bridgeLastError.trim();
        const detail = detailText ? `: ${detailText}` : '';
        runtimeFailureReason = detailText;
        const fallbackPeerId = normalizePeerId(
          runtimeHealth.peerId || identityPeerId || localPeerIdRef.current || persistedPeerId || await libp2pService.getLocalPeerId().catch(() => ''),
        );
        if (fallbackPeerId.length > 0) {
          setLocalPeerId(fallbackPeerId);
          localPeerIdRef.current = fallbackPeerId;
          localStorage.setItem('profile_local_peer_id_v1', fallbackPeerId);
          setRuntimeStatusHint('runtime recovering');
        } else if (detailText.length > 0) {
          setRuntimeStatusHint(`runtime recovering${detail}`);
        } else {
          setRuntimeStatusHint('runtime recovering');
        }
      }
      if (!runtimeReady) {
        const detail = runtimeHealth.lastError ? `: ${runtimeHealth.lastError}` : '';
        setRuntimeStatusHint(`runtime starting${detail}`);
        runtimeFailureReason = runtimeFailureReason || (runtimeHealth.lastError?.trim() ?? '');
        if (!runtimeFailureReason) {
          runtimeFailureReason = 'runtime_not_ready';
        }
      } else if (!runtimeHealth.nativeReady) {
        setRuntimeStatusHint('runtime recovering');
      } else {
        setRuntimeStatusHint('');
      }
      const now = Date.now();
      const shouldRefreshRendezvous = now - lastRendezvousRefreshAtRef.current > 15_000;
      const shouldRefreshMdnsDebug =
        lastMdnsDebugRefreshAtRef.current === 0 || now - lastMdnsDebugRefreshAtRef.current > 5_000;
      const rendezvousPromise = shouldRefreshRendezvous
        ? libp2pService.rendezvousDiscover('unimaker/nodes/v1', 64).catch(() => [] as Record<string, unknown>[])
        : Promise.resolve([] as Record<string, unknown>[]);
      const mdnsDebugPromise = shouldRefreshMdnsDebug
        ? libp2pService.mdnsDebug().catch(() => ({} as Record<string, unknown>))
        : Promise.resolve({} as Record<string, unknown>);

      const [peerIdRaw, peers, rendezvousRaw, discoveredRaw, mdnsDebugRaw] = await Promise.all([
        libp2pService.getLocalPeerId(),
        libp2pService.getConnectedPeers(),
        rendezvousPromise,
        libp2pService.socialListDiscoveredPeers('', 256),
        mdnsDebugPromise,
      ]);

      const [peersInfo, diagnostics] = await Promise.all([
        libp2pService.getConnectedPeersInfo().catch(() => []),
        libp2pService.getDiagnostics().catch(() => ({} as Record<string, unknown>)),
      ]);
      const peerRows = Array.isArray(peersInfo) ? peersInfo : [];
      const diagnosticsObj = parseObject(diagnostics);
      const bootstrap: BootstrapPeer[] = [];
      const rendezvousHints = shouldRefreshRendezvous ? parseRendezvousPeerMap(rendezvousRaw) : {};
      if (shouldRefreshRendezvous) {
        lastRendezvousRefreshAtRef.current = now;
      }

      const resolvedPeerId = normalizePeerId(peerIdRaw || identityPeerId || runtimeHealth.peerId || localPeerIdRef.current);
      const connectedPeers = uniqueStrings(peers.map((item) => normalizePeerId(item)).filter(Boolean));
      const connectedSet = new Set(connectedPeers);
      const discoveredPeers = parseDiscoveredPeers(discoveredRaw);
      const mdnsHints: Record<string, string[]> = {};
      for (const row of discoveredPeers) {
        if (row.sources.includes('mDNS') || row.sources.includes('LAN')) {
          mdnsHints[row.peerId] = uniqueStrings([...(mdnsHints[row.peerId] ?? []), ...row.multiaddrs]);
        }
        if (row.sources.includes('Rendezvous')) {
          rendezvousHints[row.peerId] = uniqueStrings([...(rendezvousHints[row.peerId] ?? []), ...row.multiaddrs]);
        }
      }
      const mergedRendezvousHints: Record<string, string[]> = rendezvousHints;

      if (shouldRefreshMdnsDebug) {
        lastMdnsDebugRefreshAtRef.current = now;
      }
      const androidMdnsPeers = shouldRefreshMdnsDebug ? parseAndroidMdnsPeerMap(mdnsDebugRaw) : {};
      if (shouldRefreshMdnsDebug) {
        setMdnsDebugState(parseObject(mdnsDebugRaw));
      }
      for (const [peerId, addrs] of Object.entries(androidMdnsPeers)) {
        if (!peerId || addrs.length === 0) {
          continue;
        }
        mdnsHints[peerId] = uniqueStrings([...(mdnsHints[peerId] ?? []), ...addrs]);
      }

      const autoConnectCandidates = new Map<string, string>();
      for (const row of discoveredPeers) {
        const peerId = normalizePeerId(row.peerId);
        const isLanDiscovered = row.sources.includes('mDNS') || row.sources.includes('LAN');
        if (!isLanDiscovered || !peerId || peerId === resolvedPeerId || connectedSet.has(peerId)) {
          continue;
        }
        const firstAddr = row.multiaddrs.find((item) => isDialablePeerMultiaddr(item)) ?? '';
        if (!firstAddr) {
          continue;
        }
        autoConnectCandidates.set(peerId, firstAddr);
      }
      for (const [peerIdRaw, addrs] of Object.entries(mdnsHints)) {
        const peerId = normalizePeerId(peerIdRaw);
        if (!peerId || peerId === resolvedPeerId || connectedSet.has(peerId) || autoConnectCandidates.has(peerId)) {
          continue;
        }
        const firstAddr = addrs.find((item) => isDialablePeerMultiaddr(item)) ?? '';
        if (!firstAddr) {
          continue;
        }
        autoConnectCandidates.set(peerId, firstAddr.trim());
      }
      for (const [peerIdRaw, addrs] of Object.entries(mergedRendezvousHints)) {
        const peerId = normalizePeerId(peerIdRaw);
        if (!peerId || peerId === resolvedPeerId || connectedSet.has(peerId) || autoConnectCandidates.has(peerId)) {
          continue;
        }
        const firstAddr = addrs.find((item) => isDialablePeerMultiaddr(item)) ?? '';
        if (!firstAddr) {
          continue;
        }
        autoConnectCandidates.set(peerId, firstAddr.trim());
      }
      const autoConnectTasks: Promise<unknown>[] = [];
      for (const [peerId, rawAddr] of autoConnectCandidates.entries()) {
        const lastAttemptAt = lastAutoConnectAttemptAtRef.current[peerId] ?? 0;
        if (now - lastAttemptAt < 15_000) {
          continue;
        }
        lastAutoConnectAttemptAtRef.current[peerId] = now;
        const normalizedAddr = normalizeMultiaddrForPeer(rawAddr, peerId);
        autoConnectTasks.push(
          (async () => {
            if (!isDialablePeerMultiaddr(normalizedAddr)) {
              return;
            }
            await libp2pService.registerPeerHints(peerId, [normalizedAddr], 'nodes-page-auto-connect').catch(() => false);
            await libp2pService.socialConnectPeer(peerId, normalizedAddr).catch(() => false);
          })()
        );
      }
      if (autoConnectTasks.length > 0) {
        await Promise.allSettled(autoConnectTasks);
      }

      const rebuilt = buildNativeNodes(
        resolvedPeerId,
        peerRows as Record<string, unknown>[],
        connectedPeers,
        mdnsHints,
        mergedRendezvousHints,
        t
      );
      const rebuiltWithMeasured = applyMeasuredBandwidthOverlay(rebuilt, measuredBandwidthRef.current);
      const visibleNodes = rebuiltWithMeasured.filter((item) => item.status === 'online' && item.peerId !== resolvedPeerId);
      setNodes(visibleNodes);
      if (resolvedPeerId.length > 0) {
        setLocalPeerId(resolvedPeerId);
        localPeerIdRef.current = resolvedPeerId;
        localStorage.setItem('profile_local_peer_id_v1', resolvedPeerId);
      }
      setNativeConnectedPeers(connectedPeers);
      setNativeDiagnostics(diagnosticsObj);
      setBootstrapPeers(bootstrap);
      setSelectedNode((prev) => {
        if (!prev) return null;
        return visibleNodes.find((item) => item.peerId === prev.peerId) ?? null;
      });
      if (runtimeReady) {
        setRuntimeStatusHint('');
      }
      if (runtimeReady) {
        setNativeError('');
      } else if (runtimeFailureReason) {
        setNativeError(runtimeFailureReason);
      }
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : `${error}`);
    } finally {
      setNativeStatusLoading(false);
    }
  };

  const scheduleRefreshNativeStatus = (immediate = false) => {
    if (refreshTimerRef.current) {
      return;
    }
    const now = Date.now();
    const refreshThrottleMs = 1000;
    const waitMs = immediate ? 0 : Math.max(0, refreshThrottleMs - (now - lastRefreshAtRef.current));
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void runRefreshNativeStatus();
    }, waitMs);
  };

  const runRefreshNativeStatus = async () => {
    if (refreshInFlightRef.current) {
      refreshPendingRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    lastRefreshAtRef.current = Date.now();
    try {
      await refreshNativeStatus();
    } finally {
      refreshInFlightRef.current = false;
      if (refreshPendingRef.current) {
        refreshPendingRef.current = false;
        scheduleRefreshNativeStatus();
      }
    }
  };

  useEffect(() => {
    scheduleRefreshNativeStatus(true);
    const unsubscribe = libp2pEventPump.subscribe(() => {
      scheduleRefreshNativeStatus();
    });
    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!libp2pService.isNativePlatform()) {
      return;
    }
    let disposed = false;
    void libp2pService.mdnsSetEnabled(true);
    void libp2pService.mdnsSetInterval(2);
    const tick = () => {
      if (disposed) return;
      const now = Date.now();
      void libp2pService.mdnsProbe();
      scheduleRefreshNativeStatus();
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const joinViaRandomBootstrap = async () => {
    if (bootstrapJoining) return;
    if (bootstrapPeers.length === 0) {
      setNativeError(t.nodes_noBootstrapNode);
      return;
    }
    setBootstrapJoining(true);
    setNativeError('');
    try {
      const result = parseObject(await libp2pService.joinViaRandomBootstrap(3));
      const connectedCount = parseNumber(result.connectedCount, 0);
      const ok = (result.ok === true) || connectedCount > 0;
      if (!ok) {
        setNativeError((await libp2pService.getLastError()) || t.nodes_bootstrapFailed);
      }
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : `${error}`);
    } finally {
      setBootstrapJoining(false);
      scheduleRefreshNativeStatus(true);
    }
  };

  useEffect(() => {
    if (bootstrapAutoJoinRef.current) return;
    if (nativeConnectedPeers.length > 0) return;
    if (bootstrapPeers.length === 0) return;
    bootstrapAutoJoinRef.current = true;
    void joinViaRandomBootstrap();
  }, [bootstrapPeers, nativeConnectedPeers]);

  useEffect(() => {
    const peerId = selectedNodeContentOwner?.peerId ?? '';
    if (!peerId) {
      setSelectedNodeContents([]);
      return;
    }
    const updateByPeer = () => {
      setSelectedNodeContents(getDistributedContentsByPeer(peerId, 300));
    };
    updateByPeer();
    const unsubscribe = subscribeDistributedContents(() => {
      updateByPeer();
    });
    return () => {
      unsubscribe();
    };
  }, [selectedNodeContentOwner?.peerId]);

  useEffect(() => {
    const peerId = selectedNode?.peerId ?? '';
    if (!peerId || !libp2pService.isNativePlatform()) {
      return;
    }
    let disposed = false;
    setBandwidthProbePeerId(peerId);
    const applyProbe = async () => {
      try {
        const raw = parseObject(await libp2pService.measurePeerBandwidth(peerId, 2500, 12288));
        if (disposed) return;
        if (raw.ok !== true) {
          const errText = parseText(raw.error, '');
          if (errText) {
            setNativeError(errText);
          }
          return;
        }
        const uplinkBps = parseNumber(raw.uplinkBps, 0);
        const downlinkBps = parseNumber(raw.downlinkBps, 0);
        const isRelayed = raw.isRelayed === true || raw.relayLimited === true;
        const relayBottleneckBps = parseNumber(raw.relayBottleneckBps, 0);
        measuredBandwidthRef.current[peerId] = {
          uplinkBps,
          downlinkBps,
          isRelayed,
          relayBottleneckBps,
        };
        setNodes((prev) => prev.map((item) => {
          if (item.peerId !== peerId) return item;
          const systemProfile: NodeSystemProfile = {
            ...item.systemProfile,
            uplinkBps,
            downlinkBps,
            isRelayed,
            relayBottleneckBps,
          };
          return {
            ...item,
            systemProfile,
            bandwidth: toBandwidthLabel(systemProfile),
          };
        }));
        setSelectedNode((prev) => {
          if (!prev || prev.peerId !== peerId) return prev;
          const systemProfile: NodeSystemProfile = {
            ...prev.systemProfile,
            uplinkBps,
            downlinkBps,
            isRelayed,
            relayBottleneckBps,
          };
          return {
            ...prev,
            systemProfile,
            bandwidth: toBandwidthLabel(systemProfile),
          };
        });
      } catch (error) {
        if (disposed) return;
        setNativeError(error instanceof Error ? error.message : `${error}`);
      } finally {
        if (!disposed) {
          setBandwidthProbePeerId((current) => (current === peerId ? '' : current));
        }
      }
    };
    void applyProbe();
    return () => {
      disposed = true;
    };
  }, [selectedNode?.peerId]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (localPeerId && node.peerId === localPeerId) return false;
      if (sourceFilter !== 'all' && !node.sources.includes(sourceFilter)) return false;
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        node.peerId.toLowerCase().includes(query) ||
        node.nickname.toLowerCase().includes(query) ||
        node.domain?.toLowerCase().includes(query) ||
        node.location.toLowerCase().includes(query)
      );
    });
  }, [localPeerId, nodes, searchQuery, sourceFilter]);

  const toggleSelectPeer = (peerId: string) => {
    setSelectedPeerIds((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId); else next.add(peerId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPeerIds.size === filteredNodes.length) {
      setSelectedPeerIds(new Set());
    } else {
      setSelectedPeerIds(new Set(filteredNodes.map((n) => n.peerId)));
    }
  };

  const handleCreateGroup = () => {
    if (selectedPeerIds.size < 2) return;
    const members = nodes.filter((n) => selectedPeerIds.has(n.peerId));
    const groupName = members.slice(0, 3).map((m) => m.domain || m.nickname || m.peerId.slice(0, 8)).join(', ');
    setChatSession({
      id: `group-${Date.now()}`,
      name: groupName,
      avatar: '',
      isGroup: true,
    });
    setSelectMode(false);
    setSelectedPeerIds(new Set());
  };

  const diagnosticsPeerId = normalizePeerId(parseText((nativeDiagnostics as Record<string, unknown>).peerId, localPeerId));
  const localProfile = useMemo(() => {
    const fromNode = nodes.find((item) => item.peerId === diagnosticsPeerId || item.peerId === localPeerId);
    if (fromNode) return fromNode.systemProfile;
    return readSystemProfile((nativeDiagnostics as Record<string, unknown>).systemProfile);
  }, [diagnosticsPeerId, localPeerId, nativeDiagnostics, nodes]);
  const globalResourceSummary = useMemo(
    () => buildGlobalResourceSummary(nodes, nativeDiagnostics, localProfile, localPeerId),
    [localPeerId, localProfile, nativeDiagnostics, nodes],
  );
  const discoveryDiagnostics = useMemo(() => {
    const diag = parseObject(nativeDiagnostics);
    const discovery = parseObject(diag.discovery);
    const mdns = parseObject(mdnsDebugState);
    const connectedCount = nativeConnectedPeers.length > 0
      ? nativeConnectedPeers.length
      : parseNumber(diag.connectedCount, parseNumber(diag.connectedPeers, 0));
    const mdnsPeerCount = parseNumber(
      mdns.peerCount,
      parseNumber(mdns.mdnsPeerCount, parseArrayCount(mdns.peers)),
    );
    const candidateCount = parseNumber(
      discovery.candidateCount,
      parseNumber(diag.candidateCount, parseArrayCount(discovery.candidates) || parseArrayCount(diag.discoveredPeers)),
    );
    const status: 'ready' | 'starting' | 'not_ready' =
      runtimeHealthState.nativeReady
        ? (runtimeHealthState.started ? 'ready' : 'starting')
        : 'not_ready';
    const lastError = parseText(
      runtimeHealthState.lastError,
      parseText(diag.lastError, parseText(diag.error, '')),
    );
    return {
      status,
      connectedCount,
      mdnsPeerCount,
      candidateCount,
      peerId: runtimeHealthState.peerId || localPeerId,
      lastError,
    };
  }, [localPeerId, mdnsDebugState, nativeConnectedPeers, nativeDiagnostics, runtimeHealthState]);

  const osStats = useMemo(() => {
    const stats: Record<string, number> = {};
    const add = (os: string) => {
      const key = (os === 'unknown' ? 'Unknown' : os) || 'Unknown';
      stats[key] = (stats[key] || 0) + 1;
    };
    add(localProfile.osName); // Local node is always online/active here
    nodes.forEach((n) => {
      if (isRecentlyOnline(n)) add(n.systemProfile.osName);
    });

    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    return Object.entries(stats)
      .map(([name, count]) => ({ name, count, percent: count / total }))
      .sort((a, b) => b.count - a.count);
  }, [localProfile, nodes]);

  const renderPieChart = () => {
    if (osStats.length === 0) return null;

    let cumulativePercent = 0;
    const size = 100;
    const center = size / 2;
    const radius = center;

    const getCoordinatesForPercent = (percent: number) => {
      const x = center + radius * Math.cos(2 * Math.PI * percent);
      const y = center + radius * Math.sin(2 * Math.PI * percent);
      return [x, y];
    };

    const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088fe', '#00C49F'];

    return (
      <div className="flex items-center justify-center gap-4">
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90 w-full h-full">
            {osStats.map((stat, index) => {
              const startPercent = cumulativePercent;
              const endPercent = cumulativePercent + stat.percent;
              cumulativePercent += stat.percent;

              // If there's only one slice, draw a full circle
              if (osStats.length === 1) {
                return (
                  <circle
                    key={stat.name}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill={colors[index % colors.length]}
                  />
                );
              }

              const [startX, startY] = getCoordinatesForPercent(startPercent);
              const [endX, endY] = getCoordinatesForPercent(endPercent);
              const largeArcFlag = stat.percent > 0.5 ? 1 : 0;

              const pathData = [
                `M ${center} ${center}`,
                `L ${startX} ${startY}`,
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
                'Z',
              ].join(' ');

              return (
                <path
                  key={stat.name}
                  d={pathData}
                  fill={colors[index % colors.length]}
                />
              );
            })}
          </svg>
        </div>
        <div className="flex flex-col gap-1 text-xs">
          {osStats.map((stat, index) => (
            <div key={stat.name} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: colors[index % colors.length] }}
              />
              <span className="text-gray-600">{stat.name}</span>
              <span className="font-medium text-gray-900">{Math.round(stat.percent * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const openNodeChat = (node: Node, action: NodeActionType) => {
    const chatId = action === 'group' ? `${node.peerId}:group` : node.peerId;
    const chatName = action === 'group' ? `${node.nickname} ${t.nodes_groupChatSuffix}` : node.nickname;
    const isGroup = action === 'group';

    ensureConversation({
      id: chatId,
      name: chatName,
      avatar: node.avatar,
      isGroup,
    });

    if (action === 'voice') {
      setSocialHint(t.nodes_voiceInviteSent);
    } else if (action === 'video') {
      setSocialHint(t.nodes_videoInviteSent);
    } else if (action === 'group') {
      setSocialHint(t.nodes_groupDraftCreated);
    } else {
      setSocialHint(action === 'chat' ? t.nodes_directSessionCreated : null);
    }

    setNodes((prev) => prev.map((item) => item.peerId === node.peerId
      ? {
        ...item,
        status: 'online',
        lastSeenAt: Date.now(),
        connections: item.connections + 1,
      }
      : item));

    setChatSession({
      id: chatId,
      name: chatName,
      avatar: node.avatar,
      isGroup,
      initialAction:
        action === 'redPacket'
          ? 'redPacket'
          : action === 'location'
            ? 'location'
            : action === 'voice'
              ? 'voice'
              : action === 'video'
                ? 'videoCall'
                : 'dm',
    });
  };

  const refreshSelectedNodeContents = async (peerId: string, useNetwork = true) => {
    const normalizedPeerId = normalizePeerId(peerId);
    if (!normalizedPeerId) {
      setSelectedNodeContents([]);
      return;
    }

    setSelectedNodeContents(getDistributedContentsByPeer(normalizedPeerId, 300));
    if (!useNetwork || !libp2pService.isNativePlatform()) {
      return;
    }

    setSelectedNodeContentLoading(true);
    try {
      await syncDistributedContentFromNetwork(normalizedPeerId);
      setSelectedNodeContents(getDistributedContentsByPeer(normalizedPeerId, 300));
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : `${error}`);
    } finally {
      setSelectedNodeContentLoading(false);
    }
  };

  const openNodePublishedContents = (node: Node) => {
    setSelectedNodeContentOwner(node);
    setSelectedNodeContent(null);
    void refreshSelectedNodeContents(node.peerId, true);
  };

  const openContentDetail = (content: DistributedContent) => {
    setSelectedNodeContent(content);
    void (async () => {
      const resolved = await resolveDistributedContentDetail(content.id, content.userId);
      if (!resolved) {
        return;
      }
      setSelectedNodeContent((current) => {
        if (!current || current.id !== content.id) {
          return current;
        }
        return resolved;
      });
    })();
  };

  const openAddNodeModal = () => {
    setNodeDraft(emptyNodeDraft);
    setNodeDraftError('');
    setShowAddNode(true);
  };

  const handleCreateNode = () => {
    const peerId = normalizePeerId(nodeDraft.peerId);
    if (peerId.length < 12) {
      setNodeDraftError(t.nodes_invalidPeerId);
      return;
    }

    if (nodes.some((item) => item.peerId === peerId)) {
      setNodeDraftError(t.nodes_nodeExists);
      return;
    }

    const node: Node = {
      ...buildBaseNode(peerId, nodeDraft.nickname.trim() || `${t.nodes_defaultNickname} ${peerId.slice(0, 6)}`, t),
      domain: nodeDraft.domain.trim() || undefined,
      location: nodeDraft.location.trim() || '--',
      region: nodeDraft.region.trim() || '--',
      bio: nodeDraft.bio.trim() || t.nodes_manuallyAdded,
      status: 'online',
      lastSeenAt: Date.now(),
    };

    setNodes((prev) => [node, ...prev]);
    setShowAddNode(false);
    setNodeDraft(emptyNodeDraft);
  };

  const handleSelectNode = async (node: Node) => {
    setSelectedNode(node);
    setNativeError('');
    try {
      const peerId = normalizePeerId(node.peerId);
      if (!peerId) return;
      let multiaddrs = uniqueStrings(node.multiaddrs.map((item) => normalizeMultiaddrForPeer(item, peerId)).filter(Boolean));
      let connected = false;

      const firstDial = pickDialMultiaddr(peerId, multiaddrs);
      if (firstDial) {
        connected = await libp2pService.connectMultiaddr(firstDial);
      }

      if (!connected) {
        const knownAddrs = await libp2pService.getPeerMultiaddrs(peerId);
        multiaddrs = uniqueStrings([
          ...multiaddrs,
          ...knownAddrs.map((item) => normalizeMultiaddrForPeer(item, peerId)).filter(Boolean),
        ]);
        if (multiaddrs.length > 0) {
          await libp2pService.registerPeerHints(peerId, multiaddrs, 'nodes-page');
          const hintedDial = pickDialMultiaddr(peerId, multiaddrs);
          if (hintedDial) {
            connected = await libp2pService.connectMultiaddr(hintedDial);
          }
        }
      }

      if (!connected) {
        connected = await libp2pService.connectPeer(peerId);
      }

      if (!connected) {
        connected = await libp2pService.socialConnectPeer(peerId, firstDial || multiaddrs[0] || '');
      }

      if (!connected) {
        setNativeError((await libp2pService.getLastError()) || `${t.nodes_connectFailed}: ${peerId.slice(0, 10)}`);
      }
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : `${error}`);
    } finally {
      scheduleRefreshNativeStatus(true);
    }
  };

  if (chatSession) {
    return (
      <ChatPage
        chatId={chatSession.id}
        chatName={chatSession.name}
        chatAvatar={chatSession.avatar}
        isGroup={chatSession.isGroup}
        initialAction={chatSession.initialAction}
        onBack={() => setChatSession(null)}
      />
    );
  }

  if (selectedNodeContentOwner) {
    return (
      <div className="h-full">
        <NodePublishedContentPage
          node={selectedNodeContentOwner}
          items={selectedNodeContents}
          loading={selectedNodeContentLoading}
          onBack={() => {
            setSelectedNodeContentOwner(null);
            setSelectedNodeContent(null);
          }}
          onRefresh={() => {
            void refreshSelectedNodeContents(selectedNodeContentOwner.peerId, true);
          }}
          onSelectContent={openContentDetail}
        />
        {selectedNodeContent && (
          <ContentDetailPage
            content={selectedNodeContent}
            onClose={() => setSelectedNodeContent(null)}
          />
        )}
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className="h-full">
        {socialHint && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-sm bg-green-50 text-green-700 border border-green-100">
            {socialHint}
          </div>
        )}
        <NodeDetail
          node={selectedNode}
          isBandwidthProbeRunning={bandwidthProbePeerId === selectedNode.peerId}
          onBack={() => {
            setSelectedNode(null);
            setSocialHint(null);
          }}
          onAction={(action) => openNodeChat(selectedNode, action)}
          onViewContent={() => {
            openNodePublishedContents(selectedNode);
          }}
        />
      </div>
    );
  }

  const SOURCE_TABS: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: t.nodes_sourceAll },
    { key: 'mDNS', label: 'mDNS' },
    { key: 'DHT', label: 'DHT' },
    { key: 'Connected', label: t.nodes_sourceDirect },
    { key: 'LAN', label: 'LAN' },
    { key: 'WAN', label: 'WAN' },
  ];
  const runtimeStatusLabel =
    discoveryDiagnostics.status === 'ready'
      ? t.nodes_diag_runtime_ready
      : discoveryDiagnostics.status === 'starting'
        ? t.nodes_diag_runtime_starting
        : t.nodes_diag_runtime_notReady;

  return (
    <>
      <div className="h-full flex flex-col bg-white">
        <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2 z-10">
          {showSearch ? (
            <>
              <input
                type="text"
                placeholder={t.nodes_searchPlaceholder}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
              <button
                onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors shrink-0"
                aria-label={t.nodes_cancelSearch}
              >
                <X size={20} className="text-gray-500" />
              </button>
            </>
          ) : (
            <>
              <div className="flex-1" />
              <button
                onClick={() => { setSelectMode(!selectMode); setSelectedPeerIds(new Set()); }}
                className={`p-2 rounded-full transition-colors ${selectMode ? 'bg-purple-100 text-purple-600' : 'hover:bg-gray-100'}`}
                aria-label={t.nodes_multiSelect}
              >
                <Users size={20} />
              </button>
              <button
                onClick={() => setShowSearch(true)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                aria-label={t.nodes_searchNodes}
              >
                <Search size={22} />
              </button>
            </>
          )}
        </header>

        <section className="mx-4 mt-2 rounded-xl border border-purple-100 bg-gradient-to-r from-purple-50 to-indigo-50 overflow-hidden transition-all">
          <button
            onClick={() => setIsResourceExpanded(!isResourceExpanded)}
            className="w-full flex items-center justify-between px-3 py-3"
          >
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-gray-900">{t.nodes_globalComputeTitle}</div>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                {t.nodes_onlineNodes}: {globalResourceSummary.onlineCount}
              </span>
            </div>
            {isResourceExpanded ? <ChevronDown size={18} className="text-gray-500" /> : <ChevronRight size={18} className="text-gray-500" />}
          </button>

          {isResourceExpanded && (
            <div className="px-3 pb-3 pt-0 border-t border-purple-100/50">
              <div className="flex flex-col gap-4 mt-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">{t.nodes_os}</div>
                    {renderPieChart()}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-gray-700 bg-white/50 p-3 rounded-lg">
                  <div>{t.nodes_totalCpuCores}：<span className="font-medium">{globalResourceSummary.cpuCoresTotal || '--'}</span></div>
                  <div>{t.nodes_totalMemory}：<span className="font-medium">{formatBytes(globalResourceSummary.memoryTotalBytes)}</span></div>
                  <div>{t.nodes_totalDiskAvailable}：<span className="font-medium">{formatBytes(globalResourceSummary.diskAvailableBytes)}</span> / {formatBytes(globalResourceSummary.diskTotalBytes)}</div>
                  <div>{t.nodes_totalGpuVram}：<span className="font-medium">{formatBytes(globalResourceSummary.gpuVramTotalBytes)}</span></div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Source filter tabs */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 overflow-x-auto">
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSourceFilter(tab.key)}
              className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${sourceFilter === tab.key
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Select mode header */}
        {selectMode && (
          <div className="flex items-center justify-between px-4 py-2 bg-purple-50 border-b border-purple-100">
            <button
              onClick={toggleSelectAll}
              className="text-xs text-purple-700 font-medium"
            >
              {selectedPeerIds.size === filteredNodes.length ? t.nodes_deselectAll : t.nodes_selectAll}
            </button>
            <span className="text-xs text-gray-600">{t.nodes_selectedCount} {selectedPeerIds.size}</span>
            <button
              onClick={handleCreateGroup}
              disabled={selectedPeerIds.size < 2}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${selectedPeerIds.size >= 2
                ? 'bg-purple-600 text-white hover:bg-purple-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
            >
              {t.nodes_createGroup}
            </button>
          </div>
        )}

        {nativeError && (
          <div className="mx-4 mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
            {nativeError}
          </div>
        )}
        {runtimeStatusHint && (
          <div className="mx-4 mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
            {runtimeStatusHint}
          </div>
        )}
        <section className="mx-4 mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-xs font-semibold text-slate-700 mb-2">{t.nodes_diag_title}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-700">
            <div>{t.nodes_diag_runtime}：<span className="font-medium">{runtimeStatusLabel}</span></div>
            <div>{t.nodes_diag_connected_peers}：<span className="font-medium">{discoveryDiagnostics.connectedCount}</span></div>
            <div>{t.nodes_diag_mdns_peers}：<span className="font-medium">{discoveryDiagnostics.mdnsPeerCount}</span></div>
            <div>{t.nodes_diag_candidates}：<span className="font-medium">{discoveryDiagnostics.candidateCount}</span></div>
            <div className="col-span-2 truncate">
              {t.nodes_diag_peer_id}：<span className="font-medium">{discoveryDiagnostics.peerId || '--'}</span>
            </div>
            <div className="col-span-2 truncate">
              {t.nodes_diag_last_error}：<span className="font-medium">{discoveryDiagnostics.lastError || '--'}</span>
            </div>
          </div>
        </section>



        {filteredNodes.length > 0 ? (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {filteredNodes.map((node) => {
              const online = isRecentlyOnline(node);
              const displayName = node.domain || node.peerId;
              const latencyText = online && node.latency > 0 ? `${node.latency}ms` : '';
              const isSelected = selectedPeerIds.has(node.peerId);
              return (
                <button
                  key={node.peerId}
                  onClick={() => selectMode ? toggleSelectPeer(node.peerId) : void handleSelectNode(node)}
                  className={`w-full mb-2 p-3 border rounded-xl hover:shadow-md transition-all text-left ${isSelected ? 'bg-purple-50 border-purple-300' : 'bg-white border-gray-200'
                    }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {selectMode && (
                      <div className={`w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${isSelected ? 'bg-purple-600 border-purple-600' : 'border-gray-300'
                        }`}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    )}
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div className="font-medium text-gray-900 text-sm truncate">{displayName}</div>
                    {latencyText && (
                      <span className={`text-xs shrink-0 ${node.latency < 80 ? 'text-green-600' : 'text-orange-500'}`}>{latencyText}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center px-6">
              <Activity size={48} className="mx-auto mb-3 opacity-50" />
              <p>{t.nodes_noNodes}</p>
              <p className="text-xs mt-1">{t.nodes_noNodesHint}</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
