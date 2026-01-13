import fs from 'fs';
import path from 'path';
import os from 'os';

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

// Default configuration - will be overridden by environment or config file
const defaultConfig = {
  // Hardcoded keys for immediate usage after npm install
  supabaseUrl: process.env.SUPABASE_URL || 'https://dwjiceshuiwpmglkzdcv.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3amljZXNodWl3cG1nbGt6ZGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMjA5NTIsImV4cCI6MjA4Mzg5Njk1Mn0.hIEeMaVF_EZ1j0gqvCketg4FIcGdWL6LVAIjtfKuIJs',
  githubClientId: process.env.GITHUB_CLIENT_ID || 'Ov23lisr5QBFJRlbInmZ',
};

// Load config from file if exists
function loadConfig() {
  ensureConfigDir();

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...defaultConfig, ...fileConfig };
    } catch (err) {
      // Ignore parse errors, use defaults
    }
  }

  return defaultConfig;
}

// Save config to file
export function saveConfig(newConfig) {
  ensureConfigDir();
  const currentConfig = loadConfig();
  const mergedConfig = { ...currentConfig, ...newConfig };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2));
  return mergedConfig;
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
