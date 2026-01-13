#! /usr/bin/env node

import { getLocalSessions } from '../lib/store.js';
import { syncSession } from '../lib/api.js';
import { isLoggedIn } from '../lib/auth.js';
import { getRepoInfo, isGitRepo } from '../lib/git.js';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import path from 'path';

async function migrate() {
    console.log(chalk.bold.blue('\n📦 dev-timr Data Migration\n'));

    if (!isLoggedIn()) {
        console.error(chalk.red('❌ You must be logged in to migrate data.'));
        console.log('Run `dev-timr login` first.');
        process.exit(1);
    }

    if (!isGitRepo()) {
        console.error(chalk.red('❌ Current directory is not a git repository.'));
        console.log('Please run migration from the root of your project.');
        process.exit(1);
    }

    const sessions = getLocalSessions();
    if (sessions.length === 0) {
        console.log(chalk.yellow('⚠️  No local sessions found to migrate.'));
        process.exit(0);
    }

    const repoInfo = getRepoInfo();
    console.log(`Repository: ${chalk.bold(repoInfo.fullName)}`);
    console.log(`Found ${chalk.cyan(sessions.length)} local sessions to migrate.`);

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Start migration?',
            default: true
        }
    ]);

    if (!confirm) {
        console.log(chalk.gray('Migration cancelled.'));
        process.exit(0);
    }

    const spinner = ora('Migrating sessions...').start();

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const session of sessions) {
        try {
            // Check session validity
            if (!session.start || !session.end) {
                skipped++;
                continue;
            }

            // Prepare session object
            // Use existing taskName if available, otherwise null
            // We generate a clientId if missing to avoid duplicates on re-run
            const sessionData = {
                start: session.start,
                end: session.end,
                taskName: session.taskName || null,
                clientId: session.clientId || `legacy-${session.start}-${session.end}`,
                repo: repoInfo // Explicitly pass repo info
            };

            await syncSession(sessionData);
            success++;

            // Update spinner text occasionally
            if (success % 5 === 0) {
                spinner.text = `Migrating sessions... (${success}/${sessions.length})`;
            }

        } catch (err) {
            // Silent fail for individual sessions, likely duplicates
            failed++;
        }
    }

    spinner.succeed('Migration complete!');

    console.log('\nSummary:');
    console.log(chalk.green(`✅ Synced: ${success}`));
    if (failed > 0) console.log(chalk.yellow(`⚠️  Failed/Duplicates: ${failed}`));
    if (skipped > 0) console.log(chalk.gray(`⏭️  Skipped (Invalid): ${skipped}`));

    console.log(chalk.gray('\nNote: Your local file (.dev-clock.json) was not deleted as a backup.'));
}

// Check if run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    migrate();
}

export default migrate;
