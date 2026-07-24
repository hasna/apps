#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Veo } from '../api';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getApiKey,
  getBaseUrl,
  getConfigDir,
  getCurrentProfile,
  listProfiles,
  loadProfile,
  profileExists,
  setApiKey,
  setBaseUrl,
  setCurrentProfile,
  setProfileOverride,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { error, info, parseBodyJson, parseQueryJson, print, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-veo';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Veo sports video library API — videos, transcripts, users, and groups')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API access token (overrides config)')
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
      process.env.VEO_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Veo {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <token>" or set VEO_API_KEY.`);
    process.exit(1);
  }
  return new Veo({ apiKey, baseUrl: getBaseUrl() });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile').option('--api-key <key>', 'API access token').action((name: string, opts) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name, { apiKey: opts.apiKey });
  success(`Profile "${name}" created`);
});

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Cannot delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API access token').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set custom API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || 'https://api.veo.co.uk/api (default)'}`);
});

configCmd.command('clear').description('Clear active profile config').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const videosCmd = program.command('videos').description('Video library operations');

videosCmd
  .command('list')
  .description('List videos (GET /videos/v3/get-all)')
  .option('--query <json>', 'JSON query parameters object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.videos.list(parseQueryJson(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('get <videoId>')
  .description('Get a video by ID')
  .option('--query <json>', 'JSON query parameters object')
  .action(async (videoId: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.videos.get(videoId, parseQueryJson(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('transcript <videoId>')
  .description('Get video transcript')
  .option('--query <json>', 'JSON query parameters object')
  .action(async (videoId: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.videos.getTranscript(videoId, parseQueryJson(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const usersCmd = program.command('users').description('User operations');

usersCmd
  .command('list')
  .description('List users (GET /users)')
  .option('--query <json>', 'JSON query parameters object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.users.list(parseQueryJson(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const groupsCmd = program.command('groups').description('Group operations');

groupsCmd
  .command('list')
  .description('List groups (GET /groups)')
  .option('--query <json>', 'JSON query parameters object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.groups.list(parseQueryJson(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send an authenticated request to any API path')
  .requiredOption('-m, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)')
  .requiredOption('--path <path>', 'API path (e.g. /videos/v3/get-all)')
  .option('--query <json>', 'JSON query parameters object')
  .option('--body <json>', 'JSON request body')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        error(`Unsupported method: ${opts.method}`);
        process.exit(1);
      }
      const result = await client.rawRequest({
        method,
        path: opts.path,
        query: parseQueryJson(opts.query),
        body: parseBodyJson(opts.body),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
