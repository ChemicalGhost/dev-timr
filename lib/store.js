import fs from 'fs';
import path from 'path';

const STORE_FILE = '.dev-clock.json';

function getStorePath() {
  return path.resolve(process.cwd(), STORE_FILE);
}

function readStore() {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return { sessions: [] };
  }
  try {
    const data = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { sessions: [] };
  }
}

function writeStore(data) {
  const storePath = getStorePath();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

export function addSession(session) {
  const store = readStore();
  store.sessions.push(session);
  writeStore(store);
}

export function getStats() {
  const store = readStore();
  const now = new Date();
  const todayString = now.toISOString().split('T')[0];

  let totalMs = 0;
  let todayMs = 0;

  for (const session of store.sessions) {
    const duration = session.end - session.start;
    if (duration > 0) {
        totalMs += duration;
        
        const sessionDate = new Date(session.start).toISOString().split('T')[0];
        if (sessionDate === todayString) {
            todayMs += duration;
        }
    }
  }

  return {
    totalMs,
    todayMs
  };
}
