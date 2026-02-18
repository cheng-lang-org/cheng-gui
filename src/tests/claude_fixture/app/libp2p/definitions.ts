export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface OkResult {
  ok: boolean;
}

export interface StartedResult {
  started: boolean;
}

export interface RuntimeHealthResult {
  native_ready?: boolean;
  host_loaded?: boolean;
  started?: boolean;
  peer_id?: string;
  last_error?: string;
}

export interface PeerIdResult {
  peerId: string;
}

export interface StringResult {
  error?: string;
  value?: string;
}

export interface ArrayResult {
  addresses?: string[];
  peers?: string[];
  multiaddrs?: string[];
  endpoints?: Record<string, JsonValue>[];
  events?: BridgeEventEntry[];
}

export interface ConnectedResult {
  connected: boolean;
}

export interface ReserveAllResult {
  ok: boolean;
  count: number;
}

export interface FileProvidersResult {
  providers: string[];
}

export interface FileChunkResult {
  ok: boolean;
  payloadBase64?: string;
  chunkSize?: number;
  error?: string;
}

export interface ChunkSizeResult {
  size: number;
}

export interface VrfKeypairResult {
  ok: boolean;
  publicKeyHex?: string;
  privateKeyHex?: string;
  error?: string;
}

export interface VrfSignResult {
  ok: boolean;
  signatureHex?: string;
  signatureBase64?: string;
  error?: string;
}

export interface VrfVerifyResult {
  ok: boolean;
  valid?: boolean;
  error?: string;
}

export interface BridgeEventEntry {
  topic?: string;
  payload?: JsonValue;
  kind?: string;
  entity?: string;
  op?: string;
  traceId?: string;
  conversationId?: string;
  groupId?: string;
  roomId?: string;
  postId?: string;
  seq?: number;
  timestampMs?: number;
  source?: string;
  [key: string]: JsonValue | undefined;
}

export interface SocialEvent extends BridgeEventEntry {
  kind?: 'social' | string;
}

export interface DiscoveredPeer {
  peerId: string;
  multiaddrs: string[];
  sources: string[];
  lastSeenAt?: number;
  [key: string]: JsonValue | undefined;
}

export interface Message {
  id: string;
  conversationId?: string;
  peerId?: string;
  sender?: string;
  type?: string;
  content?: string;
  status?: string;
  ackStatus?: string;
  timestampMs?: number;
  edited?: boolean;
  revoked?: boolean;
  payload?: JsonValue;
  [key: string]: JsonValue | undefined;
}

export interface Conversation {
  conversationId: string;
  peerId?: string;
  name?: string;
  unreadCount?: number;
  lastMessage?: string;
  lastTimestampMs?: number;
  messages?: Message[];
  [key: string]: JsonValue | undefined;
}

export interface Contact {
  peerId: string;
  status?: string;
  helloText?: string;
  reason?: string;
  updatedAt?: number;
  [key: string]: JsonValue | undefined;
}

export interface Group {
  groupId: string;
  name?: string;
  ownerPeerId?: string;
  members?: string[];
  createdAt?: number;
  updatedAt?: number;
  [key: string]: JsonValue | undefined;
}

export interface SyncCastProgram {
  programId?: string;
  id?: string;
  title?: string;
  url?: string;
  coverUrl?: string;
  allowSeek?: boolean;
  allowRateChange?: boolean;
  mode?: string;
  [key: string]: JsonValue | undefined;
}

export interface SyncCastRoomState {
  roomId: string;
  program?: SyncCastProgram;
  members?: string[];
  state?: Record<string, JsonValue>;
  lastControl?: Record<string, JsonValue>;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: JsonValue | undefined;
}

export interface MomentPost {
  postId: string;
  id?: string;
  authorPeerId?: string;
  content?: string;
  likes?: string[];
  comments?: Record<string, JsonValue>[];
  timestampMs?: number;
  deleted?: boolean;
  [key: string]: JsonValue | undefined;
}

