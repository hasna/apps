#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Teamtailor } from '../api';
import { ResourceApi } from '../api/resources';
import {
  getApiKey,
  setApiKey,
  setApiVersion,
  setBaseUrl,
  clearConfig,
  getConfigDir,
  getApiVersion,
  getBaseUrl,
  isAuthenticated,
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
import type { JsonApiResourceObject, ListParams } from '../types';

const program = new Command();

program
  .name('connect-teamtailor')
  .description('Teamtailor API connector CLI - Manage candidates, jobs, applications, and recruitment data')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-teamtailor profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }
  });

// Helper to get output format from the root command
function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format;
    if (fmt) return fmt as OutputFormat;
    node = node.parent;
  }
  return 'pretty';
}

// Helper to get authenticated client
function requireAuth(): Teamtailor {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-teamtailor config set-key <key>" or set TEAMTAILOR_API_KEY.');
    process.exit(1);
  }
  return Teamtailor.create();
}

// Flatten a JSON:API resource object into a single row for table/pretty output.
function flattenResource(resource: JsonApiResourceObject): Record<string, unknown> {
  return {
    id: resource.id,
    type: resource.type,
    ...resource.attributes,
  };
}

// Parse a --filter "key=value,key2=value2" string into a filter map.
function parseFilter(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  const filter: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) filter[key] = value;
  }
  return Object.keys(filter).length ? filter : undefined;
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

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
  .option('--api-version <version>', 'X-Api-Version date (YYYYMMDD)')
  .option('--base-url <url>', 'Custom API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      apiVersion: opts.apiVersion,
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
    info(`API Version: ${config.apiVersion || chalk.gray('default')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set the Teamtailor API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('set-version <apiVersion>')
  .description('Set the X-Api-Version date (YYYYMMDD)')
  .action((apiVersion: string) => {
    setApiVersion(apiVersion);
    success(`API version set to ${apiVersion} for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <baseUrl>')
  .description('Set a custom API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL set to ${baseUrl} for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Version: ${getApiVersion() || chalk.gray('default')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.teamtailor.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Resource Commands (generic JSON:API CRUD)
// ============================================

interface ResourceSpec {
  /** CLI command name */
  command: string;
  /** Human description */
  description: string;
  /** Accessor returning the ResourceApi instance from a Teamtailor client */
  select: (tt: Teamtailor) => ResourceApi;
}

const RESOURCES: ResourceSpec[] = [
  { command: 'candidates', description: 'Manage candidates', select: t => t.candidates },
  { command: 'jobs', description: 'Manage jobs', select: t => t.jobs },
  { command: 'applications', description: 'Manage job applications', select: t => t.jobApplications },
  { command: 'users', description: 'Manage users', select: t => t.users },
  { command: 'departments', description: 'Manage departments', select: t => t.departments },
  { command: 'locations', description: 'Manage locations', select: t => t.locations },
  { command: 'stages', description: 'Manage recruitment stages', select: t => t.stages },
];

for (const spec of RESOURCES) {
  const cmd = program.command(spec.command).description(spec.description);

  cmd
    .command('list')
    .description(`List ${spec.command}`)
    .option('-n, --page <number>', 'Page number', (v) => parseInt(v, 10))
    .option('-s, --size <number>', 'Page size', (v) => parseInt(v, 10))
    .option('-i, --include <relations>', 'Comma-separated relationships to sideload')
    .option('--sort <field>', 'Sort field (prefix with - for descending)')
    .option('--filter <pairs>', 'Filters as key=value,key2=value2')
    .action(async (opts) => {
      try {
        const api = spec.select(requireAuth());
        const params: ListParams = {};
        if (opts.page !== undefined) params.pageNumber = opts.page;
        if (opts.size !== undefined) params.pageSize = opts.size;
        if (opts.include) params.include = opts.include;
        if (opts.sort) params.sort = opts.sort;
        const filter = parseFilter(opts.filter);
        if (filter) params.filter = filter;

        const response = await api.list(params);
        const rows = (response.data || []).map(flattenResource);

        if (rows.length === 0) {
          info(`No ${spec.command} found`);
          return;
        }

        const total = response.meta?.['record-count'];
        success(`Found ${rows.length} ${spec.command}${total ? ` (of ${total} total)` : ''}:`);
        print(rows, getFormat(cmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  cmd
    .command('get <id>')
    .description(`Get a single ${spec.command.replace(/s$/, '')} by id`)
    .option('-i, --include <relations>', 'Comma-separated relationships to sideload')
    .action(async (id: string, opts) => {
      try {
        const api = spec.select(requireAuth());
        const response = await api.get(id, opts.include ? { include: opts.include } : undefined);
        print(flattenResource(response.data), getFormat(cmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  cmd
    .command('create')
    .description(`Create a ${spec.command.replace(/s$/, '')}`)
    .requiredOption('-d, --data <json>', 'JSON object of attributes')
    .option('-r, --relationships <json>', 'JSON object of JSON:API relationships')
    .action(async (opts) => {
      try {
        const api = spec.select(requireAuth());
        const attributes = JSON.parse(opts.data);
        const relationships = opts.relationships ? JSON.parse(opts.relationships) : undefined;
        const response = await api.create(attributes, relationships);
        success(`${spec.command.replace(/s$/, '')} created (id: ${response.data.id})`);
        print(flattenResource(response.data), getFormat(cmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  cmd
    .command('update <id>')
    .description(`Update a ${spec.command.replace(/s$/, '')} by id`)
    .requiredOption('-d, --data <json>', 'JSON object of attributes to update')
    .option('-r, --relationships <json>', 'JSON object of JSON:API relationships')
    .action(async (id: string, opts) => {
      try {
        const api = spec.select(requireAuth());
        const attributes = JSON.parse(opts.data);
        const relationships = opts.relationships ? JSON.parse(opts.relationships) : undefined;
        const response = await api.update(id, attributes, relationships);
        success(`${spec.command.replace(/s$/, '')} ${id} updated`);
        print(flattenResource(response.data), getFormat(cmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  cmd
    .command('delete <id>')
    .description(`Delete a ${spec.command.replace(/s$/, '')} by id`)
    .action(async (id: string) => {
      try {
        const api = spec.select(requireAuth());
        await api.delete(id);
        success(`${spec.command.replace(/s$/, '')} ${id} deleted`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}

// Parse and execute
program.parse();
