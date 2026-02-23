import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import {
  Wallet,
  MapPin,
  ChevronRight,
  Copy,
  Check,
  ArrowDownCircle,
  SendHorizontal,
  Globe,
  Plus,
  Menu,
  PencilLine,
  Trash2,
  CheckCircle2,
  ShieldAlert,
  X,
  Coins,
  Upload,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
  Star,
  Footprints,
  Car,
  Navigation,
  ArrowLeftRight,
  Server,
} from 'lucide-react';
import { useLocale } from '../i18n/LocaleContext';
import Sidebar from './Sidebar';
import { ethers } from 'ethers';
import { ensureRegionPolicy, getRegionPolicySync, subscribeRegionPolicy } from '../utils/region';
import { getFeatureFlag, setFeatureFlag } from '../utils/featureFlags';
import {
  getAlipayQr,
  getCreditCardEnabled,
  getSettlementWalletAddress,
  getWechatQr,
  setAlipayQr as storeAlipayQr,
  setCreditCardEnabled as storeCreditCardEnabled,
  setSettlementWalletAddress as storeSettlementWalletAddress,
  setWechatQr as storeWechatQr,
} from '../utils/paymentStore';
import { libp2pService } from '../libp2p/service';
import {
  clearLocalPublishedContents,
  getDistributedContentsByPeer,
  subscribeDistributedContents,
} from '../data/distributedContent';
import {
  type WalletEntry,
  type ChainType,
  type ChainBalance,
  loadWallets,
  saveWallets,
  deleteWallet as deleteWalletEntry,
  createEVMAndSolanaWallets,
  createRWADWallet,
  importEVMWallet,
  importSolanaWallet,
  createBTCWallet,
  importBTCWallet,
  importRWADWallet,
  fetchRWADBalance,
  fetchBalance,
  chainLabel,
  chainIcon,
  maskAddr,
} from '../utils/walletChains';
import { DEFAULT_MAKER_FUNDS_V2 } from '../domain/dex/marketConfig';

interface AddressRecord {
  id: string;
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  tag: string;
  isDefault: boolean;
}

interface AddressDraft {
  receiver: string;
  phone: string;
  region: string;
  detail: string;
  tag: string;
  isDefault: boolean;
}

type ParsedClipboardAddress = Pick<AddressDraft, 'receiver' | 'phone' | 'region' | 'detail'>;

interface LedgerEntry {
  id: string;
  type: 'points_recharge' | 'points_transfer' | 'rwad_recharge' | 'rwad_transfer' | 'domain_register' | 'domain_transfer';
  amount: number;
  target?: string;
  createdAt: number;
}

type WalletImportMethod = 'mnemonic' | 'privateKey';
type WalletAction = 'create' | 'import';

interface ImportedWalletMeta {
  address: string;
  method: WalletImportMethod;
  alias: string;
  importedAt: number;
}

interface AssetActionState {
  asset: 'points' | 'rwad';
  action: 'recharge' | 'transfer';
}

const STORAGE_KEYS = {
  points: 'profile_points_balance_v2',
  rwadLegacy: 'profile_rwad_balance_v2',
  rwadChainCache: 'profile_rwad_chain_balance_cache_v1',
  rwadChainCacheTs: 'profile_rwad_chain_balance_cache_ts_v1',
  rwadMigrationHintShown: 'profile_rwad_chain_migration_hint_v1',
  domain: 'profile_node_domain_v2',
  addresses: 'profile_addresses_v2',
  ledger: 'profile_asset_ledger_v2',
  walletMeta: 'profile_wallet_meta',
  errandEnabled: 'profile_errand_enabled',
  errandOriginRange: 'profile_errand_origin_range',
  errandDestRange: 'profile_errand_dest_range',
  errandOriginUnit: 'profile_errand_origin_unit',
  errandDestUnit: 'profile_errand_dest_unit',
  rideEnabled: 'profile_ride_enabled',
  rideFrom: 'profile_ride_from',
  rideTo: 'profile_ride_to',
  localPeerId: 'profile_local_peer_id_v1',
  vpnNodeEnabled: 'profile_vpn_node_enabled',
  vpnNodeFee: 'profile_vpn_node_fee',
  c2cMakerEnabled: 'profile_c2c_maker_enabled',
  c2cMakerFunds: 'profile_c2c_maker_funds',
} as const;

type MakerAssetCode = 'BTC' | 'USDC' | 'USDT' | 'XAU';

interface FundSetting {
  asset: MakerAssetCode;
  assetCode: MakerAssetCode;
  enabled: boolean;
  limit: string;
  baseSpreadBps: number;
  maxSpreadBps: number;
  marketPairs: string[];
}

interface C2CMakerFundsV2Payload {
  version: 2;
  funds: FundSetting[];
}

const defaultFunds: FundSetting[] = DEFAULT_MAKER_FUNDS_V2.map((item) => ({
  asset: item.assetCode,
  assetCode: item.assetCode,
  enabled: item.assetCode !== 'BTC',
  limit: String(item.dailyLimit),
  baseSpreadBps: item.baseSpreadBps,
  maxSpreadBps: item.maxSpreadBps,
  marketPairs: [...item.marketPairs],
}));

const emptyAddressDraft: AddressDraft = {
  receiver: '',
  phone: '',
  region: '',
  detail: '',
  tag: '',
  isDefault: false,
};


function readNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function sanitizeMakerAssetCode(value: unknown): MakerAssetCode | null {
  if (value === 'BTC' || value === 'USDC' || value === 'USDT' || value === 'XAU') {
    return value;
  }
  return null;
}

function normalizeFundSetting(raw: unknown): FundSetting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const assetCode = sanitizeMakerAssetCode(row.assetCode ?? row.asset);
  if (!assetCode) {
    return null;
  }
  const fallback = defaultFunds.find((item) => item.assetCode === assetCode);
  const limit = String(row.limit ?? fallback?.limit ?? '0');
  const baseSpread = Number(row.baseSpreadBps ?? fallback?.baseSpreadBps ?? 0);
  const maxSpread = Number(row.maxSpreadBps ?? fallback?.maxSpreadBps ?? 0);
  const marketPairs = Array.isArray(row.marketPairs)
    ? row.marketPairs.filter((item): item is string => typeof item === 'string')
    : [...(fallback?.marketPairs ?? [])];

  return {
    asset: assetCode,
    assetCode,
    enabled: Boolean(row.enabled),
    limit,
    baseSpreadBps: Number.isFinite(baseSpread) ? baseSpread : fallback?.baseSpreadBps ?? 0,
    maxSpreadBps: Number.isFinite(maxSpread) ? maxSpread : fallback?.maxSpreadBps ?? 0,
    marketPairs,
  };
}

function toMakerFundsV2Payload(rows: FundSetting[]): C2CMakerFundsV2Payload {
  return {
    version: 2,
    funds: rows.map((item) => ({
      ...item,
      asset: item.assetCode,
    })),
  };
}

function mergeWithDefaultFunds(rows: FundSetting[]): FundSetting[] {
  const map = new Map(rows.map((item) => [item.assetCode, item]));
  return defaultFunds.map((item) => ({
    ...item,
    ...(map.get(item.assetCode) ?? {}),
    asset: item.assetCode,
    assetCode: item.assetCode,
  }));
}

function readC2CMakerFundsV2(storageKey: string): FundSetting[] {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return defaultFunds;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const payload = parsed as Partial<C2CMakerFundsV2Payload>;
      if (payload.version === 2 && Array.isArray(payload.funds)) {
        const rows = payload.funds.map(normalizeFundSetting).filter((item): item is FundSetting => Boolean(item));
        if (rows.length > 0) {
          return mergeWithDefaultFunds(rows);
        }
      }
    }
    if (Array.isArray(parsed)) {
      // Legacy v1 array migration.
      const migrated = mergeWithDefaultFunds(
        parsed.map(normalizeFundSetting).filter((item): item is FundSetting => Boolean(item)),
      );
      localStorage.setItem(storageKey, JSON.stringify(toMakerFundsV2Payload(migrated)));
      return migrated;
    }
  } catch {
    return defaultFunds;
  }
  return defaultFunds;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeChinaPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const withoutCountryCode = digits.startsWith('86') ? digits.slice(2) : digits;
  if (/^1\d{10}$/.test(withoutCountryCode)) {
    return withoutCountryCode;
  }
  return value.trim();
}

function parseJdClipboardAddress(raw: string): ParsedClipboardAddress | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const parsed: Partial<ParsedClipboardAddress> = {};

  for (const line of lines) {
    const match = line.match(/^([^:：]{1,30})\s*[：:]\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!value) continue;

    if (/收货人|收件人|联系人/.test(key)) {
      parsed.receiver = value;
      continue;
    }
    if (/手机号|手机号码|联系电话|电话/.test(key)) {
      parsed.phone = normalizeChinaPhone(value);
      continue;
    }
    if (/所在地区|地区/.test(key)) {
      parsed.region = value;
      continue;
    }
    if (/详细地址|地址详情|地址/.test(key)) {
      parsed.detail = value;
      continue;
    }
  }

  if (parsed.receiver && parsed.phone && parsed.region && parsed.detail) {
    return {
      receiver: parsed.receiver,
      phone: parsed.phone,
      region: parsed.region,
      detail: parsed.detail,
    };
  }

  return null;
}

function formatShortTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatImportTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const maskAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

function normalizeWalletInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function deriveAddressFromImport(method: WalletImportMethod, rawInput: string, mnemonicPath: string, mnemonicPassword: string): string {
  const normalizedInput = normalizeWalletInput(rawInput);
  if (!normalizedInput) {
    throw new Error('请输入助记词或私钥');
  }

  if (method === 'mnemonic') {
    if (!ethers.Mnemonic.isValidMnemonic(normalizedInput)) {
      throw new Error('助记词格式不正确');
    }
    const path = mnemonicPath.trim() || "m/44'/60'/0'/0/0";
    const wallet = ethers.HDNodeWallet.fromPhrase(normalizedInput, mnemonicPassword, path);
    return wallet.address;
  }

  const formattedKey = normalizedInput.startsWith('0x') ? normalizedInput : `0x${normalizedInput}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(formattedKey)) {
    throw new Error('私钥格式不正确');
  }
  return new ethers.Wallet(formattedKey).address;
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.unimaker$/, '');
}

function domainIsValid(raw: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(raw);
}

function amountIsValid(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Number(value.toFixed(6));
}

function normalizePeerId(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (/stub/i.test(value)) return '';
  return value;
}

export default function ProfilePage({ onNavigate, onOpenApp, ...rest }: { onNavigate?: (page: string) => void; onOpenApp?: (appId: string) => void;[key: string]: unknown }) {
  const { t } = useLocale();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [regionPolicy, setRegionPolicy] = useState(() => getRegionPolicySync());
  const isDomestic = regionPolicy.isDomestic;
  const [peerId, setPeerId] = useState(() => normalizePeerId(localStorage.getItem(STORAGE_KEYS.localPeerId) ?? ''));
  const [publishedContentCount, setPublishedContentCount] = useState(0);
  const [clearingPublished, setClearingPublished] = useState(false);
  const [publishedClearHint, setPublishedClearHint] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeRegionPolicy(setRegionPolicy);
    void ensureRegionPolicy().then(setRegionPolicy);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let fetching = false;
    const fetchPeerId = async () => {
      if (cancelled || fetching) return;
      fetching = true;
      try {
        const identity = normalizePeerId(await libp2pService.ensurePeerIdentity().catch(() => ''));
        if (libp2pService.isNativePlatform()) {
          await libp2pService.ensureStarted().catch(() => false);
        }
        const direct = normalizePeerId(await libp2pService.getLocalPeerId());
        const health = await libp2pService.runtimeHealth().catch(() => ({
          nativeReady: false,
          started: false,
          peerId: '',
          lastError: '',
        }));
        const healthPeerId = normalizePeerId(health.peerId ?? '');
        const cachedPeerId = normalizePeerId(localStorage.getItem(STORAGE_KEYS.localPeerId) ?? '');
        const id = direct || identity || healthPeerId || cachedPeerId;
        if (!cancelled && id) {
          setPeerId((current) => (current === id ? current : id));
          localStorage.setItem(STORAGE_KEYS.localPeerId, id);
        }
      } catch { /* ignore */ }
      finally {
        fetching = false;
      }
    };
    void fetchPeerId();
    const timer = window.setInterval(() => {
      void fetchPeerId();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const normalizedPeer = peerId.trim();
    if (normalizedPeer.length === 0) {
      setPublishedContentCount(0);
      return;
    }
    const refreshCount = () => {
      setPublishedContentCount(getDistributedContentsByPeer(normalizedPeer).length);
    };
    refreshCount();
    const unsubscribe = subscribeDistributedContents(() => {
      refreshCount();
    });
    return () => {
      unsubscribe();
    };
  }, [peerId]);

  const [showAddresses, setShowAddresses] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [copiedPeerId, setCopiedPeerId] = useState(false);

  const [pointsBalance, setPointsBalance] = useState<number>(() => readNumber(STORAGE_KEYS.points, 0));
  const [rwadBalance, setRwadBalance] = useState<number>(() => readNumber(STORAGE_KEYS.rwadChainCache, 0));
  const [rwadSyncing, setRwadSyncing] = useState(false);
  const [rwadSyncHint, setRwadSyncHint] = useState('');
  const [showRwadMigrationHint, setShowRwadMigrationHint] = useState(false);
  const [domainName, setDomainName] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.domain) || '');
  const [domainInput, setDomainInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [domainTransferTarget, setDomainTransferTarget] = useState('');
  const [showDomainTransfer, setShowDomainTransfer] = useState(false);

  // VPN Node Settings
  const [vpnNodeEnabled, setVpnNodeEnabled] = useState<boolean>(() => localStorage.getItem(STORAGE_KEYS.vpnNodeEnabled) === 'true');
  const [vpnNodeFee, setVpnNodeFee] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.vpnNodeFee) || '0.1');

  // C2C Market Maker Settings
  const [c2cMakerEnabled, setC2cMakerEnabled] = useState<boolean>(() => localStorage.getItem(STORAGE_KEYS.c2cMakerEnabled) === 'true');
  const [distributedNodeEnabled, setDistributedNodeEnabled] = useState<boolean>(() => localStorage.getItem('profile_distributed_node_enabled') === 'true');
  const [limitCpu, setLimitCpu] = useState(() => Number(localStorage.getItem('profile_limit_cpu') || '4'));
  const [limitMemory, setLimitMemory] = useState(() => Number(localStorage.getItem('profile_limit_memory') || '8'));
  const [limitDisk, setLimitDisk] = useState(() => Number(localStorage.getItem('profile_limit_disk') || '100'));
  const [limitGpu, setLimitGpu] = useState(() => Number(localStorage.getItem('profile_limit_gpu') || '0'));

  // System prices (read-only defaults)
  const sysPriceCpu = 10;
  const sysPriceMemory = 5;
  const sysPriceDisk = 1;
  const sysPriceGpu = 50;
  const [c2cMakerFunds, setC2cMakerFunds] = useState<FundSetting[]>(() => {
    return readC2CMakerFundsV2(STORAGE_KEYS.c2cMakerFunds);
  });
  const [dexClobEnabled, setDexClobEnabled] = useState<boolean>(() => getFeatureFlag('dex_clob_v1', true));
  const [dexBridgeEnabled, setDexBridgeEnabled] = useState<boolean>(() => getFeatureFlag('dex_c2c_bridge_v1', true));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.c2cMakerFunds, JSON.stringify(toMakerFundsV2Payload(c2cMakerFunds)));
  }, [c2cMakerFunds]);

  useEffect(() => {
    localStorage.setItem('profile_distributed_node_enabled', String(distributedNodeEnabled));
  }, [distributedNodeEnabled]);

  useEffect(() => { localStorage.setItem('profile_limit_cpu', String(limitCpu)); }, [limitCpu]);
  useEffect(() => { localStorage.setItem('profile_limit_memory', String(limitMemory)); }, [limitMemory]);
  useEffect(() => { localStorage.setItem('profile_limit_disk', String(limitDisk)); }, [limitDisk]);
  useEffect(() => { localStorage.setItem('profile_limit_gpu', String(limitGpu)); }, [limitGpu]);

  const toggleVpnNode = useCallback((enabled: boolean) => {
    setVpnNodeEnabled(enabled);
    localStorage.setItem(STORAGE_KEYS.vpnNodeEnabled, String(enabled));
  }, []);

  const saveVpnNodeFee = useCallback((fee: string) => {
    setVpnNodeFee(fee);
    localStorage.setItem(STORAGE_KEYS.vpnNodeFee, fee);
  }, []);

  const toggleC2cMaker = useCallback((enabled: boolean) => {
    setC2cMakerEnabled(enabled);
    localStorage.setItem(STORAGE_KEYS.c2cMakerEnabled, String(enabled));
  }, []);

  const updateFundSetting = useCallback((index: number, field: keyof FundSetting, value: any) => {
    setC2cMakerFunds((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      localStorage.setItem(STORAGE_KEYS.c2cMakerFunds, JSON.stringify(toMakerFundsV2Payload(next)));
      return next;
    });
  }, []);

  const toggleFeature = useCallback((name: 'dex_clob_v1' | 'dex_c2c_bridge_v1', enabled: boolean) => {
    setFeatureFlag(name, enabled);
    if (name === 'dex_clob_v1') {
      setDexClobEnabled(enabled);
    } else {
      setDexBridgeEnabled(enabled);
    }
  }, []);

  const [assetActionState, setAssetActionState] = useState<AssetActionState | null>(null);
  const [assetAmountInput, setAssetAmountInput] = useState('');
  const [assetTargetInput, setAssetTargetInput] = useState('');
  const [assetActionError, setAssetActionError] = useState('');

  const [addresses, setAddresses] = useState<AddressRecord[]>(() => readJson<AddressRecord[]>(STORAGE_KEYS.addresses, []));
  const [showAddressEditor, setShowAddressEditor] = useState(false);
  const [showClipboard, setShowClipboard] = useState(false);
  const [clipboardText, setClipboardText] = useState('');
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(emptyAddressDraft);
  const [addressError, setAddressError] = useState('');

  const [ledger, setLedger] = useState<LedgerEntry[]>(() => readJson<LedgerEntry[]>(STORAGE_KEYS.ledger, []));
  const [showTransactions, setShowTransactions] = useState(false);
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState<LedgerEntry | null>(null);

  const [walletImportMethod, setWalletImportMethod] = useState<WalletImportMethod>('mnemonic');
  const [walletInput, setWalletInput] = useState('');
  const [walletAlias, setWalletAlias] = useState(t.profile_myWallet);
  const [mnemonicPath, setMnemonicPath] = useState("m/44'/60'/0'/0/0");
  const [mnemonicPassword, setMnemonicPassword] = useState('');
  const [walletPreviewAddress, setWalletPreviewAddress] = useState('');
  const [walletError, setWalletError] = useState('');
  const [walletSuccess, setWalletSuccess] = useState('');
  const [walletRiskAccepted, setWalletRiskAccepted] = useState(false);
  const [walletMeta, setWalletMeta] = useState<ImportedWalletMeta | null>(() => readJson<ImportedWalletMeta | null>(STORAGE_KEYS.walletMeta, null));

  // Multi-chain wallet state
  const [wallets, setWallets] = useState<WalletEntry[]>(() => loadWallets());
  const [walletAction, setWalletAction] = useState<WalletAction>('create');
  const [walletChain, setWalletChain] = useState<ChainType>('evm');
  const [walletBalances, setWalletBalances] = useState<Record<string, ChainBalance>>({});
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletExportId, setWalletExportId] = useState<string | null>(null);
  const [walletShowSecret, setWalletShowSecret] = useState(false);
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [tosCheck1, setTosCheck1] = useState(false);
  const [tosCheck2, setTosCheck2] = useState(false);
  const [tosCheck3, setTosCheck3] = useState(false);
  const allTosAccepted = tosCheck1 && tosCheck2 && tosCheck3;
  const resetTos = () => { setTosCheck1(false); setTosCheck2(false); setTosCheck3(false); };
  const settlementWallets = wallets.filter((wallet) => wallet.chain === 'rwad' || wallet.chain === 'evm');

  // Payment QR state
  const [wechatQr, setWechatQr] = useState<string | null>(() => getWechatQr());
  const [alipayQr, setAlipayQr] = useState<string | null>(() => getAlipayQr());
  const [creditCardEnabled, setCreditCardEnabled] = useState<boolean>(() => getCreditCardEnabled());
  const [settlementWalletAddress, setSettlementWalletAddress] = useState<string>(() => getSettlementWalletAddress());
  const wechatQrInputRef = useRef<HTMLInputElement>(null);
  const alipayQrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storeCreditCardEnabled(creditCardEnabled);
  }, [creditCardEnabled]);

  useEffect(() => {
    storeSettlementWalletAddress(settlementWalletAddress);
  }, [settlementWalletAddress]);

  // Errand & Rideshare state — values stored in meters
  // Migration: old values were stored as km (e.g. "3"), new values are meters (e.g. "3000")
  const migrateToMeters = (raw: string | null, fallbackMeters: number): number => {
    if (!raw) return fallbackMeters;
    const n = Number(raw);
    if (isNaN(n) || n <= 0) return fallbackMeters;
    // Old format: small numbers (≤100) are km values; new format: >100 are meters
    return n <= 100 ? n * 1000 : n;
  };
  const [errandEnabled, setErrandEnabled] = useState(() => localStorage.getItem(STORAGE_KEYS.errandEnabled) === 'true');
  const [errandOriginMeters, setErrandOriginMeters] = useState(() => migrateToMeters(localStorage.getItem(STORAGE_KEYS.errandOriginRange), 3000));
  const [errandDestMeters, setErrandDestMeters] = useState(() => migrateToMeters(localStorage.getItem(STORAGE_KEYS.errandDestRange), 5000));
  const [errandOriginUnit, setErrandOriginUnit] = useState<'km' | 'm'>(() => (localStorage.getItem(STORAGE_KEYS.errandOriginUnit) as 'km' | 'm') || 'km');
  const [errandDestUnit, setErrandDestUnit] = useState<'km' | 'm'>(() => (localStorage.getItem(STORAGE_KEYS.errandDestUnit) as 'km' | 'm') || 'km');
  const [rideEnabled, setRideEnabled] = useState(() => localStorage.getItem(STORAGE_KEYS.rideEnabled) === 'true');
  const [rideFrom, setRideFrom] = useState(() => localStorage.getItem(STORAGE_KEYS.rideFrom) || '');
  const [rideTo, setRideTo] = useState(() => localStorage.getItem(STORAGE_KEYS.rideTo) || '');

  const toggleErrand = (v: boolean) => { setErrandEnabled(v); localStorage.setItem(STORAGE_KEYS.errandEnabled, String(v)); };
  const toggleRide = (v: boolean) => { setRideEnabled(v); localStorage.setItem(STORAGE_KEYS.rideEnabled, String(v)); };
  const saveErrandOriginM = (m: number) => { setErrandOriginMeters(m); localStorage.setItem(STORAGE_KEYS.errandOriginRange, String(m)); };
  const saveErrandDestM = (m: number) => { setErrandDestMeters(m); localStorage.setItem(STORAGE_KEYS.errandDestRange, String(m)); };
  const saveRideFrom = (v: string) => { setRideFrom(v); localStorage.setItem(STORAGE_KEYS.rideFrom, v); };
  const saveRideTo = (v: string) => { setRideTo(v); localStorage.setItem(STORAGE_KEYS.rideTo, v); };

  useEffect(() => {
    const alreadyHinted = localStorage.getItem(STORAGE_KEYS.rwadMigrationHintShown) === '1';
    const legacyBalance = localStorage.getItem(STORAGE_KEYS.rwadLegacy);
    if (!alreadyHinted && legacyBalance !== null) {
      setShowRwadMigrationHint(true);
      localStorage.setItem(STORAGE_KEYS.rwadMigrationHintShown, '1');
    }
    if (legacyBalance !== null) {
      localStorage.removeItem(STORAGE_KEYS.rwadLegacy);
    }
  }, []);

  const refreshRwadBalance = useCallback(async () => {
    const rwadWallet = wallets.find((item) => item.chain === 'rwad');
    if (!rwadWallet) {
      setRwadBalance(0);
      setRwadSyncHint(t.profile_rwadWalletNotFound);
      return;
    }

    setRwadSyncing(true);
    setRwadSyncHint('');
    try {
      const balance = await fetchRWADBalance(rwadWallet.address);
      const next = Math.max(0, Number(balance.raw.toFixed(6)));
      setRwadBalance(next);
      localStorage.setItem(STORAGE_KEYS.rwadChainCache, String(next));
      localStorage.setItem(STORAGE_KEYS.rwadChainCacheTs, String(Date.now()));
    } catch {
      setRwadSyncHint(t.profile_rwadChainRefreshFailed);
    } finally {
      setRwadSyncing(false);
    }
  }, [wallets]);

  // Independent unit toggles
  const toggleOriginUnit = () => {
    const next = errandOriginUnit === 'km' ? 'm' : 'km';
    setErrandOriginUnit(next);
    localStorage.setItem(STORAGE_KEYS.errandOriginUnit, next);
  };
  const toggleDestUnit = () => {
    const next = errandDestUnit === 'km' ? 'm' : 'km';
    setErrandDestUnit(next);
    localStorage.setItem(STORAGE_KEYS.errandDestUnit, next);
  };

  // Display helpers — per-slider unit conversion
  const originToDisplay = (meters: number) => errandOriginUnit === 'km' ? meters / 1000 : meters;
  const originFromDisplay = (display: number) => errandOriginUnit === 'km' ? display * 1000 : display;
  const destToDisplay = (meters: number) => errandDestUnit === 'km' ? meters / 1000 : meters;
  const destFromDisplay = (display: number) => errandDestUnit === 'km' ? display * 1000 : display;
  const originSliderMin = errandOriginUnit === 'km' ? 1 : 100;
  const originSliderMax = errandOriginUnit === 'km' ? 20 : 20000;
  const originSliderStep = errandOriginUnit === 'km' ? 1 : 100;
  const destSliderMin = errandDestUnit === 'km' ? 1 : 100;
  const destSliderMax = errandDestUnit === 'km' ? 30 : 30000;
  const destSliderStep = errandDestUnit === 'km' ? 1 : 100;

  // Editable input state for origin/dest (string to allow typing)
  const [originInput, setOriginInput] = useState(() => String(originToDisplay(errandOriginMeters)));
  const [destInput, setDestInput] = useState(() => String(destToDisplay(errandDestMeters)));
  // Sync inputs when individual units toggle
  useEffect(() => {
    setOriginInput(String(originToDisplay(errandOriginMeters)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errandOriginUnit]);
  useEffect(() => {
    setDestInput(String(destToDisplay(errandDestMeters)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errandDestUnit]);

  const handlePaymentQrUpload = (type: 'wechat' | 'alipay', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      if (type === 'wechat') {
        setWechatQr(url);
        storeWechatQr(url);
      } else {
        setAlipayQr(url);
        storeAlipayQr(url);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePaymentQr = (type: 'wechat' | 'alipay') => {
    if (type === 'wechat') {
      setWechatQr(null);
      storeWechatQr(null);
    } else {
      setAlipayQr(null);
      storeAlipayQr(null);
    }
  };

  const persistPoints = (value: number) => {
    const next = Math.max(0, Number(value.toFixed(6)));
    setPointsBalance(next);
    localStorage.setItem(STORAGE_KEYS.points, String(next));
  };

  const persistDomain = (value: string) => {
    setDomainName(value);
    if (value) {
      localStorage.setItem(STORAGE_KEYS.domain, value);
    } else {
      localStorage.removeItem(STORAGE_KEYS.domain);
    }
  };

  const persistAddresses = (next: AddressRecord[]) => {
    setAddresses(next);
    writeJson(STORAGE_KEYS.addresses, next);
  };

  const appendLedger = (entry: LedgerEntry) => {
    setLedger((prev) => {
      const next = [entry, ...prev].slice(0, 50);
      writeJson(STORAGE_KEYS.ledger, next);
      return next;
    });
  };

  const handleCopyPeerId = () => {
    navigator.clipboard.writeText(peerId);
    setCopiedPeerId(true);
    window.setTimeout(() => setCopiedPeerId(false), 2000);
  };

  const handleClearPublishedContents = useCallback(() => {
    if (clearingPublished) return;
    const confirmed = window.confirm('确认清空本机已发布内容？该操作将清除当前设备上的发布列表。');
    if (!confirmed) return;
    setClearingPublished(true);
    setPublishedClearHint('');
    void (async () => {
      try {
        const result = await clearLocalPublishedContents();
        setPublishedClearHint(`已清空 ${result.removed} 条本机发布内容`);
      } catch (error) {
        setPublishedClearHint(error instanceof Error ? error.message : `${error}`);
      } finally {
        setClearingPublished(false);
        window.setTimeout(() => setPublishedClearHint(''), 2200);
      }
    })();
  }, [clearingPublished]);

  const openAssetAction = (asset: 'points' | 'rwad', action: 'recharge' | 'transfer') => {
    setAssetActionState({ asset, action });
    setAssetAmountInput('');
    setAssetTargetInput('');
    setAssetActionError('');
  };

  const closeAssetAction = () => {
    setAssetActionState(null);
    setAssetAmountInput('');
    setAssetTargetInput('');
    setAssetActionError('');
  };

  const handleAssetActionSubmit = () => {
    if (!assetActionState) return;

    const amount = amountIsValid(assetAmountInput);
    if (amount === null) {
      setAssetActionError(t.profile_errInvalidAmount);
      return;
    }

    if (assetActionState.action === 'recharge') {
      if (assetActionState.asset === 'points' && !isDomestic) {
        setAssetActionError(t.profile_errOverseasRwadOnly);
        return;
      }
      if (assetActionState.asset === 'rwad') {
        setAssetActionError(t.profile_rwadChainRechargeBlocked);
        return;
      }

      if (assetActionState.asset === 'points') {
        persistPoints(pointsBalance + amount);
      }

      appendLedger({
        id: createId('ledger'),
        type: assetActionState.asset === 'points' ? 'points_recharge' : 'rwad_recharge',
        amount,
        createdAt: Date.now(),
      });

      closeAssetAction();
      return;
    }

    const target = assetTargetInput.trim();
    if (target.length < 6) {
      setAssetActionError(t.profile_errInvalidTarget);
      return;
    }

    if (assetActionState.asset === 'points') {
      if (pointsBalance < amount) {
        setAssetActionError(t.profile_errInsufficientPoints);
        return;
      }
      persistPoints(pointsBalance - amount);
    } else {
      setAssetActionError(t.profile_rwadChainTransferBlocked);
      return;
    }

    appendLedger({
      id: createId('ledger'),
      type: assetActionState.asset === 'points' ? 'points_transfer' : 'rwad_transfer',
      amount,
      target,
      createdAt: Date.now(),
    });

    closeAssetAction();
  };

  const handleRegisterDomain = () => {
    setDomainError('');
    if (domainName) return;

    const normalized = normalizeDomain(domainInput);
    if (!normalized) {
      setDomainError(t.profile_errDomainEmpty);
      return;
    }
    if (!domainIsValid(normalized)) {
      setDomainError(t.profile_errDomainFormat);
      return;
    }

    if (isDomestic) {
      if (pointsBalance < 1) {
        setDomainError(t.profile_errDomainPointsCost);
        return;
      }
      persistPoints(pointsBalance - 1);
    } else {
      if (rwadBalance < 1) {
        setDomainError(t.profile_errDomainRwadCost);
        return;
      }
      setDomainError(t.profile_rwadChainDomainBlocked);
      return;
    }

    persistDomain(normalized);
    setDomainInput('');

    appendLedger({
      id: createId('ledger'),
      type: 'domain_register',
      amount: 1,
      createdAt: Date.now(),
    });
  };

  const handleTransferDomain = () => {
    const target = domainTransferTarget.trim();
    if (!target || target.length < 6) {
      setDomainError(t.profile_errInvalidTarget);
      return;
    }

    appendLedger({
      id: createId('ledger'),
      type: 'domain_transfer',
      amount: 0,
      target,
      createdAt: Date.now(),
    });

    persistDomain('');
    setDomainTransferTarget('');
    setShowDomainTransfer(false);
    setDomainError('');
  };

  const openNewAddress = () => {
    setEditingAddressId(null);
    setAddressDraft({ ...emptyAddressDraft, isDefault: addresses.length === 0 });
    setAddressError('');
    setShowAddressEditor(true);
  };

  const openEditAddress = (address: AddressRecord) => {
    setEditingAddressId(address.id);
    setAddressDraft({
      receiver: address.receiver,
      phone: address.phone,
      region: address.region,
      detail: address.detail,
      tag: address.tag,
      isDefault: address.isDefault,
    });
    setAddressError('');
    setShowAddressEditor(true);
  };

  const ensureSingleDefault = (rows: AddressRecord[]): AddressRecord[] => {
    if (rows.length === 0) return rows;
    if (rows.some((row) => row.isDefault)) return rows;
    return rows.map((row, index) => ({ ...row, isDefault: index === 0 }));
  };

  const handleSaveAddress = () => {
    if (!addressDraft.receiver.trim() || !addressDraft.phone.trim() || !addressDraft.region.trim() || !addressDraft.detail.trim()) {
      setAddressError(t.profile_errAddressIncomplete);
      return;
    }

    const baseRows = editingAddressId
      ? addresses.map((row) => row.id === editingAddressId
        ? {
          ...row,
          receiver: addressDraft.receiver.trim(),
          phone: addressDraft.phone.trim(),
          region: addressDraft.region.trim(),
          detail: addressDraft.detail.trim(),
          tag: addressDraft.tag.trim(),
          isDefault: addressDraft.isDefault,
        }
        : row)
      : [
        ...addresses,
        {
          id: createId('addr'),
          receiver: addressDraft.receiver.trim(),
          phone: addressDraft.phone.trim(),
          region: addressDraft.region.trim(),
          detail: addressDraft.detail.trim(),
          tag: addressDraft.tag.trim(),
          isDefault: addressDraft.isDefault,
        },
      ];

    const withDefault = addressDraft.isDefault
      ? baseRows.map((row) => ({ ...row, isDefault: editingAddressId ? row.id === editingAddressId : row.id === baseRows[baseRows.length - 1].id }))
      : ensureSingleDefault(baseRows);

    persistAddresses(withDefault);
    setShowAddressEditor(false);
    setEditingAddressId(null);
    setAddressDraft(emptyAddressDraft);
    setAddressError('');
  };

  const handleSetDefaultAddress = (id: string) => {
    persistAddresses(addresses.map((row) => ({ ...row, isDefault: row.id === id })));
  };

  const handleDeleteAddress = (id: string) => {
    const filtered = addresses.filter((row) => row.id !== id);
    persistAddresses(ensureSingleDefault(filtered));
  };

  const resetWalletDraft = () => {
    setWalletInput('');
    setWalletPreviewAddress('');
    setWalletError('');
    setWalletSuccess('');
    setMnemonicPassword('');
    setWalletRiskAccepted(false);
  };

  const handleCloseWallet = () => {
    setShowWallet(false);
    resetWalletDraft();
  };

  const handlePreviewWallet = () => {
    setWalletError('');
    setWalletSuccess('');
    try {
      const address = deriveAddressFromImport(walletImportMethod, walletInput, mnemonicPath, mnemonicPassword);
      setWalletPreviewAddress(address);
    } catch (error) {
      setWalletPreviewAddress('');
      setWalletError(error instanceof Error ? error.message : t.profile_errImportInvalid);
    }
  };

  const handleConfirmImport = () => {
    setWalletError('');
    setWalletSuccess('');

    if (!walletPreviewAddress) {
      setWalletError(t.profile_errVerifyFirst);
      return;
    }
    if (!walletRiskAccepted) {
      setWalletError(t.profile_errAcceptRisk);
      return;
    }

    const payload: ImportedWalletMeta = {
      address: walletPreviewAddress,
      method: walletImportMethod,
      alias: walletAlias.trim() || t.profile_myWallet,
      importedAt: Date.now(),
    };

    writeJson(STORAGE_KEYS.walletMeta, payload);
    localStorage.setItem('user_wallet_address', payload.address);

    setWalletMeta(payload);
    setWalletSuccess(t.profile_walletImportSuccess);
    setWalletInput('');
    setMnemonicPassword('');
    setWalletRiskAccepted(false);
  };

  // ---- Multi-chain wallet handlers ----
  const refreshAllBalances = useCallback(async () => {
    setWalletBalanceLoading(true);
    const balances: Record<string, ChainBalance> = {};
    await Promise.all(wallets.map(async (w) => {
      balances[w.id] = await fetchBalance(w);
    }));
    setWalletBalances(balances);
    setWalletBalanceLoading(false);
  }, [wallets]);

  useEffect(() => {
    if (wallets.length > 0) {
      void refreshAllBalances();
    }
  }, [wallets.length, refreshAllBalances]);

  useEffect(() => {
    if (!isDomestic) {
      void refreshRwadBalance();
    }
  }, [isDomestic, refreshRwadBalance, wallets.length]);

  useEffect(() => {
    if (isDomestic || settlementWalletAddress.trim().length > 0 || settlementWallets.length === 0) {
      return;
    }
    const preferred = settlementWallets.find((wallet) => wallet.chain === 'rwad') ?? settlementWallets[0];
    setSettlementWalletAddress(preferred.address);
  }, [settlementWalletAddress, settlementWallets, isDomestic]);

  const createEVMSolana = async () => {
    setWalletCreating(true);
    setWalletError('');
    try {
      await createEVMAndSolanaWallets();
      setWallets(loadWallets());
      setWalletSuccess(t.profile_evmSolanaSuccess);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : t.profile_errCreateFailed);
    }
    setWalletCreating(false);
  };

  const createBTC = async () => {
    setWalletCreating(true);
    setWalletError('');
    try {
      await createBTCWallet();
      setWallets(loadWallets());
      setWalletSuccess(t.profile_btcSuccess);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : t.profile_errCreateFailed);
    }
    setWalletCreating(false);
  };

  const createRWAD = async () => {
    setWalletCreating(true);
    setWalletError('');
    try {
      await createRWADWallet();
      setWallets(loadWallets());
      setWalletSuccess(t.profile_rwadWalletCreated);
      if (!isDomestic) {
        await refreshRwadBalance();
      }
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : t.profile_errCreateFailed);
    }
    setWalletCreating(false);
  };

  const importWalletForChain = async (chain: ChainType, input: string, alias: string) => {
    setWalletCreating(true);
    setWalletError('');
    try {
      switch (chain) {
        case 'evm': await importEVMWallet(input, alias); break;
        case 'solana': await importSolanaWallet(input, alias); break;
        case 'btc': await importBTCWallet(input, alias); break;
        case 'rwad': await importRWADWallet(input, alias); break;
      }
      setWallets(loadWallets());
      setWalletInput('');
      setWalletSuccess(`${chainLabel(chain)} ${t.profile_chainImportSuccess}`);
      if (!isDomestic && chain === 'rwad') {
        await refreshRwadBalance();
      }
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : t.profile_errImportFailed);
    }
    setWalletCreating(false);
  };

  const handleDeleteWallet = async (id: string) => {
    const deleting = wallets.find((item) => item.id === id);
    try {
      const updated = await deleteWalletEntry(id);
      setWallets(updated);
      const newBalances = { ...walletBalances };
      delete newBalances[id];
      setWalletBalances(newBalances);
      if (walletExportId === id) setWalletExportId(null);
      if (!isDomestic && deleting?.chain === 'rwad') {
        await refreshRwadBalance();
      }
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : t.profile_errImportFailed);
    }
  };

  return (
    <>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onNavigate={onNavigate} onOpenApp={onOpenApp} />
      <div className="h-full overflow-y-auto bg-gray-50 pb-24">
        <header className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-gray-100 rounded-full transition-colors" aria-label="展开侧边栏">
              <Menu size={22} />
            </button>
            <div className="text-xs text-gray-500">{isDomestic ? t.profile_domesticNode : t.profile_overseasNode}</div>
          </div>
          <button
            onClick={() => setShowAddresses(true)}
            className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1"
          >
            <MapPin size={16} />
            <span>{t.profile_addressManagement}</span>
          </button>
        </header>

        <div className="p-3 space-y-3">
          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{t.profile_nodePeerId}</span>
                <button
                  onClick={handleCopyPeerId}
                  className="flex items-center gap-1 text-xs text-purple-600"
                >
                  {copiedPeerId ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedPeerId ? t.profile_copied : t.profile_copy}</span>
                </button>
              </div>
              <div className="font-mono text-[11px] text-gray-900 break-all mt-1">{peerId || t.profile_locating}</div>
            </div>

            {!isDomestic && (
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-800">RWAD</span>
                  </div>
                  <span className="text-lg font-semibold text-purple-600">{rwadBalance.toFixed(0)}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => { void refreshRwadBalance(); }}
                    disabled={rwadSyncing}
                    className="flex-1 py-2 rounded-lg text-sm font-medium border bg-purple-600 text-white border-purple-600"
                  >
                    {rwadSyncing ? t.profile_loading : t.profile_refreshChainBalance}
                  </button>
                  <button
                    onClick={() => setShowWallet(true)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium border border-purple-200 text-purple-700 bg-purple-50"
                  >
                    {t.profile_web3Wallet}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">{t.profile_overseasRwadNote}</p>
                {rwadSyncHint && <p className="text-[11px] text-gray-500 mt-1">{rwadSyncHint}</p>}
                {showRwadMigrationHint && (
                  <p className="text-[11px] text-orange-600 mt-1">{t.profile_rwadMigrationHint}</p>
                )}
              </div>
            )}

            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-800">{t.profile_points}</span>
                </div>
                <span className="text-lg font-semibold text-purple-600">{pointsBalance.toFixed(0)}</span>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => openAssetAction('points', 'recharge')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border ${isDomestic ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100 text-gray-400 border-gray-200'}`}
                >
                  {t.profile_recharge}
                </button>
                <button
                  onClick={() => openAssetAction('points', 'transfer')}
                  className="flex-1 py-2 rounded-lg text-sm font-medium border border-purple-200 text-purple-700 bg-purple-50"
                >
                  {t.profile_transfer}
                </button>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="mb-2">
                <span className="text-sm font-medium text-gray-800">{t.profile_domainLabel}</span>
              </div>

              {domainName ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-lg bg-purple-50 border border-purple-100 px-3 py-2 text-sm text-purple-900 break-all truncate">
                    {domainName}
                  </div>
                  <button
                    onClick={() => setShowDomainTransfer(true)}
                    className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border border-purple-200 text-purple-700 bg-purple-50"
                  >
                    {t.profile_transferDomain}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={domainInput}
                    onChange={(event) => {
                      setDomainInput(event.target.value);
                      setDomainError('');
                    }}
                    placeholder={t.profile_domainInputPlaceholder}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    onClick={handleRegisterDomain}
                    className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700"
                  >
                    注册
                  </button>
                </div>
              )}

              {domainError && (
                <div className="text-xs text-red-600 mt-2">{domainError}</div>
              )}
            </div>
          </section>

          {/* 收款设置 */}
          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900 mb-1">收款设置</div>
                  <div className="text-xs text-gray-500">
                    当前策略：{isDomestic ? '国内IP（微信/支付宝）' : '境外IP（信用卡/Web3 钱包）'}
                  </div>
                </div>
                <button
                  onClick={() => { void ensureRegionPolicy(true).then(setRegionPolicy); }}
                  className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  刷新IP
                </button>
              </div>

              {isDomestic ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-2">微信收款码</div>
                    <input
                      type="file"
                      ref={wechatQrInputRef}
                      onChange={(e) => handlePaymentQrUpload('wechat', e)}
                      accept="image/*"
                      className="hidden"
                    />
                    {wechatQr ? (
                      <div className="relative w-full aspect-square bg-white rounded-lg overflow-hidden border border-gray-200">
                        <img src={wechatQr} alt="微信收款码" className="w-full h-full object-cover" />
                        <button
                          onClick={() => handleRemovePaymentQr('wechat')}
                          className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 rounded-full flex items-center justify-center"
                        >
                          <X size={14} className="text-white" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => wechatQrInputRef.current?.click()}
                        className="w-full aspect-square border-2 border-dashed border-green-300 rounded-lg flex flex-col items-center justify-center text-green-500 hover:bg-green-50 transition-colors"
                      >
                        <Upload size={24} />
                        <span className="text-xs mt-2">上传微信</span>
                      </button>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-2">支付宝收款码</div>
                    <input
                      type="file"
                      ref={alipayQrInputRef}
                      onChange={(e) => handlePaymentQrUpload('alipay', e)}
                      accept="image/*"
                      className="hidden"
                    />
                    {alipayQr ? (
                      <div className="relative w-full aspect-square bg-white rounded-lg overflow-hidden border border-gray-200">
                        <img src={alipayQr} alt="支付宝收款码" className="w-full h-full object-cover" />
                        <button
                          onClick={() => handleRemovePaymentQr('alipay')}
                          className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 rounded-full flex items-center justify-center"
                        >
                          <X size={14} className="text-white" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => alipayQrInputRef.current?.click()}
                        className="w-full aspect-square border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors"
                      >
                        <Upload size={24} />
                        <span className="text-xs mt-2">上传支付宝</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-800">信用卡收款</div>
                      <div className="text-xs text-gray-500">开启后，境外买家可走信用卡并提交凭证核验</div>
                    </div>
                    <button
                      onClick={() => setCreditCardEnabled(!creditCardEnabled)}
                      className={`w-12 h-6 rounded-full transition-colors ${creditCardEnabled ? 'bg-purple-500' : 'bg-gray-300'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${creditCardEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">收款 Web3 钱包</span>
                      {settlementWallets.length > 0 && (
                        <button
                          onClick={() => {
                            const preferred = settlementWallets.find((wallet) => wallet.chain === 'rwad') ?? settlementWallets[0];
                            setSettlementWalletAddress(preferred.address);
                          }}
                          className="text-xs px-2 py-1 rounded border border-purple-200 text-purple-600 bg-purple-50"
                        >
                          使用收款钱包
                        </button>
                      )}
                    </div>
                    <input
                      value={settlementWalletAddress}
                      onChange={(event) => setSettlementWalletAddress(event.target.value)}
                      placeholder="输入或选择收款钱包地址"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    {settlementWallets.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {settlementWallets.map((wallet) => (
                          <button
                            key={wallet.id}
                            onClick={() => setSettlementWalletAddress(wallet.address)}
                            className={`text-[11px] px-2 py-1 rounded border ${settlementWalletAddress.trim() === wallet.address
                              ? 'border-purple-400 bg-purple-50 text-purple-700'
                              : 'border-gray-200 bg-white text-gray-600'
                              }`}
                          >
                            {wallet.chain.toUpperCase()} · {maskAddr(wallet.address)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 跑腿 & 顺风车 设置 */}
          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-4">
              <div className="font-medium text-gray-900 mb-1">{t.profile_serviceWillingness}</div>

              {/* 跑腿开关 */}
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Footprints size={18} className="text-orange-500" />
                      <span className="text-sm font-medium text-gray-800">{t.profile_errand}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleErrand(!errandEnabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${errandEnabled ? 'bg-orange-500' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${errandEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {errandEnabled && (
                    <div className="mt-3 ml-7 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">{t.profile_errandOriginRange}</span>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            inputMode="numeric"
                            value={originInput}
                            onChange={(e) => {
                              setOriginInput(e.target.value);
                              const n = Number(e.target.value);
                              if (!isNaN(n) && n >= originSliderMin && n <= originSliderMax) {
                                saveErrandOriginM(originFromDisplay(n));
                              }
                            }}
                            onBlur={() => {
                              const n = Number(originInput);
                              if (!originInput || isNaN(n) || n < originSliderMin) {
                                saveErrandOriginM(originFromDisplay(originSliderMin));
                                setOriginInput(String(originSliderMin));
                              } else if (n > originSliderMax) {
                                saveErrandOriginM(originFromDisplay(originSliderMax));
                                setOriginInput(String(originSliderMax));
                              } else {
                                const rounded = errandOriginUnit === 'km' ? Math.round(n) : Math.round(n / 100) * 100;
                                saveErrandOriginM(originFromDisplay(rounded));
                                setOriginInput(String(rounded));
                              }
                            }}
                            className="w-14 text-right text-sm font-semibold bg-transparent outline-none border-b border-dashed text-orange-600 border-orange-300"
                          />
                          <button
                            type="button"
                            onClick={toggleOriginUnit}
                            className="text-sm font-semibold underline decoration-dashed underline-offset-2 cursor-pointer transition-colors text-orange-600 hover:text-orange-700"
                          >
                            {errandOriginUnit === 'km' ? t.profile_rangeUnit : t.profile_rangeUnitM}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">{t.profile_errandDestRange}</span>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            inputMode="numeric"
                            value={destInput}
                            onChange={(e) => {
                              setDestInput(e.target.value);
                              const n = Number(e.target.value);
                              if (!isNaN(n) && n >= destSliderMin && n <= destSliderMax) {
                                saveErrandDestM(destFromDisplay(n));
                              }
                            }}
                            onBlur={() => {
                              const n = Number(destInput);
                              if (!destInput || isNaN(n) || n < destSliderMin) {
                                saveErrandDestM(destFromDisplay(destSliderMin));
                                setDestInput(String(destSliderMin));
                              } else if (n > destSliderMax) {
                                saveErrandDestM(destFromDisplay(destSliderMax));
                                setDestInput(String(destSliderMax));
                              } else {
                                const rounded = errandDestUnit === 'km' ? Math.round(n) : Math.round(n / 100) * 100;
                                saveErrandDestM(destFromDisplay(rounded));
                                setDestInput(String(rounded));
                              }
                            }}
                            className="w-14 text-right text-sm font-semibold bg-transparent outline-none border-b border-dashed text-orange-600 border-orange-300"
                          />
                          <button
                            type="button"
                            onClick={toggleDestUnit}
                            className="text-sm font-semibold underline decoration-dashed underline-offset-2 cursor-pointer transition-colors text-orange-600 hover:text-orange-700"
                          >
                            {errandDestUnit === 'km' ? t.profile_rangeUnit : t.profile_rangeUnitM}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-px bg-gray-100" />

                {/* 顺风车开关 */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Car size={18} className="text-blue-500" />
                      <span className="text-sm font-medium text-gray-800">{t.profile_rideshare}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleRide(!rideEnabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${rideEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${rideEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {rideEnabled && (
                    <div className="mt-3 ml-7 space-y-3">
                      {/* Route */}
                      <div>
                        <div className="text-xs text-gray-500 mb-1.5">{t.profile_rideshareRoute}</div>
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 border border-gray-100">
                          <div className="flex-1 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                            <input
                              value={rideFrom}
                              onChange={(e) => saveRideFrom(e.target.value)}
                              placeholder={t.profile_rideshareFrom}
                              className="w-full text-sm bg-transparent outline-none placeholder-gray-400"
                            />
                          </div>
                          <ChevronRight size={14} className="text-gray-300" />
                          <div className="flex-1 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                            <input
                              value={rideTo}
                              onChange={(e) => saveRideTo(e.target.value)}
                              placeholder={t.profile_rideshareTo}
                              className="w-full text-sm bg-transparent outline-none placeholder-gray-400"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-px bg-gray-100" />

                {/* VPN Proxy Node Switch */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server size={18} className="text-purple-500" />
                      <div>
                        <div className="text-sm font-medium text-gray-800">{t.profile_vpnNode}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleVpnNode(!vpnNodeEnabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${vpnNodeEnabled ? 'bg-purple-500' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${vpnNodeEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {vpnNodeEnabled && (
                    <div className="mt-3 ml-7 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">{t.profile_vpnFee}</span>
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            value={vpnNodeFee}
                            onChange={(e) => saveVpnNodeFee(e.target.value)}
                            min="0"
                            step="0.01"
                            placeholder="0.10"
                            className="w-16 text-right text-sm font-semibold bg-transparent outline-none border-b border-dashed text-purple-600 border-purple-300"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-px bg-gray-100" />

                {/* C2C Market Maker Switch */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight size={18} className="text-indigo-500" />
                      <div>
                        <div className="text-sm font-medium text-gray-800">{t.profile_c2cMaker}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{t.profile_c2cMakerHint}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleC2cMaker(!c2cMakerEnabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${c2cMakerEnabled ? 'bg-indigo-500' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${c2cMakerEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {c2cMakerEnabled && (
                    <div className="mt-3 ml-7 space-y-3">
                      <div className="text-xs text-gray-500 mb-1">{t.profile_c2cFundType} / {t.profile_c2cDailyLimit} / {t.profile_c2cSpread}</div>
                      <div className="space-y-2">
                        {c2cMakerFunds.map((fund, idx) => (
                          <div key={fund.assetCode} className="bg-gray-50 rounded-lg p-2 border border-gray-100 space-y-2">
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-2 cursor-pointer min-w-[96px]">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${fund.enabled ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-gray-300'}`}>
                                  {fund.enabled && <Check size={10} className="text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={fund.enabled}
                                  onChange={(e) => updateFundSetting(idx, 'enabled', e.target.checked)}
                                />
                                <span className="text-sm font-medium text-gray-700">{fund.assetCode}</span>
                              </label>

                              <div className="h-4 w-px bg-gray-200" />

                              <div className="flex-1 flex items-center gap-2">
                                <span className="text-[11px] text-gray-500">{t.profile_c2cLimitLabel}</span>
                                <input
                                  type="number"
                                  value={fund.limit}
                                  onChange={(e) => updateFundSetting(idx, 'limit', e.target.value)}
                                  placeholder={t.profile_c2cLimitPlaceholder}
                                  className={`w-full text-sm bg-transparent outline-none ${fund.enabled ? 'text-gray-900' : 'text-gray-400'}`}
                                  disabled={!fund.enabled}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <label className="flex items-center gap-2">
                                <span className="text-gray-500 min-w-[58px]">{t.profile_c2cBaseBps}</span>
                                <input
                                  type="number"
                                  value={fund.baseSpreadBps}
                                  onChange={(e) => updateFundSetting(idx, 'baseSpreadBps', Number(e.target.value))}
                                  className={`w-full text-sm bg-transparent border rounded px-2 py-1 ${fund.enabled ? 'text-gray-900 border-gray-200' : 'text-gray-400 border-gray-100'}`}
                                  disabled={!fund.enabled}
                                />
                              </label>
                              <label className="flex items-center gap-2">
                                <span className="text-gray-500 min-w-[58px]">{t.profile_c2cMaxBps}</span>
                                <input
                                  type="number"
                                  value={fund.maxSpreadBps}
                                  onChange={(e) => updateFundSetting(idx, 'maxSpreadBps', Number(e.target.value))}
                                  className={`w-full text-sm bg-transparent border rounded px-2 py-1 ${fund.enabled ? 'text-gray-900 border-gray-200' : 'text-gray-400 border-gray-100'}`}
                                  disabled={!fund.enabled}
                                />
                              </label>
                            </div>

                            <div className="text-[10px] text-gray-500">
                              {t.profile_c2cPairs}: {fund.marketPairs.join(', ')}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {t.profile_c2cPolicyReset}
                      </div>
                    </div>
                  )}
                </div>

                {c2cMakerEnabled ? (
                  <>
                    <div className="h-px bg-gray-100" />

                    {/* DEX rollback switches */}
                    <div>
                      <div className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
                        <span className="w-1 h-4 bg-purple-500 rounded-full" />
                        {t.profile_dexSettings}
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                          <div className="flex-1 pr-4">
                            <div className="text-sm font-medium text-gray-900">{t.profile_dexClob}</div>
                            <div className="text-xs text-gray-500 mt-0.5 leading-tight">{t.profile_dexClobDesc}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleFeature('dex_clob_v1', !dexClobEnabled)}
                            className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${dexClobEnabled ? 'bg-purple-600' : 'bg-gray-200'}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${dexClobEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                          <div className="flex-1 pr-4">
                            <div className="text-sm font-medium text-gray-900">{t.profile_dexBridge}</div>
                            <div className="text-xs text-gray-500 mt-0.5 leading-tight">{t.profile_dexBridgeDesc}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleFeature('dex_c2c_bridge_v1', !dexBridgeEnabled)}
                            className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${dexBridgeEnabled ? 'bg-purple-600' : 'bg-gray-200'}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${dexBridgeEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="ml-7 text-[11px] text-gray-400">
                    {t.profile_c2cDexHint}
                  </div>
                )}

                <div className="h-px bg-gray-100" />

                {/* Distributed Node Switch */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server size={18} className="text-emerald-500" />
                      <div>
                        <div className="text-sm font-medium text-gray-800">{t.profile_distributedNode}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5 max-w-[240px] leading-tight">{t.profile_distributedNodeHint}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDistributedNodeEnabled(!distributedNodeEnabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${distributedNodeEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${distributedNodeEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {distributedNodeEnabled && (
                    <div className="mt-3 ml-7 grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex flex-col justify-between">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{t.profile_limitCpu}</div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={limitCpu}
                              onChange={(e) => setLimitCpu(Number(e.target.value))}
                              className="w-12 text-sm bg-transparent outline-none border-b border-gray-300 focus:border-emerald-500"
                            />
                            <span className="text-[10px] text-gray-400">{t.profile_unitCore}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex flex-col justify-between">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{t.profile_limitMemory}</div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={limitMemory}
                              onChange={(e) => setLimitMemory(Number(e.target.value))}
                              className="w-12 text-sm bg-transparent outline-none border-b border-gray-300 focus:border-emerald-500"
                            />
                            <span className="text-[10px] text-gray-400">{t.profile_unitGB}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex flex-col justify-between">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{t.profile_limitDisk}</div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={limitDisk}
                              onChange={(e) => setLimitDisk(Number(e.target.value))}
                              className="w-12 text-sm bg-transparent outline-none border-b border-gray-300 focus:border-emerald-500"
                            />
                            <span className="text-[10px] text-gray-400">{t.profile_unitGB}</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex flex-col justify-between">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{t.profile_limitGpu}</div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={limitGpu}
                              onChange={(e) => setLimitGpu(Number(e.target.value))}
                              className="w-12 text-sm bg-transparent outline-none border-b border-gray-300 focus:border-emerald-500"
                            />
                            <span className="text-[10px] text-gray-400">{t.profile_unitCard}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => setShowWallet(true)}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="text-left">
                <div className="font-medium text-gray-900">{t.profile_web3Wallet}</div>
                <div className="text-xs text-gray-600">
                  {wallets.length > 0 ? `${wallets.length} ${t.profile_walletCount}` : t.profile_createOrImport}
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            {/* Inline wallet summary */}
            {wallets.length > 0 && (
              <div className="px-4 pb-3 space-y-2">
                {wallets.map((w) => (
                  <div key={w.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-800 truncate">{w.alias}</div>
                      <div className="text-[10px] text-gray-500 font-mono truncate">{maskAddr(w.address)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-purple-600">
                        {walletBalances[w.id]
                          ? `${walletBalances[w.id].formatted} ${walletBalances[w.id].symbol}`
                          : walletBalanceLoading ? '...' : '--'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => setShowTransactions(true)}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="text-left">
                <div className="font-medium text-gray-900">{t.profile_transactionHistory}</div>
                <div className="text-xs text-gray-600">
                  {ledger.length > 0 ? `${ledger.length} ${t.profile_recordCount}` : t.profile_noRecords}
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
          </section>

          <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={handleClearPublishedContents}
              disabled={clearingPublished}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <div className="text-left">
                <div className="font-medium text-gray-900">清空已发布内容</div>
                <div className="text-xs text-gray-600">
                  {publishedContentCount > 0 ? `${publishedContentCount} 条本机发布内容` : '暂无本机已发布内容'}
                </div>
              </div>
              <ChevronRight size={18} className="text-gray-400" />
            </button>
            {publishedClearHint && (
              <div className="px-4 pb-3 text-xs text-gray-600">{publishedClearHint}</div>
            )}
          </section>
        </div >

        {assetActionState && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">
                  {assetActionState.asset === 'points' ? t.profile_points : 'RWAD'}
                  {assetActionState.action === 'recharge' ? t.profile_recharge : t.profile_transfer}
                </h3>
                <button onClick={closeAssetAction} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-gray-600 block mb-1">{t.profile_amountLabel}</label>
                  <input
                    value={assetAmountInput}
                    onChange={(event) => setAssetAmountInput(event.target.value)}
                    placeholder={t.profile_enterAmount}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                {assetActionState.action === 'transfer' && (
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">{t.profile_targetAddress}</label>
                    <input
                      value={assetTargetInput}
                      onChange={(event) => setAssetTargetInput(event.target.value)}
                      placeholder={t.profile_enterTargetAddress}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                )}

                {assetActionError && <div className="text-xs text-red-600">{assetActionError}</div>}

                <button
                  onClick={handleAssetActionSubmit}
                  className="w-full py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700"
                >
                  {t.profile_confirm}
                </button>
              </div>
            </div>
          </div>
        )
        }

        {
          showDomainTransfer && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{t.profile_transferDomain}</h3>
                  <button onClick={() => setShowDomainTransfer(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-3">
                  <div className="text-sm text-gray-700 break-all">{t.profile_currentDomain}：{domainName}</div>
                  <input
                    value={domainTransferTarget}
                    onChange={(event) => {
                      setDomainTransferTarget(event.target.value);
                      setDomainError('');
                    }}
                    placeholder={t.profile_enterReceiverAddress}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  {domainError && <div className="text-xs text-red-600">{domainError}</div>}
                  <button onClick={handleTransferDomain} className="w-full py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700">
                    {t.profile_confirmTransfer}
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {
          showAddresses && (
            <div className="fixed inset-0 bg-white z-50 flex flex-col">
              {/* ===== JD-Style Header ===== */}
              <div className="flex items-center justify-between px-4 h-12 border-b border-gray-100 shrink-0">
                <button onClick={() => setShowAddresses(false)} className="text-gray-700 text-sm font-medium flex items-center gap-1">
                  <ArrowDownCircle size={18} className="rotate-90" />
                  <span>{t.profile_back}</span>
                </button>
                <h3 className="text-base font-semibold text-gray-900 absolute left-1/2 -translate-x-1/2">{t.profile_addressManagement}</h3>
                <div className="w-14" />
              </div>

              {/* ===== Address List ===== */}
              <div className="flex-1 overflow-y-auto bg-[#f5f5f5]">
                {addresses.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <MapPin size={48} strokeWidth={1} />
                    <p className="mt-3 text-sm">{t.profile_noAddress}</p>
                    <p className="text-xs mt-1 text-gray-300">{t.profile_noAddressHint}</p>
                  </div>
                ) : (
                  <div className="py-2">
                    {addresses.map((address) => (
                      <div key={address.id} className="mx-3 mb-2 bg-white rounded-lg overflow-hidden shadow-sm">
                        {/* Card Body — clickable to edit */}
                        <button
                          onClick={() => openEditAddress(address)}
                          className="w-full text-left px-4 pt-3 pb-3"
                        >
                          {/* Row 1: name + phone + badges */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[15px] font-semibold text-gray-900">{address.receiver}</span>
                            <span className="text-[13px] text-gray-500">{address.phone}</span>
                            {address.isDefault && (
                              <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500 text-white leading-none">{t.profile_defaultTag}</span>
                            )}
                          </div>
                          {/* Row 2: tag + full address */}
                          <div className="flex items-start gap-1.5">
                            {address.tag && (
                              <span className="shrink-0 mt-0.5 px-1 py-[1px] rounded text-[10px] font-medium border border-purple-400 text-purple-500 leading-tight">{address.tag}</span>
                            )}
                            <span className="text-[13px] text-gray-600 leading-5">{address.region} {address.detail}</span>
                          </div>
                        </button>

                        {/* Card Footer — actions */}
                        <div className="flex items-center border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
                          <button
                            onClick={() => handleSetDefaultAddress(address.id)}
                            className={`inline-flex items-center gap-1.5 mr-5 ${address.isDefault ? 'text-purple-500' : 'text-gray-500'}`}
                          >
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${address.isDefault ? 'border-purple-500 bg-purple-500' : 'border-gray-300'}`}>
                              {address.isDefault && <Check size={10} className="text-white" />}
                            </div>
                            <span>{t.profile_setDefault}</span>
                          </button>
                          <div className="flex-1" />
                          <button onClick={() => openEditAddress(address)} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 mr-4">
                            <PencilLine size={13} />
                            <span>{t.profile_edit}</span>
                          </button>
                          <button onClick={() => handleDeleteAddress(address.id)} className="inline-flex items-center gap-1 text-gray-500 hover:text-red-600">
                            <Trash2 size={13} />
                            <span>{t.profile_delete}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ===== Bottom: Add Address Button (JD red CTA) ===== */}
              <div className="shrink-0 px-4 py-3 bg-white border-t border-gray-100 safe-area-bottom">
                <button
                  onClick={openNewAddress}
                  className="w-full h-11 rounded-full bg-purple-600 text-white font-medium text-[15px] flex items-center justify-center gap-1.5 active:bg-purple-700 transition-colors"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  {t.profile_addAddress}
                </button>
              </div>
            </div>
          )
        }

        {
          showAddressEditor && (
            <div className="fixed inset-0 bg-white z-[60] flex flex-col">
              {/* ===== Header ===== */}
              <div className="flex items-center px-4 h-12 border-b border-gray-100 shrink-0 relative">
                <button
                  onClick={() => setShowAddressEditor(false)}
                  className="text-gray-800 z-10"
                >
                  <ChevronRight size={22} className="rotate-180" />
                </button>
                <h3 className="text-[16px] font-semibold text-gray-900 absolute left-1/2 -translate-x-1/2">
                  {editingAddressId ? t.profile_editAddress : t.profile_addAddress}
                </h3>
              </div>

              {/* ===== Form Body ===== */}
              <div className="flex-1 overflow-y-auto bg-white">
                {/* 收货人 */}
                <div className="flex items-center px-5 h-[56px] border-b border-gray-100">
                  <label className="w-16 text-[15px] text-gray-900 shrink-0">{t.profile_recipient}</label>
                  <input
                    value={addressDraft.receiver}
                    onChange={(e) => setAddressDraft((prev) => ({ ...prev, receiver: e.target.value }))}
                    placeholder={t.profile_recipientPlaceholder}
                    className="flex-1 text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
                    maxLength={25}
                  />
                </div>

                {/* 手机号 */}
                <div className="flex items-center px-5 h-[56px] border-b border-gray-100">
                  <label className="w-16 text-[15px] text-gray-900 shrink-0">{t.profile_phone}</label>
                  <div className="flex items-center gap-1 text-[15px] text-gray-900 mr-2">
                    <span>+86</span>
                    <ChevronRight size={14} className="text-gray-400 rotate-90" />
                  </div>
                  <input
                    value={addressDraft.phone}
                    onChange={(e) => setAddressDraft((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder={t.profile_phonePlaceholder}
                    type="tel"
                    className="flex-1 text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
                    maxLength={11}
                  />
                </div>

                {/* 地图选址 / 地区选址 tabs */}
                <div className="mt-3 mx-5 bg-gray-50 rounded-xl overflow-hidden">
                  <div className="flex border-b border-gray-100">
                    <button className="flex-1 py-3 text-center text-[14px] text-gray-500 border-b-2 border-transparent">
                      {t.profile_mapSelect}
                    </button>
                    <button className="flex-1 py-3 text-center text-[14px] text-gray-900 font-medium border-b-2 border-purple-500">
                      {t.profile_regionSelect}
                      <span className="text-[11px] text-gray-400 block leading-tight">{t.profile_regionSelectHint}</span>
                    </button>
                  </div>

                  {/* 地址 — 选择收货地址 */}
                  <div className="flex items-center px-4 h-[52px] border-b border-gray-100">
                    <label className="w-12 text-[14px] text-gray-900 shrink-0">{t.profile_address}</label>
                    <input
                      value={addressDraft.region}
                      onChange={(e) => setAddressDraft((prev) => ({ ...prev, region: e.target.value }))}
                      placeholder={t.profile_addressPlaceholder}
                      className="flex-1 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
                    />
                    <MapPin size={18} className="text-purple-500 shrink-0" />
                  </div>

                  {/* 当前定位 */}
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-gray-900 font-medium truncate">{t.profile_currentLocation}：{addressDraft.region || t.profile_locating}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate">{addressDraft.region || t.profile_locationService}</div>
                      </div>
                      <button
                        onClick={() => {/* use current location */ }}
                        className="shrink-0 ml-3 px-3 py-1 text-[13px] text-gray-700 border border-gray-300 rounded bg-white"
                      >
                        {t.profile_use}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 门牌号 */}
                <div className="flex items-center px-5 h-[56px] border-b border-gray-100 mt-1">
                  <label className="w-16 text-[15px] text-gray-900 shrink-0">{t.profile_doorNumber}</label>
                  <input
                    value={addressDraft.detail}
                    onChange={(e) => setAddressDraft((prev) => ({ ...prev, detail: e.target.value }))}
                    placeholder={t.profile_doorNumberPlaceholder}
                    className="flex-1 text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
                  />
                </div>

                {/* 地址粘贴板 */}
                <div className="border-b border-gray-100">
                  {showClipboard && (
                    <div className="mx-5 mt-3 mb-1">
                      <textarea
                        value={clipboardText}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setClipboardText(nextValue);
                          const parsed = parseJdClipboardAddress(nextValue);
                          if (!parsed) return;
                          setAddressDraft((prev) => ({
                            ...prev,
                            receiver: parsed.receiver,
                            phone: parsed.phone,
                            region: parsed.region,
                            detail: parsed.detail,
                          }));
                          setAddressError('');
                        }}
                        placeholder={t.profile_clipboardPlaceholder}
                        className="w-full border border-gray-200 rounded-lg px-3 py-3 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-300 resize-none bg-white min-h-[72px] leading-6"
                        rows={3}
                      />
                    </div>
                  )}
                  <button
                    onClick={() => setShowClipboard((v) => !v)}
                    className="w-full py-2.5 flex items-center justify-center gap-1 text-[13px] text-gray-500"
                  >
                    {t.profile_addressClipboard}
                    <ChevronRight size={12} className={`text-gray-400 transition-transform ${showClipboard ? '-rotate-90' : 'rotate-90'}`} />
                  </button>
                </div>

                {/* 设为默认地址 */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div>
                    <div className="text-[15px] text-gray-900">{t.profile_setAsDefault}</div>
                    <div className="text-[12px] text-gray-400 mt-0.5">{t.profile_setAsDefaultHint}</div>
                  </div>
                  <button
                    onClick={() => setAddressDraft((prev) => ({ ...prev, isDefault: !prev.isDefault }))}
                    className="shrink-0"
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${addressDraft.isDefault ? 'border-purple-500 bg-purple-500' : 'border-gray-300'}`}>
                      {addressDraft.isDefault && <Check size={12} className="text-white" />}
                    </div>
                  </button>
                </div>

                {/* 标签 */}
                <div className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    <span className="text-[15px] text-gray-900 shrink-0 pt-1.5">{t.profile_tagLabel}</span>
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      {[t.profile_tagSchool, t.profile_tagHome, t.profile_tagCompany, t.profile_tagShopping, t.profile_tagDelivery, t.profile_tagCustom].map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setAddressDraft((prev) => ({ ...prev, tag: prev.tag === tag ? '' : tag }))}
                          className={`py-2 rounded-lg text-[13px] font-medium text-center transition-colors border ${addressDraft.tag === tag
                            ? 'bg-purple-50 text-purple-600 border-purple-400'
                            : 'bg-gray-50 text-gray-600 border-gray-200'
                            }`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {addressError && (
                  <div className="mx-5 mb-3 px-4 py-2 bg-red-50 rounded-lg text-[13px] text-red-600">{addressError}</div>
                )}
              </div>

              {/* ===== Bottom: 确认 Button ===== */}
              <div className="shrink-0 px-5 py-3 bg-white border-t border-gray-100 safe-area-bottom">
                <button
                  onClick={handleSaveAddress}
                  className="w-full h-[44px] rounded-full bg-purple-600 text-white font-medium text-[16px] flex items-center justify-center active:bg-purple-700 transition-colors"
                >
                  {t.profile_confirm}
                </button>
              </div>
            </div>
          )
        }

        {
          showWallet && (
            <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end">
              <div className="bg-white w-full max-h-[85vh] rounded-t-2xl overflow-hidden">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
                  <h3 className="font-semibold">{t.profile_walletTitle}</h3>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={refreshAllBalances}
                      disabled={walletBalanceLoading}
                      className="text-purple-600 hover:text-purple-700 disabled:opacity-50"
                    >
                      <RefreshCw size={16} className={walletBalanceLoading ? 'animate-spin' : ''} />
                    </button>
                    <button
                      onClick={handleCloseWallet}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      {t.profile_close}
                    </button>
                  </div>
                </div>

                <div className="overflow-y-auto max-h-[calc(85vh-72px)] p-4 space-y-4">

                  {/* Existing wallets list */}
                  {wallets.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-gray-700">{t.profile_myWallets}</div>
                      {wallets.map((w) => (
                        <div key={w.id} className="border border-gray-200 rounded-xl p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900">{w.alias}</div>
                              <div className="text-xs text-gray-500">{chainLabel(w.chain)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-purple-600">
                                {walletBalances[w.id]
                                  ? `${walletBalances[w.id].formatted} ${walletBalances[w.id].symbol}`
                                  : walletBalanceLoading ? t.profile_loading : '--'}
                              </div>
                            </div>
                          </div>
                          <div className="font-mono text-[11px] text-gray-600 break-all bg-gray-50 rounded px-2 py-1">
                            {w.address}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setWalletExportId(walletExportId === w.id ? null : w.id);
                                setWalletShowSecret(false);
                              }}
                              className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-purple-200 text-purple-700 bg-purple-50 flex items-center justify-center gap-1"
                            >
                              <Upload size={12} /> {t.profile_export}
                            </button>
                            <button
                              onClick={() => { void handleDeleteWallet(w.id); }}
                              className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-purple-200 text-purple-700 bg-purple-50 flex items-center justify-center gap-1"
                            >
                              <Trash2 size={12} /> {t.profile_deleteWallet}
                            </button>
                          </div>
                          {/* Export detail */}
                          {walletExportId === w.id && (
                            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
                              <div className="text-xs text-purple-800 font-medium">{t.profile_doNotLeak}</div>
                              <div>
                                <div className="text-xs text-gray-500">{t.profile_privateKey}</div>
                                <div className="font-mono text-xs text-gray-900 break-all mt-0.5">
                                  {walletShowSecret ? w.privateKey : '••••••••••••••••'}
                                </div>
                              </div>
                              <button
                                onClick={() => setWalletShowSecret(!walletShowSecret)}
                                className="text-xs text-purple-600 flex items-center gap-1"
                              >
                                {walletShowSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                                {walletShowSecret ? t.profile_hide : t.profile_show}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Create / Import tabs */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-2 border-b border-gray-200">
                      <button
                        onClick={() => { setWalletAction('create'); setWalletError(''); setWalletSuccess(''); resetTos(); }}
                        className={`py-2.5 text-sm font-medium transition-colors ${walletAction === 'create' ? 'bg-purple-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        {t.profile_createWallet}
                      </button>
                      <button
                        onClick={() => { setWalletAction('import'); setWalletError(''); setWalletSuccess(''); resetTos(); }}
                        className={`py-2.5 text-sm font-medium transition-colors ${walletAction === 'import' ? 'bg-purple-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        {t.profile_importWallet}
                      </button>
                    </div>

                    <div className="p-4 space-y-3">
                      {/* Non-Custodial ToS */}
                      <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
                        <h3 className="font-semibold text-amber-800 text-sm">{t.wallet_tos_title}</h3>
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input type="checkbox" checked={tosCheck1} onChange={(e) => setTosCheck1(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" />
                          <span className="text-xs text-gray-700 leading-relaxed">{t.wallet_tos_1}</span>
                        </label>
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input type="checkbox" checked={tosCheck2} onChange={(e) => setTosCheck2(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" />
                          <span className="text-xs text-gray-700 leading-relaxed">{t.wallet_tos_2}</span>
                        </label>
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input type="checkbox" checked={tosCheck3} onChange={(e) => setTosCheck3(e.target.checked)} className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" />
                          <span className="text-xs text-gray-700 leading-relaxed">{t.wallet_tos_3}</span>
                        </label>
                      </div>

                      {walletAction === 'create' ? (
                        <>
                          <div className="text-sm text-gray-600 mb-1">{t.profile_evmSolanaHint}</div>
                          <button
                            onClick={createEVMSolana}
                            disabled={walletCreating || !allTosAccepted}
                            className="w-full py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {walletCreating ? t.profile_creating : t.profile_createEvmSolana}
                          </button>
                          <button
                            onClick={createBTC}
                            disabled={walletCreating || !allTosAccepted}
                            className="w-full py-2.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {walletCreating ? t.profile_creating : t.profile_createBtc}
                          </button>
                          <button
                            onClick={createRWAD}
                            disabled={walletCreating || !allTosAccepted}
                            className="w-full py-2.5 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {walletCreating ? t.profile_creating : t.profile_createRwadWallet}
                          </button>
                        </>
                      ) : (
                        <>
                          {/* Chain selector — only for import */}
                          <div>
                            <div className="text-sm text-gray-600 mb-2">{t.profile_selectChain}</div>
                            <div className="grid grid-cols-4 gap-2">
                              {(['evm', 'solana', 'btc', 'rwad'] as ChainType[]).map((c) => (
                                <button
                                  key={c}
                                  onClick={() => setWalletChain(c)}
                                  className={`py-2 rounded-lg border text-sm transition-colors ${walletChain === c
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'border-gray-300 text-gray-700 hover:border-purple-300'
                                    }`}
                                >
                                  {c === 'evm' ? 'EVM' : c === 'solana' ? 'Solana' : c === 'btc' ? 'BTC' : 'RWAD'}
                                </button>
                              ))}
                            </div>
                            <div className="text-[10px] text-gray-500 mt-1">{chainLabel(walletChain)}</div>
                          </div>
                          <div>
                            <label className="text-sm text-gray-600 block mb-1">{t.profile_walletAlias}</label>
                            <input
                              type="text"
                              value={walletAlias}
                              onChange={(event) => setWalletAlias(event.target.value)}
                              placeholder={t.profile_walletAliasPlaceholder}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                          </div>
                          <div>
                            <label className="text-sm text-gray-600 block mb-1">{t.profile_mnemonicOrKey}</label>
                            <textarea
                              value={walletInput}
                              onChange={(event) => {
                                setWalletInput(event.target.value);
                                setWalletError('');
                                setWalletSuccess('');
                              }}
                              placeholder={t.profile_mnemonicOrKeyPlaceholder}
                              className="w-full min-h-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
                            />
                          </div>
                          <button
                            onClick={() => importWalletForChain(walletChain, walletInput, walletAlias.trim() || t.profile_myWallet)}
                            disabled={walletCreating || !walletInput.trim() || !allTosAccepted}
                            className="w-full py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                          >
                            {walletCreating ? t.profile_importing : `${t.profile_importTo} ${walletChain.toUpperCase()}`}
                          </button>
                        </>
                      )}

                      {walletError && (
                        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                          {walletError}
                        </div>
                      )}
                      {walletSuccess && (
                        <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                          {walletSuccess}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        {/* ===== Fullscreen Transaction List ===== */}
        {
          showTransactions && (
            <div className="fixed inset-0 bg-white z-50 flex flex-col">
              <div className="flex items-center justify-between px-4 h-12 border-b border-gray-100 shrink-0">
                <button onClick={() => { setShowTransactions(false); setSelectedLedgerEntry(null); }} className="text-gray-700 text-sm font-medium flex items-center gap-1">
                  <ArrowDownCircle size={18} className="rotate-90" />
                  <span>{t.profile_back}</span>
                </button>
                <h3 className="text-base font-semibold text-gray-900 absolute left-1/2 -translate-x-1/2">{t.profile_transactionHistory}</h3>
                <div className="w-14" />
              </div>

              <div className="flex-1 overflow-y-auto bg-[#f5f5f5]">
                {selectedLedgerEntry ? (
                  /* --- Transaction Detail --- */
                  <div className="p-4 space-y-3">
                    <button onClick={() => setSelectedLedgerEntry(null)} className="text-sm text-purple-600 flex items-center gap-1 mb-2">
                      <ArrowDownCircle size={14} className="rotate-90" /> {t.profile_backToList}
                    </button>
                    <div className="bg-white rounded-xl p-4 space-y-3">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-900">
                          {selectedLedgerEntry.amount > 0 ? selectedLedgerEntry.amount.toFixed(0) : '--'}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          {selectedLedgerEntry.type === 'points_recharge' && t.profile_txPointsRecharge}
                          {selectedLedgerEntry.type === 'points_transfer' && t.profile_txPointsTransfer}
                          {selectedLedgerEntry.type === 'rwad_recharge' && t.profile_txRwadRecharge}
                          {selectedLedgerEntry.type === 'rwad_transfer' && t.profile_txRwadTransfer}
                          {selectedLedgerEntry.type === 'domain_register' && t.profile_txDomainRegister}
                          {selectedLedgerEntry.type === 'domain_transfer' && t.profile_txDomainTransfer}
                        </div>
                      </div>
                      <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">{t.profile_txStatus}</span>
                          <span className="text-green-600 font-medium flex items-center gap-1"><CheckCircle2 size={14} /> {t.profile_txDone}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">{t.profile_txTime}</span>
                          <span className="text-gray-800">{formatShortTime(selectedLedgerEntry.createdAt)}</span>
                        </div>
                        {selectedLedgerEntry.target && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">{t.profile_txTarget}</span>
                            <span className="text-gray-800 font-mono text-xs break-all">{selectedLedgerEntry.target}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-gray-500">{t.profile_txId}</span>
                          <span className="text-gray-800 font-mono text-xs">{selectedLedgerEntry.id}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : ledger.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <Coins size={48} strokeWidth={1} />
                    <p className="mt-3 text-sm">{t.profile_noTxRecords}</p>
                  </div>
                ) : (
                  <div className="py-2">
                    {ledger.map((entry) => (
                      <button
                        key={entry.id}
                        onClick={() => setSelectedLedgerEntry(entry)}
                        className="w-full mx-3 mb-2 bg-white rounded-lg overflow-hidden shadow-sm text-left px-4 py-3 flex items-start justify-between gap-3 text-sm hover:bg-gray-50 transition-colors"
                        style={{ width: 'calc(100% - 24px)' }}
                      >
                        <div>
                          <div className="text-gray-800 font-medium">
                            {entry.type === 'points_recharge' && t.profile_txPointsRecharge}
                            {entry.type === 'points_transfer' && t.profile_txPointsTransfer}
                            {entry.type === 'rwad_recharge' && t.profile_txRwadRecharge}
                            {entry.type === 'rwad_transfer' && t.profile_txRwadTransfer}
                            {entry.type === 'domain_register' && t.profile_txDomainRegister}
                            {entry.type === 'domain_transfer' && t.profile_txDomainTransfer}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {formatShortTime(entry.createdAt)}
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-1">
                          <div className="font-medium text-gray-900">{entry.amount > 0 ? entry.amount.toFixed(0) : '--'}</div>
                          <ChevronRight size={14} className="text-gray-400" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        }

      </div>
    </>
  );
}