export interface NotificationItem {
  id?: string;
  type?: string;
  title?: string;
  body?: string;
  timestampMs?: number;
  payload?: JsonValue;
  [key: string]: JsonValue | undefined;
}

export interface PresenceSnapshot {
  peerId: string;
  online: boolean;
  lastSeenAt?: number;
  source?: string;
  [key: string]: JsonValue | undefined;
}

export interface Libp2pIdentity {
  privateKey: string;
  publicKey: string;
  peerId: string;
  source?: string;
  keyPath?: string;
}

export interface Libp2pBridgePlugin {
  init(options: { config?: string | Record<string, JsonValue> }): Promise<OkResult>;
  start(): Promise<OkResult>;
  stop(): Promise<OkResult>;
  reset?(): Promise<OkResult>;
  isStarted(): Promise<StartedResult>;
  runtimeHealth(): Promise<RuntimeHealthResult>;
  generateIdentity(): Promise<Libp2pIdentity>;
  identityFromSeed(options: { seed: string }): Promise<Libp2pIdentity>;
  getLocalPeerId(): Promise<PeerIdResult>;
  getListenAddresses(): Promise<ArrayResult>;
  getDialableAddresses(): Promise<ArrayResult>;

  connectPeer(options: { peerId: string }): Promise<OkResult>;
  connectMultiaddr(options: { multiaddr: string }): Promise<OkResult>;
  disconnectPeer(options: { peerId: string }): Promise<OkResult>;
  registerPeerHints(options: { peerId: string; addresses: string[]; source?: string }): Promise<OkResult>;
  addExternalAddress(options: { multiaddr: string }): Promise<OkResult>;
  isPeerConnected(options: { peerId: string }): Promise<ConnectedResult>;
  getPeerMultiaddrs(options: { peerId: string }): Promise<ArrayResult>;
  reconnectBootstrap(): Promise<OkResult>;
  getRandomBootstrapPeers(options?: { limit?: number }): Promise<Record<string, JsonValue>>;
  joinViaRandomBootstrap(options?: { limit?: number }): Promise<Record<string, JsonValue>>;
  bootstrapSetPolicy(options: { policy?: string | Record<string, JsonValue> }): Promise<OkResult>;
  bootstrapTick(): Promise<Record<string, JsonValue>>;
  bootstrapGetStatus(): Promise<Record<string, JsonValue>>;
  bootstrapPublishSnapshot(): Promise<OkResult>;
  boostConnectivity(): Promise<OkResult>;
  reserveOnRelay(options: { relayAddr: string }): Promise<OkResult>;
  reserveOnAllRelays(): Promise<ReserveAllResult>;
  mdnsSetEnabled(options: { enabled: boolean }): Promise<OkResult>;
  mdnsSetInterface(options: { ipv4: string }): Promise<OkResult>;
  mdnsSetInterval(options: { seconds: number }): Promise<OkResult>;
  mdnsProbe(): Promise<OkResult>;
  mdnsDebug(): Promise<Record<string, JsonValue>>;
  rendezvousAdvertise(options: { namespace: string; ttlMs?: number }): Promise<OkResult>;
  rendezvousDiscover(options: { namespace?: string; limit?: number }): Promise<{ peers: Record<string, JsonValue>[] }>;
  rendezvousUnregister(options: { namespace: string }): Promise<OkResult>;

