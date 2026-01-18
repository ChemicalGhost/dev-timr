#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { startSession, setTaskName, endSession, spawnChild } from '../lib/tracker.js';
import { startServer } from '../lib/server.js';
import { logout } from '../lib/auth.js';
import { getRecentTasks } from '../lib/api.js';
import { getQueuedCount, processQueue } from '../lib/queue.js';
import login from './login.js';
import showStats from './stats.js';
import migrate from './migrate.js';

// Setup global error handling
process.on('uncaughtException', (err) => {
    console.error(chalk.red('Unexpected error:'), err.message);
    process.exit(1);
});

async function runTracker(argv) {
    if (!argv.command || argv.command.length === 0) {
        console.error(chalk.red('Error: No command provided to run.'));
        console.log(chalk.yellow('Usage: dev-timr "npm run dev"'));
        process.exit(1);
    }

    const fullCommandString = argv.command.join(' ');

    // Start session immediately
    startSession();

    // Check for offline queue items
    const queuedCount = getQueuedCount();
    if (queuedCount > 0) {
        console.log(chalk.gray(`\n⚡ Syncing ${queuedCount} offline sessions...`));
        processQueue().then(({ synced, failed }) => {
            if (synced > 0) console.log(chalk.gray(`   Synced ${synced} sessions.`));
            if (failed > 0) console.log(chalk.gray(`   ${failed} pending retry.`));
        });
    }

    // Prompt for task name
    let taskName = null;
    try {
        const recentTasks = await getRecentTasks(null, 5);
        const choices = recentTasks.map(t => t.name);

        // Add "New Task" option if we have recent tasks
        if (choices.length > 0) {
            choices.push(new inquirer.Separator());
            choices.push('Type a new task name...');
            choices.push('Skip (No task)');
        }

        console.log(''); // Spacer

        let answer;
        if (choices.length > 0) {
            answer = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'taskSelect',
                    message: 'What are you working on?',
                    choices: choices,
                    loop: false
                }
            ]);

            if (answer.taskSelect === 'Type a new task name...') {
                const textAnswer = await inquirer.prompt([{
                    type: 'input',
                    name: 'taskInput',
                    message: 'Enter task name:'
                }]);
                taskName = textAnswer.taskInput;
            } else if (answer.taskSelect !== 'Skip (No task)') {
                taskName = answer.taskSelect;
            }
        } else {
            // Simple input if no history
            answer = await inquirer.prompt([{
                type: 'input',
                name: 'taskInput',
                message: 'Task name (optional):'
            }]);
            taskName = answer.taskInput;
        }

    } catch (err) {
        // Fallback if prompt fails or offline/no-auth caused getRecentTasks to fail silently
        // console.debug('Task prompt skipped:', err.message);
    }

    if (taskName) {
        setTaskName(taskName);
    } else {
        console.log(chalk.gray('No task selected.'));
    }

    // Start GUI Server
    const serverProcess = await startServer();

    console.log(chalk.green(`\n🚀 Executing: ${chalk.bold(fullCommandString)}\n`));

    // Spawn the child process
    const child = spawnChild(fullCommandString);

    // Handle exit signals - use .then() to ensure sync completes before exit
    const cleanup = () => {
        console.log(chalk.yellow('\nStopping session...'));
        endSession().then(() => {
            process.exit(0);
        }).catch(() => {
            process.exit(0);
        });
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // If the child exits, we exit too
    child.on('exit', (code) => {
        endSession().then(() => {
            process.exit(code);
        }).catch(() => {
            process.exit(code);
        });
    });
}

// Define entry point
const argv = hideBin(process.argv);
const firstArg = argv[0];

// Check if first arg is a known subcommand
const subcommands = ['login', 'logout', 'stats', 'migrate', 'help', '--help', '-h'];
const isSubcommand = subcommands.includes(firstArg);

if (isSubcommand) {
    // Handle subcommands
    yargs(argv)
        .usage('Usage: $0 <command> [args...]')
        .command('login', 'Log in with GitHub', {}, async () => {
            await login();
        })
        .command('logout', 'Log out', {}, () => {
            logout();
            console.log(chalk.green('Logged out successfully.'));
        })
        .command('stats', 'View repository statistics', {}, async () => {
            await showStats();
        })
        .command('migrate', 'Migrate local data to cloud', {}, async () => {
            await migrate();
        })
        .help()
        .parse();
} else {
    // Handle tracker command (default)
    runTracker({ command: argv });
}
