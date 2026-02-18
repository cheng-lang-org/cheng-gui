/**
 * Secure encryption utilities using Web Crypto API (AES-GCM)
 * Provides encryption/decryption for sensitive data like private keys
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_ITERATIONS = 100000;

/**
 * Derive an encryption key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: KEY_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Encrypt a string value with a password
 * Returns a base64-encoded string containing salt + iv + ciphertext
 */
export async function encryptValue(plaintext: string, password: string): Promise<string> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(password, salt);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(plaintext)
    );

    // Combine salt + iv + ciphertext
    const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, SALT_LENGTH);
    combined.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

    return uint8ArrayToBase64(combined);
}

/**
 * Decrypt a base64-encoded encrypted value with a password
 * Returns the original plaintext string
 */
export async function decryptValue(encryptedBase64: string, password: string): Promise<string> {
    const combined = base64ToUint8Array(encryptedBase64);

    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKey(password, salt);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

/**
 * Check if a string appears to be encrypted (base64 with expected length pattern)
 */
export function isEncrypted(value: string): boolean {
    // Encrypted values start with salt (16 bytes) + iv (12 bytes) = 28 bytes minimum
    // Base64 encoded: ~37+ chars for empty plaintext
    if (!value || value.length < 40) return false;

    // Check if it's valid base64
    try {
        const decoded = base64ToUint8Array(value);
        // Encrypted values should be at least salt + iv length
        return decoded.length >= SALT_LENGTH + IV_LENGTH;
    } catch {
        return false;
    }
}

/**
 * Generate a random wallet password if user doesn't provide one
 * This is stored in sessionStorage (cleared when browser closes)
 */
export function getOrCreateWalletPassword(): string {
    const STORAGE_KEY = 'unimaker_wallet_pwd_v1';
    let password = sessionStorage.getItem(STORAGE_KEY);

    if (!password) {
        // Generate a secure random password
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        password = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
        sessionStorage.setItem(STORAGE_KEY, password);
    }

    return password;
}

/**
 * Clear the wallet password from session storage
 */
export function clearWalletPassword(): void {
    sessionStorage.removeItem('unimaker_wallet_pwd_v1');
}

/**
 * Securely compare two strings in constant time to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
