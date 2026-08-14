#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Userlens } from '../api';
import {
  getApiKey,
  getEventsBaseUrl,
  getRawBaseUrl,
  setApiKey,
  setEventsBaseUrl,
  setRawBaseUrl,
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-userlens';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Userlens connector CLI - Customer success analytics identify, group, track, and raw events')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Userlens {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set USERLENS_API_KEY.`);
    process.exit(1);
  }

  return new Userlens({
    apiKey,
    eventsBaseUrl: getEventsBaseUrl(),
    rawBaseUrl: getRawBaseUrl(),
  });
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
    profiles.forEach((p) => {
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
  .option('--api-key <key>', 'Userlens Write Code API key')
  .option('--events-base-url <url>', 'Events API base URL')
  .option('--raw-base-url <url>', 'Raw events API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; eventsBaseUrl?: string; rawBaseUrl?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      eventsBaseUrl: opts.eventsBaseUrl,
      rawBaseUrl: opts.rawBaseUrl,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 4)}...` : chalk.gray('not set')}`);
    info(`Events Base URL: ${config.eventsBaseUrl || chalk.gray('default')}`);
    info(`Raw Base URL: ${config.rawBaseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <key>')
  .description('Set Userlens Write Code API key')
  .action((key: string) => {
    setApiKey(key);
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set')
  .description('Set Userlens configuration')
  .option('--api-key <key>', 'Userlens Write Code API key')
  .option('--events-base-url <url>', 'Events API base URL')
  .option('--raw-base-url <url>', 'Raw events API base URL')
  .action((opts: { apiKey?: string; eventsBaseUrl?: string; rawBaseUrl?: string }) => {
    if (opts.apiKey) {
      setApiKey(opts.apiKey);
      info('API key saved');
    }
    if (opts.eventsBaseUrl) {
      setEventsBaseUrl(opts.eventsBaseUrl);
      info('Events base URL saved');
    }
    if (opts.rawBaseUrl) {
      setRawBaseUrl(opts.rawBaseUrl);
      info('Raw base URL saved');
    }
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 4)}...` : chalk.gray('not set')}`);
    info(`Events Base URL: ${getEventsBaseUrl() || chalk.gray('default (https://events.userlens.io)')}`);
    info(`Raw Base URL: ${getRawBaseUrl() || chalk.gray('default (https://raw.userlens.io)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('identify <userId>')
  .description('Identify a user with traits')
  .option('--traits <json>', 'User traits as JSON', '{}')
  .option('--source <source>', 'Event source', 'userlens-restapi')
  .action(async (userId: string, opts: { traits: string; source: string }) => {
    try {
      const client = getClient();
      const traits = JSON.parse(opts.traits);
      const result = await client.identifyUser(userId, traits, opts.source);
      print(result, getFormat(program));
      success(`Identified user: ${userId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('group <groupId> <userId>')
  .description('Associate a user with a group')
  .option('--traits <json>', 'Group traits as JSON')
  .option('--source <source>', 'Event source', 'userlens-restapi')
  .action(async (groupId: string, userId: string, opts: { traits?: string; source: string }) => {
    try {
      const client = getClient();
      const traits = opts.traits ? JSON.parse(opts.traits) : undefined;
      const result = await client.groupUser(groupId, userId, traits, opts.source);
      print(result, getFormat(program));
      success(`Grouped user ${userId} into ${groupId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('track <userId> <event>')
  .description('Track an event for a user')
  .option('--properties <json>', 'Event properties as JSON')
  .option('--source <source>', 'Event source', 'userlens-restapi')
  .action(async (userId: string, event: string, opts: { properties?: string; source: string }) => {
    try {
      const client = getClient();
      const properties = opts.properties ? JSON.parse(opts.properties) : undefined;
      const result = await client.trackEvent(userId, event, properties, opts.source);
      print(result, getFormat(program));
      success(`Tracked event "${event}" for user: ${userId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('forward-raw')
  .description('Forward raw events batch to Userlens')
  .requiredOption('--events <json>', 'Array of raw events as JSON')
  .action(async (opts: { events: string }) => {
    try {
      const client = getClient();
      const events = JSON.parse(opts.events);
      const result = await client.forwardRawEvents(events);
      print(result, getFormat(program));
      success('Forwarded raw events');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw HTTP request to Userlens events or raw API')
  .option('--path <path>', 'Request path', '/event')
  .option('--method <method>', 'HTTP method', 'POST')
  .option('--body <json>', 'Request body as JSON')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--use-raw-base', 'Use raw events base URL')
  .action(async (opts: { path: string; method: string; body?: string; query?: string; useRawBase?: boolean }) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        body: opts.body ? JSON.parse(opts.body) : undefined,
        query: opts.query ? JSON.parse(opts.query) : undefined,
        useRawBase: opts.useRawBase,
      });
      print(result, getFormat(program));
      success('Raw request completed');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
