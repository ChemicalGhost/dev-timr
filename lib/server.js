import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { getStats, getLocalStats, getLocalDailyBreakdown, getLocalTaskBreakdown, getUISettings, saveUISettings } from './store.js';
import { getDuration, getCurrentTaskName, pauseSession, resumeSession, isPausedState } from './tracker.js';
import { getQueuedCount } from './queue.js';
import { getDailyBreakdown, getTaskBreakdown, getTeamContributions, getRepoStats } from './api.js';
import { isLoggedIn } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 0; // Let OS choose available port

/**
 * Input validation helpers
 */
function parseBoolean(value, defaultValue = false) {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return defaultValue;
}

function parsePositiveInt(value, defaultValue, max = 1000) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) return defaultValue;
    return Math.min(num, max);
}

/**
 * Simple in-memory rate limiter
 * Limits requests per IP to prevent abuse from local processes
 */
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;    // 100 requests per minute

function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    // Clean old entries
    if (!rateLimitMap.has(ip) || now - rateLimitMap.get(ip).startTime > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, startTime: now });
        return next();
    }

    const entry = rateLimitMap.get(ip);
    entry.count++;

    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }

    next();
}

app.use(rateLimiter);

/**
 * Security headers middleware
 */
app.use((req, res, next) => {
    // Content Security Policy - restrict resource loading (tightened)
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +  // Allow Chart.js CDN
        "style-src 'self' 'unsafe-inline'; " +   // Allow inline styles (required for dynamic styling)
        "img-src 'self' data: https:; " +        // HTTPS only for external images
        "connect-src 'self'"                      // Allow XHR/fetch to same origin
    );
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Enable XSS filtering
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Cache for base stats to avoid frequent DB/File reads during streaming
let baseStatsCache = { totalMs: 0, todayMs: 0, weekMs: 0, monthMs: 0 };
let lastCacheUpdate = 0;

async function updateBaseStats() {
    const now = Date.now();
    if (now - lastCacheUpdate > 60000) { // Update every minute
        baseStatsCache = await getStats();
        lastCacheUpdate = now;
    }
    return baseStatsCache;
}

// Initial fetch
updateBaseStats();

app.get('/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendUpdate = async () => {
        const currentDuration = getDuration();
        const taskName = getCurrentTaskName();
        const queuedCount = getQueuedCount();

        // Refresh base stats occasionally
        if (Date.now() - lastCacheUpdate > 60000) {
            await updateBaseStats();
        }

        const data = {
            currentSession: currentDuration,
            taskName: taskName || 'No Task',
            // Add current session to cached totals
            todayTotal: (baseStatsCache.todayMs || 0) + currentDuration,
            allTimeTotal: (baseStatsCache.totalMs || 0) + currentDuration,
            weekTotal: (baseStatsCache.weekMs || 0) + currentDuration,
            monthTotal: (baseStatsCache.monthMs || 0) + currentDuration,
            queued: queuedCount,
            isOffline: !isLoggedIn(),
            isPaused: isPausedState()
        };

        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const intervalId = setInterval(sendUpdate, 1000);
    sendUpdate(); // Send immediately

    req.on('close', () => {
        clearInterval(intervalId);
    });
});

/**
 * API: Get daily breakdown
 * Returns cloud data if logged in, local otherwise
 */
app.get('/api/daily', async (req, res) => {
    try {
        const personal = parseBoolean(req.query.personal);
        if (isLoggedIn()) {
            try {
                const data = await getDailyBreakdown(null, 30, personal);
                if (data.length > 0) return res.json(data);
            } catch (err) {
                // Ignore cloud error, fall back to local
            }
        }
        res.json(getLocalDailyBreakdown(30));
    } catch (err) {
        console.error('API /api/daily error:', err.message);
        res.status(500).json({ error: 'Failed to load daily breakdown' });
    }
});

/**
 * API: Get task breakdown
 */
app.get('/api/tasks', async (req, res) => {
    try {
        const personal = parseBoolean(req.query.personal);
        if (isLoggedIn()) {
            try {
                const data = await getTaskBreakdown(null, personal);
                if (data.length > 0) return res.json(data);
            } catch (err) {
                // Fallback
            }
        }
        res.json(getLocalTaskBreakdown());
    } catch (err) {
        console.error('API /api/tasks error:', err.message);
        res.status(500).json({ error: 'Failed to load task breakdown' });
    }
});

/**
 * API: Get team contributions
 */
app.get('/api/team', async (req, res) => {
    try {
        if (isLoggedIn()) {
            const data = await getTeamContributions();
            res.json(data);
        } else {
            res.json([]); // No team data locally
        }
    } catch (err) {
        console.error('API /api/team error:', err.message);
        res.status(500).json({ error: 'Failed to load team data' });
    }
});

/**
 * API: Force manual sync of offline queue
 */
app.post('/api/sync', async (req, res) => {
    // Logic to trigger sync if needed
    res.json({ success: true });
});

/**
 * API: Get UI settings
 */
app.get('/api/settings', (req, res) => {
    try {
        const settings = getUISettings();
        res.json(settings || {});
    } catch (err) {
        console.error('API /api/settings GET error:', err.message);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

/**
 * API: Save UI settings
 */
app.use(express.json()); // Enable JSON body parsing
app.post('/api/settings', (req, res) => {
    try {
        const settings = req.body;
        saveUISettings(settings);
        res.json({ success: true });
    } catch (err) {
        console.error('API /api/settings POST error:', err.message);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

/**
 * API: Pause timer
 */
app.post('/api/pause', (req, res) => {
    const success = pauseSession();
    res.json({ success, isPaused: isPausedState() });
});

/**
 * API: Resume timer
 */
app.post('/api/resume', (req, res) => {
    const success = resumeSession();
    res.json({ success, isPaused: isPausedState() });
});

export function startServer() {
    return new Promise((resolve) => {
        const server = app.listen(PORT, () => {
            const address = server.address();
            const port = address.port;
            const url = `http://localhost:${port}`;
            console.log(`Open GUI at ${url}`);
            open(url).catch(err => console.error('Failed to open browser:', err));
            resolve(server);
        });
    });
}