  pubsubPublish(options: { topic: string; payload?: string; payloadBase64?: string }): Promise<OkResult>;
  pubsubSubscribe(options: { topic: string }): Promise<OkResult>;
  pubsubUnsubscribe(options: { topic: string }): Promise<OkResult>;
  sendDirectText(options: {
    peerId: string;
    messageId?: string;
    text: string;
    replyTo?: string;
    requestAck?: boolean;
    timeoutMs?: number;
  }): Promise<OkResult>;
  sendChatControl(options: {
    peerId: string;
    op: string;
    messageId?: string;
    body?: string;
    target?: string;
    requestAck?: boolean;
    timeoutMs?: number;
  }): Promise<OkResult>;
  sendChatAck(options: {
    peerId: string;
    messageId: string;
    success: boolean;
    error?: string;
  }): Promise<OkResult>;
  sendWithAck(options: { peerId: string; payload: string | Record<string, JsonValue>; timeoutMs?: number }): Promise<OkResult>;
  waitSecureChannel(options: { peerId: string; timeoutMs?: number }): Promise<OkResult>;
  getLastDirectError(): Promise<StringResult>;

  fetchFeedSnapshot(): Promise<Record<string, JsonValue>>;
  feedSubscribePeer(options: { peerId: string }): Promise<OkResult>;
  feedUnsubscribePeer(options: { peerId: string }): Promise<OkResult>;
  feedPublishEntry(options: { payload: string | Record<string, JsonValue> }): Promise<OkResult>;
  syncPeerstoreState(): Promise<Record<string, JsonValue>>;
  loadStoredPeers(): Promise<Record<string, JsonValue>>;
  fetchFileProviders(options: { key: string; limit?: number }): Promise<FileProvidersResult>;
  requestFileChunk(options: {
    peerId: string;
    requestJson?: string;
    request?: Record<string, JsonValue>;
    maxBytes?: number;
  }): Promise<FileChunkResult>;
  lastChunkSize(): Promise<ChunkSizeResult>;
  resolveIpns(options: { nameOrUri: string }): Promise<StringResult>;
  vrfGenerateKeypair(): Promise<VrfKeypairResult>;
  vrfSign(options: { privateKeyHex: string; inputHex: string }): Promise<VrfSignResult>;
  vrfVerify(options: { publicKeyHex: string; inputHex: string; signatureHex: string }): Promise<VrfVerifyResult>;

  getLanEndpoints(): Promise<ArrayResult>;
  lanGroupJoin(options: { groupId: string }): Promise<OkResult>;
  lanGroupLeave(options: { groupId: string }): Promise<OkResult>;
  lanGroupSend(options: { groupId: string; message: string }): Promise<OkResult>;
  upsertLivestreamConfig(options: {
    streamKey: string;
    configJson?: string;
    config?: Record<string, JsonValue>;
  }): Promise<OkResult>;
  publishLivestreamFrame(options: {
    streamKey: string;
    payload?: string;
    payloadBase64?: string;
  }): Promise<OkResult>;

  getDiagnostics(): Promise<Record<string, JsonValue>>;
  getBootstrapStatus(): Promise<Record<string, JsonValue>>;
  getConnectedPeers(): Promise<ArrayResult>;
  getConnectedPeersInfo(): Promise<{ peers: Record<string, JsonValue>[] }>;
  measurePeerBandwidth(options: { peerId: string; durationMs?: number; chunkBytes?: number }): Promise<Record<string, JsonValue>>;
  getLastError(): Promise<StringResult>;
  pollEvents(options: { maxEvents?: number }): Promise<{ events: BridgeEventEntry[] }>;

  rwadSubmitTx?(options: { tx: string | Record<string, JsonValue> }): Promise<Record<string, JsonValue>>;
  rwadGetAccount?(options: { address: string }): Promise<Record<string, JsonValue>>;
  rwadGetAssetBalance?(options: { assetId: string; owner: string }): Promise<Record<string, JsonValue>>;
  rwadGetEscrow?(options: { escrowId: string }): Promise<Record<string, JsonValue>>;
  rwadGetTx?(options: { txHash: string }): Promise<Record<string, JsonValue>>;
  rwadListMarketEvents?(options?: {
    category?: string;
    limit?: number;
    cursor?: string;
    after_event_id?: string;
    partyAddress?: string;
    party_address?: string;
  }): Promise<Record<string, JsonValue>>;

