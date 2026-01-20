import fs from 'fs';
import https from 'https';
import { createClient } from '@supabase/supabase-js';
import config, { getSupabaseConfig, getGitHubConfig } from './config.js';
import chalk from 'chalk';
import { readSecureAuthData, writeSecureAuthData, clearSecureAuthData } from './secure-storage.js';

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
 * Read stored authentication data (now using secure encrypted storage)
 */
function readAuthData() {
    return readSecureAuthData();
}

/**
 * Write authentication data (now using secure encrypted storage)
 */
function writeAuthData(data) {
    writeSecureAuthData(data);
}

/**
 * Clear stored authentication data
 */
export function clearAuthData() {
    clearSecureAuthData();
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
            const token = response.data.access_token;
            // Clear token from response object to reduce memory exposure
            response.data.access_token = undefined;
            return token;
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

    // Extract tokens and clear from response to reduce memory exposure
    const result = {
        session: {
            access_token: response.data.access_token,
            expires_at: response.data.expires_at,
        },
        user: response.data.user,
    };

    // Clear sensitive data from response object
    response.data.access_token = undefined;
    response.data = undefined;

    return result;
}

/**
 * Check if token should be refreshed (less than 24 hours remaining)
 */
export function shouldRefreshToken(expiresAt) {
    if (!expiresAt) return false;
    const msRemaining = (expiresAt * 1000) - Date.now();
    const hoursRemaining = msRemaining / (1000 * 60 * 60);
    return hoursRemaining > 0 && hoursRemaining < 24;
}

/**
 * Refresh the Supabase JWT using the stored GitHub token
 * @returns {Promise<boolean>} true if refresh succeeded, false if re-login needed
 */
export async function refreshToken() {
    const authData = readAuthData();
    if (!authData?.github?.token) {
        return { success: false, requiresReauth: true };
    }

    const { url, anonKey } = getSupabaseConfig();
    if (!url || !anonKey) {
        return { success: false, requiresReauth: true };
    }

    try {
        const response = await httpsRequest({
            hostname: url.replace('https://', '').replace('http://', ''),
            path: '/functions/v1/token-refresh',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${anonKey}`,
                'apikey': anonKey,
            },
        }, JSON.stringify({
            github_token: authData.github.token,
            current_jwt: authData.supabase?.accessToken
        }));

        if (response.status !== 200) {
            const requiresReauth = response.data?.requiresReauth || response.data?.code === 'GITHUB_TOKEN_INVALID';
            return { success: false, requiresReauth };
        }

        // Update stored auth data with new token
        authData.supabase = {
            ...authData.supabase,
            accessToken: response.data.access_token,
            expiresAt: response.data.expires_at,
            user: response.data.user,
        };
        authData.lastRefresh = Date.now();
        writeAuthData(authData);

        return { success: true, expiresAt: response.data.expires_at };
    } catch (error) {
        console.error('Token refresh failed:', error.message);
        return { success: false, requiresReauth: false };
    }
}

/**
 * Get session with automatic token refresh if needed
 * @returns {Promise<object|null>} Session data or null if not logged in
 */
export async function getSessionWithRefresh() {
    const authData = readAuthData();
    if (!authData) {
        return null;
    }

    const expiresAt = authData.supabase?.expiresAt;

    // Check if token is expired
    if (expiresAt && Date.now() > expiresAt * 1000) {
        // Try to refresh
        const result = await refreshToken();
        if (result.success) {
            return readAuthData(); // Return refreshed data
        }
        return { ...authData, expired: true, requiresReauth: result.requiresReauth };
    }

    // Check if token should be proactively refreshed
    if (shouldRefreshToken(expiresAt)) {
        // Attempt refresh in background, don't block
        refreshToken().catch(() => { }); // Ignore errors, will retry later
    }

    return authData;
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
 * Logout - invalidate token server-side and clear local auth data
 * @param {boolean} silent - If true, don't log errors
 * @returns {Promise<{success: boolean, serverRevoked: boolean}>}
 */
export async function logout(silent = false) {
    const authData = readAuthData();
    let serverRevoked = false;

    // Try to revoke token server-side
    if (authData?.supabase?.accessToken) {
        const { url, anonKey } = getSupabaseConfig();

        if (url && anonKey) {
            try {
                const response = await httpsRequest({
                    hostname: url.replace('https://', '').replace('http://', ''),
                    path: '/functions/v1/logout',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${anonKey}`,
                        'apikey': anonKey,
                    },
                }, JSON.stringify({ access_token: authData.supabase.accessToken }));

                serverRevoked = response.status === 200;
            } catch (error) {
                if (!silent) {
                    console.error('Could not revoke token server-side:', error.message);
                }
            }
        }
    }

    // Always clear local data
    clearAuthData();

    return { success: true, serverRevoked };
}

export default {
    startDeviceFlow,
    pollForToken,
    getGitHubUser,
    signInToSupabase,
    shouldRefreshToken,
    refreshToken,
    getSessionWithRefresh,
    completeLogin,
    getSession,
    getSupabaseClient,
    isLoggedIn,
    getCurrentUser,
    logout,
};
