import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load .env file if it exists (for self-hosted instances)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Configuration paths
const CONFIG_DIR = path.join(os.homedir(), '.dev-timr');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const QUEUE_FILE = path.join(CONFIG_DIR, 'queue.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Ensure config directory exists
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Shared instance credentials (collaboration-enabled default)
// These are rotated periodically and protected by Row Level Security (RLS)
// For self-hosted instances, override via environment variables or .env file
const SHARED_INSTANCE = {
  supabaseUrl: 'https://dwjiceshuiwpmglkzdcv.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3amljZXNodWl3cG1nbGt6ZGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMjA5NTIsImV4cCI6MjA4Mzg5Njk1Mn0.hIEeMaVF_EZ1j0gqvCketg4FIcGdWL6LVAIjtfKuIJs',
  githubClientId: 'Ov23lisr5QBFJRlbInmZ',
};

// Configuration priority: 1. Environment variables, 2. Config file, 3. Shared instance
const defaultConfig = {
  supabaseUrl: process.env.SUPABASE_URL || SHARED_INSTANCE.supabaseUrl,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || SHARED_INSTANCE.supabaseAnonKey,
  githubClientId: process.env.GITHUB_CLIENT_ID || SHARED_INSTANCE.githubClientId,
};

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

// Lazy-loaded encryption functions (avoid circular dependency)
let encryptFn = null;
let decryptFn = null;

async function getEncryptionFunctions() {
  if (!encryptFn || !decryptFn) {
    const secureStorage = await import('./secure-storage.js');
    encryptFn = secureStorage.encrypt;
    decryptFn = secureStorage.decrypt;
  }
  return { encrypt: encryptFn, decrypt: decryptFn };
}

// Load config from file if exists (handles encrypted and legacy plaintext)
function loadConfig() {
  ensureConfigDir();

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');

      if (isEncrypted(content)) {
        // For encrypted content, use cached decrypt if available
        if (decryptFn) {
          const fileConfig = decryptFn(content);
          if (fileConfig) {
            return { ...defaultConfig, ...fileConfig };
          }
        }
        // If no decrypt available, return defaults (init encryption first)
        return defaultConfig;
      } else {
        // Legacy plaintext - parse and return (will be encrypted on next save)
        const fileConfig = JSON.parse(content);
        return { ...defaultConfig, ...fileConfig };
      }
    } catch (err) {
      // Ignore parse errors, use defaults
      console.error('[Config] Failed to load config:', err.message);
    }
  }

  return defaultConfig;
}

// Save config to file (encrypted)
export async function saveConfig(newConfig) {
  ensureConfigDir();
  const currentConfig = loadConfig();
  const mergedConfig = { ...currentConfig, ...newConfig };

  try {
    const { encrypt } = await getEncryptionFunctions();
    const encrypted = encrypt(mergedConfig);
    fs.writeFileSync(CONFIG_FILE, encrypted, { mode: 0o600 });
  } catch {
    // Fallback to plaintext if encryption fails
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2), { mode: 0o600 });
  }

  return mergedConfig;
}

// Check if using shared instance or custom instance
export function isUsingSharedInstance() {
  const currentConfig = loadConfig();
  return currentConfig.supabaseUrl === SHARED_INSTANCE.supabaseUrl;
}

// Export configuration
export const config = {
  ...loadConfig(),
  paths: {
    configDir: CONFIG_DIR,
    authFile: AUTH_FILE,
    queueFile: QUEUE_FILE,
    configFile: CONFIG_FILE,
  },
};

// Check if properly configured
export function isConfigured() {
  return !!(config.supabaseUrl && config.supabaseAnonKey && config.githubClientId);
}

// Get Supabase config
export function getSupabaseConfig() {
  return {
    url: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
  };
}

// Get GitHub config
export function getGitHubConfig() {
  return {
    clientId: config.githubClientId,
  };
}

export default config;
