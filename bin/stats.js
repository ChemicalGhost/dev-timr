#! /usr/bin/env node

import { getRepoStats, getTeamContributions } from '../lib/api.js';
import { getStats as getLocalStats } from '../lib/store.js';
import { getRepoInfo as getGitRepoInfo } from '../lib/git.js';
import { isLoggedIn, getCurrentUser } from '../lib/auth.js';
import chalk from 'chalk';
import ora from 'ora';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Helper to format milliseconds to human readable string
function formatDuration(ms) {
    if (!ms) return '0m';

    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

async function showStats() {
    const argv = yargs(hideBin(process.argv))
        .option('me', {
            alias: 'm',
            type: 'boolean',
            description: 'Show only my stats'
        })
        .option('repo', {
            alias: 'r',
            type: 'string',
            description: 'Show stats for specific repo (owner/repo)'
        })
        .help()
        .argv;

    console.log(chalk.bold.blue('\n📊 dev-timr Stats\n'));

    // Determine target repo
    let repoInfo = null;
    if (argv.repo) {
        const parts = argv.repo.split('/');
        if (parts.length === 2) {
            repoInfo = { owner: parts[0], repo: parts[1], fullName: argv.repo };
        } else {
            console.error(chalk.red('Invalid repo format. Use "owner/repo"'));
            process.exit(1);
        }
    } else {
        repoInfo = getGitRepoInfo();
    }

    if (!repoInfo) {
        console.error(chalk.red('❌ Not in a git repository.'));
        console.log('Use --repo owner/repo to view stats for a specific repository.');
        process.exit(1);
    }

    console.log(`Repository: ${chalk.bold(repoInfo.fullName)}`);
    if (argv.me) {
        console.log(chalk.gray('(Personal stats only)'));
    } else if (isLoggedIn()) {
        console.log(chalk.gray('(Team aggregate stats)'));
    }

    const spinner = ora('Fetching stats...').start();

    try {
        let stats = null;
        let contributions = [];

        if (isLoggedIn()) {
            // Cloud fetch
            stats = await getRepoStats(repoInfo.fullName, argv.me);
            if (!argv.me) {
                contributions = await getTeamContributions(repoInfo.fullName);
            }
        } else {
            // Local fallback
            if (argv.me) {
                spinner.warn('Not logged in. Showing local stats only.');
            } else {
                spinner.warn('Not logged in. Showing local stats (no team data).');
            }
            stats = await getLocalStats(true); // force local
        }

        spinner.stop();

        if (!stats) {
            console.log(chalk.yellow('\nNo stats found for this repository.'));
            return;
        }

        // Display Summary Table
        console.log('\n┌─────────────────┬─────────────────┐');
        console.log(`│ ${chalk.white('Period')}          │ ${chalk.white('Time')}            │`);
        console.log('├─────────────────┼─────────────────┤');
        console.log(`│ Today           │ ${chalk.green(formatDuration(stats.todayMs).padEnd(15))} │`);
        console.log(`│ This Week       │ ${chalk.cyan(formatDuration(stats.weekMs).padEnd(15))} │`);
        console.log(`│ This Month      │ ${chalk.blue(formatDuration(stats.monthMs).padEnd(15))} │`);
        console.log(`│ All Time        │ ${chalk.bold(formatDuration(stats.totalMs).padEnd(15))} │`);
        console.log('└─────────────────┴─────────────────┘');

        // Display Team Contributions (if applicable)
        if (!argv.me && contributions.length > 0) {
            console.log(chalk.bold('\n👥 Team Contributions'));
            console.log('─────────────────────');

            const maxDuration = Math.max(...contributions.map(c => c.totalMs));

            contributions.forEach(member => {
                const username = member.username.padEnd(20);
                const time = formatDuration(member.totalMs).padStart(10);

                // Simple bar chart
                const barLength = 20;
                const filled = Math.floor((member.totalMs / maxDuration) * barLength);
                const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

                console.log(`${chalk.cyan(username)} ${bar} ${time}`);
            });
        }

    } catch (err) {
        spinner.stop();
        console.error(chalk.red('\n❌ Failed to fetch stats:'), err.message);
    }
}

// Check if run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    showStats();
}

export default showStats;
