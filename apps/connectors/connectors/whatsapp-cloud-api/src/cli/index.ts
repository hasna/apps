#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { WhatsappCloudApi } from '../api';
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

const CONNECTOR_NAME = 'connect-whatsapp-cloud-api';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WhatsApp Cloud API connector — items, events, search, and raw API access (api.whatsappcloudapi.com)')
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
      process.env.WHATSAPP_CLOUD_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WhatsappCloudApi {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WHATSAPP_CLOUD_API_KEY.`);
    process.exit(1);
  }
  return new WhatsappCloudApi({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function parseJsonFile(path: string, label: string): Record<string, unknown> {
  try {
    return parseJsonOption(readFileSync(path, 'utf-8'), label);
  } catch {
    error(`Could not read ${label} file: ${path}`);
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
  for (const p of profiles) {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  }
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
  info(`Base URL: ${getBaseUrl()}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const itemsCmd = program.command('items').description('Item endpoints');

itemsCmd.command('list').description('List items (GET /items)').action(async () => {
  try {
    const result = await getClient().listItems();
    print(result, getFormat(itemsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

itemsCmd.command('get <itemId>').description('Get item by ID (GET /items/:itemId)').action(async (itemId: string) => {
  try {
    const result = await getClient().getItem(itemId);
    print(result, getFormat(itemsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

itemsCmd
  .command('create')
  .description('Create item (POST /items)')
  .option('--json <json>', 'JSON request body')
  .option('--file <path>', 'Path to JSON file for request body')
  .action(async (opts) => {
    try {
      const body = opts.file
        ? parseJsonFile(opts.file, 'body')
        : opts.json
          ? parseJsonOption(opts.json, 'body')
          : {};
      const result = await getClient().createItem(body);
      success('Item created');
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Event endpoints');

eventsCmd.command('list').description('List events (GET /events)').action(async () => {
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
  .description('Search (POST /search)')
  .option('--json <json>', 'JSON request body')
  .option('--file <path>', 'Path to JSON file for request body')
  .action(async (opts) => {
    try {
      const body = opts.file
        ? parseJsonFile(opts.file, 'body')
        : opts.json
          ? parseJsonOption(opts.json, 'body')
          : {};
      const result = await getClient().search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <path>')
  .description('Raw API request')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--json <json>', 'JSON request body')
  .option('--file <path>', 'Path to JSON file for request body')
  .action(async (path: string, opts) => {
    try {
      const method = String(opts.method || 'GET').toUpperCase();
      const body =
        opts.file ? parseJsonFile(opts.file, 'body') : opts.json ? parseJsonOption(opts.json, 'body') : undefined;
      const result = await getClient().rawRequest({
        path,
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
