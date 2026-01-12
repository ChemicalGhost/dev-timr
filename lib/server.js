import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { getStats } from './store.js';
import { getDuration } from './tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 0; // Let OS choose available port

app.use(express.static(path.join(__dirname, 'public')));

app.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendStats = () => {
        const stats = getStats();
        const currentDuration = getDuration();

        // Add current session to today's and total stats for real-time display
        // Note: getStats() returns committed sessions. We need to add current running session.
        const data = {
            currentSession: currentDuration,
            todayTotal: stats.todayMs + currentDuration,
            allTimeTotal: stats.totalMs + currentDuration
        };

        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const intervalId = setInterval(sendStats, 1000);
    sendStats(); // Send immediately

    req.on('close', () => {
        clearInterval(intervalId);
    });
});

export function startServer() {
    const server = app.listen(PORT, () => {
        const address = server.address();
        const port = address.port;
        const url = `http://localhost:${port}`;
        console.log(`GUI Timer running at ${url}`);
        open(url).catch(err => console.error('Failed to open browser:', err));
    });
    return server;
}
