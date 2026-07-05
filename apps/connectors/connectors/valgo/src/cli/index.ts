#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';
import type { HttpMethod } from '../types';

const CONNECTOR_NAME = 'connect-valgo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Valgo connector CLI - Physical AI risk quantification and autonomy insurance simulations')
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
      process.env.VALGO_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('expected JSON object');
  } catch {
    error(`Invalid ${label} JSON`);
    process.exit(1);
  }
}

function parseQueryOption(value: string | undefined): Record<string, string | number | boolean> | undefined {
  const parsed = parseJsonOption(value, 'query');
  if (!parsed) return undefined;
  const params: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      params[key] = val;
    }
  }
  return params;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VALGO_API_KEY.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
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
    profiles.forEach(p => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
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

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.valgo.ai/v1)')}`);
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
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.valgo.ai/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('list-simulations')
  .description('List simulations')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.simulations.list(parseQueryOption(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-simulation <simulationId>')
  .description('Get a simulation by ID')
  .action(async (simulationId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.simulations.get(simulationId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create-simulation')
  .description('Create a simulation')
  .requiredOption('--data <json>', 'Simulation payload as JSON object')
  .action(async (opts, cmd) => {
    try {
      const body = parseJsonOption(opts.data, 'data');
      if (!body) {
        error('--data is required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.simulations.create(body);
      success('Simulation created');
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-loss-estimate <simulationId>')
  .description('Get loss estimate for a simulation')
  .action(async (simulationId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.simulations.getLossEstimate(simulationId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-routes')
  .description('List routes')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.routes.list(parseQueryOption(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-route <routeId>')
  .description('Get a route by ID')
  .action(async (routeId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.routes.get(routeId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-environments')
  .description('List environments')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.environments.list(parseQueryOption(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw API request')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--path <path>', 'API path (e.g. /simulations)', '/simulations')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .option('--headers <json>', 'Additional headers as JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.raw.request({
        method: opts.method.toUpperCase() as HttpMethod,
        path: opts.path,
        params: parseQueryOption(opts.query),
        body: parseJsonOption(opts.body, 'body'),
        headers: parseJsonOption(opts.headers, 'headers') as Record<string, string> | undefined,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
