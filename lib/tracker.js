import spawn from 'cross-spawn';
import { parse } from 'shell-quote';
import { randomUUID } from 'crypto';
import { addSession } from './store.js';

let startTime = null;
let currentTaskName = null;
let sessionClientId = null;
let isPaused = false;
let pausedDuration = 0; // Total accumulated pause time
let pauseStartTime = null; // When current pause started

/**
 * Start a new tracking session
 * @param {string|null} taskName - Optional task name for this session
 */
export function startSession(taskName = null) {
    startTime = Date.now();
    currentTaskName = taskName;
    sessionClientId = randomUUID();
    isPaused = false;
    pausedDuration = 0;
    pauseStartTime = null;

    console.log('🕐 Timer started.');
    if (currentTaskName) {
        console.log(`📋 Task: ${currentTaskName}`);
    }
}

/**
 * Sanitize task name - remove potentially dangerous characters
 * @param {string} name - Raw task name
 * @returns {string|null} Sanitized task name
 */
function sanitizeTaskName(name) {
    if (!name || typeof name !== 'string') return null;

    // Remove control characters, special shell chars, and limit length
    const sanitized = name
        .replace(/[\x00-\x1F\x7F]/g, '')  // Control characters
        .replace(/[<>{}[\]\\|`$]/g, '')   // Shell/HTML special chars
        .trim()
        .slice(0, 100);                    // Max 100 chars

    return sanitized || null;
}

/**
 * Set the task name for the current session
 * @param {string} taskName - Task name to set
 */
export function setTaskName(taskName) {
    currentTaskName = sanitizeTaskName(taskName);
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
 * Pause the current session
 */
export function pauseSession() {
    if (!startTime || isPaused) return false;
    isPaused = true;
    pauseStartTime = Date.now();
    console.log('⏸️  Timer paused.');
    return true;
}

/**
 * Resume the current session
 */
export function resumeSession() {
    if (!startTime || !isPaused) return false;
    // Add the pause duration to total paused time
    pausedDuration += Date.now() - pauseStartTime;
    isPaused = false;
    pauseStartTime = null;
    console.log('▶️  Timer resumed.');
    return true;
}

/**
 * Check if session is paused
 */
export function isPausedState() {
    return isPaused;
}

/**
 * End the current session and save it
 */
export async function endSession() {
    if (!startTime) return;

    // If paused, add current pause duration
    if (isPaused && pauseStartTime) {
        pausedDuration += Date.now() - pauseStartTime;
    }

    const endTime = Date.now();
    const duration = endTime - startTime - pausedDuration;

    // Save session and sync to cloud (awaited)
    await addSession({
        start: startTime,
        end: endTime,
        duration: duration, // Actual working time (excluding pauses)
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
    isPaused = false;
    pausedDuration = 0;
    pauseStartTime = null;
}

/**
 * Get the duration of the current session in milliseconds (excluding paused time)
 */
export function getDuration() {
    if (!startTime) return 0;

    let currentPauseDuration = 0;
    if (isPaused && pauseStartTime) {
        currentPauseDuration = Date.now() - pauseStartTime;
    }

    return Date.now() - startTime - pausedDuration - currentPauseDuration;
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
 * Spawn a child process safely (no shell injection)
 * @param {string} commandString - The command to run
 */
export function spawnChild(commandString) {
    // Parse command string safely without shell interpretation
    // shell-quote returns an array of strings for arguments,
    // and objects for operators like { op: '|' } which we filter out
    const parsed = parse(commandString);

    // Filter out shell operators (objects) - only keep string arguments
    const args = parsed.filter(arg => typeof arg === 'string');

    if (args.length === 0) {
        throw new Error('Invalid command: no executable found');
    }

    const cmd = args.shift();

    // Use shell: false to prevent any shell interpretation
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false });

    // Note: Exit handling is done by the caller to allow for async cleanup
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
