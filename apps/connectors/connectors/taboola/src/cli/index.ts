#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getCredentials,
  setCredentials,
  getAccessToken,
  setAccessToken,
  getAccountId,
  setAccountId,
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

const CONNECTOR_NAME = 'connect-taboola';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Taboola Backstage API connector CLI - manage accounts, campaigns, items, reports, and audiences')
  .version(VERSION)
  .option('-a, --account <accountId>', 'Account id (overrides config)')
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
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.account) {
      process.env.TABOOLA_ACCOUNT_ID = opts.account;
      debug(`Using account: ${opts.account}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const credentials = getCredentials();
  const accessToken = getAccessToken();

  if (!credentials && !accessToken) {
    error(
      `No credentials configured. Run "${CONNECTOR_NAME} config set-credentials <clientId> <clientSecret>" ` +
        `or set TABOOLA_CLIENT_ID and TABOOLA_CLIENT_SECRET.`
    );
    process.exit(1);
  }

  return new Connector({
    clientId: credentials?.clientId,
    clientSecret: credentials?.clientSecret,
    accessToken,
    accountId: getAccountId(),
  });
}

function requireAccount(): string {
  const accountId = getAccountId();
  if (!accountId) {
    error(
      `No account id. Pass -a <accountId>, set TABOOLA_ACCOUNT_ID, or run "${CONNECTOR_NAME} config set-account <accountId>".`
    );
    process.exit(1);
  }
  return accountId;
}

// ============================================
// Profile Commands
// ============================================
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {});
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
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${config.clientSecret ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-credentials <clientId> <clientSecret>')
  .description('Set OAuth2 client credentials')
  .action((clientId: string, clientSecret: string) => {
    setCredentials({ clientId, clientSecret });
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-token <accessToken>')
  .description('Set a pre-issued Bearer access token')
  .action((accessToken: string) => {
    setAccessToken(accessToken);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-account <accountId>')
  .description('Set the default account id')
  .action((accountId: string) => {
    setAccountId(accountId);
    success(`Account id saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const credentials = getCredentials();
    const accountId = getAccountId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${credentials?.clientId ? `${credentials.clientId.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${credentials?.clientSecret ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Account ID: ${accountId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Account Commands
// ============================================
const accountCmd = program.command('account').description('View accounts');

accountCmd
  .command('list')
  .description('List accounts you are allowed to operate on')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.account.listAllowed();
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('current')
  .description("Show the current credentials' account")
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.account.getCurrent();
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Campaign Commands
// ============================================
const campaignCmd = program.command('campaign').description('Manage campaigns');

campaignCmd
  .command('list')
  .description('List campaigns for the account')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.campaigns.list(requireAccount());
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('get <campaignId>')
  .description('Get a campaign by id')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.campaigns.get(requireAccount(), campaignId);
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('create')
  .description('Create a new campaign')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .requiredOption('-b, --branding-text <text>', 'Branding text (advertiser name shown on ads)')
  .requiredOption('-c, --cpc <amount>', 'Cost per click')
  .requiredOption('-s, --spending-limit <amount>', 'Spending limit')
  .option('-m, --spending-limit-model <model>', 'Spending limit model (MONTHLY, ENTIRE, NONE)', 'MONTHLY')
  .option('--marketing-objective <objective>', 'Marketing objective')
  .option('--daily-cap <amount>', 'Daily budget cap')
  .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.create(requireAccount(), {
        name: opts.name,
        branding_text: opts.brandingText,
        cpc: parseFloat(opts.cpc),
        spending_limit: parseFloat(opts.spendingLimit),
        spending_limit_model: opts.spendingLimitModel,
        marketing_objective: opts.marketingObjective,
        daily_cap: opts.dailyCap ? parseFloat(opts.dailyCap) : undefined,
        start_date: opts.startDate,
        end_date: opts.endDate,
      });
      success('Campaign created!');
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('update <campaignId>')
  .description('Update a campaign')
  .option('-n, --name <name>', 'Campaign name')
  .option('-b, --branding-text <text>', 'Branding text')
  .option('-c, --cpc <amount>', 'Cost per click')
  .option('-s, --spending-limit <amount>', 'Spending limit')
  .option('--daily-cap <amount>', 'Daily budget cap')
  .option('--activate', 'Set campaign active')
  .option('--pause', 'Pause campaign')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = {};
      if (opts.name) data.name = opts.name;
      if (opts.brandingText) data.branding_text = opts.brandingText;
      if (opts.cpc) data.cpc = parseFloat(opts.cpc);
      if (opts.spendingLimit) data.spending_limit = parseFloat(opts.spendingLimit);
      if (opts.dailyCap) data.daily_cap = parseFloat(opts.dailyCap);
      if (opts.activate) data.is_active = true;
      if (opts.pause) data.is_active = false;
      const result = await client.campaigns.update(requireAccount(), campaignId, data);
      success('Campaign updated!');
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Campaign Item Commands
// ============================================
const itemCmd = program.command('item').description('Manage campaign items (creatives)');

itemCmd
  .command('list <campaignId>')
  .description('List items for a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.items.list(requireAccount(), campaignId);
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('get <campaignId> <itemId>')
  .description('Get a campaign item by id')
  .action(async (campaignId: string, itemId: string) => {
    try {
      const client = getClient();
      const result = await client.items.get(requireAccount(), campaignId, itemId);
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('create <campaignId>')
  .description('Create a campaign item')
  .requiredOption('-u, --url <url>', 'Landing page URL')
  .option('-t, --title <title>', 'Item title')
  .option('--thumbnail-url <url>', 'Thumbnail image URL')
  .option('-d, --description <text>', 'Item description')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.items.create(requireAccount(), campaignId, {
        url: opts.url,
        title: opts.title,
        thumbnail_url: opts.thumbnailUrl,
        description: opts.description,
      });
      success('Item created!');
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('update <campaignId> <itemId>')
  .description('Update a campaign item')
  .option('-t, --title <title>', 'Item title')
  .option('--thumbnail-url <url>', 'Thumbnail image URL')
  .option('-d, --description <text>', 'Item description')
  .option('--activate', 'Set item active')
  .option('--pause', 'Pause item')
  .action(async (campaignId: string, itemId: string, opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = {};
      if (opts.title) data.title = opts.title;
      if (opts.thumbnailUrl) data.thumbnail_url = opts.thumbnailUrl;
      if (opts.description) data.description = opts.description;
      if (opts.activate) data.is_active = true;
      if (opts.pause) data.is_active = false;
      const result = await client.items.update(requireAccount(), campaignId, itemId, data);
      success('Item updated!');
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Report Commands
// ============================================
const reportCmd = program.command('report').description('Run campaign reports');

reportCmd
  .command('campaign-summary <dimension>')
  .description('Campaign summary report by dimension (e.g. day, campaign_breakdown, site_breakdown)')
  .requiredOption('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end-date <date>', 'End date (YYYY-MM-DD)')
  .action(async (dimension: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.campaignSummary(requireAccount(), dimension, {
        start_date: opts.startDate,
        end_date: opts.endDate,
      });
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportCmd
  .command('top-content <dimension>')
  .description('Top campaign content report by dimension')
  .requiredOption('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end-date <date>', 'End date (YYYY-MM-DD)')
  .action(async (dimension: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.topCampaignContent(requireAccount(), dimension, {
        start_date: opts.startDate,
        end_date: opts.endDate,
      });
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Audience Commands
// ============================================
const audienceCmd = program.command('audience').description('Manage first-party audiences and targeting');

audienceCmd
  .command('create')
  .description('Create an empty first-party audience')
  .requiredOption('-n, --name <name>', 'Audience name')
  .option('--ttl <hours>', 'Time-to-live in hours')
  .option('--integration-source <source>', 'Integration source')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.audiences.createFirstParty(requireAccount(), {
        audience_name: opts.name,
        ttl_in_hours: opts.ttl ? parseInt(opts.ttl, 10) : undefined,
        integration_source: opts.integrationSource,
      });
      success('Audience created!');
      print(result, getFormat(audienceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audienceCmd
  .command('targeting <campaignId>')
  .description('Show My Audiences targeting for a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.audiences.getCampaignTargeting(requireAccount(), campaignId);
      print(result, getFormat(audienceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
