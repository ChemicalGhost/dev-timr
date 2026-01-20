import fs from 'fs';
import config from './config.js';
import { syncSession } from './api.js';
import { encrypt, decrypt } from './secure-storage.js';

const QUEUE_FILE = config.paths.queueFile;

/**
 * Ensure the config directory exists
 */
function ensureQueueDir() {
    const dir = config.paths.configDir;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Validate queue data structure
 */
function validateQueueData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.sessions)) return false;
    // Ensure each session has required fields
    for (const session of data.sessions) {
        if (typeof session.start !== 'number' || typeof session.end !== 'number') {
            return false;
        }
    }
    return true;
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
 * Read the queue from file with validation (handles encrypted and legacy plaintext)
 */
function readQueue() {
    ensureQueueDir();
    if (!fs.existsSync(QUEUE_FILE)) {
        return { sessions: [], lastSyncAttempt: null };
    }
    try {
        const content = fs.readFileSync(QUEUE_FILE, 'utf8');

        let data;
        if (isEncrypted(content)) {
            data = decrypt(content);
            if (!data) {
                console.error('[Queue] Failed to decrypt queue file, resetting');
                return { sessions: [], lastSyncAttempt: null };
            }
        } else {
            // Legacy plaintext - parse and migrate to encrypted
            data = JSON.parse(content);
            // Re-save as encrypted
            writeQueue(data);
        }

        if (!validateQueueData(data)) {
            console.error('[Queue] Integrity warning: Invalid queue data structure, resetting');
            return { sessions: [], lastSyncAttempt: null };
        }

        return data;
    } catch (err) {
        console.error('[Queue] Failed to read queue file:', err.message);
        return { sessions: [], lastSyncAttempt: null };
    }
}

/**
 * Write the queue to file (encrypted)
 */
function writeQueue(queue) {
    ensureQueueDir();
    const encrypted = encrypt(queue);
    fs.writeFileSync(QUEUE_FILE, encrypted, { mode: 0o600 });
}

/**
 * Add a session to the offline queue
 * @param {Object} session - Session data with start, end, taskName, clientId, repo
 */
export function queueSession(session) {
    const queue = readQueue();

    // Add metadata for queue management
    const queuedSession = {
        ...session,
        queuedAt: Date.now(),
        syncAttempts: 0,
        lastError: null,
    };

    queue.sessions.push(queuedSession);
    writeQueue(queue);

    return queuedSession;
}

/**
 * Remove a session from the queue by clientId
 */
export function removeFromQueue(clientId) {
    const queue = readQueue();
    queue.sessions = queue.sessions.filter((s) => s.clientId !== clientId);
    writeQueue(queue);
}

/**
 * Get count of queued sessions
 */
export function getQueuedCount() {
    const queue = readQueue();
    return queue.sessions.length;
}

/**
 * Get all queued sessions
 */
export function getQueuedSessions() {
    const queue = readQueue();
    return queue.sessions;
}

/**
 * Process the queue - attempt to sync all pending sessions
 * @returns {Object} Result with synced and failed counts
 */
export async function processQueue() {
    const queue = readQueue();

    if (queue.sessions.length === 0) {
        return { synced: 0, failed: 0, remaining: 0 };
    }

    queue.lastSyncAttempt = Date.now();

    let synced = 0;
    let failed = 0;
    const remaining = [];

    for (const session of queue.sessions) {
        try {
            // Attempt to sync to cloud
            await syncSession(session);
            synced++;
        } catch (err) {
            // Update retry metadata
            session.syncAttempts++;
            session.lastError = err.message;

            // Keep in queue if under max retries (10 attempts with exponential backoff)
            if (session.syncAttempts < 10) {
                remaining.push(session);
            }
            failed++;
        }
    }

    // Update queue with remaining sessions
    queue.sessions = remaining;
    writeQueue(queue);

    return { synced, failed, remaining: remaining.length };
}

/**
 * Clear all queued sessions (use with caution)
 */
export function clearQueue() {
    writeQueue({ sessions: [], lastSyncAttempt: null });
}

/**
 * Get queue statistics
 */
export function getQueueStats() {
    const queue = readQueue();

    const stats = {
        count: queue.sessions.length,
        lastSyncAttempt: queue.lastSyncAttempt,
        oldestSession: null,
        totalRetries: 0,
    };

    if (queue.sessions.length > 0) {
        stats.oldestSession = Math.min(...queue.sessions.map((s) => s.queuedAt));
        stats.totalRetries = queue.sessions.reduce((sum, s) => sum + s.syncAttempts, 0);
    }

    return stats;
}

export default {
    queueSession,
    removeFromQueue,
    getQueuedCount,
    getQueuedSessions,
    processQueue,
    clearQueue,
    getQueueStats,
};
