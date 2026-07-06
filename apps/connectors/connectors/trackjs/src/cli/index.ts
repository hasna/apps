#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Trackjs } from '../api';
import {
  getApiKey,
  getCustomerId,
  setApiKey,
  setCustomerId,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-trackjs';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TrackJS Data API connector — read-only error monitoring')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-c, --customer-id <id>', 'Customer ID (overrides config)')
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
      process.env.TRACKJS_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.customerId) {
      process.env.TRACKJS_CUSTOMER_ID = opts.customerId;
      debug('Customer ID set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Trackjs {
  const apiKey = getApiKey();
  const customerId = getCustomerId();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRACKJS_API_KEY.`);
    process.exit(1);
  }

  if (!customerId) {
    error(`No customer ID configured. Run "${CONNECTOR_NAME} config set-customer <id>" or set TRACKJS_CUSTOMER_ID.`);
    process.exit(1);
  }

  return new Trackjs({ apiKey, customerId });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

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

    success('Profiles:');
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
  .option('--customer-id <id>', 'Customer ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      customerId: opts.customerId,
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
    info(`Customer ID: ${config.customerId || chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-customer <customerId>')
  .description('Set TrackJS customer ID')
  .action((customerId: string) => {
    setCustomerId(customerId);
    success(`Customer ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const customerId = getCustomerId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Customer ID: ${customerId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const errorsCmd = program.command('errors').description('TrackJS error data (read-only Data API)');

errorsCmd
  .command('list')
  .description('List recent errors')
  .option('-a, --application <key>', 'Filter by application key')
  .option('--start-date <date>', 'Start date (ISO 8601)')
  .option('--end-date <date>', 'End date (ISO 8601)')
  .option('--page <number>', 'Page number')
  .option('--size <number>', 'Page size (1-1000)')
  .option('-q, --query <text>', 'Search query')
  .option('--include-stack', 'Include stack traces')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.errors.list({
        application: opts.application,
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        size: opts.size ? parseInt(opts.size, 10) : undefined,
        query: opts.query,
        includeStack: opts.includeStack,
      });
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

errorsCmd
  .command('messages')
  .description('List errors grouped by message')
  .option('-a, --application <key>', 'Filter by application key')
  .option('--start-date <date>', 'Start date (ISO 8601)')
  .option('--end-date <date>', 'End date (ISO 8601)')
  .option('--page <number>', 'Page number')
  .option('--size <number>', 'Page size (1-1000)')
  .option('--sort <sort>', 'Sort field and direction (e.g. usercount|desc)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.errors.listMessages({
        application: opts.application,
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        size: opts.size ? parseInt(opts.size, 10) : undefined,
        sort: opts.sort,
      });
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

errorsCmd
  .command('urls')
  .description('List errors grouped by URL')
  .option('-a, --application <key>', 'Filter by application key')
  .option('--start-date <date>', 'Start date (ISO 8601)')
  .option('--end-date <date>', 'End date (ISO 8601)')
  .option('--page <number>', 'Page number')
  .option('--size <number>', 'Page size (1-1000)')
  .option('--sort <sort>', 'Sort field and direction (e.g. usercount|desc)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.errors.listUrls({
        application: opts.application,
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        size: opts.size ? parseInt(opts.size, 10) : undefined,
        sort: opts.sort,
      });
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

errorsCmd
  .command('daily')
  .description('List error counts by day')
  .option('-a, --application <key>', 'Filter by application key')
  .option('--start-date <date>', 'Start date (ISO 8601)')
  .option('--end-date <date>', 'End date (ISO 8601)')
  .option('--page <number>', 'Page number')
  .option('--size <number>', 'Page size (1-1000)')
  .option('--sort <sort>', 'Sort field and direction (e.g. usercount|desc)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.errors.listDaily({
        application: opts.application,
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        size: opts.size ? parseInt(opts.size, 10) : undefined,
        sort: opts.sort,
      });
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

errorsCmd
  .command('hourly')
  .description('List error counts by hour')
  .option('-a, --application <key>', 'Filter by application key')
  .option('--start-date <date>', 'Start date (ISO 8601)')
  .option('--end-date <date>', 'End date (ISO 8601)')
  .option('--page <number>', 'Page number')
  .option('--size <number>', 'Page size (1-1000)')
  .option('--sort <sort>', 'Sort field and direction (e.g. usercount|desc)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.errors.listHourly({
        application: opts.application,
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        size: opts.size ? parseInt(opts.size, 10) : undefined,
        sort: opts.sort,
      });
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
