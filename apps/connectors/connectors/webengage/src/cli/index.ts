#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getLicenseCode,
  setLicenseCode,
  getDataCenter,
  setDataCenter,
  getBaseUrl,
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
import type {
  BulkEventsParams,
  BulkUsersParams,
  EventTrackParams,
  MultiTransactionParams,
  SingleTransactionParams,
  UserTrackParams,
} from '../types';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-webengage';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WebEngage API connector CLI - track users, events, bulk data, and transactional campaigns')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-l, --license-code <code>', 'License code (overrides config)')
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
      process.env.WEBENGAGE_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.licenseCode) {
      process.env.WEBENGAGE_LICENSE_CODE = opts.licenseCode;
      debug('License code set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  const licenseCode = getLicenseCode();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WEBENGAGE_API_KEY.`);
    process.exit(1);
  }
  if (!licenseCode) {
    error(`No license code configured. Run "${CONNECTOR_NAME} config set-license <code>" or set WEBENGAGE_LICENSE_CODE.`);
    process.exit(1);
  }

  return new Connector({
    apiKey,
    licenseCode,
    dataCenter: getDataCenter(),
    baseUrl: getBaseUrl(),
  });
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    error(`Failed to read JSON file: ${path} (${String(err)})`);
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--license-code <code>', 'License code')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, licenseCode: opts.licenseCode });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`License Code: ${config.licenseCode || chalk.gray('not set')}`);
  info(`Data Center: ${config.dataCenter || 'global (default)'}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-license <licenseCode>').description('Set license code').action((licenseCode: string) => {
  setLicenseCode(licenseCode);
  success(`License code saved to profile: ${getCurrentProfile()}`);
});

configCmd
  .command('set-dc <dataCenter>')
  .description('Set data center (global, in, sa, eug)')
  .action((dataCenter: string) => {
    const allowed = ['global', 'in', 'sa', 'eug'];
    if (!allowed.includes(dataCenter)) {
      error(`Invalid data center. Use one of: ${allowed.join(', ')}`);
      process.exit(1);
    }
    setDataCenter(dataCenter as 'global' | 'in' | 'sa' | 'eug');
    success(`Data center set to: ${dataCenter}`);
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  const licenseCode = getLicenseCode();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`License Code: ${licenseCode || chalk.gray('not set')}`);
  info(`Data Center: ${getDataCenter() || 'global (default)'}`);
  info(`Base URL: ${getBaseUrl() || '(derived from data center)'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Users commands
const usersCmd = program.command('users').description('Track user profiles');

usersCmd
  .command('track')
  .description('Create or update a user profile')
  .requiredOption('--user-id <id>', 'User ID')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--file <path>', 'JSON file with user payload')
  .action(async (opts) => {
    try {
      const client = getClient();
      const payload: UserTrackParams = opts.file
        ? (readJsonFile(opts.file) as UserTrackParams)
        : {
            userId: opts.userId,
            firstName: opts.firstName,
            lastName: opts.lastName,
            email: opts.email,
            phone: opts.phone,
          };
      const result = await client.users.track(payload);
      success('User tracked');
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events commands
const eventsCmd = program.command('events').description('Track custom events');

eventsCmd
  .command('track')
  .description('Track a custom event')
  .requiredOption('--user-id <id>', 'User ID')
  .requiredOption('--name <eventName>', 'Event name')
  .option('--file <path>', 'JSON file with event payload')
  .action(async (opts) => {
    try {
      const client = getClient();
      const payload: EventTrackParams = opts.file
        ? (readJsonFile(opts.file) as EventTrackParams)
        : {
            userId: opts.userId,
            eventName: opts.name,
          };
      const result = await client.events.track(payload);
      success('Event tracked');
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Bulk commands
const bulkCmd = program.command('bulk').description('Bulk user and event tracking');

bulkCmd
  .command('users')
  .description('Track users in bulk (max 25 per request)')
  .requiredOption('--file <path>', 'JSON file with { users: [...] } payload')
  .action(async (opts) => {
    try {
      const client = getClient();
      const payload = readJsonFile(opts.file) as BulkUsersParams;
      const result = await client.bulk.trackUsers(payload);
      success('Bulk users submitted');
      print(result, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('events')
  .description('Track events in bulk (max 25 per request)')
  .requiredOption('--file <path>', 'JSON file with { events: [...] } payload')
  .action(async (opts) => {
    try {
      const client = getClient();
      const payload = readJsonFile(opts.file) as BulkEventsParams;
      const result = await client.bulk.trackEvents(payload);
      success('Bulk events submitted');
      print(result, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Transaction commands
const transactionCmd = program.command('transaction').description('Trigger transactional campaigns');

transactionCmd
  .command('send <experimentId>')
  .description('Send a single transactional campaign')
  .requiredOption('--user-id <id>', 'User ID')
  .requiredOption('--file <path>', 'JSON file with transaction payload (overrideData, ttl, etc.)')
  .action(async (experimentId: string, opts) => {
    try {
      const client = getClient();
      const fileData = readJsonFile(opts.file) as Omit<SingleTransactionParams, 'userId'>;
      const result = await client.transactional.send(experimentId, {
        userId: opts.userId,
        ...fileData,
      });
      success('Transactional campaign sent');
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionCmd
  .command('multi')
  .description('Send multi-campaign transaction (v2)')
  .requiredOption('--file <path>', 'JSON file with multi-transaction payload')
  .action(async (opts) => {
    try {
      const client = getClient();
      const payload = readJsonFile(opts.file) as MultiTransactionParams;
      const result = await client.transactional.sendMulti(payload);
      success('Multi-campaign transaction sent');
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
