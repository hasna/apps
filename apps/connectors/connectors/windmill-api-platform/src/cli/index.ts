#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { WindmillApiPlatform } from '../api';
import {
  getApiKey,
  getBaseUrl,
  getWorkspace,
  setApiKey,
  setBaseUrl,
  setWorkspace,
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
import type { QueryParams } from '../types';

const CONNECTOR_NAME = 'connect-windmill-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Windmill API Platform connector CLI - workspace REST API integration')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-b, --base-url <url>', 'Windmill API base URL, e.g. https://windmill.example.com/api')
  .option('-w, --workspace <workspace>', 'Windmill workspace id (overrides config)')
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
      process.env.WINDMILL_API_PLATFORM_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.WINDMILL_API_PLATFORM_BASE_URL = opts.baseUrl;
    }
    if (opts.workspace) {
      process.env.WINDMILL_API_PLATFORM_WORKSPACE = opts.workspace;
    }
  });

function getFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WindmillApiPlatform {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WINDMILL_API_PLATFORM_API_KEY.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    error(`No base URL configured. Run "${CONNECTOR_NAME} config set-base-url <url>" or set WINDMILL_API_PLATFORM_BASE_URL.`);
    process.exit(1);
  }
  const workspace = getWorkspace();
  if (!workspace) {
    error(`No workspace configured. Run "${CONNECTOR_NAME} config set-workspace <workspace>" or set WINDMILL_API_PLATFORM_WORKSPACE.`);
    process.exit(1);
  }
  return new WindmillApiPlatform({ apiKey, baseUrl, workspace });
}

function parseQueryPairs(pairs: string[] | undefined): QueryParams {
  const query: QueryParams = {};
  for (const pair of pairs || []) {
    const [key, ...rest] = pair.split('=');
    if (key) query[key] = rest.join('=');
  }
  return query;
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function readBody(opts: { body?: string; file?: string }): Record<string, unknown> {
  if (opts.file) {
    return JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
  }
  return parseJsonOption(opts.body, 'body');
}

// Profile commands
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
  .option('--base-url <url>', 'Windmill API base URL')
  .option('--workspace <workspace>', 'Windmill workspace id')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl, workspace: opts.workspace });
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
  info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
  info(`Workspace: ${config.workspace || chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set Windmill API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-workspace <workspace>').description('Set Windmill workspace id').action((workspace: string) => {
  setWorkspace(workspace);
  success(`Workspace saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('not set')}`);
  info(`Workspace: ${getWorkspace() || chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Scripts commands
const scriptsCmd = program.command('scripts').description('Manage Windmill scripts');

scriptsCmd
  .command('list')
  .description('List scripts')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      const result = await getClient().listScripts(parseQueryPairs(opts.query));
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scriptsCmd
  .command('get <path>')
  .description('Get a script by path')
  .action(async (path: string) => {
    try {
      const result = await getClient().getScript(path);
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scriptsCmd
  .command('run <path>')
  .description('Run a script by path and return the job id')
  .option('-b, --body <json>', 'Script args JSON body')
  .option('-f, --file <path>', 'JSON file with script args')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (path: string, opts) => {
    try {
      const result = await getClient().runScript({
        path,
        args: readBody(opts),
        query: parseQueryPairs(opts.query),
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scriptsCmd
  .command('run-wait <path>')
  .description('Run a script by path and wait for the result')
  .option('-b, --body <json>', 'Script args JSON body')
  .option('-f, --file <path>', 'JSON file with script args')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (path: string, opts) => {
    try {
      const result = await getClient().runScriptAndWait({
        path,
        args: readBody(opts),
        query: parseQueryPairs(opts.query),
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Flows commands
const flowsCmd = program.command('flows').description('Manage Windmill flows');

flowsCmd
  .command('list')
  .description('List flows')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      const result = await getClient().listFlows(parseQueryPairs(opts.query));
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

flowsCmd.command('get <path>').description('Get a flow by path').action(async (path: string) => {
  try {
    const result = await getClient().getFlow(path);
    print(result, getFormat());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Resources commands
const resourcesCmd = program.command('resources').description('Manage Windmill resources');

resourcesCmd
  .command('list')
  .description('List resources')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      const result = await getClient().listResources(parseQueryPairs(opts.query));
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

resourcesCmd.command('get <path>').description('Get a resource by path').action(async (path: string) => {
  try {
    const result = await getClient().getResource(path);
    print(result, getFormat());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Jobs commands
const jobsCmd = program.command('jobs').description('Inspect Windmill jobs');

jobsCmd
  .command('list')
  .description('List jobs')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      const result = await getClient().listJobs(parseQueryPairs(opts.query));
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request command
program
  .command('raw-request')
  .description('Send an arbitrary Windmill API request')
  .requiredOption('-p, --path <path>', 'API path (e.g. /w/<workspace>/scripts/list)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'Request JSON body')
  .option('-f, --file <path>', 'JSON file with request body')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      let body: unknown;
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8'));
      } else if (opts.body) {
        body = parseJsonOption(opts.body, 'body');
      }
      const result = await getClient().rawRequest({
        method: opts.method,
        path: opts.path,
        body,
        query: parseQueryPairs(opts.query),
      });
      print(result, getFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
