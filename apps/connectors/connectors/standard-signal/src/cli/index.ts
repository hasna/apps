#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StandardSignal } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-standard-signal';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Standard Signal API connector CLI - AI hedge fund portfolios, strategies, positions, trades, and performance')
  .version(VERSION)
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
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): StandardSignal {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STANDARD_SIGNAL_API_KEY.`);
    process.exit(1);
  }

  return new StandardSignal({ apiKey, baseUrl });
}

function parseQueryOptions(opts: Record<string, unknown>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && value !== null && value !== '') {
      query[key] = String(value);
    }
  }
  return query;
}

// Profile commands
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
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.key,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <key>')
  .description('Set Standard Signal API key')
  .action((key: string) => {
    setApiKey(key);
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
    info(`Base URL: ${baseUrl}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Portfolios
const portfoliosCmd = program.command('portfolios').description('Manage portfolios');

portfoliosCmd
  .command('list')
  .description('List portfolios')
  .option('--limit <limit>', 'Maximum results')
  .option('--offset <offset>', 'Pagination offset')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.portfolios.list(parseQueryOptions(opts));
      print(result, getFormat(portfoliosCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

portfoliosCmd
  .command('get <portfolioId>')
  .description('Get portfolio details')
  .action(async (portfolioId: string) => {
    try {
      const client = getClient();
      const result = await client.portfolios.get(portfolioId);
      print(result, getFormat(portfoliosCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Strategies
const strategiesCmd = program.command('strategies').description('Manage strategies');

strategiesCmd
  .command('list')
  .description('List strategies')
  .option('--limit <limit>', 'Maximum results')
  .option('--offset <offset>', 'Pagination offset')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.strategies.list(parseQueryOptions(opts));
      print(result, getFormat(strategiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Positions
const positionsCmd = program.command('positions').description('View positions');

positionsCmd
  .command('list')
  .description('List positions')
  .option('--portfolio-id <id>', 'Filter by portfolio')
  .option('--limit <limit>', 'Maximum results')
  .option('--offset <offset>', 'Pagination offset')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(opts);
      if (opts.portfolioId) {
        query.portfolio_id = opts.portfolioId;
      }
      const result = await client.positions.list(query);
      print(result, getFormat(positionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Trades
const tradesCmd = program.command('trades').description('View trades');

tradesCmd
  .command('list')
  .description('List trades')
  .option('--portfolio-id <id>', 'Filter by portfolio')
  .option('--limit <limit>', 'Maximum results')
  .option('--offset <offset>', 'Pagination offset')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(opts);
      if (opts.portfolioId) {
        query.portfolio_id = opts.portfolioId;
      }
      const result = await client.trades.list(query);
      print(result, getFormat(tradesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Performance
const performanceCmd = program.command('performance').description('Performance reports');

performanceCmd
  .command('get')
  .description('Get performance report')
  .option('--portfolio-id <id>', 'Filter by portfolio')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(opts);
      if (opts.portfolioId) {
        query.portfolio_id = opts.portfolioId;
      }
      const result = await client.performance.get(query);
      print(result, getFormat(performanceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program
  .command('raw')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /portfolios)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = opts.query ? JSON.parse(opts.query) : undefined;
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest(opts.path, {
        method: opts.method,
        query,
        body,
      });
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
