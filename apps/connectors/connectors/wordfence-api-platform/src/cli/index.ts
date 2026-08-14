#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WordfenceApiPlatform } from '../api';
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
import type { VulnerabilityFeed } from '../types';

const CONNECTOR_NAME = 'connect-wordfence-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wordfence Intelligence v3 connector — WordPress vulnerability feed')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
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
    }
    if (opts.apiKey) {
      process.env.WORDFENCE_API_PLATFORM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WordfenceApiPlatform {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WORDFENCE_API_PLATFORM_API_KEY.`,
    );
    process.exit(1);
  }
  return new WordfenceApiPlatform({ apiKey, baseUrl: getBaseUrl() });
}

function parseFeed(value?: string): VulnerabilityFeed {
  if (!value || value === 'production') return 'production';
  if (value === 'staging') return 'staging';
  throw new Error('Feed must be production or staging');
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to profile after creation')
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
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
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

configCmd.command('show').description('Show configuration').action(() => {
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${getApiKey() ? `${getApiKey()!.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl()}`);
});

configCmd.command('clear').description('Clear active profile config').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const itemsCmd = program.command('items').description('Vulnerability feed items');

itemsCmd
  .command('list')
  .description('List all vulnerabilities in the feed')
  .option('--feed <feed>', 'Feed name: production or staging', 'production')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listItems({ feed: parseFeed(opts.feed) });
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('get <itemId>')
  .description('Get a vulnerability by ID')
  .option('--feed <feed>', 'Feed name: production or staging', 'production')
  .action(async (itemId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getItem({ itemId, feed: parseFeed(opts.feed) });
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('create')
  .description('Create item (not supported — read-only feed)')
  .action(async () => {
    try {
      const client = getClient();
      await client.createItem();
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Recent vulnerability publications');

eventsCmd
  .command('list')
  .description('List recently published vulnerabilities')
  .option('--feed <feed>', 'Feed name: production or staging', 'production')
  .option('--since <iso>', 'Published on/after (ISO date)')
  .option('--until <iso>', 'Published on/before (ISO date)')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents({
        feed: parseFeed(opts.feed),
        since: opts.since,
        until: opts.until,
        limit: Number(opts.limit),
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search vulnerabilities in the feed');

searchCmd
  .requiredOption('-q, --query <text>', 'Search text')
  .option('--feed <feed>', 'Feed name: production or staging', 'production')
  .option('--plugin <slug>', 'Filter by WordPress plugin slug')
  .option('--cve <id>', 'Filter by CVE identifier')
  .option('-n, --limit <number>', 'Maximum results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.search({
        query: opts.query,
        feed: parseFeed(opts.feed),
        pluginSlug: opts.plugin,
        cve: opts.cve,
        limit: Number(opts.limit),
      });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Raw authenticated API request');

rawCmd
  .requiredOption('--path <path>', 'Request path (e.g. /vulnerabilities/production)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query params JSON object')
  .option('--body <json>', 'Request body JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        query: opts.query ? JSON.parse(opts.query) : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
