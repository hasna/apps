#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { SpotPay } from '../api';
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

const CONNECTOR_NAME = 'connect-spotpay';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SpotPay connector — global stablecoin neobank API')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
      process.env.SPOTPAY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SpotPay {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPOTPAY_API_KEY.`);
    process.exit(1);
  }
  return new SpotPay({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonBody(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid JSON body: ${String(err)}`);
    process.exit(1);
  }
}

function readJsonFile(path: string): Record<string, unknown> {
  try {
    return parseJsonBody(readFileSync(path, 'utf-8'));
  } catch (err) {
    error(`Failed to read JSON file: ${String(err)}`);
    process.exit(1);
  }
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
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'SpotPay API key')
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set SpotPay API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
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

const accountCmd = program.command('account').description('Account operations');

accountCmd
  .command('get')
  .description('Get account details')
  .action(async () => {
    try {
      const client = getClient();
      const account = await client.getAccount();
      print(account, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const transactionsCmd = program.command('transactions').description('Transaction operations');

transactionsCmd
  .command('list')
  .description('List transactions')
  .option('--limit <n>', 'Maximum number of transactions')
  .option('--offset <n>', 'Pagination offset')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.limit) params.limit = Number(opts.limit);
      if (opts.offset) params.offset = Number(opts.offset);
      const result = await client.listTransactions(params);
      print(result, getFormat(transactionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const transfersCmd = program.command('transfers').description('Transfer operations');

transfersCmd
  .command('create')
  .description('Create a transfer')
  .option('--body <json>', 'Transfer payload as JSON string')
  .option('--file <path>', 'Transfer payload JSON file')
  .action(async (opts) => {
    if (!opts.body && !opts.file) {
      error('Provide --body or --file with transfer payload JSON');
      process.exit(1);
    }
    try {
      const client = getClient();
      const body = opts.file ? readJsonFile(opts.file) : parseJsonBody(opts.body);
      const result = await client.createTransfer(body);
      success('Transfer created');
      print(result, getFormat(transfersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const paymentsCmd = program.command('payments').description('Payment operations');

paymentsCmd
  .command('create')
  .description('Create a payment')
  .option('--body <json>', 'Payment payload as JSON string')
  .option('--file <path>', 'Payment payload JSON file')
  .action(async (opts) => {
    if (!opts.body && !opts.file) {
      error('Provide --body or --file with payment payload JSON');
      process.exit(1);
    }
    try {
      const client = getClient();
      const body = opts.file ? readJsonFile(opts.file) : parseJsonBody(opts.body);
      const result = await client.createPayment(body);
      success('Payment created');
      print(result, getFormat(paymentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const cardsCmd = program.command('cards').description('Card operations');

cardsCmd
  .command('list')
  .description('List cards')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listCards();
      print(result, getFormat(cardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const exchangeRatesCmd = program.command('exchange-rates').description('Exchange rate operations');

exchangeRatesCmd
  .command('get')
  .description('Get exchange rates')
  .option('--from <currency>', 'Source currency')
  .option('--to <currency>', 'Target currency')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.from) params.from = opts.from;
      if (opts.to) params.to = opts.to;
      const result = await client.getExchangeRate(params);
      print(result, getFormat(exchangeRatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <path>')
  .description('Make a raw API request')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body JSON')
  .option('--file <path>', 'Request body JSON file')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const method = (opts.method || 'GET').toUpperCase();
      let body: Record<string, unknown> | undefined;
      if (opts.file) {
        body = readJsonFile(opts.file);
      } else if (opts.body) {
        body = parseJsonBody(opts.body);
      }
      const result = await client.rawRequest(path, { method, body });
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
