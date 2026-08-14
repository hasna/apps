#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getApiVersion,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import type { ReportRunParameters, RangeQuery } from '../types';

// Connector name and version
const CONNECTOR_NAME = 'connect-stripe-reporting-advanced';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Reporting (Advanced) connector CLI - scheduled financial report generation')
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
      process.env.STRIPE_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl(), apiVersion: getApiVersion() });
}

// Parse a comma-separated list into a string array (undefined when empty)
function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map(s => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

// Parse a timestamp/date option into a Unix timestamp
function parseTimestamp(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid timestamp/date: ${value}`);
  }
  return Math.floor(parsed / 1000);
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile created: ${name}`);
    if (opts.use) {
      setCurrentProfile(name);
      success(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (deleteProfile(name)) {
      success(`Profile deleted: ${name}`);
    } else {
      error(`Cannot delete profile "${name}" (does not exist or is the default profile)`);
      process.exit(1);
    }
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
    const baseUrl = getBaseUrl();
    if (baseUrl) info(`Base URL: ${baseUrl}`);
    const apiVersion = getApiVersion();
    if (apiVersion) info(`API Version: ${apiVersion}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Report Types Commands
// ============================================
const reportTypesCmd = program
  .command('report-types')
  .description('Browse available Stripe report types');

reportTypesCmd
  .command('list')
  .description('List all available report types')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.reportTypes.list();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportTypesCmd
  .command('get <id>')
  .description('Get a report type by ID (e.g. balance.summary.1)')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.reportTypes.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Report Runs Commands
// ============================================
const reportRunsCmd = program
  .command('report-runs')
  .description('Create and inspect report runs');

reportRunsCmd
  .command('create')
  .description('Create (and start) a new report run')
  .requiredOption('-t, --report-type <id>', 'Report type ID (e.g. balance.summary.1)')
  .option('--interval-start <ts>', 'Interval start (Unix timestamp or ISO date)')
  .option('--interval-end <ts>', 'Interval end (Unix timestamp or ISO date)')
  .option('--columns <list>', 'Comma-separated list of columns')
  .option('--currency <code>', 'Currency filter (e.g. usd)')
  .option('--timezone <tz>', 'IANA timezone (e.g. America/Los_Angeles)')
  .option('--reporting-category <category>', 'Reporting category filter')
  .option('--payout <id>', 'Payout ID (for payout reconciliation reports)')
  .option('--connected-account <id>', 'Connected account ID (Connect)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const parameters: ReportRunParameters = {
        interval_start: parseTimestamp(opts.intervalStart),
        interval_end: parseTimestamp(opts.intervalEnd),
        columns: parseList(opts.columns),
        currency: opts.currency,
        timezone: opts.timezone,
        reporting_category: opts.reportingCategory,
        payout: opts.payout,
        connected_account: opts.connectedAccount,
      };
      const hasParameters = Object.values(parameters).some(v => v !== undefined);
      const result = await client.reportRuns.create({
        report_type: opts.reportType,
        parameters: hasParameters ? parameters : undefined,
      });
      success('Report run created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportRunsCmd
  .command('get <id>')
  .description('Get a report run by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.reportRuns.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportRunsCmd
  .command('list')
  .description('List report runs (most recent first)')
  .option('-l, --limit <number>', 'Maximum number of report runs', '10')
  .option('--starting-after <id>', 'Cursor for pagination')
  .option('--ending-before <id>', 'Cursor for pagination')
  .option('--created <ts>', 'Filter by creation time (Unix timestamp or ISO date)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const created: RangeQuery | undefined = opts.created ? parseTimestamp(opts.created) : undefined;
      const result = await client.reportRuns.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        starting_after: opts.startingAfter,
        ending_before: opts.endingBefore,
        created,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
