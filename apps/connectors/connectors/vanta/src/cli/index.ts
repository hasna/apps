#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Vanta } from '../api';
import {
  getClientId,
  getClientSecret,
  getScope,
  getBaseUrl,
  setCredentials,
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

const CONNECTOR_NAME = 'connect-vanta';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vanta Manage API connector - compliance controls, documents, and event logs')
  .version(VERSION)
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
        error('Profile "' + opts.profile + '" does not exist');
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vanta {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    error(
      'No OAuth credentials configured. Run "' +
        CONNECTOR_NAME +
        ' config set-credentials <clientId> <clientSecret>" or set VANTA_CLIENT_ID/VANTA_CLIENT_SECRET.',
    );
    process.exit(1);
  }

  return new Vanta({
    clientId,
    clientSecret,
    scope: getScope(),
    baseUrl: getBaseUrl(),
  });
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(s => s.trim()).filter(Boolean);
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
    console.log('  ' + p + isActive);
  }
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error('Profile "' + name + '" does not exist');
    process.exit(1);
  }
  setCurrentProfile(name);
  success('Switched to profile: ' + name);
});

profileCmd.command('create <name>').description('Create a new profile')
  .option('--client-id <id>', 'OAuth client ID')
  .option('--client-secret <secret>', 'OAuth client secret')
  .option('--scope <scope>', 'OAuth scope')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error('Profile "' + name + '" already exists');
      process.exit(1);
    }
    createProfile(name, {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      scope: opts.scope,
      baseUrl: opts.baseUrl,
    });
    success('Profile "' + name + '" created');
    if (opts.use) {
      setCurrentProfile(name);
      info('Switched to profile: ' + name);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) {
    success('Profile "' + name + '" deleted');
  } else {
    error('Profile "' + name + '" not found');
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold('Profile: ' + profileName + (profileName === active ? chalk.green(' (active)') : '')));
  info('Client ID: ' + (config.clientId ? config.clientId.substring(0, 8) + '...' : chalk.gray('not set')));
  info('Client Secret: ' + (config.clientSecret ? '***' : chalk.gray('not set')));
  info('Scope: ' + (config.scope || 'vanta-api.all:read'));
  info('Base URL: ' + (config.baseUrl || 'https://api.vanta.com/v1'));
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-credentials <clientId> <clientSecret>')
  .description('Set OAuth client credentials')
  .option('--scope <scope>', 'OAuth scope', 'vanta-api.all:read')
  .option('--base-url <url>', 'API base URL')
  .action((clientId: string, clientSecret: string, opts) => {
    setCredentials(clientId, clientSecret, {
      scope: opts.scope,
      baseUrl: opts.baseUrl,
    });
    success('Credentials saved to profile: ' + getCurrentProfile());
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const clientId = getClientId();
  console.log(chalk.bold('Active Profile: ' + getCurrentProfile()));
  info('Config directory: ' + getConfigDir());
  info('Client ID: ' + (clientId ? clientId.substring(0, 8) + '...' : chalk.gray('not set')));
  info('Scope: ' + getScope());
  info('Base URL: ' + getBaseUrl());
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success('Configuration cleared for profile: ' + getCurrentProfile());
});

const controlsCmd = program.command('controls').description('Manage compliance controls');

controlsCmd.command('list').description('List controls')
  .option('--page-size <n>', 'Page size', '10')
  .option('--page-cursor <cursor>', 'Pagination cursor')
  .option('--framework <ids>', 'Comma-separated framework IDs (frameworkMatchesAny)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.controls.list({
        pageSize: parseInt(opts.pageSize, 10),
        pageCursor: opts.pageCursor,
        frameworkMatchesAny: parseList(opts.framework),
      });
      print(result, getFormat(controlsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

controlsCmd.command('get <controlId>').description('Get a control by ID').action(async (controlId: string) => {
  try {
    const client = getClient();
    const result = await client.controls.get(controlId);
    print(result, getFormat(controlsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

controlsCmd.command('create').description('Create a custom control')
  .requiredOption('-n, --name <name>', 'Control name')
  .requiredOption('-d, --description <description>', 'Control description')
  .option('--external-id <id>', 'External ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.controls.create({
        name: opts.name,
        description: opts.description,
        externalId: opts.externalId,
      });
      success('Control created');
      print(result, getFormat(controlsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Query event logs');

eventsCmd.command('list').description('List event logs (GET /event-logs)')
  .option('--page-size <n>', 'Page size', '10')
  .option('--page-cursor <cursor>', 'Pagination cursor')
  .option('--start-date <date>', 'Filter events on or after this ISO date')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        pageSize: parseInt(opts.pageSize, 10),
        pageCursor: opts.pageCursor,
        startDate: opts.startDate,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const documentsCmd = program.command('documents').description('Search/list documents');

documentsCmd.command('search').description('Search documents via GET /documents (no global /search API)')
  .option('--page-size <n>', 'Page size', '10')
  .option('--page-cursor <cursor>', 'Pagination cursor')
  .option('--framework <ids>', 'Comma-separated framework IDs')
  .option('--status <statuses>', 'Comma-separated document statuses')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.documents.search({
        pageSize: parseInt(opts.pageSize, 10),
        pageCursor: opts.pageCursor,
        frameworkMatchesAny: parseList(opts.framework),
        statusMatchesAny: parseList(opts.status),
      });
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Authenticated raw API request');

rawCmd.command('request <path>').description('Send an authenticated request to any API path')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'JSON request body')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest(path, {
        method: opts.method.toUpperCase(),
        body,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
