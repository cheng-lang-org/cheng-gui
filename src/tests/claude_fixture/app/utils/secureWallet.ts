/**
 * Secure wallet storage with encryption support
 * Provides safe access to private keys with automatic encryption/decryption
 */

import { encryptValue, decryptValue, isEncrypted, getOrCreateWalletPassword } from './crypto';

export type ChainType = 'evm' | 'solana' | 'btc' | 'rwad';

export interface WalletEntry {
    id: string;
    chain: ChainType;
    alias: string;
    address: string;
    /** Encrypted private key (AES-GCM) */
    privateKey: string;
    /** Whether the private key is encrypted */
    encrypted: boolean;
    /** Mnemonic is NOT stored - only shown once during creation/import */
    createdAt: number;
}

export interface DecryptedWallet {
    id: string;
    chain: ChainType;
    alias: string;
    address: string;
    privateKey: string;
    createdAt: number;
}

const STORAGE_KEY = 'unimaker_wallets_v2';
const LEGACY_STORAGE_KEY = 'unimaker_wallets_v1';

/**
 * Generate a unique wallet ID
 */
export function genId(): string {
    return `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Encrypt a wallet entry's sensitive data
 */
async function encryptWallet(wallet: Omit<WalletEntry, 'encrypted'>, password: string): Promise<WalletEntry> {
    const encryptedPrivateKey = await encryptValue(wallet.privateKey, password);

    return {
        ...wallet,
        privateKey: encryptedPrivateKey,
        encrypted: true,
    };
}

/**
 * Decrypt a wallet entry's sensitive data
 */
export async function decryptWallet(wallet: WalletEntry, password: string): Promise<DecryptedWallet> {
    if (!wallet.encrypted) {
        // Legacy unencrypted wallet - return as-is but mark for migration
        return {
            id: wallet.id,
            chain: wallet.chain,
            alias: wallet.alias,
            address: wallet.address,
            privateKey: wallet.privateKey,
            createdAt: wallet.createdAt,
        };
    }

    const decryptedPrivateKey = await decryptValue(wallet.privateKey, password);

    return {
        id: wallet.id,
        chain: wallet.chain,
        alias: wallet.alias,
        address: wallet.address,
        privateKey: decryptedPrivateKey,
        createdAt: wallet.createdAt,
    };
}

/**
 * Load all wallets from storage
 */
export function loadWallets(): WalletEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw) as WalletEntry[];
        }

        // Try to migrate from legacy storage
        const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
            const legacyWallets = JSON.parse(legacyRaw);
            // Mark legacy wallets as unencrypted - they will be encrypted on first access
            const migrated = legacyWallets.map((w: Record<string, unknown>) => ({
                ...w,
                encrypted: false,
            })) as WalletEntry[];

            // Save to new storage
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
            // Keep legacy for backup during transition

            return migrated;
        }

        return [];
    } catch {
        return [];
    }
}

/**
 * Save wallets to storage (encrypts sensitive data if not already encrypted)
 */
export async function saveWallets(wallets: WalletEntry[]): Promise<void> {
    const password = getOrCreateWalletPassword();

    const encryptedWallets = await Promise.all(
        wallets.map(async (wallet) => {
            // If not encrypted, encrypt now
            if (!wallet.encrypted && !isEncrypted(wallet.privateKey)) {
                return encryptWallet(wallet, password);
            }
            return wallet;
        })
    );

    localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedWallets));
}

/**
 * Add a new wallet (will be encrypted before storage)
 */
export async function addWallet(wallet: Omit<WalletEntry, 'encrypted'>): Promise<WalletEntry> {
    const wallets = loadWallets();
    const password = getOrCreateWalletPassword();
    const encryptedWallet = await encryptWallet(wallet, password);
    wallets.push(encryptedWallet);
    await saveWallets(wallets);
    return encryptedWallet;
}

/**
 * Delete a wallet by ID
 */
export async function deleteWallet(id: string): Promise<WalletEntry[]> {
    const wallets = loadWallets().filter((w) => w.id !== id);
    await saveWallets(wallets);
    return wallets;
}

/**
 * Secure accessor for private keys
 * Decrypts the private key only when needed, never stores it in state
 */
export async function getPrivateKey(wallet: WalletEntry): Promise<string> {
    const password = getOrCreateWalletPassword();
    const decrypted = await decryptWallet(wallet, password);
    return decrypted.privateKey;
}

/**
 * Get decrypted wallet data for signing operations
 * Use this sparingly - prefer getPrivateKey for single operations
 */
export async function getDecryptedWallet(wallet: WalletEntry): Promise<DecryptedWallet> {
    const password = getOrCreateWalletPassword();
    return decryptWallet(wallet, password);
}

/**
 * Migrate all legacy wallets to encrypted format
 * Call this once when the app starts
 */
export async function migrateLegacyWallets(): Promise<{ migrated: number; total: number }> {
    const wallets = loadWallets();
    const legacyWallets = wallets.filter((w) => !w.encrypted && !isEncrypted(w.privateKey));

    if (legacyWallets.length === 0) {
        return { migrated: 0, total: wallets.length };
    }

    await saveWallets(wallets);

    // Remove legacy storage after successful migration
    localStorage.removeItem(LEGACY_STORAGE_KEY);

    return { migrated: legacyWallets.length, total: wallets.length };
}

/**
 * Export wallet with decrypted private key (for backup)
 * WARNING: This exposes the private key - use with caution
 */
export async function exportWallet(wallet: WalletEntry): Promise<DecryptedWallet & { exportedAt: number }> {
    const decrypted = await getDecryptedWallet(wallet);
    return {
        ...decrypted,
        exportedAt: Date.now(),
    };
}

/**
 * Check if a wallet is encrypted
 */
export function isWalletEncrypted(wallet: WalletEntry): boolean {
    return wallet.encrypted || isEncrypted(wallet.privateKey);
}
