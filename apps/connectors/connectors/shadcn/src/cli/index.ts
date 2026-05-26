#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Shadcn } from '../api';
import {
  getCwd,
  setCwd,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-shadcn';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Shadcn CLI wrapper - Execute shadcn commands programmatically')
  .version(VERSION)
  .option('-c, --cwd <path>', 'Working directory (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get Shadcn client
function getClient(cmdOpts?: { cwd?: string }): Shadcn {
  const cwd = cmdOpts?.cwd || getCwd() || process.cwd();
  return new Shadcn({ cwd });
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }

    success(`Profiles:`);
    profiles.forEach(p => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--cwd <path>', 'Working directory')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      cwd: opts.cwd,
    });
    success(`Profile "${name}" created`);

    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (name === 'default') {
      error('Cannot delete the default profile');
      process.exit(1);
    }
    if (deleteProfile(name)) {
      success(`Profile "${name}" deleted`);
    } else {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Working directory: ${config.cwd || chalk.gray('not set (uses current directory)')}`);
    info(`Package manager: ${config.packageManager || chalk.gray('not set (uses npx)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-cwd <path>')
  .description('Set working directory')
  .action((path: string) => {
    setCwd(path);
    success(`Working directory saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const cwd = getCwd();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Working directory: ${cwd || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Add Command
// ============================================
program
  .command('add [components...]')
  .description('Add components to your project')
  .option('-c, --cwd <path>', 'Working directory')
  .option('-o, --overwrite', 'Overwrite existing files')
  .option('-a, --all', 'Add all available components')
  .option('--path <path>', 'Path to install components')
  .action(async (components: string[], opts) => {
    try {
      if (!opts.all && components.length === 0) {
        error('Please specify components to add or use --all flag');
        process.exit(1);
      }

      const client = getClient(opts);
      info(`Adding components from: ${client.getCwd()}`);

      const result = await client.components.add({
        components,
        overwrite: opts.overwrite,
        all: opts.all,
        path: opts.path,
      });

      if (result.stdout) {
        console.log(result.stdout);
      }
      success('Components added successfully!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Diff Command
// ============================================
program
  .command('diff [component]')
  .description('Show diff of component against registry')
  .option('-c, --cwd <path>', 'Working directory')
  .action(async (component: string | undefined, opts) => {
    try {
      const client = getClient(opts);
      const diff = await client.components.diff({ component });

      if (diff) {
        console.log(diff);
      } else {
        info('No differences found');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Init Command
// ============================================
program
  .command('init')
  .description('Initialize shadcn/ui in your project')
  .option('-c, --cwd <path>', 'Working directory')
  .option('-d, --defaults', 'Use default configuration')
  .option('--force', 'Force initialization')
  .option('--src-dir', 'Use src directory')
  .option('--base-color <color>', 'Base color (slate, gray, zinc, neutral, stone)')
  .option('--style <style>', 'Style (default, new-york)')
  .action(async (opts) => {
    try {
      const client = getClient(opts);
      info(`Initializing shadcn/ui in: ${client.getCwd()}`);

      const result = await client.components.init({
        defaults: opts.defaults,
        force: opts.force,
        srcDir: opts.srcDir,
        baseColor: opts.baseColor,
        style: opts.style,
      });

      if (result.stdout) {
        console.log(result.stdout);
      }
      success('shadcn/ui initialized successfully!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// List Command
// ============================================
program
  .command('list')
  .description('List available components')
  .action(async () => {
    try {
      const client = getClient();
      const components = await client.components.list();

      success(`Available components (${components.length}):`);
      components.forEach(c => {
        console.log(`  ${chalk.cyan(c)}`);
      });
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Execute Raw Command
// ============================================
program
  .command('exec <args...>')
  .description('Execute a raw shadcn CLI command')
  .option('-c, --cwd <path>', 'Working directory')
  .action(async (args: string[], opts) => {
    try {
      const client = getClient(opts);
      const output = await client.execute(args);

      if (output) {
        console.log(output);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
