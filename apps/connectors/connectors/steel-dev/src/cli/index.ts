#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { SteelDev } from '../api';
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

const CONNECTOR_NAME = 'connect-steel-dev';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Steel Dev connector CLI - cloud browser sessions and page extraction API')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Steel API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, yaml, pretty)', 'yaml')
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

    if (opts.apiKey) {
      process.env.STEEL_API_KEY = opts.apiKey;
    }
  });

function getFormat(): OutputFormat {
  return (program.opts().format || 'yaml') as OutputFormat;
}

function getClient(): SteelDev {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!apiKey) {
    error(`No Steel API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STEEL_API_KEY.`);
    process.exit(1);
  }

  return new SteelDev({ apiKey, baseUrl });
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) {
    error(`File not found: ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    error(`Invalid JSON in file: ${path}`);
    process.exit(1);
  }
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
  profiles.forEach(p => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
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
  .option('--api-key <key>', 'Steel API key')
  .option('--base-url <url>', 'Steel API base URL')
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
  info(`Base URL: ${config.baseUrl || 'https://api.steel.dev/v1 (default)'}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set Steel API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set Steel API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl()}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const sessionsCmd = program.command('sessions').description('Manage Steel browser sessions');

sessionsCmd.command('list').description('List sessions').action(async () => {
  try {
    const client = getClient();
    const result = await client.sessions.list();
    print(result, getFormat());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sessionsCmd
  .command('create')
  .description('Create a new session')
  .option('-i, --input <file>', 'JSON file with session options')
  .option('--use-proxy', 'Enable Steel proxy network')
  .option('--solve-captcha', 'Enable automatic CAPTCHA solving')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.input ? readJsonFile(opts.input) as Record<string, unknown> : {};
      if (opts.useProxy) body.useProxy = true;
      if (opts.solveCaptcha) body.solveCaptcha = true;
      const result = await client.sessions.create(body);
      success('Session created');
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd.command('get <id>').description('Get session by ID').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.sessions.get(id);
    print(result, getFormat());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sessionsCmd.command('release <id>').description('Release a session').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.sessions.release(id);
    success(`Session ${id} released`);
    print(result, getFormat());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const eventsCmd = program.command('events').description('Session recording events');

eventsCmd.command('list <sessionId>').description('List events for a session').action(async (sessionId: string) => {
  try {
    const client = getClient();
    const result = await client.sessions.events(sessionId);
    print(result, getFormat());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const searchCmd = program.command('search').description('Extract page content from a URL (POST /v1/scrape)');

searchCmd
  .command('scrape <url>')
  .description('Scrape a URL and return rendered content')
  .option('--format <formats>', 'Comma-separated formats (markdown,html,cleaned_html,readability)', 'markdown')
  .option('--use-proxy', 'Route through Steel proxy network')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search.scrape({
        url,
        format: opts.format.split(',').map((f: string) => f.trim()),
        useProxy: opts.useProxy || undefined,
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Send a raw HTTP request to the Steel API');

rawCmd
  .command('request')
  .description('Execute a raw API request')
  .requiredOption('-X, --method <method>', 'HTTP method')
  .requiredOption('-p, --path <path>', 'API path (e.g. /sessions)')
  .option('-b, --body <file>', 'JSON body file')
  .option('-q, --query <json>', 'Query params as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? readJsonFile(opts.body) : undefined;
      const query = opts.query ? JSON.parse(opts.query) : undefined;
      const result = await client.getClient().rawRequest({
        method: opts.method,
        path: opts.path,
        body,
        query,
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
