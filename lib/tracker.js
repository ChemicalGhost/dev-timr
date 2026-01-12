import spawn from 'cross-spawn';
import { addSession } from './store.js';

let startTime = null;

export function startSession() {
    startTime = Date.now();
    console.log('Use [dev-timr] to track your time.');
}

export function endSession() {
    if (!startTime) return;
    const endTime = Date.now();
    addSession({
        start: startTime,
        end: endTime,
    });
    startTime = null;
}

export function getDuration() {
    if (!startTime) return 0;
    return Date.now() - startTime;
}

export function spawnChild(commandString) {
    // Use shell: true to support command strings like "npm run dev" directly
    const child = spawn(commandString, [], { stdio: 'inherit', shell: true });

    child.on('close', (code) => {
        process.exit(code);
    });

    return child;
}
