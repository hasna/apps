#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-spreadsheet-file';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SpreadsheetFile API connector CLI')
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
      process.env.SPREADSHEET_FILE_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPREADSHEET_FILE_API_KEY.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) {
    error(`${label} is required and must be valid JSON`);
    process.exit(1);
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`${label} must be valid JSON`);
    process.exit(1);
  }
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
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key for active profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL for active profile')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('https://api.spreadsheet-file.com/v1 (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const filesCmd = program.command('files').description('Spreadsheet file operations');

filesCmd
  .command('list')
  .description('List spreadsheet files')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--offset <number>', 'Result offset')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.files.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('get <fileId>')
  .description('Get a spreadsheet file by ID')
  .action(async (fileId: string) => {
    try {
      const client = getClient();
      const result = await client.files.get(fileId);
      print(result, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('create')
  .description('Create a spreadsheet file')
  .option('-b, --body <json>', 'Request body as JSON')
  .option('-n, --name <name>', 'File name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonOption(opts.body, 'Body')
        : opts.name
          ? { name: opts.name }
          : {};
      const result = await client.files.create(body);
      success('File created');
      print(result, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Spreadsheet event operations');

eventsCmd
  .command('list')
  .description('List spreadsheet events')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--offset <number>', 'Result offset')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--file-id <fileId>', 'Filter by file ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
        cursor: opts.cursor,
        fileId: opts.fileId,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search spreadsheet data');

searchCmd
  .command('run')
  .description('Run a search query')
  .option('-b, --body <json>', 'Search request body as JSON')
  .option('-q, --query <query>', 'Search query string')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonOption(opts.body, 'Body')
        : opts.query
          ? { query: opts.query }
          : {};
      const result = await client.search.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Make a raw API request');

rawCmd
  .requiredOption('-p, --path <path>', 'API path (e.g. /files)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-q, --query <json>', 'Query parameters as JSON object')
  .option('-b, --body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase();
      const query = opts.query ? parseJsonOption(opts.query, 'Query') as Record<string, string | number | boolean | undefined> : undefined;
      const body = opts.body ? parseJsonOption(opts.body, 'Body') : undefined;

      const result = await client.rawRequest({
        path: opts.path,
        method,
        query,
        body,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
