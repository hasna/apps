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

const CONNECTOR_NAME = 'connect-twelve-data';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Twelve Data connector - real-time and historical market data')
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
      process.env.TWELVE_DATA_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TWELVE_DATA_API_KEY environment variable.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Connector({ apiKey, baseUrl });
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

    success(`Profiles:`);
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.twelvedata.com)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
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
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.twelvedata.com)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Market Data Commands
// ============================================
program
  .command('price <symbol>')
  .description('Get real-time price for a symbol')
  .option('-e, --exchange <exchange>', 'Exchange name')
  .option('-c, --country <country>', 'Country code')
  .option('--dp <dp>', 'Decimal places', parseInt)
  .action(async (symbol: string, opts) => {
    try {
      const client = getClient();
      const result = await client.price.get({
        symbol,
        exchange: opts.exchange,
        country: opts.country,
        dp: opts.dp,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('quote <symbol>')
  .description('Get real-time quote for a symbol')
  .option('-i, --interval <interval>', 'Interval')
  .option('-e, --exchange <exchange>', 'Exchange name')
  .option('--dp <dp>', 'Decimal places', parseInt)
  .action(async (symbol: string, opts) => {
    try {
      const client = getClient();
      const result = await client.quote.get({
        symbol,
        interval: opts.interval,
        exchange: opts.exchange,
        dp: opts.dp,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('time-series <symbol>')
  .description('Get historical time series data')
  .requiredOption('-i, --interval <interval>', 'Interval (e.g. 1min, 1day)')
  .option('-o, --outputsize <size>', 'Number of data points', parseInt)
  .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date (YYYY-MM-DD)')
  .option('-e, --exchange <exchange>', 'Exchange name')
  .option('--dp <dp>', 'Decimal places', parseInt)
  .action(async (symbol: string, opts) => {
    try {
      const client = getClient();
      const result = await client.timeSeries.get({
        symbol,
        interval: opts.interval,
        outputsize: opts.outputsize,
        start_date: opts.startDate,
        end_date: opts.endDate,
        exchange: opts.exchange,
        dp: opts.dp,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('exchange-rate <symbol>')
  .description('Get exchange rate (e.g. USD/EUR)')
  .option('--dp <dp>', 'Decimal places', parseInt)
  .action(async (symbol: string, opts) => {
    try {
      const client = getClient();
      const result = await client.exchangeRate.get({
        symbol,
        dp: opts.dp,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('symbols')
  .description('List available stock symbols')
  .option('-s, --symbol <symbol>', 'Filter by symbol')
  .option('-e, --exchange <exchange>', 'Filter by exchange')
  .option('-c, --country <country>', 'Filter by country')
  .option('--type <type>', 'Filter by instrument type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.symbols.list({
        symbol: opts.symbol,
        exchange: opts.exchange,
        country: opts.country,
        type: opts.type,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <path>')
  .description('Make a raw GET request to any API path')
  .allowUnknownOption()
  .action(async (path: string) => {
    try {
      const client = getClient();
      const args = process.argv;
      const rawIdx = args.indexOf('raw');
      const queryParams: Record<string, string> = {};

      for (let i = rawIdx + 2; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('-')) {
          const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          queryParams[key] = args[++i];
        }
      }

      const result = await client.raw(path.startsWith('/') ? path : `/${path}`, queryParams);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
