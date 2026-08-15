#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { TestRigor } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-testrigor';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TestRigor connector — manage test suites, events, and search')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    if (opts.apiKey) {
      process.env.TESTRIGOR_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function getClient(): TestRigor {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TESTRIGOR_API_KEY.`);
    process.exit(1);
  }
  return new TestRigor({ apiKey, baseUrl: getBaseUrl() });
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

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || 'https://api.testrigor.com/v1 (default)'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const suitesCmd = program.command('suites').description('Manage test suites');

suitesCmd.command('list').description('List test suites').action(async () => {
  try {
    const result = await getClient().listSuites();
    print(result, getFormat(suitesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

suitesCmd.command('get <suiteId>').description('Get a test suite by ID').action(async (suiteId: string) => {
  try {
    const result = await getClient().getSuite(suiteId);
    print(result, getFormat(suitesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

suitesCmd
  .command('create')
  .description('Create a test suite')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.bodyFile) body = parseJsonOption(readFileSync(opts.bodyFile, 'utf-8'), 'body file');
      else if (opts.body) body = parseJsonOption(opts.body, '--body');
      const result = await getClient().createSuite(body);
      print(result, getFormat(suitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List test events');

eventsCmd.command('list').description('List events').action(async () => {
  try {
    const result = await getClient().listEvents();
    print(result, getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program
  .command('search')
  .description('Search test artifacts')
  .option('--body <json>', 'JSON search request body')
  .option('--body-file <path>', 'Path to JSON search body file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.bodyFile) body = parseJsonOption(readFileSync(opts.bodyFile, 'utf-8'), 'body file');
      else if (opts.body) body = parseJsonOption(opts.body, '--body');
      else {
        error('Provide --body or --body-file');
        process.exit(1);
      }
      const result = await getClient().search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('request')
  .description('Send a raw API request')
  .requiredOption('--method <method>', 'HTTP method')
  .requiredOption('--path <path>', 'API path (e.g. /suites)')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> | undefined;
      if (opts.bodyFile) body = parseJsonOption(readFileSync(opts.bodyFile, 'utf-8'), 'body file');
      else if (opts.body) body = parseJsonOption(opts.body, '--body');
      const result = await getClient().rawRequest(opts.path, { method: opts.method.toUpperCase(), body });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
