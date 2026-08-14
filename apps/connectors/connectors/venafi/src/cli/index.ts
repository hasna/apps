#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  getBaseUrl,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-venafi';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Venafi TLS Protect Cloud API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.VENAFI_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VENAFI_API_KEY.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Connector({ apiKey, baseUrl });
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.venafi.com/v1)')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.venafi.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const certificatesCmd = program.command('certificates').description('Certificate operations');

certificatesCmd
  .command('list')
  .description('List certificates')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.certificates.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
      });
      print(result, getFormat(certificatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

certificatesCmd
  .command('get <certificateId>')
  .description('Get a certificate by ID')
  .action(async (certificateId: string) => {
    try {
      const client = getClient();
      const result = await client.certificates.get(certificateId);
      print(result, getFormat(certificatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

certificatesCmd
  .command('create')
  .description('Create a certificate')
  .option('-b, --body <json>', 'Request body as JSON string')
  .option('-n, --common-name <name>', 'Certificate common name')
  .action(async (opts) => {
    try {
      const client = getClient();
      let body: Record<string, unknown> = {};
      if (opts.body) {
        body = JSON.parse(opts.body);
      } else if (opts.commonName) {
        body = { commonName: opts.commonName };
      } else {
        error('Provide --body <json> or --common-name <name>');
        process.exit(1);
      }
      const result = await client.certificates.create(body);
      success('Certificate request submitted');
      print(result, getFormat(certificatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search Venafi objects')
  .requiredOption('-e, --expression <expr>', 'Search expression')
  .option('-t, --object-types <types>', 'Comma-separated object types')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body: Record<string, unknown> = { expression: opts.expression };
      if (opts.objectTypes) {
        body.objectTypes = opts.objectTypes.split(',').map((s: string) => s.trim());
      }
      const result = await client.search.search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /certificates)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'Request body as JSON string')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.raw.request({
        path: opts.path,
        method: opts.method.toUpperCase(),
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
