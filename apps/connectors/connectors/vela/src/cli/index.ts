#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Vela } from '../api';
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

const CONNECTOR_NAME = 'connect-vela';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vela AI scheduling connector CLI')
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
      process.env.VELA_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vela {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VELA_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Vela({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

function parseQueryOptions(opts: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && !['format', 'profile', 'apiKey', 'verbose', 'body', 'json'].includes(key)) {
      query[key] = value as string | number | boolean;
    }
  }
  return query;
}

// Profile commands
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.tryvela.ai/v1)')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
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
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.tryvela.ai/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Scheduling request commands
program
  .command('list-scheduling-requests')
  .description('List scheduling requests')
  .allowUnknownOption(true)
  .action(async (_, cmd) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(cmd.parent?.opts() ?? {});
      const result = await client.schedulingRequests.list(query);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-scheduling-request <requestId>')
  .description('Get a scheduling request by ID')
  .action(async (requestId: string) => {
    try {
      const client = getClient();
      const result = await client.schedulingRequests.get(requestId);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create-scheduling-request')
  .description('Create a scheduling request')
  .option('--json <payload>', 'Request body as JSON')
  .option('--subject <subject>', 'Meeting subject')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.json) ?? {};
      if (opts.subject) body.subject = opts.subject;
      const result = await client.schedulingRequests.create(body);
      success('Scheduling request created');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Meeting commands
program
  .command('list-meetings')
  .description('List meetings')
  .allowUnknownOption(true)
  .action(async (_, cmd) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(cmd.parent?.opts() ?? {});
      const result = await client.meetings.list(query);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-meeting <meetingId>')
  .description('Get a meeting by ID')
  .action(async (meetingId: string) => {
    try {
      const client = getClient();
      const result = await client.meetings.get(meetingId);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('cancel-meeting <meetingId>')
  .description('Cancel a meeting')
  .option('--json <payload>', 'Request body as JSON')
  .option('--reason <reason>', 'Cancellation reason')
  .action(async (meetingId: string, opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.json) ?? {};
      if (opts.reason) body.reason = opts.reason;
      const result = await client.meetings.cancel(meetingId, body);
      success('Meeting cancelled');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('reschedule-meeting <meetingId>')
  .description('Reschedule a meeting')
  .option('--json <payload>', 'Request body as JSON')
  .option('--start-at <datetime>', 'New start time (ISO 8601)')
  .action(async (meetingId: string, opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.json) ?? {};
      if (opts.startAt) body.startAt = opts.startAt;
      const result = await client.meetings.reschedule(meetingId, body);
      success('Meeting rescheduled');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Contact commands
program
  .command('list-contacts')
  .description('List contacts')
  .allowUnknownOption(true)
  .action(async (_, cmd) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(cmd.parent?.opts() ?? {});
      const result = await client.contacts.list(query);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Calendar commands
program
  .command('sync-calendar')
  .description('Sync calendar with Vela')
  .option('--json <payload>', 'Request body as JSON')
  .option('--provider <provider>', 'Calendar provider (e.g. google)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.json) ?? {};
      if (opts.provider) body.provider = opts.provider;
      const result = await client.calendar.sync(body);
      success('Calendar sync initiated');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request escape hatch
program
  .command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /scheduling-requests)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--json <payload>', 'Request body as JSON')
  .allowUnknownOption(true)
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(cmd.parent?.opts() ?? {});
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method?.toUpperCase(),
        body: parseJsonOption(opts.json),
        params: query,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
