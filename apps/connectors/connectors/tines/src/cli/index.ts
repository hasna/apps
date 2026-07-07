#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import { Tines } from '../api';
import {
  getApiKey,
  getTenantUrl,
  setApiKey,
  setTenantUrl,
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

const CONNECTOR_NAME = 'connect-tines';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tines SOAR connector — stories, agents, events, webhooks')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --tenant-url <url>', 'Tenant URL (overrides config)')
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
      process.env.TINES_API_KEY = opts.apiKey;
    }
    if (opts.tenantUrl) {
      process.env.TINES_TENANT_URL = opts.tenantUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tines {
  const apiKey = getApiKey();
  const tenantUrl = getTenantUrl();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set" or set TINES_API_KEY.`);
    process.exit(1);
  }
  if (!tenantUrl) {
    error(`No tenant URL configured. Run "${CONNECTOR_NAME} config set" or set TINES_TENANT_URL.`);
    process.exit(1);
  }

  return new Tines({ apiKey, tenantUrl });
}

function parseIntOpt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
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
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--tenant-url <url>', 'Tenant URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, tenantUrl: opts.tenantUrl });
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
    info(`API key: ${config.apiKey ? `${config.apiKey.substring(0, 4)}...` : chalk.gray('not set')}`);
    info(`Tenant URL: ${config.tenantUrl || chalk.gray('not set')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set')
  .description('Set Tines credentials')
  .requiredOption('--api-key <key>', 'Tines API key')
  .requiredOption('--tenant-url <url>', 'Tines tenant URL (https://...)')
  .action((opts) => {
    setApiKey(opts.apiKey);
    setTenantUrl(opts.tenantUrl);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const tenantUrl = getTenantUrl();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API key: ${apiKey ? `${apiKey.substring(0, 4)}...` : chalk.gray('not set')}`);
    info(`Tenant URL: ${tenantUrl || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear active profile credentials')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Stories
const storiesCmd = program.command('stories').description('Manage Tines stories');

storiesCmd
  .command('list')
  .description('List stories')
  .option('--team-id <id>', 'Filter by team ID')
  .option('--folder-id <id>', 'Filter by folder ID')
  .option('--tags <tags>', 'Filter by tags')
  .option('--per-page <n>', 'Results per page')
  .option('--page <n>', 'Page number')
  .action(async (opts, cmd) => {
    const client = getClient();
    const result = await client.stories.list({
      teamId: parseIntOpt(opts.teamId),
      folderId: parseIntOpt(opts.folderId),
      tags: opts.tags,
      perPage: parseIntOpt(opts.perPage),
      page: parseIntOpt(opts.page),
    });
    print(result, getFormat(cmd));
  });

storiesCmd
  .command('get <id>')
  .description('Get a story by ID')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.stories.get(Number.parseInt(id, 10)), getFormat(cmd));
  });

storiesCmd
  .command('create <name>')
  .description('Create a story')
  .requiredOption('--team-id <id>', 'Team ID')
  .option('--description <text>', 'Story description')
  .option('--folder-id <id>', 'Folder ID')
  .option('--disabled', 'Create disabled')
  .action(async (name: string, opts, cmd) => {
    const client = getClient();
    print(
      await client.stories.create({
        teamId: Number.parseInt(opts.teamId, 10),
        name,
        description: opts.description,
        folderId: parseIntOpt(opts.folderId),
        disabled: opts.disabled,
      }),
      getFormat(cmd),
    );
  });

storiesCmd
  .command('delete <id>')
  .description('Delete a story')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.stories.delete(Number.parseInt(id, 10)), getFormat(cmd));
  });

storiesCmd
  .command('export <id>')
  .description('Export a story')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.stories.export(Number.parseInt(id, 10)), getFormat(cmd));
  });

// Agents
const agentsCmd = program.command('agents').description('Manage Tines agents');

agentsCmd
  .command('list')
  .description('List agents')
  .option('--story-id <id>', 'Filter by story ID')
  .option('--per-page <n>', 'Results per page')
  .option('--page <n>', 'Page number')
  .action(async (opts, cmd) => {
    const client = getClient();
    print(
      await client.agents.list({
        storyId: parseIntOpt(opts.storyId),
        perPage: parseIntOpt(opts.perPage),
        page: parseIntOpt(opts.page),
      }),
      getFormat(cmd),
    );
  });

agentsCmd
  .command('get <id>')
  .description('Get an agent by ID')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.agents.get(Number.parseInt(id, 10)), getFormat(cmd));
  });

agentsCmd
  .command('run <id>')
  .description('Run an agent')
  .option('--payload <json>', 'JSON payload')
  .action(async (id: string, opts, cmd) => {
    const client = getClient();
    const payload = opts.payload ? JSON.parse(opts.payload) : {};
    print(await client.agents.run(Number.parseInt(id, 10), payload), getFormat(cmd));
  });

agentsCmd
  .command('test <id>')
  .description('Test an agent')
  .option('--event-id <id>', 'Event ID')
  .action(async (id: string, opts, cmd) => {
    const client = getClient();
    print(
      await client.agents.test(Number.parseInt(id, 10), parseIntOpt(opts.eventId)),
      getFormat(cmd),
    );
  });

// Events
const eventsCmd = program.command('events').description('Tines events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--agent-id <id>', 'Filter by agent ID')
  .option('--story-id <id>', 'Filter by story ID')
  .option('--per-page <n>', 'Results per page')
  .option('--page <n>', 'Page number')
  .action(async (opts, cmd) => {
    const client = getClient();
    print(
      await client.events.list({
        agentId: parseIntOpt(opts.agentId),
        storyId: parseIntOpt(opts.storyId),
        perPage: parseIntOpt(opts.perPage),
        page: parseIntOpt(opts.page),
      }),
      getFormat(cmd),
    );
  });

eventsCmd
  .command('get <id>')
  .description('Get an event by ID')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.events.get(Number.parseInt(id, 10)), getFormat(cmd));
  });

// Folders
const foldersCmd = program.command('folders').description('Manage folders');

foldersCmd
  .command('list')
  .option('--team-id <id>', 'Filter by team ID')
  .action(async (opts, cmd) => {
    const client = getClient();
    print(await client.folders.list({ teamId: parseIntOpt(opts.teamId) }), getFormat(cmd));
  });

foldersCmd
  .command('create <name>')
  .requiredOption('--team-id <id>', 'Team ID')
  .option('--content-type <type>', 'Content type')
  .action(async (name: string, opts, cmd) => {
    const client = getClient();
    print(
      await client.folders.create({
        teamId: Number.parseInt(opts.teamId, 10),
        name,
        contentType: opts.contentType,
      }),
      getFormat(cmd),
    );
  });

foldersCmd
  .command('delete <id>')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.folders.delete(Number.parseInt(id, 10)), getFormat(cmd));
  });

// Teams & users
program
  .command('teams list')
  .description('List teams')
  .action(async (_opts, cmd) => {
    const client = getClient();
    print(await client.teams.list(), getFormat(cmd));
  });

program
  .command('users list')
  .description('List users')
  .option('--team-id <id>', 'Filter by team ID')
  .action(async (opts, cmd) => {
    const client = getClient();
    print(await client.users.list({ teamId: parseIntOpt(opts.teamId) }), getFormat(cmd));
  });

program
  .command('tunnels list')
  .description('List tunnels')
  .action(async (_opts, cmd) => {
    const client = getClient();
    print(await client.tunnels.list(), getFormat(cmd));
  });

// Credentials
const credsCmd = program.command('credentials').description('User credentials');

credsCmd
  .command('list')
  .option('--team-id <id>', 'Filter by team ID')
  .action(async (opts, cmd) => {
    const client = getClient();
    print(await client.credentials.list({ teamId: parseIntOpt(opts.teamId) }), getFormat(cmd));
  });

credsCmd
  .command('create <name>')
  .requiredOption('--team-id <id>', 'Team ID')
  .requiredOption('--mode <mode>', 'Credential mode')
  .option('--value <value>', 'Credential value')
  .option('--description <text>', 'Description')
  .action(async (name: string, opts, cmd) => {
    const client = getClient();
    print(
      await client.credentials.create({
        teamId: Number.parseInt(opts.teamId, 10),
        name,
        mode: opts.mode,
        value: opts.value,
        description: opts.description,
      }),
      getFormat(cmd),
    );
  });

credsCmd
  .command('delete <id>')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.credentials.delete(Number.parseInt(id, 10)), getFormat(cmd));
  });

// Annotations & story runs
program
  .command('annotations list')
  .requiredOption('--story-id <id>', 'Story ID')
  .action(async (opts, cmd) => {
    const client = getClient();
    print(await client.annotations.list(Number.parseInt(opts.storyId, 10)), getFormat(cmd));
  });

const runsCmd = program.command('story-runs').description('Story runs');

runsCmd
  .command('list')
  .requiredOption('--story-id <id>', 'Story ID')
  .option('--status <status>', 'Filter by status')
  .action(async (opts, cmd) => {
    const client = getClient();
    print(
      await client.storyRuns.list({
        storyId: Number.parseInt(opts.storyId, 10),
        status: opts.status,
      }),
      getFormat(cmd),
    );
  });

runsCmd
  .command('get <id>')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.storyRuns.get(Number.parseInt(id, 10)), getFormat(cmd));
  });

runsCmd
  .command('stop <id>')
  .action(async (id: string, _opts, cmd) => {
    const client = getClient();
    print(await client.storyRuns.stop(Number.parseInt(id, 10)), getFormat(cmd));
  });

// Webhooks
program
  .command('webhook send <path> <secret>')
  .description('Send payload to a Tines webhook')
  .option('--payload <json>', 'JSON payload', '{}')
  .action(async (path: string, secret: string, opts, cmd) => {
    const client = getClient();
    const payload = JSON.parse(opts.payload);
    print(await client.webhooks.send(path, secret, payload), getFormat(cmd));
  });

program.parse();
