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

const CONNECTOR_NAME = 'connect-abuselpdb';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('AbuseIPDB connector CLI - IP abuse checking, reporting, and blacklist')
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
      process.env.ABUSEIPDB_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ABUSEIPDB_API_KEY environment variable.`);
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
// Check Commands
// ============================================
const checkCmd = program
  .command('check')
  .description('Check IP addresses for abuse reports');

checkCmd
  .command('ip <ipAddress>')
  .description('Check an IP address for abuse reports')
  .option('-d, --days <number>', 'Max age of reports in days (1-365)', '30')
  .option('--verbose', 'Include detailed reports in response')
  .action(async (ipAddress: string, opts) => {
    try {
      const client = getClient();
      const result = await client.check.check({
        ipAddress,
        maxAgeInDays: parseInt(opts.days),
        verbose: opts.verbose,
      });
      print(result, getFormat(checkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checkCmd
  .command('block <network>')
  .description('Check a CIDR network block for reported addresses')
  .option('-d, --days <number>', 'Max age of reports in days (1-365)', '30')
  .action(async (network: string, opts) => {
    try {
      const client = getClient();
      const result = await client.check.checkBlock({
        network,
        maxAgeInDays: parseInt(opts.days),
      });
      print(result, getFormat(checkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Report Commands
// ============================================
const reportCmd = program
  .command('report')
  .description('Report and manage IP abuse reports');

reportCmd
  .command('submit <ip>')
  .description('Report an IP address for abusive behavior')
  .requiredOption('-c, --categories <ids>', 'Comma-separated category IDs (e.g., "18,22")')
  .option('-m, --comment <text>', 'Description of the abuse')
  .action(async (ip: string, opts) => {
    try {
      const client = getClient();
      const result = await client.report.report({
        ip,
        categories: opts.categories,
        comment: opts.comment,
      });
      success(`IP ${ip} reported successfully`);
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportCmd
  .command('list <ipAddress>')
  .description('List reports for an IP address')
  .option('-d, --days <number>', 'Max age of reports in days', '30')
  .option('--page <number>', 'Page number', '1')
  .option('--per-page <number>', 'Results per page', '25')
  .action(async (ipAddress: string, opts) => {
    try {
      const client = getClient();
      const result = await client.report.reports({
        ipAddress,
        maxAgeInDays: parseInt(opts.days),
        page: parseInt(opts.page),
        perPage: parseInt(opts.perPage),
      });
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportCmd
  .command('clear <ipAddress>')
  .description('Clear your own reports for an IP address')
  .action(async (ipAddress: string) => {
    try {
      const client = getClient();
      const result = await client.report.clearAddress({ ipAddress });
      success(`Cleared ${result.numReportsDeleted} report(s) for ${ipAddress}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Blacklist Commands
// ============================================
const blacklistCmd = program
  .command('blacklist')
  .description('AbuseIPDB blacklist of abusive IPs');

blacklistCmd
  .command('get')
  .description('Get the blacklist of most-reported abusive IPs')
  .option('-c, --confidence <number>', 'Minimum confidence score (25-100)')
  .option('-l, --limit <number>', 'Maximum number of results')
  .option('--only-countries <codes>', 'Comma-separated country codes to include')
  .option('--except-countries <codes>', 'Comma-separated country codes to exclude')
  .option('--ip-version <version>', 'IP version (4 or 6)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.blacklist.get({
        confidenceMinimum: opts.confidence ? parseInt(opts.confidence) : undefined,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        onlyCountries: opts.onlyCountries,
        exceptCountries: opts.exceptCountries,
        ipVersion: opts.ipVersion ? parseInt(opts.ipVersion) : undefined,
      });
      print(result, getFormat(blacklistCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
