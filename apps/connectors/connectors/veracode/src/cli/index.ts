#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Veracode } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-veracode';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Veracode application security platform API connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL override')
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
      process.env.VERACODE_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
    if (opts.baseUrl) {
      process.env.VERACODE_BASE_URL = opts.baseUrl;
      debug('Base URL set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Veracode {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VERACODE_API_KEY.`);
    process.exit(1);
  }
  return new Veracode({ apiKey, baseUrl });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
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
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
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
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.veracode.com/v1)')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || chalk.gray('default (https://api.veracode.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const scanCmd = program.command('scan').description('Veracode scan operations');

scanCmd
  .command('list')
  .description('List scans')
  .option('--page <number>', 'Page number')
  .option('--size <number>', 'Page size')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.page) params.page = Number(opts.page);
      if (opts.size) params.size = Number(opts.size);
      const result = await client.listScans(params);
      print(result, getFormat(scanCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scanCmd
  .command('get <scanId>')
  .description('Get a scan by ID')
  .action(async (scanId: string) => {
    try {
      const client = getClient();
      const result = await client.getScan(scanId);
      print(result, getFormat(scanCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scanCmd
  .command('create')
  .description('Create a scan')
  .option('--body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : {};
      const result = await client.createScan(body);
      success('Scan created');
      print(result, getFormat(scanCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Veracode event operations');

eventsCmd
  .command('list')
  .description('List events')
  .option('--page <number>', 'Page number')
  .option('--size <number>', 'Page size')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.page) params.page = Number(opts.page);
      if (opts.size) params.size = Number(opts.size);
      const result = await client.listEvents(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search Veracode resources');

searchCmd
  .command('run')
  .description('Run a search query')
  .requiredOption('--body <json>', 'JSON search request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = JSON.parse(opts.body);
      const result = await client.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
