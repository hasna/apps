#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Icons8 } from '../api';
import {
  getApiKey,
  setApiKey,
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

// Icons8 connector CLI
const CONNECTOR_NAME = 'icons8';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Icons8 API connector CLI - Search and download icons from Icons8')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.ICONS8_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Icons8 {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ICONS8_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Icons8({ apiKey });
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Icons API Commands
// ============================================
const iconsCmd = program
  .command('icons')
  .description('Icons8 icons API commands');

iconsCmd
  .command('search <term>')
  .description('Search for icons')
  .option('-n, --amount <number>', 'Number of results', '25')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('--platform <platform>', 'Platform/style (e.g., ios16, color, fluency)')
  .option('--language <lang>', 'Language code (e.g., en-US)')
  .action(async (term: string, opts) => {
    try {
      const client = getClient();
      const result = await client.icons.search({
        term,
        amount: parseInt(opts.amount),
        offset: parseInt(opts.offset),
        platform: opts.platform,
        language: opts.language,
      });
      print(result, getFormat(iconsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

iconsCmd
  .command('get <id>')
  .description('Get an icon by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.icons.get(id);
      print(result, getFormat(iconsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

iconsCmd
  .command('categories')
  .description('List all icon categories')
  .option('--platform <platform>', 'Filter by platform')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.icons.listCategories(opts.platform);
      print(result, getFormat(iconsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

iconsCmd
  .command('platforms')
  .description('List all available platforms/styles')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.icons.listPlatforms();
      print(result, getFormat(iconsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

iconsCmd
  .command('category <category>')
  .description('List icons by category')
  .option('-n, --amount <number>', 'Number of results', '25')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('--platform <platform>', 'Platform/style')
  .action(async (category: string, opts) => {
    try {
      const client = getClient();
      const result = await client.icons.listByCategory(category, {
        amount: parseInt(opts.amount),
        offset: parseInt(opts.offset),
        platform: opts.platform,
      });
      print(result, getFormat(iconsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
