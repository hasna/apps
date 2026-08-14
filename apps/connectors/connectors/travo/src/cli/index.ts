#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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

const CONNECTOR_NAME = 'connect-travo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Travo real-estate intelligence API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
      process.env.TRAVO_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRAVO_API_KEY environment variable.`,
    );
    process.exit(1);
  }

  return new Connector({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryFlags(flags: Record<string, string | undefined>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (value !== undefined) {
      query[key] = value;
    }
  }
  return query;
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

    console.log(
      chalk.bold(
        `Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`,
      ),
    );
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.travoai.com/v1)')}`);
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
  .command('set-base-url <baseUrl>')
  .description('Set API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.travoai.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const propertiesCmd = program.command('properties').description('Property intelligence operations');

propertiesCmd
  .command('search')
  .description('Search properties')
  .option('--asset-type <type>', 'Asset type filter')
  .option('--state <state>', 'State filter')
  .option('--q <query>', 'Search query')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const query = parseQueryFlags({
        assetType: opts.assetType,
        state: opts.state,
        q: opts.q,
      });
      const result = await client.properties.searchProperties(query);
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('get <propertyId>')
  .description('Get property details')
  .action(async function (this: Command, propertyId: string) {
    try {
      const client = getClient();
      const result = await client.properties.getProperty(propertyId);
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('comps <propertyId>')
  .description('Get comparable properties')
  .option('--radius <miles>', 'Search radius in miles')
  .action(async function (this: Command, propertyId: string, opts) {
    try {
      const client = getClient();
      const query = opts.radius ? { radius: Number(opts.radius) } : {};
      const result = await client.properties.getComps(propertyId, query);
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('ownership <propertyId>')
  .description('Get property ownership data')
  .action(async function (this: Command, propertyId: string) {
    try {
      const client = getClient();
      const result = await client.properties.getOwnership(propertyId);
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('zoning <propertyId>')
  .description('Get property zoning data')
  .action(async function (this: Command, propertyId: string) {
    try {
      const client = getClient();
      const result = await client.properties.getZoning(propertyId);
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('financials <propertyId>')
  .description('Get property financial data')
  .action(async function (this: Command, propertyId: string) {
    try {
      const client = getClient();
      const result = await client.properties.getFinancials(propertyId);
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('enrich <propertyId>')
  .description('Enrich property data')
  .option('--sources <sources>', 'Comma-separated enrichment sources')
  .option('--body <json>', 'JSON body for enrichment request')
  .action(async function (this: Command, propertyId: string, opts) {
    try {
      const client = getClient();
      let body: Record<string, unknown> = {};

      if (opts.body) {
        body = JSON.parse(opts.body) as Record<string, unknown>;
      } else if (opts.sources) {
        body = { sources: opts.sources.split(',').map((s: string) => s.trim()) };
      }

      const result = await client.properties.enrichProperty(propertyId, body);
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /properties/search)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.properties.rawRequest({
        method: opts.method,
        path: opts.path,
        query: opts.query ? (JSON.parse(opts.query) as Record<string, string>) : undefined,
        body: opts.body ? (JSON.parse(opts.body) as Record<string, unknown>) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
