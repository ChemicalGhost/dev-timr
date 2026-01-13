import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Parse git remote URL to extract owner and repo name
 * Supports both HTTPS and SSH formats:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 */
function parseGitUrl(url) {
    if (!url) return null;

    // Remove trailing .git if present
    url = url.replace(/\.git$/, '').trim();

    // SSH format: git@github.com:owner/repo
    const sshMatch = url.match(/git@[\w.-]+:(.+)\/(.+)$/);
    if (sshMatch) {
        return {
            owner: sshMatch[1],
            repo: sshMatch[2],
            fullName: `${sshMatch[1]}/${sshMatch[2]}`,
        };
    }

    // HTTPS format: https://github.com/owner/repo
    const httpsMatch = url.match(/https?:\/\/[\w.-]+\/(.+)\/(.+)$/);
    if (httpsMatch) {
        return {
            owner: httpsMatch[1],
            repo: httpsMatch[2],
            fullName: `${httpsMatch[1]}/${httpsMatch[2]}`,
        };
    }

    return null;
}

/**
 * Get the git remote origin URL from current directory
 */
function getOriginUrl() {
    try {
        // Try using git command first (more reliable)
        const url = execSync('git config --get remote.origin.url', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return url;
    } catch (err) {
        // Fall back to parsing .git/config file
        try {
            const gitConfigPath = path.join(process.cwd(), '.git', 'config');
            if (!fs.existsSync(gitConfigPath)) {
                return null;
            }

            const content = fs.readFileSync(gitConfigPath, 'utf8');
            const match = content.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
            return match ? match[1].trim() : null;
        } catch (err) {
            return null;
        }
    }
}

/**
 * Check if current directory is a git repository
 */
export function isGitRepo() {
    try {
        execSync('git rev-parse --git-dir', {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return true;
    } catch (err) {
        return fs.existsSync(path.join(process.cwd(), '.git'));
    }
}

/**
 * Get repository information from current directory
 * @returns {{ owner: string, repo: string, fullName: string } | null}
 */
export function getRepoInfo() {
    if (!isGitRepo()) {
        return null;
    }

    const originUrl = getOriginUrl();
    if (!originUrl) {
        return null;
    }

    return parseGitUrl(originUrl);
}

/**
 * Get current git branch name
 */
export function getCurrentBranch() {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch (err) {
        return null;
    }
}

/**
 * Get current git user name (from git config)
 */
export function getGitUserName() {
    try {
        return execSync('git config user.name', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch (err) {
        return null;
    }
}

/**
 * Get current git user email (from git config)
 */
export function getGitUserEmail() {
    try {
        return execSync('git config user.email', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    } catch (err) {
        return null;
    }
}

export default {
    getRepoInfo,
    isGitRepo,
    getCurrentBranch,
    getGitUserName,
    getGitUserEmail,
};
