/**
 * Secure Token Storage Module (Simplified)
 *
 * Stores sensitive tokens using AES-256-GCM encryption.
 * Uses a machine-specific key derived from system factors.
 *
 * This provides:
 * - Encryption at rest (tokens not readable in plaintext)
 * - Protection against casual snooping
 * - Existing backup systems won't expose usable tokens
 */

import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import config from './config.js';

const AUTH_FILE = config.paths.authFile;

/**
 * Ensure the config directory exists
 */
function ensureAuthDir() {
    const dir = config.paths.configDir;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Generate a machine-specific encryption key
 * Uses a combination of factors for reasonable security
 */
function getEncryptionKey() {
    const factors = [
        process.env.USER || process.env.USERNAME || 'user',
        os.hostname(),
        'dev-timr-secret-v1',
    ].join(':');
    return crypto.createHash('sha256').update(factors).digest();
}

/**
 * Encrypt data
 */
function encrypt(data) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
        v: 1,
        iv: iv.toString('hex'),
        tag: authTag.toString('hex'),
        data: encrypted,
    });
}

/**
 * Decrypt data
 */
function decrypt(encryptedStr) {
    try {
        const { iv, tag, data } = JSON.parse(encryptedStr);
        const key = getEncryptionKey();

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            key,
            Buffer.from(iv, 'hex')
        );
        decipher.setAuthTag(Buffer.from(tag, 'hex'));

        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch {
        return null;
    }
}

/**
 * Check if content is encrypted
 */
function isEncrypted(content) {
    try {
        const parsed = JSON.parse(content);
        return parsed.v === 1 && parsed.iv && parsed.tag && parsed.data;
    } catch {
        return false;
    }
}

/**
 * Read auth data (handles both encrypted and legacy plaintext)
 */
export function readSecureAuthData() {
    ensureAuthDir();
    if (!fs.existsSync(AUTH_FILE)) {
        return null;
    }

    try {
        const content = fs.readFileSync(AUTH_FILE, 'utf8');

        if (isEncrypted(content)) {
            return decrypt(content);
        }

        // Legacy plaintext - read and migrate
        const data = JSON.parse(content);
        // Re-save encrypted
        writeSecureAuthData(data);
        return data;
    } catch {
        return null;
    }
}

/**
 * Write auth data (always encrypted)
 */
export function writeSecureAuthData(data) {
    ensureAuthDir();
    const encrypted = encrypt(data);
    fs.writeFileSync(AUTH_FILE, encrypted, { mode: 0o600 });
}

/**
 * Clear auth data
 */
export function clearSecureAuthData() {
    if (fs.existsSync(AUTH_FILE)) {
        fs.unlinkSync(AUTH_FILE);
    }
}

export default {
    readSecureAuthData,
    writeSecureAuthData,
    clearSecureAuthData,
};
