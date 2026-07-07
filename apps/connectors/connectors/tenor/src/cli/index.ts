#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getClientKey,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';
import type { ContentFilter, CategoryType } from '../types';

const CONNECTOR_NAME = 'connect-tenor';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tenor API connector CLI - search and discover GIFs')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.TENOR_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

// Helper to get output format from the global program options
function getFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TENOR_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, clientKey: getClientKey(), baseUrl: process.env.TENOR_BASE_URL });
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
// Tenor API Commands
// ============================================

program
  .command('search <query>')
  .description('Search for GIFs and stickers')
  .option('-n, --limit <number>', 'Maximum results (1-50)', '20')
  .option('--pos <pos>', 'Pagination position from a previous response')
  .option('--locale <locale>', 'Locale, e.g. en_US')
  .option('--country <country>', 'Two-letter country code, e.g. US')
  .option('--content-filter <level>', 'Content filter: off, low, medium, high')
  .option('--media-filter <formats>', 'Comma-separated media formats, e.g. gif,tinygif')
  .option('--random', 'Randomize the order of results')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tenor.search(query, {
        limit: parseInt(opts.limit, 10),
        pos: opts.pos,
        locale: opts.locale,
        country: opts.country,
        contentFilter: opts.contentFilter as ContentFilter | undefined,
        mediaFilter: opts.mediaFilter,
        random: opts.random,
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('featured')
  .description('Get a feed of featured GIFs')
  .option('-n, --limit <number>', 'Maximum results (1-50)', '20')
  .option('--pos <pos>', 'Pagination position from a previous response')
  .option('--locale <locale>', 'Locale, e.g. en_US')
  .option('--country <country>', 'Two-letter country code, e.g. US')
  .option('--content-filter <level>', 'Content filter: off, low, medium, high')
  .option('--media-filter <formats>', 'Comma-separated media formats, e.g. gif,tinygif')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tenor.featured({
        limit: parseInt(opts.limit, 10),
        pos: opts.pos,
        locale: opts.locale,
        country: opts.country,
        contentFilter: opts.contentFilter as ContentFilter | undefined,
        mediaFilter: opts.mediaFilter,
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('categories')
  .description('List GIF categories')
  .option('-t, --type <type>', 'Category type: featured or trending', 'featured')
  .option('--locale <locale>', 'Locale, e.g. en_US')
  .option('--country <country>', 'Two-letter country code, e.g. US')
  .option('--content-filter <level>', 'Content filter: off, low, medium, high')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tenor.categories({
        type: opts.type as CategoryType | undefined,
        locale: opts.locale,
        country: opts.country,
        contentFilter: opts.contentFilter as ContentFilter | undefined,
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('autocomplete <query>')
  .description('Get autocomplete suggestions for a partial search term')
  .option('-n, --limit <number>', 'Maximum results', '5')
  .option('--locale <locale>', 'Locale, e.g. en_US')
  .option('--country <country>', 'Two-letter country code, e.g. US')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tenor.autocomplete(query, {
        limit: parseInt(opts.limit, 10),
        locale: opts.locale,
        country: opts.country,
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('trending-terms')
  .description('Get the current list of trending search terms')
  .option('-n, --limit <number>', 'Maximum results', '5')
  .option('--locale <locale>', 'Locale, e.g. en_US')
  .option('--country <country>', 'Two-letter country code, e.g. US')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tenor.trendingTerms({
        limit: parseInt(opts.limit, 10),
        locale: opts.locale,
        country: opts.country,
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
