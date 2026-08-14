#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Valence } from '../api';
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

const CONNECTOR_NAME = 'connect-valence';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Valence prediction markets API connector - markets, orders, positions, balances, arbitrage')
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

function getClient(): Valence {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No Valence API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VALENCE_API_KEY.`);
    process.exit(1);
  }
  return new Valence({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryOptions(opts: Record<string, unknown>): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && !['format', 'profile', 'body'].includes(key)) {
      query[key] = String(value);
    }
  }
  return query;
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
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create a new profile')
  .option('--key <key>', 'Valence API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.key, baseUrl: opts.baseUrl });
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.valence.trade/v1)')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <key>').description('Set Valence API key').action((key: string) => {
  setApiKey(key);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || chalk.gray('default (https://api.valence.trade/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Markets commands
const marketsCmd = program.command('markets').description('Prediction market operations');

marketsCmd.command('list').description('List prediction markets')
  .option('--limit <n>', 'Maximum results')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.markets.listMarkets(parseQueryOptions(opts));
      print(result, getFormat(marketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

marketsCmd.command('get <marketId>').description('Get a prediction market').action(async (marketId: string) => {
  try {
    const client = getClient();
    const result = await client.markets.getMarket(marketId);
    print(result, getFormat(marketsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

marketsCmd.command('match-tickers').description('Match equivalent tickers across exchanges')
  .option('--body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : {};
      const result = await client.markets.matchTickers(body);
      print(result, getFormat(marketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Orders commands
const ordersCmd = program.command('orders').description('Order operations');

ordersCmd.command('list').description('List orders')
  .option('--limit <n>', 'Maximum results')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.orders.listOrders(parseQueryOptions(opts));
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd.command('create').description('Create a cross-venue order')
  .option('--body <json>', 'JSON request body', '{}')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = JSON.parse(opts.body);
      const result = await client.orders.createOrder(body);
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd.command('cancel <orderId>').description('Cancel an order')
  .option('--body <json>', 'Optional JSON request body')
  .action(async (orderId: string, opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.orders.cancelOrder(orderId, body);
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Positions command
program.command('positions').description('Get portfolio positions')
  .option('--limit <n>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.positions.getPositions(parseQueryOptions(opts));
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Balances command
program.command('balances').description('Get account balances')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.balances.getBalances();
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Arbitrage commands
const arbitrageCmd = program.command('arbitrage').description('Arbitrage operations');

arbitrageCmd.command('list-opportunities').description('List cross-venue arbitrage opportunities')
  .option('--limit <n>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.arbitrage.listOpportunities(parseQueryOptions(opts));
      print(result, getFormat(arbitrageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program.command('raw').description('Call any Valence API path')
  .requiredOption('--path <path>', 'API path (e.g. /markets)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method,
        path: opts.path,
        params: opts.query ? JSON.parse(opts.query) : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