  socialListDiscoveredPeers(options?: { sourceFilter?: string; limit?: number }): Promise<{ peers: DiscoveredPeer[]; totalCount?: number }>;
  socialConnectPeer(options: { peerId: string; multiaddr?: string }): Promise<OkResult>;
  socialDmSend(options: {
    peerId: string;
    conversationId?: string;
    messageJson?: string;
    message?: Record<string, JsonValue>;
  }): Promise<OkResult>;
  socialDmEdit(options: {
    peerId: string;
    conversationId?: string;
    messageId: string;
    patchJson?: string;
    patch?: Record<string, JsonValue>;
  }): Promise<OkResult>;
  socialDmRevoke(options: {
    peerId: string;
    conversationId?: string;
    messageId: string;
    reason?: string;
  }): Promise<OkResult>;
  socialDmAck(options: {
    peerId: string;
    conversationId?: string;
    messageId: string;
    status?: string;
  }): Promise<OkResult>;
  socialContactsSendRequest(options: { peerId: string; helloText?: string }): Promise<OkResult>;
  socialContactsAccept(options: { peerId: string }): Promise<OkResult>;
  socialContactsReject(options: { peerId: string; reason?: string }): Promise<OkResult>;
  socialContactsRemove(options: { peerId: string }): Promise<OkResult>;
  socialGroupsCreate(options: { groupMetaJson?: string; groupMeta?: Record<string, JsonValue> }): Promise<Record<string, JsonValue>>;
  socialGroupsUpdate(options: { groupId: string; patchJson?: string; patch?: Record<string, JsonValue> }): Promise<OkResult>;
  socialGroupsInvite(options: { groupId: string; peerIds?: string[]; peerIdsJson?: string }): Promise<OkResult>;
  socialGroupsKick(options: { groupId: string; peerId: string }): Promise<OkResult>;
  socialGroupsLeave(options: { groupId: string }): Promise<OkResult>;
  socialGroupsSend(options: { groupId: string; messageJson?: string; message?: Record<string, JsonValue> }): Promise<OkResult>;
  socialSynccastUpsertProgram(options: {
    roomId: string;
    programJson?: string;
    program?: Record<string, JsonValue>;
  }): Promise<Record<string, JsonValue>>;
  socialSynccastJoin(options: { roomId: string; peerId?: string }): Promise<OkResult>;
  socialSynccastLeave(options: { roomId: string }): Promise<OkResult>;
  socialSynccastControl(options: {
    roomId: string;
    controlJson?: string;
    control?: Record<string, JsonValue>;
  }): Promise<OkResult>;
  socialSynccastGetState(options: { roomId: string }): Promise<Record<string, JsonValue>>;
  socialSynccastListRooms(options?: { limit?: number }): Promise<{ items: SyncCastRoomState[]; totalCount?: number }>;
  socialMomentsPublish(options: { postJson?: string; post?: Record<string, JsonValue> }): Promise<Record<string, JsonValue>>;
  socialMomentsDelete(options: { postId: string }): Promise<OkResult>;
  socialMomentsLike(options: { postId: string; like: boolean }): Promise<OkResult>;
  socialMomentsComment(options: { postId: string; commentJson?: string; comment?: Record<string, JsonValue> }): Promise<OkResult>;
  socialMomentsTimeline(options?: { cursor?: string; limit?: number }): Promise<{ items: MomentPost[]; nextCursor?: string; hasMore?: boolean }>;
  socialNotificationsList(options?: { cursor?: string; limit?: number }): Promise<{ items: NotificationItem[]; nextCursor?: string; hasMore?: boolean }>;
  socialQueryPresence(options: { peerIds?: string[]; peerIdsJson?: string }): Promise<{ peers: PresenceSnapshot[] }>;
  socialPollEvents(options?: { maxEvents?: number }): Promise<{ events: BridgeEventEntry[] }>;
}
