#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { VercelEdgeConfig } from '../api';
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
  getTeamId,
  setTeamId,
  getBaseUrl,
  setBaseUrl,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-vercel-edge-config';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vercel Edge Config connector - Manage edge configs, items, tokens, and backups')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-t, --team-id <id>', 'Team ID')
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
      process.env.VERCEL_TOKEN = opts.apiKey;
    }
    if (opts.teamId) {
      process.env.VERCEL_TEAM_ID = opts.teamId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): VercelEdgeConfig {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VERCEL_TOKEN.`,
    );
    process.exit(1);
  }
  return new VercelEdgeConfig({ apiKey, teamId: getTeamId(), baseUrl: getBaseUrl() });
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
  .option('--api-key <key>', 'API key')
  .option('--team-id <id>', 'Team ID')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      teamId: opts.teamId,
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
    info(`Team ID: ${config.teamId || chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.vercel.com)')}`);
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
  .command('set-team <teamId>')
  .description('Set team ID')
  .action((teamId: string) => {
    setTeamId(teamId);
    success(`Team ID saved to profile: ${getCurrentProfile()}`);
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
    const teamId = getTeamId();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Team ID: ${teamId || chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const edgeConfigCmd = program.command('edge-config').description('Edge Config operations');

edgeConfigCmd
  .command('list')
  .description('List all Edge Configs')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listEdgeConfigs();
      print(result, getFormat(edgeConfigCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

edgeConfigCmd
  .command('get <edgeConfigId>')
  .description('Get an Edge Config by ID')
  .action(async (edgeConfigId: string) => {
    try {
      const client = getClient();
      const result = await client.getEdgeConfig(edgeConfigId);
      print(result, getFormat(edgeConfigCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

edgeConfigCmd
  .command('create <slug>')
  .description('Create an Edge Config')
  .option('--items <json>', 'Initial items JSON object')
  .action(async (slug: string, opts) => {
    try {
      const client = getClient();
      const body: { slug: string; items?: Record<string, unknown> } = { slug };
      if (opts.items) {
        body.items = JSON.parse(opts.items);
      }
      const result = await client.createEdgeConfig(body);
      print(result, getFormat(edgeConfigCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

edgeConfigCmd
  .command('update <edgeConfigId>')
  .description('Update an Edge Config')
  .option('--slug <slug>', 'New slug')
  .option('--items <json>', 'Items JSON object')
  .action(async (edgeConfigId: string, opts) => {
    try {
      const client = getClient();
      const body: { slug?: string; items?: Record<string, unknown> } = {};
      if (opts.slug) body.slug = opts.slug;
      if (opts.items) body.items = JSON.parse(opts.items);
      const result = await client.updateEdgeConfig(edgeConfigId, body);
      print(result, getFormat(edgeConfigCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

edgeConfigCmd
  .command('delete <edgeConfigId>')
  .description('Delete an Edge Config')
  .action(async (edgeConfigId: string) => {
    try {
      const client = getClient();
      await client.deleteEdgeConfig(edgeConfigId);
      success(`Deleted Edge Config: ${edgeConfigId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const itemCmd = program.command('item').description('Edge Config item operations');

itemCmd
  .command('get <edgeConfigId> <key>')
  .description('Get a single item by key')
  .action(async (edgeConfigId: string, key: string) => {
    try {
      const client = getClient();
      const result = await client.getItem(edgeConfigId, key);
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const itemsCmd = program.command('items').description('Edge Config batch item operations');

itemsCmd
  .command('patch <edgeConfigId> <file>')
  .description('Batch update items from a JSON file (items array per Vercel API)')
  .action(async (edgeConfigId: string, file: string) => {
    try {
      const client = getClient();
      const body = JSON.parse(readFileSync(file, 'utf-8'));
      const result = await client.patchItems(edgeConfigId, body);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const schemaCmd = program.command('schema').description('Edge Config schema operations');

schemaCmd
  .command('get <edgeConfigId>')
  .description('Get Edge Config schema')
  .action(async (edgeConfigId: string) => {
    try {
      const client = getClient();
      const result = await client.getSchema(edgeConfigId);
      print(result, getFormat(schemaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const tokenCmd = program.command('token').description('Edge Config read token operations');

tokenCmd
  .command('list <edgeConfigId>')
  .description('List read access tokens')
  .action(async (edgeConfigId: string) => {
    try {
      const client = getClient();
      const result = await client.listTokens(edgeConfigId);
      print(result, getFormat(tokenCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tokenCmd
  .command('create <edgeConfigId>')
  .description('Create a read access token')
  .option('--label <label>', 'Token label')
  .action(async (edgeConfigId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createToken(edgeConfigId, opts.label);
      print(result, getFormat(tokenCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const backupCmd = program.command('backup').description('Edge Config backup operations');

backupCmd
  .command('list <edgeConfigId>')
  .description('List backups')
  .action(async (edgeConfigId: string) => {
    try {
      const client = getClient();
      const result = await client.listBackups(edgeConfigId);
      print(result, getFormat(backupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <method> <path>')
  .description('Send a raw API request (escape hatch)')
  .option('--body <json>', 'Request body JSON')
  .option('--query <json>', 'Query parameters JSON')
  .action(async (method: string, path: string, opts) => {
    const upperMethod = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod)) {
      error('Method must be GET, POST, PUT, PATCH, or DELETE');
      process.exit(1);
    }

    try {
      const client = getClient();
      const result = await client.rawRequest(upperMethod as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path, {
        body: opts.body ? JSON.parse(opts.body) : undefined,
        params: opts.query ? JSON.parse(opts.query) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
