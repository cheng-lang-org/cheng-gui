import { canonicalJson } from '../c2c/codec';
import type { JsonValue } from '../../libp2p/definitions';
import { libp2pService } from '../../libp2p/service';

export interface RwadTxEnvelope {
  chain_id: string;
  sender: string;
  nonce: number;
  gas_limit: number;
  gas_price: number;
  fee_payer: string;
  expires_at: number;
  tx_type: string;
  payload: Record<string, JsonValue>;
  signature: string;
  encoding: 'cbor' | 'jcs-json';
}

export interface SubmitTxResult {
  ok: boolean;
  txHash: string;
  status: 'accepted' | 'pending' | 'rejected' | 'unknown';
  reason?: string;
  raw?: Record<string, JsonValue>;
}

export interface RwadAccount {
  address: string;
  balance: number;
  nonce: number;
  raw: Record<string, JsonValue>;
}

export interface MarketEvent {
  eventId: string;
  ts: number;
  txHash?: string;
  action: string;
  metadata: Record<string, JsonValue>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let idx = 0; idx < bytes.length; idx += 1) {
    binary += String.fromCharCode(bytes[idx]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let idx = 0; idx < binary.length; idx += 1) {
    output[idx] = binary.charCodeAt(idx);
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function normalizePkcs8(privateKeyPkcs8: string): string {
  const trimmed = privateKeyPkcs8.trim();
  if (trimmed.startsWith('pkcs8:')) {
    return trimmed.slice('pkcs8:'.length).trim();
  }
  return trimmed;
}

function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function normalizeBridgeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.trim();
  if (!message) {
    return 'bridge_call_failed';
  }
  if (message.includes('native_platform_required')) {
    return 'native_platform_required';
  }
  if (message.includes('bridge_method_unavailable')) {
    return 'bridge_method_unavailable';
  }
  return message;
}

async function importPrivateEd25519(privateKeyPkcs8: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(base64ToBytes(normalizePkcs8(privateKeyPkcs8))),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

function normalizeStatus(value: string): SubmitTxResult['status'] {
  const normalized = value.toLowerCase();
  if (normalized.includes('accept') || normalized === 'ok') return 'accepted';
  if (normalized.includes('pending')) return 'pending';
  if (normalized.includes('reject') || normalized.includes('fail')) return 'rejected';
  return 'unknown';
}

export async function submitTx(envelope: RwadTxEnvelope | string): Promise<SubmitTxResult> {
  try {
    const result = await libp2pService.rwadSubmitTx(
      typeof envelope === 'string' ? envelope : (envelope as unknown as Record<string, JsonValue>),
    );
    const nested = asRecord(result.result) ?? {};
    const txHash =
      asString(result.txHash) ||
      asString(result.tx_hash) ||
      asString(nested.txHash) ||
      asString(nested.tx_hash);
    const statusRaw =
      asString(result.status) ||
      asString(result.tx_status) ||
      asString(nested.status) ||
      asString(nested.tx_status) ||
      (result.ok === true ? 'accepted' : 'unknown');
    const reason = asString(result.reason) || asString(result.error) || asString(nested.reason);
    return {
      ok: Boolean(result.ok ?? txHash),
      txHash,
      status: normalizeStatus(statusRaw),
      reason: reason || undefined,
      raw: result,
    };
  } catch (error) {
    return {
      ok: false,
      txHash: '',
      status: 'unknown',
      reason: normalizeBridgeError(error),
    };
  }
}

export async function getAccount(address: string): Promise<RwadAccount> {
  const result = await libp2pService.rwadGetAccount(address);
  const root = asRecord(result.result) ?? result;
  const overview = asRecord(root.overview) ?? root;
  return {
    address: asString(overview.address) || address,
    balance: asNumber(overview.balance ?? overview.amount ?? 0),
    nonce: asNumber(overview.nonce ?? 0),
    raw: result,
  };
}

export async function getAssetBalance(assetId: string, owner: string): Promise<number> {
  const result = await libp2pService.rwadGetAssetBalance(assetId, owner);
  const root = asRecord(result.result) ?? result;
  return asNumber(root.balance ?? (asRecord(root.result) ?? {}).balance, 0);
}

export async function getEscrow(escrowId: string): Promise<Record<string, JsonValue>> {
  const result = await libp2pService.rwadGetEscrow(escrowId);
  return (asRecord(result.result) ?? result) as Record<string, JsonValue>;
}

export async function getTx(txHash: string): Promise<Record<string, JsonValue>> {
  const result = await libp2pService.rwadGetTx(txHash);
  return (asRecord(result.result) ?? result) as Record<string, JsonValue>;
}

export async function listMarketEvents(options: {
  limit?: number;
  cursor?: string;
  partyAddress?: string;
} = {}): Promise<{ items: MarketEvent[]; nextCursor: string; hasMore: boolean }> {
  const raw = await libp2pService.rwadListMarketEvents({
    limit: options.limit,
    cursor: options.cursor,
    partyAddress: options.partyAddress,
  });
  const result = asRecord(raw.result) ?? raw;

  const events =
    (Array.isArray(result.events) ? result.events : null) ??
    (Array.isArray(result.items) ? result.items : null) ??
    [];

  const items: MarketEvent[] = [];
  for (const row of events) {
    const entry = asRecord(row);
    if (!entry) {
      continue;
    }
    const metadata = asRecord(entry.metadata_json) ?? asRecord(entry.metadata) ?? {};
    items.push({
      eventId: asString(entry.event_id) || asString(entry.id),
      ts: asNumber(entry.timestamp_ms ?? entry.ts, Date.now()),
      txHash: asString(entry.tx_hash) || asString(entry.tx_id) || undefined,
      action: asString(entry.action),
      metadata: metadata as Record<string, JsonValue>,
    });
  }

  const page = asRecord(result.page) ?? {};
  const nextCursor =
    asString(result.next_cursor) ||
    asString(result.cursor) ||
    asString(page.next_cursor) ||
    asString(page.cursor);
  const hasMore = Boolean(result.has_more ?? result.hasMore ?? page.has_more ?? page.hasMore);
  return { items, nextCursor, hasMore };
}

export async function signTxEnvelope(input: {
  chainId: string;
  sender: string;
  privateKeyPkcs8: string;
  txType: string;
  payload: Record<string, JsonValue>;
  nonce: number;
  gasLimit?: number;
  gasPrice?: number;
  feePayer?: string;
  expiresAt?: number;
  encoding?: 'cbor' | 'jcs-json';
}): Promise<RwadTxEnvelope> {
  const envelope: Omit<RwadTxEnvelope, 'signature'> = {
    chain_id: input.chainId,
    sender: input.sender,
    nonce: input.nonce,
    gas_limit: input.gasLimit ?? 300000,
    gas_price: input.gasPrice ?? 1,
    fee_payer: input.feePayer ?? '',
    expires_at: input.expiresAt ?? Date.now() + 30 * 60 * 1000,
    tx_type: input.txType,
    payload: input.payload,
    encoding: input.encoding ?? 'cbor',
  };

  const signText = canonicalJson(envelope);
  const key = await importPrivateEd25519(input.privateKeyPkcs8);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, toArrayBuffer(stringToBytes(signText)));
  return {
    ...envelope,
    signature: bytesToBase64(new Uint8Array(signature)),
  };
}

export async function submitSignedTx(input: {
  chainId: string;
  sender: string;
  privateKeyPkcs8: string;
  txType: string;
  payload: Record<string, JsonValue>;
  gasLimit?: number;
  gasPrice?: number;
  feePayer?: string;
  expiresAt?: number;
  encoding?: 'cbor' | 'jcs-json';
}): Promise<SubmitTxResult> {
  const account = await getAccount(input.sender).catch(() => ({ nonce: 0 } as Pick<RwadAccount, 'nonce'>));
  const envelope = await signTxEnvelope({
    ...input,
    nonce: Math.max(0, account.nonce) + 1,
  });
  return submitTx(envelope);
}
