import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { getStats, getLocalStats, getLocalDailyBreakdown, getLocalTaskBreakdown } from './store.js';
import { getDuration, getCurrentTaskName } from './tracker.js';
import { getQueuedCount } from './queue.js';
import { getDailyBreakdown, getTaskBreakdown, getTeamContributions, getRepoStats } from './api.js';
import { isLoggedIn } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 0; // Let OS choose available port

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
            isOffline: !isLoggedIn()
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
        const personal = req.query.personal === 'true';
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
        res.status(500).json({ error: err.message });
    }
});

/**
 * API: Get task breakdown
 */
app.get('/api/tasks', async (req, res) => {
    try {
        const personal = req.query.personal === 'true';
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
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

/**
 * API: Force manual sync of offline queue
 */
app.post('/api/sync', async (req, res) => {
    // Logic to trigger sync if needed
    res.json({ success: true });
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
