#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-adalo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Adalo no-code platform API connector - records CRUD & push notifications')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .option('--app-id <appId>', 'Adalo App ID (overrides config)')
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
      process.env.ADALO_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.appId) {
      process.env.ADALO_APP_ID = opts.appId;
      debug(`App ID set from command line flag: ${opts.appId}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ADALO_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, appId: process.env.ADALO_APP_ID });
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
    info(`App ID: ${process.env.ADALO_APP_ID || chalk.gray('not set (use --app-id or ADALO_APP_ID)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Records Commands
// ============================================
const recordsCmd = program
  .command('records')
  .description('Manage collection records (CRUD)');

recordsCmd
  .command('list <collectionId>')
  .description('List records in a collection')
  .option('--offset <number>', 'Offset for pagination')
  .option('--limit <number>', 'Maximum records to return')
  .option('--filter-key <key>', 'Field name to filter by')
  .option('--filter-value <value>', 'Value to filter for')
  .action(async (collectionId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.offset !== undefined) params.offset = parseInt(opts.offset);
      if (opts.limit !== undefined) params.limit = parseInt(opts.limit);
      if (opts.filterKey) params.filterKey = opts.filterKey;
      if (opts.filterValue !== undefined) params.filterValue = opts.filterValue;
      const result = await client.records.list(collectionId, params);
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordsCmd
  .command('get <collectionId> <recordId>')
  .description('Get a specific record by ID')
  .action(async (collectionId: string, recordId: string) => {
    try {
      const client = getClient();
      const result = await client.records.get(collectionId, parseInt(recordId));
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordsCmd
  .command('create <collectionId>')
  .description('Create a new record')
  .requiredOption('-d, --data <json>', 'Record data as JSON')
  .action(async (collectionId: string, opts) => {
    try {
      const client = getClient();
      const data = JSON.parse(opts.data);
      const result = await client.records.create(collectionId, data);
      success('Record created!');
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordsCmd
  .command('update <collectionId> <recordId>')
  .description('Update an existing record')
  .requiredOption('-d, --data <json>', 'Record data as JSON')
  .action(async (collectionId: string, recordId: string, opts) => {
    try {
      const client = getClient();
      const data = JSON.parse(opts.data);
      const result = await client.records.update(collectionId, parseInt(recordId), data);
      success('Record updated!');
      print(result, getFormat(recordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordsCmd
  .command('delete <collectionId> <recordId>')
  .description('Delete a record')
  .action(async (collectionId: string, recordId: string) => {
    try {
      const client = getClient();
      await client.records.delete(collectionId, parseInt(recordId));
      success('Record deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Notifications Commands
// ============================================
const notifyCmd = program
  .command('notify')
  .description('Send push notifications');

notifyCmd
  .command('send')
  .description('Send a push notification to a user')
  .requiredOption('--user-id <userId>', 'Target user ID')
  .requiredOption('--title <title>', 'Notification title')
  .requiredOption('--body <body>', 'Notification body text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.notifications.send(opts.userId, opts.title, opts.body);
      success('Notification sent!');
      print(result, getFormat(notifyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
