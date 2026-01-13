import fs from 'fs';
import https from 'https';
import { createClient } from '@supabase/supabase-js';
import config, { getSupabaseConfig, getGitHubConfig } from './config.js';
import chalk from 'chalk';

const AUTH_FILE = config.paths.authFile;

/**
 * Ensure the config directory exists
 */
function ensureAuthDir() {
    const dir = config.paths.configDir;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Read stored authentication data
 */
function readAuthData() {
    ensureAuthDir();
    if (!fs.existsSync(AUTH_FILE)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    } catch (err) {
        return null;
    }
}

/**
 * Write authentication data to file
 */
function writeAuthData(data) {
    ensureAuthDir();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Clear stored authentication data
 */
export function clearAuthData() {
    if (fs.existsSync(AUTH_FILE)) {
        fs.unlinkSync(AUTH_FILE);
    }
}

/**
 * Make HTTPS request helper
 */
function httpsRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (err) {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

/**
 * Start GitHub Device Flow authentication
 * Returns device code info for user to complete auth
 */
export async function startDeviceFlow() {
    const { clientId } = getGitHubConfig();

    if (!clientId) {
        throw new Error('GitHub Client ID not configured. Please set GITHUB_CLIENT_ID environment variable or run setup.');
    }

    const response = await httpsRequest({
        hostname: 'github.com',
        path: '/login/device/code',
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    }, `client_id=${clientId}&scope=read:user,user:email`);

    if (response.status !== 200) {
        throw new Error(`Failed to start device flow: ${JSON.stringify(response.data)}`);
    }

    return {
        deviceCode: response.data.device_code,
        userCode: response.data.user_code,
        verificationUri: response.data.verification_uri,
        expiresIn: response.data.expires_in,
        interval: response.data.interval || 5,
    };
}

/**
 * Poll GitHub for access token after user completes authorization
 */
export async function pollForToken(deviceCode, interval = 5) {
    const { clientId } = getGitHubConfig();

    const poll = async () => {
        const response = await httpsRequest({
            hostname: 'github.com',
            path: '/login/oauth/access_token',
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        }, `client_id=${clientId}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`);

        if (response.data.error === 'authorization_pending') {
            // User hasn't authorized yet, keep polling
            return null;
        }

        if (response.data.error === 'slow_down') {
            // Need to slow down polling
            interval += 5;
            return null;
        }

        if (response.data.error) {
            throw new Error(`GitHub auth error: ${response.data.error_description || response.data.error}`);
        }

        if (response.data.access_token) {
            return response.data.access_token;
        }

        return null;
    };

    // Poll until we get a token or timeout
    const maxAttempts = 60; // ~5 minutes with 5s interval
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const token = await poll();
        if (token) {
            return token;
        }
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }

    throw new Error('Authentication timed out. Please try again.');
}

/**
 * Get GitHub user info using access token
 */
export async function getGitHubUser(accessToken) {
    const response = await httpsRequest({
        hostname: 'api.github.com',
        path: '/user',
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'dev-timr',
        },
    });

    if (response.status !== 200) {
        throw new Error('Failed to get GitHub user info');
    }

    return {
        id: response.data.id,
        login: response.data.login,
        name: response.data.name,
        email: response.data.email,
        avatarUrl: response.data.avatar_url,
    };
}

/**
 * Sign in to Supabase using GitHub access token via Edge Function
 */
export async function signInToSupabase(githubToken) {
    const { url, anonKey } = getSupabaseConfig();

    if (!url || !anonKey) {
        throw new Error('Supabase not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY.');
    }

    // Call our Edge Function to validate GitHub token and get Supabase JWT
    const response = await httpsRequest({
        hostname: url.replace('https://', '').replace('http://', ''),
        path: '/functions/v1/github-login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
            'apikey': anonKey,
        },
    }, JSON.stringify({ github_token: githubToken }));

    if (response.status !== 200) {
        const errorMsg = response.data?.error || response.data?.message || 'Authentication failed';
        throw new Error(`Supabase auth failed: ${errorMsg}`);
    }

    return {
        session: {
            access_token: response.data.access_token,
            expires_at: response.data.expires_at,
        },
        user: response.data.user,
    };
}

/**
 * Complete login flow - stores tokens and user info
 */
export async function completeLogin(githubToken, githubUser, supabaseSession) {
    const authData = {
        github: {
            token: githubToken,
            user: githubUser,
        },
        supabase: {
            accessToken: supabaseSession?.session?.access_token,
            expiresAt: supabaseSession?.session?.expires_at,
            user: supabaseSession?.user,
        },
        createdAt: Date.now(),
    };

    writeAuthData(authData);
    return authData;
}

/**
 * Get current session (if logged in)
 */
export function getSession() {
    const authData = readAuthData();
    if (!authData) {
        return null;
    }

    // Check if Supabase session is expired
    if (authData.supabase?.expiresAt) {
        const expiresAt = authData.supabase.expiresAt * 1000; // Convert to ms
        if (Date.now() > expiresAt) {
            // Token expired - need refresh
            return { ...authData, expired: true };
        }
    }

    return authData;
}

/**
 * Get Supabase client with current session
 */
export function getSupabaseClient() {
    const { url, anonKey } = getSupabaseConfig();

    if (!url || !anonKey) {
        return null;
    }

    const session = getSession();

    // Create client with custom auth header if we have a session
    if (session?.supabase?.accessToken) {
        const supabase = createClient(url, anonKey, {
            global: {
                headers: {
                    Authorization: `Bearer ${session.supabase.accessToken}`,
                },
            },
        });
        return supabase;
    }

    return createClient(url, anonKey);
}

/**
 * Check if user is logged in
 */
export function isLoggedIn() {
    const session = getSession();
    return session !== null && !session.expired;
}

/**
 * Get current user info
 */
export function getCurrentUser() {
    const session = getSession();
    if (!session) return null;

    return {
        id: session.supabase?.user?.id,
        githubUsername: session.github?.user?.login,
        githubId: session.github?.user?.id,
        name: session.github?.user?.name,
        email: session.github?.user?.email,
        avatarUrl: session.github?.user?.avatarUrl,
    };
}

/**
 * Logout - clear all stored auth data
 */
export function logout() {
    clearAuthData();
}

export default {
    startDeviceFlow,
    pollForToken,
    getGitHubUser,
    signInToSupabase,
    completeLogin,
    getSession,
    getSupabaseClient,
    isLoggedIn,
    getCurrentUser,
    logout,
};
