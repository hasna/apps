#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SupabaseApiPlatform } from '../api';
import {
  getAccessToken,
  getBaseUrl,
  setAccessToken,
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

const CONNECTOR_NAME = 'connect-supabase-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Supabase Management API connector CLI - projects, audit events, search, and raw API access')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseQuery(query?: string): Record<string, string> | undefined {
  if (!query) return undefined;
  try {
    const parsed = JSON.parse(query) as Record<string, string>;
    return parsed;
  } catch {
    const params: Record<string, string> = {};
    for (const pair of query.split('&')) {
      const [key, value] = pair.split('=');
      if (key) params[key] = value ?? '';
    }
    return params;
  }
}

function parseBody(body?: string): Record<string, unknown> {
  if (!body) return {};
  return JSON.parse(body) as Record<string, unknown>;
}

function getClient(): SupabaseApiPlatform {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set SUPABASE_API_PLATFORM_ACCESS_TOKEN`);
    process.exit(1);
  }
  return new SupabaseApiPlatform({ accessToken, baseUrl: getBaseUrl() });
}

const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found');
    return;
  }
  profiles.forEach(p => {
    const marker = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${marker}`);
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

profileCmd.command('create <name>').description('Create profile')
  .option('--access-token <token>', 'Personal access token')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { accessToken: opts.accessToken, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) {
    success(`Profile "${name}" deleted`);
  } else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Access Token: ${config.accessToken ? config.accessToken.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-token <accessToken>').description('Set personal access token').action((accessToken: string) => {
  setAccessToken(accessToken);
  success('Access token saved');
});

configCmd.command('set-base-url <baseUrl>').description('Set API base URL').action((baseUrl: string) => {
  setBaseUrl(baseUrl);
  success('Base URL saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const accessToken = getAccessToken();
  info(`Access Token: ${accessToken ? accessToken.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.supabase.com/v1)')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

const itemsCmd = program.command('items').description('Manage Supabase projects');

itemsCmd.command('list')
  .description('List projects (GET /projects)')
  .option('-q, --query <query>', 'Query string (key=value&...) or JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.listItems(parseQuery(opts.query));
      print(result, getFormat(cmd.parent as Command));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd.command('create')
  .description('Create a project (POST /projects)')
  .option('-d, --data <json>', 'Project JSON body', '{}')
  .option('-q, --query <query>', 'Query string or JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.createItem(parseBody(opts.data), parseQuery(opts.query));
      print(result, getFormat(cmd.parent as Command));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd.command('get <projectRef>')
  .description('Get a project by ref (GET /projects/{ref})')
  .action(async (projectRef: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.getItem(projectRef);
      print(result, getFormat(cmd.parent as Command));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Organization audit events');

eventsCmd.command('list')
  .description('List audit events (GET /organizations/{organization_slug}/audit)')
  .option('-q, --query <query>', 'Query string; must include organization_slug')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.listEvents(parseQuery(opts.query));
      print(result, getFormat(cmd.parent as Command));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('search')
  .description('Search projects via GET /projects query filters')
  .option('-d, --data <json>', 'Filter JSON body', '{}')
  .option('-q, --query <query>', 'Query string or JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.search(parseBody(opts.data), parseQuery(opts.query));
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('raw <path>')
  .description('Send a raw Management API request')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-q, --query <query>', 'Query string or JSON object')
  .option('-d, --data <json>', 'Request JSON body')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase();
      const result = await client.rawRequest(path, {
        method,
        params: parseQuery(opts.query),
        body: opts.data ? parseBody(opts.data) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
