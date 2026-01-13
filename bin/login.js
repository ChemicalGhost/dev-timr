#! /usr/bin/env node

import {
    startDeviceFlow,
    pollForToken,
    getGitHubUser,
    signInToSupabase,
    completeLogin,
    isLoggedIn,
    logout
} from '../lib/auth.js';
import { ensureUserProfile } from '../lib/api.js';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import inquirer from 'inquirer';

async function login() {
    console.log(chalk.bold.blue('\n🔐 dev-timr Login (via GitHub)\n'));

    if (isLoggedIn()) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: 'You are already logged in. Do you want to log out and sign in again?',
                default: false
            }
        ]);

        if (!confirm) {
            console.log(chalk.green('✅ Already logged in.'));
            process.exit(0);
        }

        logout();
    }

    const spinner = ora('Initializing GitHub Device Flow...').start();

    try {
        // 1. Start Device Flow
        const { deviceCode, userCode, verificationUri, interval } = await startDeviceFlow();
        spinner.stop();

        console.log(chalk.yellow('⚠️  First Copy your one-time code: ') + chalk.bold.white(userCode));
        console.log(chalk.cyan(`👉 Then Visit: ${verificationUri}`));

        // Auto-open browser
        try {
            await open(verificationUri);
        } catch (err) {
            // Ignore if browser fails to open
        }

        const pollSpinner = ora('Waiting for authentication...').start();

        // 2. Poll for token
        const githubToken = await pollForToken(deviceCode, interval);
        pollSpinner.text = 'Verifying GitHub account...';

        // 3. Get GitHub User
        const githubUser = await getGitHubUser(githubToken);
        pollSpinner.text = `Welcome, @${githubUser.login}! Connecting to Supabase...`;

        // 4. Connect to Supabase
        const supabaseSession = await signInToSupabase(githubToken);

        // 5. Complete Login
        await completeLogin(githubToken, githubUser, supabaseSession);

        // 6. Ensure profile exists
        await ensureUserProfile(githubUser);

        pollSpinner.succeed(chalk.green(`Successfully logged in as @${githubUser.login}!`));
        console.log(chalk.gray('\nYour sessions will now be synced to the cloud.'));

    } catch (error) {
        spinner.stop();
        console.error(chalk.red('\n❌ Login failed:'), error.message);
        process.exit(1);
    }
}

// Check if run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    login();
}

export default login;
