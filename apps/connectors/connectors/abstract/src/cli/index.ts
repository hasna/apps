#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-abstract';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Abstract API connector CLI')
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
      process.env.ABSTRACT_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ABSTRACT_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// IP Geolocation Commands
// ============================================
const geoCmd = program
  .command('geolocation')
  .description('IP geolocation lookup');

geoCmd
  .command('lookup')
  .description('Look up geolocation data for an IP address')
  .option('-i, --ip <address>', 'IP address to look up (omit for your own IP)')
  .option('--fields <fields>', 'Comma-separated list of fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.geolocation.lookup({
        ip_address: opts.ip,
        fields: opts.fields,
      });
      print(result, getFormat(geoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Email Validation Commands
// ============================================
const emailCmd = program
  .command('email')
  .description('Email validation');

emailCmd
  .command('validate <email>')
  .description('Validate an email address')
  .option('--auto-correct', 'Enable auto-correction suggestions')
  .action(async (email: string, opts) => {
    try {
      const client = getClient();
      const result = await client.email.validate({
        email,
        auto_correct: opts.autoCorrect,
      });
      print(result, getFormat(emailCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Phone Validation Commands
// ============================================
const phoneCmd = program
  .command('phone')
  .description('Phone number validation');

phoneCmd
  .command('validate <phone>')
  .description('Validate a phone number')
  .action(async (phone: string) => {
    try {
      const client = getClient();
      const result = await client.phone.validate({ phone });
      print(result, getFormat(phoneCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Exchange Rates Commands
// ============================================
const exchangeCmd = program
  .command('exchange')
  .description('Exchange rate lookups');

exchangeCmd
  .command('live')
  .description('Get live exchange rates')
  .requiredOption('-b, --base <currency>', 'Base currency code (e.g., USD)')
  .option('-t, --target <currency>', 'Target currency code (e.g., EUR)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.exchange.live({
        base: opts.base,
        target: opts.target,
      });
      print(result, getFormat(exchangeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exchangeCmd
  .command('convert')
  .description('Convert between currencies')
  .requiredOption('-b, --base <currency>', 'Base currency code')
  .requiredOption('-t, --target <currency>', 'Target currency code')
  .option('-a, --amount <number>', 'Amount to convert', '1')
  .option('-d, --date <date>', 'Historical date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.exchange.convert({
        base: opts.base,
        target: opts.target,
        base_amount: parseFloat(opts.amount),
        date: opts.date,
      });
      print(result, getFormat(exchangeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exchangeCmd
  .command('historical')
  .description('Get historical exchange rates')
  .requiredOption('-b, --base <currency>', 'Base currency code')
  .requiredOption('-d, --date <date>', 'Date (YYYY-MM-DD)')
  .option('-t, --target <currency>', 'Target currency code')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.exchange.historical({
        base: opts.base,
        date: opts.date,
        target: opts.target,
      });
      print(result, getFormat(exchangeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Company Enrichment Commands
// ============================================
const companyCmd = program
  .command('company')
  .description('Company data enrichment');

companyCmd
  .command('enrich <domain>')
  .description('Enrich company data by domain')
  .option('--fields <fields>', 'Comma-separated list of fields to return')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();
      const result = await client.company.enrich({
        domain,
        fields: opts.fields,
      });
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
