import fs from 'fs';
import path from 'path';
import { queueSession, processQueue, getQueuedCount } from './queue.js';
import { getRepoStats as getCloudStats } from './api.js';
import { isLoggedIn } from './auth.js';
import { getRepoInfo } from './git.js';

const STORE_FILE = '.dev-clock.json';

function getStorePath() {
  return path.resolve(process.cwd(), STORE_FILE);
}

/**
 * Ensure .dev-clock.json is in the project's .gitignore
 */
function ensureGitignore() {
  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  const entry = STORE_FILE;

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      // Check if already present (exact line match)
      const lines = content.split('\n').map(l => l.trim());
      if (lines.includes(entry)) {
        return; // Already there
      }
      // Append to .gitignore
      const newContent = content.endsWith('\n')
        ? content + entry + '\n'
        : content + '\n' + entry + '\n';
      fs.writeFileSync(gitignorePath, newContent);
      console.log(`Added ${entry} to .gitignore`);
    } else {
      // Create .gitignore with the entry
      fs.writeFileSync(gitignorePath, `# Dev-Timr session data\n${entry}\n`);
      console.log(`Created .gitignore with ${entry}`);
    }
  } catch (err) {
    // Silently fail - not critical
  }
}

/**
 * Validate store data structure
 */
function validateStoreData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.sessions)) return false;
  // Validate each session has required fields
  for (const session of data.sessions) {
    if (typeof session.start !== 'number' || typeof session.end !== 'number') {
      return false;
    }
  }
  return true;
}

/**
 * Read the local store with validation
 */
function readStore() {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return { sessions: [] };
  }
  try {
    const content = fs.readFileSync(storePath, 'utf8');
    const data = JSON.parse(content);

    if (!validateStoreData(data)) {
      console.error('[Store] Integrity warning: Invalid store data structure');
      return { sessions: [] };
    }

    return data;
  } catch (err) {
    console.error('[Store] Failed to read store file:', err.message);
    return { sessions: [] };
  }
}

function writeStore(data) {
  const storePath = getStorePath();
  // Ensure .dev-clock.json is gitignored on first write
  ensureGitignore();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

/**
 * Add a session to the store
 * - Always saves to local file as backup
 * - Immediately syncs to cloud if logged in
 * @param {Object} session - Session with start, end, taskName, clientId
 * @returns {Promise<{local: boolean, cloud: boolean}>}
 */
export async function addSession(session) {
  // Always save to local file first
  const store = readStore();
  store.sessions.push({
    start: session.start,
    end: session.end,
    taskName: session.taskName || null,
    clientId: session.clientId || null,
  });
  writeStore(store);

  let cloudSynced = false;

  // Immediately sync to cloud if logged in
  if (isLoggedIn()) {
    const repo = getRepoInfo();
    if (repo) {
      queueSession({
        ...session,
        repo,
      });

      // Sync immediately and await the result
      try {
        const result = await processQueue();
        if (result.synced > 0) {
          console.log('☁️  Synced to cloud');
          cloudSynced = true;
        } else if (result.failed > 0) {
          console.log('⏳ Queued for sync (will retry)');
        }
      } catch (err) {
        console.log('⏳ Queued for sync:', err.message);
      }
    }
  }

  return { local: true, cloud: cloudSynced };
}

/**
 * Get stats for the current repository
 * - Tries cloud first if logged in
 * - Falls back to local file
 * @param {boolean} forceLocal - Skip cloud lookup
 * @param {boolean} personalOnly - Only return personal stats (cloud only)
 * @returns {Promise<{totalMs, todayMs, weekMs?, monthMs?}>}
 */
export async function getStats(forceLocal = false, personalOnly = false) {
  // Try cloud first if authenticated and not forced local
  if (!forceLocal && isLoggedIn()) {
    try {
      const cloudStats = await getCloudStats(null, personalOnly);
      if (cloudStats) {
        return {
          ...cloudStats,
          source: 'cloud',
          queuedCount: getQueuedCount(),
        };
      }
    } catch (err) {
      console.debug('Cloud stats unavailable, using local:', err.message);
    }
  }

  // Fallback to local calculation
  return getLocalStats();
}

/**
 * Calculate stats from local file only
 */
export function getLocalStats() {
  const store = readStore();
  const now = new Date();
  const todayString = now.toISOString().split('T')[0];
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartTime = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).getTime();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let totalMs = 0;
  let todayMs = 0;
  let weekMs = 0;
  let monthMs = 0;

  for (const session of store.sessions) {
    const duration = session.end - session.start;
    if (duration > 0) {
      totalMs += duration;

      const sessionDate = new Date(session.start).toISOString().split('T')[0];
      if (sessionDate === todayString) {
        todayMs += duration;
      }
      if (session.start >= weekStartTime) {
        weekMs += duration;
      }
      if (session.start >= monthStart) {
        monthMs += duration;
      }
    }
  }

  return {
    totalMs,
    todayMs,
    weekMs,
    monthMs,
    source: 'local',
    queuedCount: getQueuedCount(),
  };
}

/**
 * Get local sessions (for migration)
 */
export function getLocalSessions() {
  const store = readStore();
  return store.sessions;
}

/**
 * Get sessions by task name (local only)
 */
export function getLocalTaskBreakdown() {
  const store = readStore();
  const taskMap = new Map();
  let unnamedTotal = 0;

  for (const session of store.sessions) {
    const duration = session.end - session.start;
    if (duration > 0) {
      if (session.taskName) {
        const current = taskMap.get(session.taskName) || 0;
        taskMap.set(session.taskName, current + duration);
      } else {
        unnamedTotal += duration;
      }
    }
  }

  const result = Array.from(taskMap.entries())
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms);

  if (unnamedTotal > 0) {
    result.push({ name: 'Unnamed Tasks', ms: unnamedTotal });
  }

  return result;
}

/**
 * Get daily breakdown from local data
 */
export function getLocalDailyBreakdown(days = 30) {
  const store = readStore();
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

  // Initialize all days to 0
  const dailyMap = new Map();
  for (let i = 0; i < days; i++) {
    const date = new Date(endDate.getTime() - (i * 24 * 60 * 60 * 1000));
    const dateStr = date.toISOString().split('T')[0];
    dailyMap.set(dateStr, 0);
  }

  // Sum durations by day
  for (const session of store.sessions) {
    if (session.start >= startDate.getTime()) {
      const dateStr = new Date(session.start).toISOString().split('T')[0];
      const duration = session.end - session.start;
      if (duration > 0 && dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, dailyMap.get(dateStr) + duration);
      }
    }
  }

  return Array.from(dailyMap.entries())
    .map(([date, ms]) => ({ date, ms }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get the most recent task name (for continuation)
 */
export function getLastTaskName() {
  const store = readStore();
  for (let i = store.sessions.length - 1; i >= 0; i--) {
    if (store.sessions[i].taskName) {
      return store.sessions[i].taskName;
    }
  }
  return null;
}

/**
 * Get UI settings from local store
 */
export function getUISettings() {
  const store = readStore();
  return store.uiSettings || null;
}

/**
 * Save UI settings to local store (separate from session data)
 */
export function saveUISettings(settings) {
  const store = readStore();
  store.uiSettings = settings;
  writeStore(store);
  return true;
}

// Legacy export for backward compatibility
export { getLocalStats as getStatsSync };
