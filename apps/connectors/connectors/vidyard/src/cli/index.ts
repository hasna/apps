#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Vidyard } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-vidyard';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vidyard Dashboard API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
      process.env.VIDYARD_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vidyard {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set VIDYARD_API_KEY.`);
    process.exit(1);
  }

  return new Vidyard({ apiKey, baseUrl: getBaseUrl() });
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
  .option('--api-key <key>', 'API token')
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

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API token')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || 'https://api.vidyard.com/dashboard/v1'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const videosCmd = program.command('videos').description('Video operations');

videosCmd
  .command('list')
  .description('List videos')
  .action(async function (this: Command) {
    try {
      const client = getClient();
      const result = await client.listVideos();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('get <id>')
  .description('Get a video by ID')
  .action(async function (this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getVideo(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('create')
  .description('Create a video')
  .requiredOption('-n, --name <name>', 'Video name')
  .option('-u, --upload-url <url>', 'Source video URL')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const video: Record<string, unknown> = { name: opts.name };
      if (opts.uploadUrl) {
        video.upload_url = opts.uploadUrl;
      }
      const result = await client.createVideo(video);
      success('Video created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events')
  .action(async function (this: Command) {
    try {
      const client = getClient();
      const result = await client.listEvents();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <id>')
  .description('Get an event by ID')
  .action(async function (this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getEvent(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search operations');

searchCmd
  .command('events')
  .description('Search events')
  .option('-q, --query <query>', 'Search query')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.searchEvents(opts.query ? { query: opts.query } : {});
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('players')
  .description('Search players')
  .option('-q, --query <query>', 'Search query')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.searchPlayers(opts.query ? { query: opts.query } : {});
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <method> <path>')
  .description('Make a raw API request (escape hatch)')
  .option('-b, --body <json>', 'JSON request body')
  .action(async function (this: Command, method: string, path: string, opts) {
    try {
      const client = getClient();
      const upperMethod = method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      const body = opts.body ? JSON.parse(opts.body) as Record<string, unknown> : undefined;
      const result = await client.rawRequest(path, { method: upperMethod, body });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
