#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TryPrism } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-tryprism';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TryPrism API connector — AI-native recruiting')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(
          `Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`,
        );
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.TRYPRISM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TryPrism {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRYPRISM_API_KEY.`,
    );
    process.exit(1);
  }
  return new TryPrism({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function parseQueryOption(
  value: string,
  label: string,
): Record<string, string | number | boolean | undefined> {
  const parsed = parseJsonOption(value, label);
  const result: Record<string, string | number | boolean | undefined> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      result[key] = entry;
    } else {
      result[key] = String(entry);
    }
  }
  return result;
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
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
    console.log(
      chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`),
    );
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL override')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('https://api.tryprism.com/v1 (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const searchesCmd = program.command('searches').description('Manage recruiting searches');

searchesCmd
  .command('list')
  .description('List searches')
  .option('--limit <n>', 'Maximum results')
  .option('--query <json>', 'Additional query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.limit) params.limit = Number(opts.limit);
      if (opts.query) Object.assign(params, parseQueryOption(opts.query, '--query'));
      const result = await client.listSearches(params);
      print(result, getFormat(searchesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchesCmd
  .command('get <searchId>')
  .description('Get a search by ID')
  .action(async (searchId: string) => {
    try {
      const client = getClient();
      print(await client.getSearch(searchId), getFormat(searchesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchesCmd
  .command('create')
  .description('Create a search')
  .option('--json <json>', 'Search payload as JSON object')
  .option('-t, --title <title>', 'Search title')
  .option('-l, --location <location>', 'Search location')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.json
        ? parseJsonOption(opts.json, '--json')
        : {
            ...(opts.title ? { title: opts.title } : {}),
            ...(opts.location ? { location: opts.location } : {}),
          };
      if (Object.keys(body).length === 0) {
        error('Provide --json or at least --title/--location');
        process.exit(1);
      }
      const result = await client.createSearch(body);
      success('Search created');
      print(result, getFormat(searchesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const candidatesCmd = program.command('candidates').description('Manage candidates');

candidatesCmd
  .command('list')
  .description('List candidates')
  .option('--search-id <id>', 'Filter by search ID')
  .option('--query <json>', 'Additional query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.searchId) params.searchId = opts.searchId;
      if (opts.query) Object.assign(params, parseQueryOption(opts.query, '--query'));
      print(await client.listCandidates(params), getFormat(candidatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd
  .command('get <candidateId>')
  .description('Get a candidate by ID')
  .action(async (candidateId: string) => {
    try {
      const client = getClient();
      print(await client.getCandidate(candidateId), getFormat(candidatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd
  .command('feedback <candidateId>')
  .description('Submit feedback for a candidate')
  .option('--json <json>', 'Feedback payload as JSON object')
  .option('--rating <rating>', 'Feedback rating (e.g. strong_yes)')
  .action(async (candidateId: string, opts) => {
    try {
      const client = getClient();
      const body = opts.json
        ? parseJsonOption(opts.json, '--json')
        : {
            ...(opts.rating ? { rating: opts.rating } : {}),
          };
      if (Object.keys(body).length === 0) {
        error('Provide --json or --rating');
        process.exit(1);
      }
      print(await client.submitCandidateFeedback(candidateId, body), getFormat(candidatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const shortlistsCmd = program.command('shortlists').description('Manage shortlists');

shortlistsCmd
  .command('list')
  .description('List shortlists')
  .option('--query <json>', 'Additional query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = opts.query ? parseQueryOption(opts.query, '--query') : undefined;
      print(await client.listShortlists(params), getFormat(shortlistsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shortlistsCmd
  .command('get <shortlistId>')
  .description('Get a shortlist by ID')
  .action(async (shortlistId: string) => {
    try {
      const client = getClient();
      print(await client.getShortlist(shortlistId), getFormat(shortlistsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw')
  .description('Send a raw API request to an undocumented path')
  .requiredOption('--path <path>', 'API path (e.g. /searches)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        query: opts.query ? parseQueryOption(opts.query, '--query') : undefined,
        body: opts.body ? parseJsonOption(opts.body, '--body') : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
