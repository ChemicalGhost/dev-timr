#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { startSession, endSession, spawnChild } from '../lib/tracker.js';
import { startServer } from '../lib/server.js';

const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 <command> [args...]')
    .command('$0 [command..]', 'Run the given command and track time', (yargs) => {
        yargs.positional('command', {
            describe: 'The command to run (e.g., "npm start")',
            type: 'string',
        });
    })
    .help()
    .argv;

if (!argv.command || argv.command.length === 0) {
    console.error(chalk.red('Error: No command provided.'));
    console.log(chalk.yellow('Usage: npx dev-clock-tracker "npm run dev"'));
    process.exit(1);
}

// Reconstruct the full command string
// If user passed `npx dev-clock-tracker npm start`, argv.command is ['npm', 'start']
const fullCommandString = argv.command.join(' ');

console.log(chalk.green(`Starting dev-clock-tracker for: ${fullCommandString}`));

// Handle exit signals
process.on('SIGINT', () => {
    console.log(chalk.yellow('\nStopping session...'));
    endSession();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(chalk.yellow('\nStopping session...'));
    endSession();
    process.exit(0);
});

// Start everything
startSession();
startServer();

// Spawn the child process
const child = spawnChild(fullCommandString);

// If the child exits, we exit too
child.on('exit', (code) => {
    endSession();
    process.exit(code);
});
