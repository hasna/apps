#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZibraLabs } from '../api';
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
import { success, error, info, print, debug, setVerboseMode } from '../utils/output';

const CONNECTOR_NAME = 'connect-zibra-labs';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zibra Labs connector CLI - Quant backtesting HPC clusters, jobs, and datasets')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-P, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.ZIBRA_LABS_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return ((parent || cmd).opts().format || 'pretty') as OutputFormat;
}

function parseQueryFlags(opts: Record<string, unknown>, excludeKeys: string[] = []): Record<string, string> {
  const query: Record<string, string> = {};
  const excluded = new Set(['format', 'profile', 'apiKey', 'verbose', 'body', ...excludeKeys]);
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && value !== null && value !== '' && !excluded.has(key)) {
      query[key] = String(value);
    }
  }
  return query;
}

function getClient(): ZibraLabs {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZIBRA_LABS_API_KEY`);
    process.exit(1);
  }
  return new ZibraLabs({ apiKey, baseUrl: getBaseUrl() });
}

const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) { info('No profiles found'); return; }
  profiles.forEach(p => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) { error(`Profile "${name}" does not exist`); process.exit(1); }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) { error(`Profile "${name}" already exists`); process.exit(1); }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) { setCurrentProfile(name); info(`Switched to profile: ${name}`); }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') { error('Cannot delete default profile'); process.exit(1); }
  if (deleteProfile(name)) { success(`Profile "${name}" deleted`); }
  else { error(`Profile "${name}" not found`); process.exit(1); }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('https://api.zibralabs.com/v1 (default)')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

const clustersCmd = program.command('clusters').description('Manage HPC clusters');

clustersCmd.command('list')
  .description('List available clusters')
  .option('--region <region>', 'Filter by region')
  .action(async (_opts, cmd) => {
    try {
      const opts = cmd.opts();
      const client = getClient();
      const result = await client.listClusters(parseQueryFlags(opts));
      print(result, getFormat(clustersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

clustersCmd.command('get <clusterId>')
  .description('Get cluster details')
  .action(async (clusterId: string) => {
    try {
      const client = getClient();
      const result = await client.getCluster(clusterId);
      print(result, getFormat(clustersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const backtestsCmd = program.command('backtests').description('Manage backtest jobs');

backtestsCmd.command('submit')
  .description('Submit a backtest job')
  .requiredOption('-b, --body <json>', 'Request body JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = JSON.parse(opts.body);
      const result = await client.submitBacktest(body);
      print(result, getFormat(backtestsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

backtestsCmd.command('get <jobId>')
  .description('Get backtest job status')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.getBacktest(jobId);
      print(result, getFormat(backtestsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

backtestsCmd.command('cancel <jobId>')
  .description('Cancel a backtest job')
  .option('-b, --body <json>', 'Optional cancel reason/body JSON')
  .action(async (jobId: string, opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.cancelBacktest(jobId, body);
      print(result, getFormat(backtestsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const datasetsCmd = program.command('datasets').description('Manage datasets');

datasetsCmd.command('list')
  .description('List available datasets')
  .option('--asset-class <assetClass>', 'Filter by asset class')
  .action(async (_opts, cmd) => {
    try {
      const opts = cmd.opts();
      const client = getClient();
      const query = parseQueryFlags(opts, ['assetClass']);
      if (opts.assetClass) query.asset_class = opts.assetClass;
      const result = await client.listDatasets(query);
      print(result, getFormat(datasetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('raw')
  .description('Send a raw API request')
  .requiredOption('-m, --method <method>', 'HTTP method')
  .requiredOption('-p, --path <path>', 'API path (e.g. /backtests)')
  .option('-q, --query <json>', 'Query parameters JSON')
  .option('-b, --body <json>', 'Request body JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method.toUpperCase(),
        path: opts.path,
        params: opts.query ? JSON.parse(opts.query) : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
