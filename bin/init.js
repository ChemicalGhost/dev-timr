#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const SCRIPTS_TO_WRAP = ['dev', 'start'];

function init() {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
        console.error(chalk.red('Error: No package.json found in current directory.'));
        process.exit(1);
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    if (!packageJson.scripts) {
        console.error(chalk.red('Error: No scripts found in package.json.'));
        process.exit(1);
    }

    let modified = false;

    for (const scriptName of SCRIPTS_TO_WRAP) {
        const script = packageJson.scripts[scriptName];

        if (script && !script.includes('dev-timr')) {
            // Wrap the script with dev-timr
            packageJson.scripts[scriptName] = `dev-timr "${script}"`;
            console.log(chalk.green(`✓ Wrapped "${scriptName}" script`));
            modified = true;
        } else if (script && script.includes('dev-timr')) {
            console.log(chalk.yellow(`⚠ "${scriptName}" is already wrapped`));
        }
    }

    if (modified) {
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        console.log(chalk.green('\n✓ package.json updated successfully!'));
        console.log(chalk.cyan('Now run: npm run dev'));
    } else {
        console.log(chalk.yellow('\nNo scripts were modified.'));
    }
}

init();
