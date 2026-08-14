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

const CONNECTOR_NAME = 'connect-ably';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Ably REST API connector CLI')
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
      process.env.ABLY_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ABLY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
  .description('Set API key (format: appId.keyId:keySecret)')
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
// Messages Commands
// ============================================
const messagesCmd = program
  .command('messages')
  .description('Publish and retrieve channel messages');

messagesCmd
  .command('publish <channel>')
  .description('Publish a message to a channel')
  .requiredOption('-n, --name <name>', 'Event name')
  .option('-d, --data <data>', 'Message data (JSON string)')
  .option('--client-id <clientId>', 'Client ID')
  .action(async (channel: string, opts) => {
    try {
      const client = getClient();
      let data: unknown = opts.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          // Keep as string
        }
      }
      const result = await client.messages.publish(channel, {
        name: opts.name,
        data,
        clientId: opts.clientId,
      });
      success(`Message published to channel: ${channel}`);
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('history <channel>')
  .description('Get message history for a channel')
  .option('-l, --limit <number>', 'Maximum results', '100')
  .option('--start <time>', 'Start time (ms since epoch)')
  .option('--end <time>', 'End time (ms since epoch)')
  .option('--direction <dir>', 'Sort direction (forwards, backwards)', 'backwards')
  .action(async (channel: string, opts) => {
    try {
      const client = getClient();
      const result = await client.messages.history(channel, {
        limit: parseInt(opts.limit),
        start: opts.start,
        end: opts.end,
        direction: opts.direction,
      });
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Channels Commands
// ============================================
const channelsCmd = program
  .command('channels')
  .description('List and inspect channels');

channelsCmd
  .command('list')
  .description('List active channels')
  .option('-l, --limit <number>', 'Maximum results', '100')
  .option('--prefix <prefix>', 'Filter by channel name prefix')
  .option('--by <type>', 'Response type (id, value)', 'value')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.channels.list({
        limit: parseInt(opts.limit),
        prefix: opts.prefix,
        by: opts.by,
      });
      print(result, getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('get <channelId>')
  .description('Get channel details')
  .action(async (channelId: string) => {
    try {
      const client = getClient();
      const result = await client.channels.get(channelId);
      print(result, getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Presence Commands
// ============================================
const presenceCmd = program
  .command('presence')
  .description('Channel presence members');

presenceCmd
  .command('get <channel>')
  .description('Get current presence members for a channel')
  .option('-l, --limit <number>', 'Maximum results', '100')
  .option('--client-id <clientId>', 'Filter by client ID')
  .option('--connection-id <connectionId>', 'Filter by connection ID')
  .action(async (channel: string, opts) => {
    try {
      const client = getClient();
      const result = await client.presence.get(channel, {
        limit: parseInt(opts.limit),
        clientId: opts.clientId,
        connectionId: opts.connectionId,
      });
      print(result, getFormat(presenceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

presenceCmd
  .command('history <channel>')
  .description('Get presence history for a channel')
  .option('-l, --limit <number>', 'Maximum results', '100')
  .option('--start <time>', 'Start time (ms since epoch)')
  .option('--end <time>', 'End time (ms since epoch)')
  .option('--direction <dir>', 'Sort direction (forwards, backwards)', 'backwards')
  .action(async (channel: string, opts) => {
    try {
      const client = getClient();
      const result = await client.presence.history(channel, {
        limit: parseInt(opts.limit),
        start: opts.start,
        end: opts.end,
        direction: opts.direction,
      });
      print(result, getFormat(presenceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Stats Commands
// ============================================
const statsCmd = program
  .command('stats')
  .description('Application statistics');

statsCmd
  .command('get')
  .description('Get application statistics')
  .option('-l, --limit <number>', 'Maximum results', '100')
  .option('--start <time>', 'Start time')
  .option('--end <time>', 'End time')
  .option('--direction <dir>', 'Sort direction (forwards, backwards)', 'backwards')
  .option('--unit <unit>', 'Interval granularity (minute, hour, day, month)', 'minute')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.stats.get({
        limit: parseInt(opts.limit),
        start: opts.start,
        end: opts.end,
        direction: opts.direction,
        unit: opts.unit,
      });
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

statsCmd
  .command('time')
  .description('Get server time')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.stats.time();
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
