#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Snap, exchangeCodeForTokens, generateAuthUrl } from '../api';
import {
  getAccessToken,
  setAccessToken,
  setRefreshToken,
  setTokens,
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  getAdAccountId,
  getDefaultAdAccountId,
  setDefaultAdAccountId,
  setNamedAdAccount,
  removeNamedAdAccount,
  listNamedAdAccounts,
  getOrganizationId,
  getDefaultOrganizationId,
  setDefaultOrganizationId,
  setNamedOrganization,
  removeNamedOrganization,
  listNamedOrganizations,
  getExportsDir,
  getImportsDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, formatMicroCurrency } from '../utils/output';

const CONNECTOR_NAME = 'connect-snap';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Snapchat Marketing API CLI - Organizations, ad accounts, campaigns, ads, creatives, audiences, and analytics')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
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
    if (opts.token) {
      process.env.SNAP_ACCESS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Snap {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} auth login" or set SNAP_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  const config = loadProfile();
  return new Snap({
    accessToken,
    refreshToken: config.refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
}

function resolveAdAccountId(nameOrId?: string): string {
  const resolved = getAdAccountId(nameOrId);
  if (!resolved) {
    error(`No ad account specified. Use --account or set default with "${CONNECTOR_NAME} config set-account <id>"`);
    process.exit(1);
  }
  return resolved;
}

function resolveOrganizationId(nameOrId?: string): string {
  const resolved = getOrganizationId(nameOrId);
  if (!resolved) {
    error(`No organization specified. Use --org or set default with "${CONNECTOR_NAME} config set-org <id>"`);
    process.exit(1);
  }
  return resolved;
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication management');

authCmd
  .command('login')
  .description('Configure OAuth credentials')
  .option('--client-id <id>', 'OAuth Client ID')
  .option('--client-secret <secret>', 'OAuth Client Secret')
  .option('--access-token <token>', 'Access token (if you have one)')
  .option('--refresh-token <token>', 'Refresh token')
  .action(async (opts) => {
    if (opts.clientId) {
      setClientId(opts.clientId);
      info(`Client ID saved`);
    }
    if (opts.clientSecret) {
      setClientSecret(opts.clientSecret);
      info(`Client Secret saved`);
    }
    if (opts.accessToken) {
      setAccessToken(opts.accessToken);
      info(`Access token saved`);
    }
    if (opts.refreshToken) {
      setRefreshToken(opts.refreshToken);
      info(`Refresh token saved`);
    }

    if (!opts.clientId && !opts.accessToken) {
      info('To authenticate, provide either:');
      info('  1. --access-token (if you already have a token)');
      info('  2. --client-id and --client-secret (for OAuth flow)');
    }

    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('url')
  .description('Generate OAuth authorization URL')
  .option('--client-id <id>', 'OAuth Client ID')
  .option('--redirect-uri <uri>', 'Redirect URI', 'http://localhost:8080/callback')
  .option('--scope <scopes>', 'Comma-separated scopes', 'snapchat-marketing-api')
  .action((opts) => {
    const clientId = opts.clientId || getClientId();
    if (!clientId) {
      error('Client ID is required. Use --client-id or run "auth login --client-id <id>"');
      process.exit(1);
    }

    const url = generateAuthUrl(
      clientId,
      opts.redirectUri,
      opts.scope.split(','),
    );

    info('Open this URL in your browser to authorize:');
    console.log(chalk.cyan(url));
  });

authCmd
  .command('exchange <code>')
  .description('Exchange authorization code for tokens')
  .option('--client-id <id>', 'OAuth Client ID')
  .option('--client-secret <secret>', 'OAuth Client Secret')
  .option('--redirect-uri <uri>', 'Redirect URI', 'http://localhost:8080/callback')
  .action(async (code: string, opts) => {
    try {
      const clientId = opts.clientId || getClientId();
      const clientSecret = opts.clientSecret || getClientSecret();

      if (!clientId || !clientSecret) {
        error('Client ID and Secret are required');
        process.exit(1);
      }

      const tokens = await exchangeCodeForTokens(
        code,
        clientId,
        clientSecret,
        opts.redirectUri
      );

      setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);

      success('Tokens saved successfully!');
      info(`Token expires in ${tokens.expires_in} seconds`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('refresh')
  .description('Refresh the access token')
  .action(async () => {
    try {
      const client = getClient();
      if (!client.canRefreshToken()) {
        error('Cannot refresh token. Need refresh_token, client_id, and client_secret.');
        process.exit(1);
      }

      await client.refreshToken();
      success('Token refreshed successfully!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(() => {
    const config = loadProfile();
    const hasToken = !!config.accessToken;
    const hasRefresh = !!config.refreshToken;
    const hasClientId = !!config.clientId;
    const hasClientSecret = !!config.clientSecret;

    console.log(chalk.bold('Authentication Status:'));
    console.log(`  Access Token: ${hasToken ? chalk.green('Set') : chalk.red('Not set')}`);
    console.log(`  Refresh Token: ${hasRefresh ? chalk.green('Set') : chalk.gray('Not set')}`);
    console.log(`  Client ID: ${hasClientId ? chalk.green('Set') : chalk.gray('Not set')}`);
    console.log(`  Client Secret: ${hasClientSecret ? chalk.green('Set') : chalk.gray('Not set')}`);

    if (config.tokenExpiresAt) {
      const expiresIn = config.tokenExpiresAt - Date.now();
      if (expiresIn > 0) {
        const minutes = Math.floor(expiresIn / 60000);
        console.log(`  Token Expires: ${chalk.yellow(`${minutes} minutes`)}`);
      } else {
        console.log(`  Token Expires: ${chalk.red('Expired')}`);
      }
    }
  });

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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Org: ${config.defaultOrganizationId || chalk.gray('not set')}`);
    info(`Default Account: ${config.defaultAdAccountId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const config = loadProfile();
    const namedOrgs = listNamedOrganizations();
    const namedAccounts = listNamedAdAccounts();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    info(`Imports directory: ${getImportsDir()}`);
    console.log();
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Organization: ${config.defaultOrganizationId || chalk.gray('not set')}`);
    info(`Default Ad Account: ${config.defaultAdAccountId || chalk.gray('not set')}`);

    const orgNames = Object.keys(namedOrgs);
    if (orgNames.length > 0) {
      console.log();
      info(`Named Organizations:`);
      orgNames.forEach(name => {
        console.log(`  ${chalk.cyan(name)}: ${namedOrgs[name]}`);
      });
    }

    const accountNames = Object.keys(namedAccounts);
    if (accountNames.length > 0) {
      console.log();
      info(`Named Ad Accounts:`);
      accountNames.forEach(name => {
        console.log(`  ${chalk.cyan(name)}: ${namedAccounts[name]}`);
      });
    }
  });

configCmd
  .command('set-org <orgId>')
  .description('Set default organization ID')
  .action((orgId: string) => {
    setDefaultOrganizationId(orgId);
    success(`Default organization set: ${orgId}`);
  });

configCmd
  .command('set-account <accountId>')
  .description('Set default ad account ID')
  .action((accountId: string) => {
    setDefaultAdAccountId(accountId);
    success(`Default ad account set: ${accountId}`);
  });

configCmd
  .command('set-named-org <name> <orgId>')
  .description('Set a named organization')
  .action((name: string, orgId: string) => {
    setNamedOrganization(name, orgId);
    success(`Organization "${name}" set to: ${orgId}`);
  });

configCmd
  .command('set-named-account <name> <accountId>')
  .description('Set a named ad account')
  .action((name: string, accountId: string) => {
    setNamedAdAccount(name, accountId);
    success(`Ad account "${name}" set to: ${accountId}`);
  });

configCmd
  .command('remove-named-org <name>')
  .description('Remove a named organization')
  .action((name: string) => {
    if (removeNamedOrganization(name)) {
      success(`Named organization "${name}" removed`);
    } else {
      error(`Named organization "${name}" not found`);
      process.exit(1);
    }
  });

configCmd
  .command('remove-named-account <name>')
  .description('Remove a named ad account')
  .action((name: string) => {
    if (removeNamedAdAccount(name)) {
      success(`Named ad account "${name}" removed`);
    } else {
      error(`Named ad account "${name}" not found`);
      process.exit(1);
    }
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Organizations Commands
// ============================================
const orgsCmd = program
  .command('orgs')
  .description('Manage organizations');

orgsCmd
  .command('list')
  .description('List all organizations')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.organizations.list();

      if (getFormat(orgsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Organizations (${result.length} total):`);
        result.forEach(org => {
          console.log(`  ${chalk.bold(org.name)}`);
          console.log(`    ID: ${org.id}`);
          console.log(`    Type: ${org.type}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgsCmd
  .command('get [orgId]')
  .description('Get organization details')
  .action(async (orgId?: string) => {
    try {
      const client = getClient();
      const id = resolveOrganizationId(orgId);
      const result = await client.organizations.get(id);
      print(result, getFormat(orgsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Accounts Commands
// ============================================
const accountsCmd = program
  .command('accounts')
  .description('Manage ad accounts');

accountsCmd
  .command('list [orgId]')
  .description('List ad accounts for an organization')
  .action(async (orgId?: string) => {
    try {
      const client = getClient();
      const id = resolveOrganizationId(orgId);
      const result = await client.accounts.list(id);

      if (getFormat(accountsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ad Accounts (${result.length} total):`);
        result.forEach(account => {
          console.log(`  ${chalk.bold(account.name)} (${account.status})`);
          console.log(`    ID: ${account.id}`);
          console.log(`    Type: ${account.type}`);
          console.log(`    Currency: ${account.currency}`);
          console.log(`    Timezone: ${account.timezone}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('get [accountId]')
  .description('Get ad account details')
  .action(async (accountId?: string) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.accounts.get(id);
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('create')
  .description('Create a new ad account')
  .requiredOption('-n, --name <name>', 'Account name')
  .requiredOption('--org <orgId>', 'Organization ID')
  .requiredOption('--type <type>', 'Account type (PARTNER, BRAND, DIRECT)')
  .requiredOption('--currency <currency>', 'Currency (USD, EUR, etc.)')
  .requiredOption('--timezone <timezone>', 'Timezone (e.g., America/New_York)')
  .option('--billing-type <type>', 'Billing type (INVOICED, PREPAID, CREDIT_CARD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.create({
        name: opts.name,
        organization_id: opts.org,
        type: opts.type,
        currency: opts.currency,
        timezone: opts.timezone,
        billing_type: opts.billingType,
      });
      success('Ad account created!');
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('update <accountId>')
  .description('Update an ad account')
  .option('-n, --name <name>', 'Account name')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)')
  .action(async (accountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.update(accountId, {
        name: opts.name,
        status: opts.status,
      });
      success('Ad account updated!');
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Campaigns Commands
// ============================================
const campaignsCmd = program
  .command('campaigns')
  .description('Manage campaigns');

campaignsCmd
  .command('list [accountId]')
  .description('List campaigns for an ad account')
  .action(async (accountId?: string) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.campaigns.list(id);

      if (getFormat(campaignsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Campaigns (${result.length} total):`);
        result.forEach(campaign => {
          const status = campaign.status === 'ACTIVE' ? chalk.green(campaign.status) : chalk.yellow(campaign.status);
          console.log(`  ${chalk.bold(campaign.name)} (${status})`);
          console.log(`    ID: ${campaign.id}`);
          console.log(`    Objective: ${campaign.objective}`);
          if (campaign.daily_budget_micro) {
            console.log(`    Daily Budget: ${formatMicroCurrency(campaign.daily_budget_micro)}`);
          }
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('get <campaignId>')
  .description('Get campaign details')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.campaigns.get(campaignId);
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('create')
  .description('Create a new campaign')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .option('-a, --account <accountId>', 'Ad account ID')
  .requiredOption('-o, --objective <objective>', 'Objective (AWARENESS, CONSIDERATION, CONVERSIONS, etc.)')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)', 'PAUSED')
  .option('--daily-budget <amount>', 'Daily budget in dollars')
  .option('--start-time <time>', 'Start time (ISO 8601)')
  .option('--end-time <time>', 'End time (ISO 8601)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.campaigns.create({
        name: opts.name,
        ad_account_id: accountId,
        objective: opts.objective,
        status: opts.status,
        daily_budget_micro: opts.dailyBudget ? parseFloat(opts.dailyBudget) * 1_000_000 : undefined,
        start_time: opts.startTime,
        end_time: opts.endTime,
      });
      success('Campaign created!');
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('update <campaignId>')
  .description('Update a campaign')
  .option('-n, --name <name>', 'Campaign name')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)')
  .option('--daily-budget <amount>', 'Daily budget in dollars')
  .option('--start-time <time>', 'Start time (ISO 8601)')
  .option('--end-time <time>', 'End time (ISO 8601)')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.update(campaignId, {
        name: opts.name,
        status: opts.status,
        daily_budget_micro: opts.dailyBudget ? parseFloat(opts.dailyBudget) * 1_000_000 : undefined,
        start_time: opts.startTime,
        end_time: opts.endTime,
      });
      success('Campaign updated!');
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('pause <campaignId>')
  .description('Pause a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      await client.campaigns.pause(campaignId);
      success('Campaign paused');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('activate <campaignId>')
  .description('Activate a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      await client.campaigns.activate(campaignId);
      success('Campaign activated');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('delete <campaignId>')
  .description('Delete a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      await client.campaigns.delete(campaignId);
      success('Campaign deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Ad Squads Commands
// ============================================
const adsquadsCmd = program
  .command('adsquads')
  .description('Manage ad squads');

adsquadsCmd
  .command('list')
  .description('List ad squads')
  .option('-a, --account <accountId>', 'Ad account ID')
  .option('-c, --campaign <campaignId>', 'Campaign ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.campaign) {
        result = await client.adSquads.listByCampaign(opts.campaign);
      } else {
        const accountId = resolveAdAccountId(opts.account);
        result = await client.adSquads.listByAccount(accountId);
      }

      if (getFormat(adsquadsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ad Squads (${result.length} total):`);
        result.forEach(adSquad => {
          const status = adSquad.status === 'ACTIVE' ? chalk.green(adSquad.status) : chalk.yellow(adSquad.status);
          console.log(`  ${chalk.bold(adSquad.name)} (${status})`);
          console.log(`    ID: ${adSquad.id}`);
          console.log(`    Type: ${adSquad.type}`);
          console.log(`    Optimization: ${adSquad.optimization_goal}`);
          if (adSquad.bid_micro) {
            console.log(`    Bid: ${formatMicroCurrency(adSquad.bid_micro)}`);
          }
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsquadsCmd
  .command('get <adSquadId>')
  .description('Get ad squad details')
  .action(async (adSquadId: string) => {
    try {
      const client = getClient();
      const result = await client.adSquads.get(adSquadId);
      print(result, getFormat(adsquadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsquadsCmd
  .command('create')
  .description('Create a new ad squad')
  .requiredOption('-n, --name <name>', 'Ad squad name')
  .requiredOption('-c, --campaign <campaignId>', 'Campaign ID')
  .requiredOption('--type <type>', 'Type (SNAP_ADS, STORY_ADS, LENS, FILTER)')
  .requiredOption('--billing-event <event>', 'Billing event (IMPRESSION, SWIPE_UP, etc.)')
  .requiredOption('--optimization-goal <goal>', 'Optimization goal')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)', 'PAUSED')
  .option('--bid <amount>', 'Bid amount in dollars')
  .option('--auto-bid', 'Use auto bidding')
  .option('--daily-budget <amount>', 'Daily budget in dollars')
  .option('--start-time <time>', 'Start time (ISO 8601)')
  .option('--end-time <time>', 'End time (ISO 8601)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.adSquads.create({
        name: opts.name,
        campaign_id: opts.campaign,
        type: opts.type,
        billing_event: opts.billingEvent,
        optimization_goal: opts.optimizationGoal,
        status: opts.status,
        bid_micro: opts.bid ? parseFloat(opts.bid) * 1_000_000 : undefined,
        auto_bid: opts.autoBid,
        daily_budget_micro: opts.dailyBudget ? parseFloat(opts.dailyBudget) * 1_000_000 : undefined,
        start_time: opts.startTime,
        end_time: opts.endTime,
      });
      success('Ad squad created!');
      print(result, getFormat(adsquadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsquadsCmd
  .command('update <adSquadId>')
  .description('Update an ad squad')
  .option('-n, --name <name>', 'Ad squad name')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)')
  .option('--bid <amount>', 'Bid amount in dollars')
  .option('--auto-bid', 'Use auto bidding')
  .option('--daily-budget <amount>', 'Daily budget in dollars')
  .action(async (adSquadId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.adSquads.update(adSquadId, {
        name: opts.name,
        status: opts.status,
        bid_micro: opts.bid ? parseFloat(opts.bid) * 1_000_000 : undefined,
        auto_bid: opts.autoBid,
        daily_budget_micro: opts.dailyBudget ? parseFloat(opts.dailyBudget) * 1_000_000 : undefined,
      });
      success('Ad squad updated!');
      print(result, getFormat(adsquadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsquadsCmd
  .command('pause <adSquadId>')
  .description('Pause an ad squad')
  .action(async (adSquadId: string) => {
    try {
      const client = getClient();
      await client.adSquads.pause(adSquadId);
      success('Ad squad paused');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsquadsCmd
  .command('activate <adSquadId>')
  .description('Activate an ad squad')
  .action(async (adSquadId: string) => {
    try {
      const client = getClient();
      await client.adSquads.activate(adSquadId);
      success('Ad squad activated');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsquadsCmd
  .command('delete <adSquadId>')
  .description('Delete an ad squad')
  .action(async (adSquadId: string) => {
    try {
      const client = getClient();
      await client.adSquads.delete(adSquadId);
      success('Ad squad deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Ads Commands
// ============================================
const adsCmd = program
  .command('ads')
  .description('Manage ads');

adsCmd
  .command('list')
  .description('List ads')
  .option('-a, --account <accountId>', 'Ad account ID')
  .option('-s, --adsquad <adSquadId>', 'Ad squad ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.adsquad) {
        result = await client.ads.listByAdSquad(opts.adsquad);
      } else {
        const accountId = resolveAdAccountId(opts.account);
        result = await client.ads.listByAccount(accountId);
      }

      if (getFormat(adsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ads (${result.length} total):`);
        result.forEach(ad => {
          const status = ad.status === 'ACTIVE' ? chalk.green(ad.status) : chalk.yellow(ad.status);
          const review = ad.review_status === 'APPROVED' ? chalk.green(ad.review_status) : chalk.yellow(ad.review_status);
          console.log(`  ${chalk.bold(ad.name)} (${status})`);
          console.log(`    ID: ${ad.id}`);
          console.log(`    Type: ${ad.type}`);
          console.log(`    Review: ${review}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('get <adId>')
  .description('Get ad details')
  .action(async (adId: string) => {
    try {
      const client = getClient();
      const result = await client.ads.get(adId);
      print(result, getFormat(adsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('create')
  .description('Create a new ad')
  .requiredOption('-n, --name <name>', 'Ad name')
  .requiredOption('-s, --adsquad <adSquadId>', 'Ad squad ID')
  .requiredOption('-c, --creative <creativeId>', 'Creative ID')
  .option('--status <status>', 'Status (ACTIVE, PAUSED)', 'PAUSED')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.ads.create({
        name: opts.name,
        ad_squad_id: opts.adsquad,
        creative_id: opts.creative,
        status: opts.status,
      });
      success('Ad created!');
      print(result, getFormat(adsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('update <adId>')
  .description('Update an ad')
  .option('-n, --name <name>', 'Ad name')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)')
  .option('-c, --creative <creativeId>', 'Creative ID')
  .action(async (adId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.ads.update(adId, {
        name: opts.name,
        status: opts.status,
        creative_id: opts.creative,
      });
      success('Ad updated!');
      print(result, getFormat(adsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('pause <adId>')
  .description('Pause an ad')
  .action(async (adId: string) => {
    try {
      const client = getClient();
      await client.ads.pause(adId);
      success('Ad paused');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('activate <adId>')
  .description('Activate an ad')
  .action(async (adId: string) => {
    try {
      const client = getClient();
      await client.ads.activate(adId);
      success('Ad activated');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('delete <adId>')
  .description('Delete an ad')
  .action(async (adId: string) => {
    try {
      const client = getClient();
      await client.ads.delete(adId);
      success('Ad deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Creatives Commands
// ============================================
const creativesCmd = program
  .command('creatives')
  .description('Manage creatives');

creativesCmd
  .command('list [accountId]')
  .description('List creatives for an ad account')
  .action(async (accountId?: string) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.creatives.list(id);

      if (getFormat(creativesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Creatives (${result.length} total):`);
        result.forEach(creative => {
          console.log(`  ${chalk.bold(creative.name)}`);
          console.log(`    ID: ${creative.id}`);
          console.log(`    Type: ${creative.type}`);
          if (creative.headline) console.log(`    Headline: ${creative.headline}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('get <creativeId>')
  .description('Get creative details')
  .action(async (creativeId: string) => {
    try {
      const client = getClient();
      const result = await client.creatives.get(creativeId);
      print(result, getFormat(creativesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('create')
  .description('Create a new creative')
  .requiredOption('-n, --name <name>', 'Creative name')
  .option('-a, --account <accountId>', 'Ad account ID')
  .requiredOption('--type <type>', 'Type (SNAP_AD, WEB_VIEW, APP_INSTALL, etc.)')
  .requiredOption('--media <mediaId>', 'Top snap media ID')
  .option('--headline <headline>', 'Headline text')
  .option('--brand <brandName>', 'Brand name')
  .option('--cta <callToAction>', 'Call to action (LEARN_MORE, SHOP_NOW, etc.)')
  .option('--url <url>', 'Web view URL (for WEB_VIEW type)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.creatives.create({
        name: opts.name,
        ad_account_id: accountId,
        type: opts.type,
        top_snap_media_id: opts.media,
        headline: opts.headline,
        brand_name: opts.brand,
        call_to_action: opts.cta,
        web_view_properties: opts.url ? { url: opts.url } : undefined,
      });
      success('Creative created!');
      print(result, getFormat(creativesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('update <creativeId>')
  .description('Update a creative')
  .option('-n, --name <name>', 'Creative name')
  .option('--headline <headline>', 'Headline text')
  .option('--brand <brandName>', 'Brand name')
  .option('--cta <callToAction>', 'Call to action')
  .action(async (creativeId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.creatives.update(creativeId, {
        name: opts.name,
        headline: opts.headline,
        brand_name: opts.brand,
        call_to_action: opts.cta,
      });
      success('Creative updated!');
      print(result, getFormat(creativesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('delete <creativeId>')
  .description('Delete a creative')
  .action(async (creativeId: string) => {
    try {
      const client = getClient();
      await client.creatives.delete(creativeId);
      success('Creative deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Media Commands
// ============================================
const mediaCmd = program
  .command('media')
  .description('Manage media');

mediaCmd
  .command('list [accountId]')
  .description('List media for an ad account')
  .action(async (accountId?: string) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.media.list(id);

      if (getFormat(mediaCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Media (${result.length} total):`);
        result.forEach(media => {
          console.log(`  ${chalk.bold(media.name || media.id)}`);
          console.log(`    ID: ${media.id}`);
          console.log(`    Type: ${media.type}`);
          console.log(`    Status: ${media.media_status}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('get <mediaId>')
  .description('Get media details')
  .action(async (mediaId: string) => {
    try {
      const client = getClient();
      const result = await client.media.get(mediaId);
      print(result, getFormat(mediaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('upload <filePath>')
  .description('Upload media file')
  .option('-a, --account <accountId>', 'Ad account ID')
  .requiredOption('--type <type>', 'Media type (VIDEO, IMAGE)')
  .option('-n, --name <name>', 'Media name')
  .action(async (filePath: string, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      info(`Uploading ${filePath}...`);
      const result = await client.media.uploadFile(accountId, filePath, opts.type, opts.name);
      success('Media uploaded!');
      print(result, getFormat(mediaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('status <mediaId>')
  .description('Check media processing status')
  .action(async (mediaId: string) => {
    try {
      const client = getClient();
      const result = await client.media.checkStatus(mediaId);
      if (result.ready) {
        success(`Media is ready (${result.status})`);
      } else {
        info(`Media status: ${result.status}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('delete <mediaId>')
  .description('Delete media')
  .action(async (mediaId: string) => {
    try {
      const client = getClient();
      await client.media.delete(mediaId);
      success('Media deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Audiences Commands
// ============================================
const audiencesCmd = program
  .command('audiences')
  .description('Manage audiences/segments');

audiencesCmd
  .command('list [accountId]')
  .description('List audiences for an ad account')
  .action(async (accountId?: string) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.audiences.list(id);

      if (getFormat(audiencesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Audiences (${result.length} total):`);
        result.forEach(segment => {
          console.log(`  ${chalk.bold(segment.name)} (${segment.status})`);
          console.log(`    ID: ${segment.id}`);
          console.log(`    Type: ${segment.source_type}`);
          if (segment.approximate_count) {
            console.log(`    Size: ~${segment.approximate_count.toLocaleString()}`);
          }
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('get <segmentId>')
  .description('Get audience details')
  .action(async (segmentId: string) => {
    try {
      const client = getClient();
      const result = await client.audiences.get(segmentId);
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('create')
  .description('Create a new audience')
  .requiredOption('-n, --name <name>', 'Audience name')
  .option('-a, --account <accountId>', 'Ad account ID')
  .requiredOption('--source <source>', 'Source type (FIRST_PARTY, PIXEL, ENGAGEMENT, EMAIL, PHONE, MOBILE_AD_ID)')
  .option('--description <description>', 'Description')
  .option('--retention <days>', 'Retention in days')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.audiences.create({
        name: opts.name,
        ad_account_id: accountId,
        source_type: opts.source,
        description: opts.description,
        retention_in_days: opts.retention ? parseInt(opts.retention) as 1 | 3 | 5 | 7 | 10 | 14 | 21 | 28 | 30 | 60 | 90 | 120 | 180 | 365 | 9999 : undefined,
      });
      success('Audience created!');
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('update <segmentId>')
  .description('Update an audience')
  .option('-n, --name <name>', 'Audience name')
  .option('--description <description>', 'Description')
  .action(async (segmentId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.audiences.update(segmentId, {
        name: opts.name,
        description: opts.description,
      });
      success('Audience updated!');
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('delete <segmentId>')
  .description('Delete an audience')
  .action(async (segmentId: string) => {
    try {
      const client = getClient();
      await client.audiences.delete(segmentId);
      success('Audience deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('create-lookalike')
  .description('Create a lookalike audience')
  .requiredOption('-n, --name <name>', 'Audience name')
  .option('-a, --account <accountId>', 'Ad account ID')
  .requiredOption('--seed <segmentId>', 'Seed segment ID')
  .requiredOption('--country <country>', 'Country code')
  .option('--type <type>', 'Type (BALANCE, REACH, SIMILARITY)', 'BALANCE')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.audiences.createLookalike({
        name: opts.name,
        ad_account_id: accountId,
        seed_segment_id: opts.seed,
        country: opts.country,
        type: opts.type,
      });
      success('Lookalike audience created!');
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Stats Commands
// ============================================
const statsCmd = program
  .command('stats')
  .description('Get performance stats');

statsCmd
  .command('account [accountId]')
  .description('Get ad account stats')
  .requiredOption('--start <date>', 'Start date (ISO 8601)')
  .requiredOption('--end <date>', 'End date (ISO 8601)')
  .option('--granularity <granularity>', 'Granularity (HOUR, DAY, WEEK, MONTH, TOTAL)', 'DAY')
  .action(async (accountId: string | undefined, opts) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.stats.getAccountStats(id, {
        start_time: opts.start,
        end_time: opts.end,
        granularity: opts.granularity,
      });
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

statsCmd
  .command('campaign <campaignId>')
  .description('Get campaign stats')
  .requiredOption('--start <date>', 'Start date (ISO 8601)')
  .requiredOption('--end <date>', 'End date (ISO 8601)')
  .option('--granularity <granularity>', 'Granularity (HOUR, DAY, WEEK, MONTH, TOTAL)', 'DAY')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.stats.getCampaignStats(campaignId, {
        start_time: opts.start,
        end_time: opts.end,
        granularity: opts.granularity,
      });
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

statsCmd
  .command('adsquad <adSquadId>')
  .description('Get ad squad stats')
  .requiredOption('--start <date>', 'Start date (ISO 8601)')
  .requiredOption('--end <date>', 'End date (ISO 8601)')
  .option('--granularity <granularity>', 'Granularity (HOUR, DAY, WEEK, MONTH, TOTAL)', 'DAY')
  .action(async (adSquadId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.stats.getAdSquadStats(adSquadId, {
        start_time: opts.start,
        end_time: opts.end,
        granularity: opts.granularity,
      });
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

statsCmd
  .command('ad <adId>')
  .description('Get ad stats')
  .requiredOption('--start <date>', 'Start date (ISO 8601)')
  .requiredOption('--end <date>', 'End date (ISO 8601)')
  .option('--granularity <granularity>', 'Granularity (HOUR, DAY, WEEK, MONTH, TOTAL)', 'DAY')
  .action(async (adId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.stats.getAdStats(adId, {
        start_time: opts.start,
        end_time: opts.end,
        granularity: opts.granularity,
      });
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pixels Commands
// ============================================
const pixelsCmd = program
  .command('pixels')
  .description('Manage Snap Pixels');

pixelsCmd
  .command('list [accountId]')
  .description('List pixels for an ad account')
  .action(async (accountId?: string) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.pixels.list(id);

      if (getFormat(pixelsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Pixels (${result.length} total):`);
        result.forEach(pixel => {
          const status = pixel.status === 'ACTIVE' ? chalk.green(pixel.status) : chalk.yellow(pixel.status);
          console.log(`  ${chalk.bold(pixel.name)} (${status})`);
          console.log(`    ID: ${pixel.id}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('get <pixelId>')
  .description('Get pixel details')
  .action(async (pixelId: string) => {
    try {
      const client = getClient();
      const result = await client.pixels.get(pixelId);
      print(result, getFormat(pixelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('create')
  .description('Create a new pixel')
  .requiredOption('-n, --name <name>', 'Pixel name')
  .option('-a, --account <accountId>', 'Ad account ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.pixels.create({
        name: opts.name,
        ad_account_id: accountId,
      });
      success('Pixel created!');
      print(result, getFormat(pixelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('code <pixelId>')
  .description('Get pixel JavaScript code')
  .action(async (pixelId: string) => {
    try {
      const client = getClient();
      const code = client.pixels.generateBaseCode(pixelId);
      console.log(code);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('delete <pixelId>')
  .description('Delete a pixel')
  .action(async (pixelId: string) => {
    try {
      const client = getClient();
      await client.pixels.delete(pixelId);
      success('Pixel deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Catalogs Commands
// ============================================
const catalogsCmd = program
  .command('catalogs')
  .description('Manage product catalogs');

catalogsCmd
  .command('list')
  .description('List catalogs')
  .option('-o, --org <orgId>', 'Organization ID')
  .option('-a, --account <accountId>', 'Ad account ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.org) {
        result = await client.catalogs.list(opts.org);
      } else {
        const accountId = resolveAdAccountId(opts.account);
        result = await client.catalogs.listByAdAccount(accountId);
      }

      if (getFormat(catalogsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Catalogs (${result.length} total):`);
        result.forEach(catalog => {
          const status = catalog.status === 'ACTIVE' ? chalk.green(catalog.status) : chalk.yellow(catalog.status);
          console.log(`  ${chalk.bold(catalog.name)} (${status})`);
          console.log(`    ID: ${catalog.id}`);
          if (catalog.product_count) {
            console.log(`    Products: ${catalog.product_count.toLocaleString()}`);
          }
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('get <catalogId>')
  .description('Get catalog details')
  .action(async (catalogId: string) => {
    try {
      const client = getClient();
      const result = await client.catalogs.get(catalogId);
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('create')
  .description('Create a new catalog')
  .requiredOption('-n, --name <name>', 'Catalog name')
  .option('-a, --account <accountId>', 'Ad account ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.catalogs.create({
        name: opts.name,
        ad_account_id: accountId,
      });
      success('Catalog created!');
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('products <catalogId>')
  .description('List products in a catalog')
  .option('-l, --limit <number>', 'Limit results')
  .action(async (catalogId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.listProducts(catalogId, opts.limit ? parseInt(opts.limit) : undefined);
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('delete <catalogId>')
  .description('Delete a catalog')
  .action(async (catalogId: string) => {
    try {
      const client = getClient();
      await client.catalogs.delete(catalogId);
      success('Catalog deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Leads Commands
// ============================================
const leadsCmd = program
  .command('leads')
  .description('Manage lead forms and leads');

leadsCmd
  .command('forms [accountId]')
  .description('List lead forms for an ad account')
  .action(async (accountId?: string) => {
    try {
      const client = getClient();
      const id = resolveAdAccountId(accountId);
      const result = await client.leads.listForms(id);

      if (getFormat(leadsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Lead Forms (${result.length} total):`);
        result.forEach(form => {
          const status = form.status === 'ACTIVE' ? chalk.green(form.status) : chalk.yellow(form.status);
          console.log(`  ${chalk.bold(form.name)} (${status})`);
          console.log(`    ID: ${form.id}`);
          console.log(`    Fields: ${form.fields.map(f => f.type).join(', ')}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadsCmd
  .command('form <formId>')
  .description('Get lead form details')
  .action(async (formId: string) => {
    try {
      const client = getClient();
      const result = await client.leads.getForm(formId);
      print(result, getFormat(leadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadsCmd
  .command('list <formId>')
  .description('List leads for a form')
  .option('-l, --limit <number>', 'Limit results')
  .option('--start <time>', 'Start time (ISO 8601)')
  .option('--end <time>', 'End time (ISO 8601)')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.leads.listLeads(formId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        startTime: opts.start,
        endTime: opts.end,
      });
      print(result, getFormat(leadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadsCmd
  .command('get <leadId>')
  .description('Get lead details')
  .action(async (leadId: string) => {
    try {
      const client = getClient();
      const result = await client.leads.getLead(leadId);
      print(result, getFormat(leadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadsCmd
  .command('export <formId>')
  .description('Export leads to CSV')
  .option('-l, --limit <number>', 'Limit results')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const leads = await client.leads.listLeads(formId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      const csv = client.leads.exportLeadsToCSV(leads);
      console.log(csv);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
