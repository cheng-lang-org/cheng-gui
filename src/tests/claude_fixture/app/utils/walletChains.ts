/**
 * Multi-chain wallet utilities: EVM (BSC Testnet), Solana (Devnet), Bitcoin (Testnet)
 * Supports create, import (mnemonic / private-key), balance reading, export, delete.
 *
 * SECURITY: Private keys are now encrypted using AES-GCM before storage.
 * Mnemonic phrases are NEVER stored - only shown once during creation/import.
 */

import { ethers } from 'ethers';
import { getAccount } from '../domain/rwad/rwadGateway';
import {
    loadWallets as loadSecureWallets,
    saveWallets as saveSecureWallets,
    addWallet as addSecureWallet,
    deleteWallet as deleteSecureWallet,
    getPrivateKey,
    migrateLegacyWallets,
    type WalletEntry,
    type ChainType,
} from './secureWallet';

// Re-export types for backward compatibility
export type { WalletEntry, ChainType } from './secureWallet';

// Legacy wallet type for migration purposes
interface LegacyWalletEntry {
    id: string;
    chain: ChainType;
    alias: string;
    address: string;
    privateKey: string;
    mnemonic?: string;
    createdAt: number;
}

export interface ChainBalance {
    /** Human-readable balance string */
    formatted: string;
    /** Raw numeric balance */
    raw: number;
    /** Unit symbol */
    symbol: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LEGACY_STORAGE_KEY = 'unimaker_wallets_v1';

/** BSC Testnet RPC */
const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
const BSC_TESTNET_CHAIN_ID = 97;

/** Solana Devnet JSON-RPC */
const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';

/** Blockstream Bitcoin Testnet REST API */
const BTC_TESTNET_API = 'https://blockstream.info/testnet/api';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function genId(): string {
    return `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((item) => item.toString(16).padStart(2, '0')).join('');
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

function base64UrlToBytes(base64Url: string): Uint8Array {
    const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    return base64ToBytes(padded);
}

function normalizePkcs8(input: string): string {
    const trimmed = input.trim();
    if (trimmed.startsWith('pkcs8:')) {
        return trimmed.slice('pkcs8:'.length).trim();
    }
    return trimmed;
}

async function importRwadPrivateKey(pkcs8: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'pkcs8',
        toArrayBuffer(base64ToBytes(normalizePkcs8(pkcs8))),
        { name: 'Ed25519' },
        true,
        ['sign']
    );
}

async function exportRwadAddressFromPrivateKey(privateKey: CryptoKey): Promise<string> {
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    if (!jwk.x || typeof jwk.x !== 'string') {
        throw new Error('RWAD private key missing public component');
    }
    return bytesToHex(base64UrlToBytes(jwk.x));
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

/**
 * Load wallets from secure storage
 */
export function loadWallets(): WalletEntry[] {
    return loadSecureWallets();
}

/**
 * Save wallets to secure storage (encrypts sensitive data)
 */
export async function saveWallets(wallets: WalletEntry[]): Promise<void> {
    return saveSecureWallets(wallets);
}

/**
 * Delete a wallet by ID
 */
export async function deleteWallet(id: string): Promise<WalletEntry[]> {
    return deleteSecureWallet(id);
}

/**
 * Get decrypted private key for signing operations
 * Use this instead of directly accessing wallet.privateKey
 */
export async function getWalletPrivateKey(wallet: WalletEntry): Promise<string> {
    return getPrivateKey(wallet);
}

/**
 * Initialize wallet system - call this on app startup
 * Migrates legacy wallets to encrypted format
 */
export async function initWalletSystem(): Promise<void> {
    await migrateLegacyWallets();
}

/* ------------------------------------------------------------------ */
/*  EVM  (BSC Testnet)                                                 */
/* ------------------------------------------------------------------ */

export interface CreateWalletResult {
    wallet: WalletEntry;
    mnemonic?: string; // Only returned on creation - NOT stored
}

export async function createEVMWallet(alias = 'EVM 钱包'): Promise<CreateWalletResult> {
    const wallet = ethers.Wallet.createRandom();
    const mnemonic = wallet.mnemonic?.phrase;

    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'evm',
        alias,
        address: wallet.address,
        privateKey: wallet.privateKey,
        createdAt: Date.now(),
    };

    const saved = await addSecureWallet(entry);

    return {
        wallet: saved,
        mnemonic, // Return mnemonic for one-time display - NOT stored
    };
}

/**
 * Create EVM + Solana wallets from a single shared BIP39 mnemonic.
 * Returns wallets and mnemonic (for one-time backup).
 */
export async function createEVMAndSolanaWallets(alias = '钱包'): Promise<{
    wallets: [WalletEntry, WalletEntry];
    mnemonic: string;
}> {
    const { Keypair } = await import('@solana/web3.js');
    const bip39 = await import('bip39');

    // Generate one shared mnemonic
    const mnemonic = ethers.Wallet.createRandom().mnemonic!.phrase;

    // --- EVM wallet ---
    const evmHd = ethers.HDNodeWallet.fromPhrase(mnemonic);
    const evmEntry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'evm',
        alias: `${alias} (EVM)`,
        address: evmHd.address,
        privateKey: evmHd.privateKey,
        createdAt: Date.now(),
    };

    // --- Solana wallet (from same mnemonic) ---
    const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
    const seed = seedBuffer.subarray(0, 32);
    const kp = Keypair.fromSeed(new Uint8Array(seed));
    const secretHex = Array.from(kp.secretKey).map(b => b.toString(16).padStart(2, '0')).join('');
    const solEntry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'solana',
        alias: `${alias} (Solana)`,
        address: kp.publicKey.toBase58(),
        privateKey: secretHex,
        createdAt: Date.now(),
    };

    const [savedEvm, savedSol] = await Promise.all([
        addSecureWallet(evmEntry),
        addSecureWallet(solEntry),
    ]);

    return {
        wallets: [savedEvm, savedSol],
        mnemonic, // Return mnemonic for one-time display - NOT stored
    };
}

export async function importEVMWallet(input: string, alias = 'EVM 钱包'): Promise<WalletEntry> {
    const trimmed = input.trim();
    let wallet: ethers.Wallet | ethers.HDNodeWallet;

    if (trimmed.split(/\s+/).length >= 12) {
        // Mnemonic
        const hd = ethers.HDNodeWallet.fromPhrase(trimmed);
        wallet = new ethers.Wallet(hd.privateKey);
    } else {
        // Private key
        const key = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
        wallet = new ethers.Wallet(key);
    }

    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'evm',
        alias,
        address: wallet.address,
        privateKey: wallet.privateKey,
        createdAt: Date.now(),
    };

    return addSecureWallet(entry);
}

export async function fetchEVMBalance(address: string): Promise<ChainBalance> {
    try {
        const provider = new ethers.JsonRpcProvider(BSC_TESTNET_RPC, BSC_TESTNET_CHAIN_ID);
        const balance = await provider.getBalance(address);
        const formatted = ethers.formatEther(balance);
        return { formatted: Number(formatted).toFixed(6), raw: Number(formatted), symbol: 'tBNB' };
    } catch {
        return { formatted: '0.000000', raw: 0, symbol: 'tBNB' };
    }
}

/* ------------------------------------------------------------------ */
/*  Solana (Devnet)                                                    */
/* ------------------------------------------------------------------ */

export async function createSolanaWallet(alias = 'Solana 钱包'): Promise<CreateWalletResult> {
    const { Keypair } = await import('@solana/web3.js');
    const kp = Keypair.generate();
    const secretHex = Array.from(kp.secretKey).map(b => b.toString(16).padStart(2, '0')).join('');

    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'solana',
        alias,
        address: kp.publicKey.toBase58(),
        privateKey: secretHex,
        createdAt: Date.now(),
    };

    const saved = await addSecureWallet(entry);

    return {
        wallet: saved,
        // No mnemonic for Solana random generation
    };
}

export async function importSolanaWallet(input: string, alias = 'Solana 钱包'): Promise<WalletEntry> {
    const { Keypair } = await import('@solana/web3.js');
    const trimmed = input.trim();
    let kp: InstanceType<typeof Keypair>;

    if (trimmed.split(/\s+/).length >= 12) {
        // Mnemonic → derive seed → Keypair
        const bip39 = await import('bip39');
        const seedBuffer = await bip39.mnemonicToSeed(trimmed);
        const seed = seedBuffer.subarray(0, 32);
        kp = Keypair.fromSeed(new Uint8Array(seed));
    } else {
        // Assume hex-encoded secret key
        const hexStr = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
        const bytes = new Uint8Array(hexStr.match(/.{1,2}/g)!.map(h => parseInt(h, 16)));
        kp = Keypair.fromSecretKey(bytes);
    }

    const secretHex = Array.from(kp.secretKey).map(b => b.toString(16).padStart(2, '0')).join('');

    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'solana',
        alias,
        address: kp.publicKey.toBase58(),
        privateKey: secretHex,
        createdAt: Date.now(),
    };

    return addSecureWallet(entry);
}

export async function fetchSolanaBalance(address: string): Promise<ChainBalance> {
    try {
        const res = await fetch(SOLANA_DEVNET_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getBalance',
                params: [address],
            }),
        });
        const data = await res.json();
        const lamports = data?.result?.value ?? 0;
        const sol = lamports / 1e9;
        return { formatted: sol.toFixed(6), raw: sol, symbol: 'SOL' };
    } catch {
        return { formatted: '0.000000', raw: 0, symbol: 'SOL' };
    }
}

/* ------------------------------------------------------------------ */
/*  Bitcoin (Testnet)                                                  */
/* ------------------------------------------------------------------ */

export async function createBTCWallet(alias = 'BTC 钱包'): Promise<CreateWalletResult> {
    const bip39 = await import('bip39');
    const bitcoin = await import('bitcoinjs-lib');
    const ecc = await import('tiny-secp256k1');
    const { ECPairFactory } = await import('ecpair');

    const ECPair = ECPairFactory(ecc);
    const mnemonic = bip39.generateMnemonic();
    const seed = await bip39.mnemonicToSeed(mnemonic);

    // Simple P2PKH testnet address from first 32 bytes of seed
    const keyPair = ECPair.fromPrivateKey(Buffer.from(seed.subarray(0, 32)), {
        network: bitcoin.networks.testnet,
    });

    const { address } = bitcoin.payments.p2pkh({
        pubkey: Buffer.from(keyPair.publicKey),
        network: bitcoin.networks.testnet,
    });

    const privKeyHex = Buffer.from(keyPair.privateKey!).toString('hex');

    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'btc',
        alias,
        address: address || '',
        privateKey: privKeyHex,
        createdAt: Date.now(),
    };

    const saved = await addSecureWallet(entry);

    return {
        wallet: saved,
        mnemonic, // Return mnemonic for one-time display - NOT stored
    };
}

export async function importBTCWallet(input: string, alias = 'BTC 钱包'): Promise<WalletEntry> {
    const bip39 = await import('bip39');
    const bitcoin = await import('bitcoinjs-lib');
    const ecc = await import('tiny-secp256k1');
    const { ECPairFactory } = await import('ecpair');

    const ECPair = ECPairFactory(ecc);
    const trimmed = input.trim();
    let privKeyHex: string;
    let address: string;

    if (trimmed.split(/\s+/).length >= 12) {
        const seed = await bip39.mnemonicToSeed(trimmed);
        const keyPair = ECPair.fromPrivateKey(Buffer.from(seed.subarray(0, 32)), {
            network: bitcoin.networks.testnet,
        });
        const payment = bitcoin.payments.p2pkh({
            pubkey: Buffer.from(keyPair.publicKey),
            network: bitcoin.networks.testnet,
        });
        address = payment.address || '';
        privKeyHex = Buffer.from(keyPair.privateKey!).toString('hex');
    } else {
        // WIF or hex private key
        const hexStr = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
        let keyPair;
        try {
            keyPair = ECPair.fromWIF(trimmed, bitcoin.networks.testnet);
        } catch {
            keyPair = ECPair.fromPrivateKey(Buffer.from(hexStr, 'hex'), {
                network: bitcoin.networks.testnet,
            });
        }
        const payment = bitcoin.payments.p2pkh({
            pubkey: Buffer.from(keyPair.publicKey),
            network: bitcoin.networks.testnet,
        });
        address = payment.address || '';
        privKeyHex = Buffer.from(keyPair.privateKey!).toString('hex');
    }

    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'btc',
        alias,
        address,
        privateKey: privKeyHex,
        createdAt: Date.now(),
    };

    return addSecureWallet(entry);
}

export async function fetchBTCBalance(address: string): Promise<ChainBalance> {
    try {
        const res = await fetch(`${BTC_TESTNET_API}/address/${address}`);
        const data = await res.json();
        const funded = data?.chain_stats?.funded_txo_sum ?? 0;
        const spent = data?.chain_stats?.spent_txo_sum ?? 0;
        const satoshis = funded - spent;
        const btc = satoshis / 1e8;
        return { formatted: btc.toFixed(8), raw: btc, symbol: 'tBTC' };
    } catch {
        return { formatted: '0.00000000', raw: 0, symbol: 'tBTC' };
    }
}

/* ------------------------------------------------------------------ */
/*  RWAD (ed25519)                                                     */
/* ------------------------------------------------------------------ */

export async function createRWADWallet(alias = 'RWAD 钱包'): Promise<CreateWalletResult> {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const privateKey = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const publicKey = await crypto.subtle.exportKey('raw', pair.publicKey);
    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'rwad',
        alias,
        address: bytesToHex(new Uint8Array(publicKey)),
        privateKey: `pkcs8:${bytesToBase64(new Uint8Array(privateKey))}`,
        createdAt: Date.now(),
    };
    const saved = await addSecureWallet(entry);
    return { wallet: saved };
}

export async function importRWADWallet(input: string, alias = 'RWAD 钱包'): Promise<WalletEntry> {
    const normalized = input.trim();
    if (!normalized) {
        throw new Error('RWAD private key is required');
    }

    let addressHint = '';
    let pkcs8 = normalized;
    if (normalized.includes(':') && !normalized.startsWith('pkcs8:')) {
        const [addressPart, ...rest] = normalized.split(':');
        const candidate = addressPart.trim().toLowerCase();
        if (/^[0-9a-f]{64}$/.test(candidate) && rest.length > 0) {
            addressHint = candidate;
            pkcs8 = rest.join(':');
        }
    }

    const privateKey = await importRwadPrivateKey(pkcs8);
    const derivedAddress = await exportRwadAddressFromPrivateKey(privateKey);
    const entry: Omit<WalletEntry, 'encrypted'> = {
        id: genId(),
        chain: 'rwad',
        alias,
        address: addressHint || derivedAddress,
        privateKey: `pkcs8:${normalizePkcs8(pkcs8)}`,
        createdAt: Date.now(),
    };
    return addSecureWallet(entry);
}

export async function signRWADPayload(wallet: WalletEntry, payload: string | Record<string, unknown>): Promise<string> {
    if (wallet.chain !== 'rwad') {
        throw new Error('wallet chain is not rwad');
    }
    const privateKeyRaw = await getPrivateKey(wallet);
    const privateKey = await importRwadPrivateKey(privateKeyRaw);
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, toArrayBuffer(new TextEncoder().encode(text)));
    return bytesToBase64(new Uint8Array(signature));
}

export async function fetchRWADBalance(address: string): Promise<ChainBalance> {
    try {
        const account = await getAccount(address);
        return {
            formatted: account.balance.toFixed(0),
            raw: account.balance,
            symbol: 'RWAD',
        };
    } catch {
        return { formatted: '0', raw: 0, symbol: 'RWAD' };
    }
}

/* ------------------------------------------------------------------ */
/*  Unified API                                                        */
/* ------------------------------------------------------------------ */

export async function fetchBalance(wallet: WalletEntry): Promise<ChainBalance> {
    switch (wallet.chain) {
        case 'evm': return fetchEVMBalance(wallet.address);
        case 'solana': return fetchSolanaBalance(wallet.address);
        case 'btc': return fetchBTCBalance(wallet.address);
        case 'rwad': return fetchRWADBalance(wallet.address);
    }
}

export function chainLabel(chain: ChainType): string {
    switch (chain) {
        case 'evm': return 'EVM (BSC Testnet)';
        case 'solana': return 'Solana (Devnet)';
        case 'btc': return 'Bitcoin (Testnet)';
        case 'rwad': return 'RWAD (ed25519)';
    }
}

export function chainIcon(chain: ChainType): string {
    switch (chain) {
        case 'evm': return '🔷';
        case 'solana': return '🟣';
        case 'btc': return '🟠';
        case 'rwad': return '🟡';
    }
}

export function maskAddr(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
