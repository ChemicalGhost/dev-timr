import spawn from 'cross-spawn';
import { randomUUID } from 'crypto';
import { addSession } from './store.js';

let startTime = null;
let currentTaskName = null;
let sessionClientId = null;

/**
 * Start a new tracking session
 * @param {string|null} taskName - Optional task name for this session
 */
export function startSession(taskName = null) {
    startTime = Date.now();
    currentTaskName = taskName;
    sessionClientId = randomUUID();

    console.log('🕐 Timer started.');
    if (currentTaskName) {
        console.log(`📋 Task: ${currentTaskName}`);
    }
}

/**
 * Set the task name for the current session
 * @param {string} taskName - Task name to set
 */
export function setTaskName(taskName) {
    currentTaskName = taskName || null;
    if (currentTaskName) {
        console.log(`📋 Task set: ${currentTaskName}`);
    }
}

/**
 * Get the current task name
 */
export function getCurrentTaskName() {
    return currentTaskName;
}

/**
 * End the current session and save it
 */
export function endSession() {
    if (!startTime) return;

    const endTime = Date.now();
    const duration = endTime - startTime;

    addSession({
        start: startTime,
        end: endTime,
        taskName: currentTaskName,
        clientId: sessionClientId,
    });

    // Format duration for display
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    console.log(`\n⏱️  Session ended: ${hours}h ${minutes}m ${seconds}s`);
    if (currentTaskName) {
        console.log(`📋 Task: ${currentTaskName}`);
    }

    startTime = null;
    currentTaskName = null;
    sessionClientId = null;
}

/**
 * Get the duration of the current session in milliseconds
 */
export function getDuration() {
    if (!startTime) return 0;
    return Date.now() - startTime;
}

/**
 * Get the current session's client ID
 */
export function getSessionClientId() {
    return sessionClientId;
}

/**
 * Check if a session is currently active
 */
export function isSessionActive() {
    return startTime !== null;
}

/**
 * Get the start time of the current session
 */
export function getStartTime() {
    return startTime;
}

/**
 * Spawn a child process and return it
 * @param {string} commandString - The command to run
 */
export function spawnChild(commandString) {
    // Use shell: true to support command strings like "npm run dev" directly
    const child = spawn(commandString, [], { stdio: 'inherit', shell: true });

    child.on('close', (code) => {
        process.exit(code);
    });

    return child;
}

export default {
    startSession,
    setTaskName,
    getCurrentTaskName,
    endSession,
    getDuration,
    getSessionClientId,
    isSessionActive,
    getStartTime,
    spawnChild,
};
