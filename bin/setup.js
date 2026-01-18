#!/usr/bin/env node

import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { isUsingSharedInstance } from '../lib/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

console.log(chalk.bold.blue('\n🔧 Dev-Timr Setup\n'));

// Check current configuration
if (isUsingSharedInstance()) {
  console.log(chalk.yellow('Currently using the shared instance (default).'));
  console.log(chalk.gray('The shared instance enables collaboration with other users.\n'));
} else {
  console.log(chalk.green('Currently using a custom instance.\n'));
}

// Ask user what they want to do
const { action } = await inquirer.prompt([
  {
    type: 'list',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      {
        name: 'Use shared instance (default - enables collaboration)',
        value: 'shared',
      },
      {
        name: 'Configure custom instance (self-hosted)',
        value: 'custom',
      },
      {
        name: 'View current configuration',
        value: 'view',
      },
      {
        name: 'Exit',
        value: 'exit',
      },
    ],
  },
]);

if (action === 'exit') {
  console.log(chalk.gray('Setup cancelled.\n'));
  process.exit(0);
}

if (action === 'view') {
  console.log(chalk.bold('\nCurrent Configuration:'));
  console.log(chalk.gray('─'.repeat(50)));

  if (isUsingSharedInstance()) {
    console.log(chalk.yellow('Instance Type:'), 'Shared (default)');
    console.log(chalk.gray('Supabase URL:'), 'https://dwjiceshuiwpmglkzdcv.supabase.co');
    console.log(chalk.gray('GitHub Client:'), 'Ov23lisr5QBFJRlbInmZ');
  } else {
    console.log(chalk.green('Instance Type:'), 'Custom');
    if (fs.existsSync(envPath)) {
      console.log(chalk.gray('Configuration:'), '.env file');
    } else {
      console.log(chalk.gray('Configuration:'), 'Environment variables');
    }
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray('\nTo use the shared instance, delete your .env file.'));
  console.log(chalk.gray('To use a custom instance, run'), chalk.cyan('dev-timr setup'), chalk.gray('again.\n'));
  process.exit(0);
}

if (action === 'shared') {
  // Remove .env file if it exists
  if (fs.existsSync(envPath)) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'This will delete your .env file and use the shared instance. Continue?',
        default: false,
      },
    ]);

    if (confirm) {
      fs.unlinkSync(envPath);
      console.log(chalk.green('\n✓ Switched to shared instance successfully!'));
      console.log(chalk.gray('You can now collaborate with other users.\n'));
    } else {
      console.log(chalk.gray('Setup cancelled.\n'));
    }
  } else {
    console.log(chalk.green('\n✓ Already using the shared instance!'));
    console.log(chalk.gray('No changes needed.\n'));
  }
  process.exit(0);
}

if (action === 'custom') {
  console.log(chalk.bold('\n📝 Custom Instance Setup\n'));
  console.log(chalk.gray('You will need:'));
  console.log(chalk.gray('1. A Supabase project (https://supabase.com)'));
  console.log(chalk.gray('2. A GitHub OAuth App (https://github.com/settings/developers)'));
  console.log(chalk.gray('3. Database migrations applied'));
  console.log(chalk.gray('4. Edge Function deployed\n'));

  const { ready } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ready',
      message: 'Do you have these ready?',
      default: false,
    },
  ]);

  if (!ready) {
    console.log(chalk.yellow('\nℹ Setup Guide:'));
    console.log(chalk.gray('1. Create a Supabase project at https://supabase.com'));
    console.log(chalk.gray('2. Apply database schema (see /supabase/migrations/)'));
    console.log(chalk.gray('3. Deploy Edge Function (see /supabase/functions/github-login/)'));
    console.log(chalk.gray('4. Create GitHub OAuth App at https://github.com/settings/developers'));
    console.log(chalk.gray('5. Run'), chalk.cyan('dev-timr setup'), chalk.gray('again when ready\n'));
    process.exit(0);
  }

  // Collect credentials
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'supabaseUrl',
      message: 'Supabase Project URL:',
      validate: (input) => {
        if (!input.startsWith('https://') || !input.includes('.supabase.co')) {
          return 'Please enter a valid Supabase URL (e.g., https://xxx.supabase.co)';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'supabaseAnonKey',
      message: 'Supabase Anon Key:',
      validate: (input) => input.length > 20 || 'Please enter a valid anon key',
    },
    {
      type: 'input',
      name: 'githubClientId',
      message: 'GitHub OAuth Client ID:',
      validate: (input) => input.length > 10 || 'Please enter a valid GitHub Client ID',
    },
  ]);

  // Create .env file
  const envContent = `# Dev-Timr Custom Instance Configuration
# Generated by dev-timr setup on ${new Date().toISOString()}

SUPABASE_URL=${answers.supabaseUrl}
SUPABASE_ANON_KEY=${answers.supabaseAnonKey}
GITHUB_CLIENT_ID=${answers.githubClientId}
`;

  fs.writeFileSync(envPath, envContent, { mode: 0o600 });

  console.log(chalk.green('\n✓ Custom instance configured successfully!'));
  console.log(chalk.gray('\nConfiguration saved to:'), chalk.cyan('.env'));
  console.log(chalk.yellow('\n⚠ Important: Make sure Row Level Security (RLS) is enabled on all tables!'));
  console.log(chalk.gray('See SECURITY.md for RLS policy examples.\n'));

  process.exit(0);
}
