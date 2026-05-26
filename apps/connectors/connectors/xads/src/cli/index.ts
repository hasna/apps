#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { XAds, XAdsClient } from '../api';
import {
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConsumerKey,
  getConsumerSecret,
  getAccessToken,
  getAccessTokenSecret,
  getAccountId,
  setConsumerKey,
  setConsumerSecret,
  setAccessToken,
  setAccessTokenSecret,
  setAccountId,
  hasOAuthCredentials,
} from '../utils/config';
import {
  output,
  setOutputFormat,
  success,
  error,
  info,
  table,
  formatMicro,
  type OutputFormat,
} from '../utils/output';
import type { Objective, Placement, EntityStatus, Granularity, MetricGroup } from '../types';

const CONNECTOR_NAME = 'connect-xads';

// Create program
const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Twitter/X Ads API connector CLI')
  .version('0.0.1')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-a, --account <account>', 'Ad account ID to use')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if (options.format) {
      setOutputFormat(options.format as OutputFormat);
    }
  });

// Helper to get client
function getClient(options: { profile?: string }): XAds {
  if (options.profile) {
    const config = loadProfile(options.profile);
    if (!config.consumerKey || !config.consumerSecret) {
      throw new Error('Consumer key and secret not configured. Run: connect-xads config set consumer-key <key>');
    }
    return new XAds({
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
      accessToken: config.accessToken,
      accessTokenSecret: config.accessTokenSecret,
    });
  }

  const consumerKey = getConsumerKey();
  const consumerSecret = getConsumerSecret();
  const accessToken = getAccessToken();
  const accessTokenSecret = getAccessTokenSecret();

  if (!consumerKey || !consumerSecret) {
    throw new Error('Consumer key and secret not configured. Run: connect-xads config set consumer-key <key>');
  }

  return new XAds({
    consumerKey,
    consumerSecret,
    accessToken,
    accessTokenSecret,
  });
}

// Helper to get account ID
function getAccountIdFromOptions(options: { account?: string }): string {
  const accountId = options.account || getAccountId();
  if (!accountId) {
    throw new Error('No ad account ID specified. Use --account <id> or run: connect-xads config set account-id <id>');
  }
  return accountId;
}

// Helper for readline
function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============ Profile Commands ============
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found. Create one with: connect-xads profile create <name>');
      return;
    }
    console.log(chalk.bold('\nProfiles:'));
    for (const p of profiles) {
      const marker = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
    }
    console.log();
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      success(`Switched to profile: ${name}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, options: { use?: boolean }) => {
    try {
      createProfile(name);
      success(`Created profile: ${name}`);
      if (options.use) {
        setCurrentProfile(name);
        success(`Switched to profile: ${name}`);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Deleted profile: ${name}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    try {
      const profileName = name || getCurrentProfile();
      const config = loadProfile(profileName);
      console.log(chalk.bold(`\nProfile: ${profileName}`));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  Consumer Key: ${config.consumerKey ? chalk.green('configured') : chalk.red('not set')}`);
      console.log(`  Consumer Secret: ${config.consumerSecret ? chalk.green('configured') : chalk.red('not set')}`);
      console.log(`  Access Token: ${config.accessToken ? chalk.green('configured') : chalk.red('not set')}`);
      console.log(`  Access Token Secret: ${config.accessTokenSecret ? chalk.green('configured') : chalk.red('not set')}`);
      console.log(`  Account ID: ${config.accountId || chalk.gray('not set')}`);
      console.log();
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Config Commands ============
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (consumer-key, consumer-secret, access-token, access-token-secret, account-id)')
  .action((key: string, value: string) => {
    try {
      switch (key) {
        case 'consumer-key':
          setConsumerKey(value);
          success('Consumer key set');
          break;
        case 'consumer-secret':
          setConsumerSecret(value);
          success('Consumer secret set');
          break;
        case 'access-token':
          setAccessToken(value);
          success('Access token set');
          break;
        case 'access-token-secret':
          setAccessTokenSecret(value);
          success('Access token secret set');
          break;
        case 'account-id':
          setAccountId(value);
          success('Account ID set');
          break;
        default:
          error(`Unknown config key: ${key}`);
          process.exit(1);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const config = loadProfile();
    console.log(chalk.bold('\nCurrent Configuration'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Profile: ${profile}`);
    console.log(`  Consumer Key: ${config.consumerKey ? config.consumerKey.slice(0, 8) + '...' : chalk.red('not set')}`);
    console.log(`  Consumer Secret: ${config.consumerSecret ? chalk.green('configured') : chalk.red('not set')}`);
    console.log(`  Access Token: ${config.accessToken ? config.accessToken.slice(0, 8) + '...' : chalk.red('not set')}`);
    console.log(`  Access Token Secret: ${config.accessTokenSecret ? chalk.green('configured') : chalk.red('not set')}`);
    console.log(`  Account ID: ${config.accountId || chalk.gray('not set')}`);
    console.log();
  });

configCmd
  .command('clear')
  .description('Clear all configuration for current profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============ Auth Commands ============
const authCmd = program.command('auth').description('Authentication');

authCmd
  .command('login')
  .description('Authenticate with Twitter/X using PIN-based OAuth')
  .action(async () => {
    try {
      const consumerKey = getConsumerKey();
      const consumerSecret = getConsumerSecret();

      if (!consumerKey || !consumerSecret) {
        error('Consumer key and secret not configured.');
        info('Get these from developer.twitter.com and run:');
        console.log('  connect-xads config set consumer-key <key>');
        console.log('  connect-xads config set consumer-secret <secret>');
        process.exit(1);
      }

      const client = new XAdsClient({ consumerKey, consumerSecret });

      info('Requesting authorization...');
      const { oauthToken, oauthTokenSecret } = await client.getRequestToken();

      const authorizeUrl = client.getAuthorizeUrl(oauthToken);
      console.log(chalk.bold('\nOpen this URL in your browser:'));
      console.log(chalk.blue(authorizeUrl));
      console.log();

      const pin = await askQuestion('Enter the PIN from Twitter: ');

      if (!pin) {
        error('No PIN entered');
        process.exit(1);
      }

      info('Getting access token...');
      const { accessToken, accessTokenSecret, screenName } = await client.getAccessToken(
        oauthToken,
        oauthTokenSecret,
        pin
      );

      // Save to current profile
      setAccessToken(accessToken);
      setAccessTokenSecret(accessTokenSecret);

      success(`Authenticated as @${screenName}`);
      info('Access tokens saved to profile');
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(() => {
    if (hasOAuthCredentials()) {
      success('Authenticated (OAuth credentials configured)');
    } else {
      error('Not authenticated');
      info('Run: connect-xads auth login');
    }
  });

// ============ Accounts Commands ============
const accountsCmd = program.command('accounts').description('Manage ad accounts');

accountsCmd
  .command('list')
  .description('List all ad accounts')
  .action(async () => {
    try {
      const client = getClient(program.opts());
      const result = await client.accounts.list();
      if (result.data.length === 0) {
        info('No ad accounts found');
        return;
      }
      table(
        ['ID', 'Name', 'Status', 'Timezone'],
        result.data.map((a) => [a.id, a.name, a.approval_status, a.timezone])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

accountsCmd
  .command('get <id>')
  .description('Get ad account details')
  .action(async (id: string) => {
    try {
      const client = getClient(program.opts());
      const result = await client.accounts.get(id);
      output(result.data, { title: 'Ad Account' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

accountsCmd
  .command('funding <id>')
  .description('List funding instruments for an account')
  .action(async (id: string) => {
    try {
      const client = getClient(program.opts());
      const result = await client.accounts.listFundingInstruments(id);
      if (result.data.length === 0) {
        info('No funding instruments found');
        return;
      }
      table(
        ['ID', 'Type', 'Currency', 'Credit Remaining'],
        result.data.map((f) => [
          f.id,
          f.type,
          f.currency,
          formatMicro(f.credit_remaining_local_micro),
        ])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Campaigns Commands ============
const campaignsCmd = program.command('campaigns').description('Manage ad campaigns');

campaignsCmd
  .command('list')
  .description('List all campaigns')
  .action(async () => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.campaigns.list(accountId);
      if (result.data.length === 0) {
        info('No campaigns found');
        return;
      }
      table(
        ['ID', 'Name', 'Status', 'Daily Budget', 'Total Budget'],
        result.data.map((c) => [
          c.id,
          c.name,
          c.entity_status,
          formatMicro(c.daily_budget_amount_local_micro),
          formatMicro(c.total_budget_amount_local_micro),
        ])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

campaignsCmd
  .command('get <id>')
  .description('Get campaign details')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.campaigns.get(accountId, id);
      output(result.data, { title: 'Campaign' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

campaignsCmd
  .command('create')
  .description('Create a new campaign')
  .requiredOption('--name <name>', 'Campaign name')
  .requiredOption('--funding-instrument <id>', 'Funding instrument ID')
  .option('--daily-budget <amount>', 'Daily budget in dollars')
  .option('--total-budget <amount>', 'Total budget in dollars')
  .option('--status <status>', 'Entity status (ACTIVE, PAUSED, DRAFT)', 'PAUSED')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.campaigns.create(accountId, {
        name: options.name,
        funding_instrument_id: options.fundingInstrument,
        daily_budget_amount_local_micro: options.dailyBudget
          ? parseFloat(options.dailyBudget) * 1_000_000
          : undefined,
        total_budget_amount_local_micro: options.totalBudget
          ? parseFloat(options.totalBudget) * 1_000_000
          : undefined,
        entity_status: options.status as EntityStatus,
      });
      success(`Created campaign: ${result.data.id}`);
      output(result.data);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

campaignsCmd
  .command('pause <id>')
  .description('Pause a campaign')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.campaigns.pause(accountId, id);
      success(`Paused campaign: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

campaignsCmd
  .command('activate <id>')
  .description('Activate a campaign')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.campaigns.activate(accountId, id);
      success(`Activated campaign: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

campaignsCmd
  .command('delete <id>')
  .description('Delete a campaign')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.campaigns.delete(accountId, id);
      success(`Deleted campaign: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Line Items Commands ============
const lineItemsCmd = program.command('line-items').description('Manage line items (ad groups)');

lineItemsCmd
  .command('list')
  .description('List all line items')
  .option('--campaign <id>', 'Filter by campaign ID')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.lineItems.list(accountId, {
        campaign_ids: options.campaign ? [options.campaign] : undefined,
      });
      if (result.data.length === 0) {
        info('No line items found');
        return;
      }
      table(
        ['ID', 'Name', 'Campaign', 'Objective', 'Status', 'Bid'],
        result.data.map((l) => [
          l.id,
          l.name,
          l.campaign_id,
          l.objective,
          l.entity_status,
          formatMicro(l.bid_amount_local_micro),
        ])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

lineItemsCmd
  .command('get <id>')
  .description('Get line item details')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.lineItems.get(accountId, id);
      output(result.data, { title: 'Line Item' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

lineItemsCmd
  .command('create')
  .description('Create a new line item')
  .requiredOption('--campaign <id>', 'Campaign ID')
  .requiredOption('--name <name>', 'Line item name')
  .requiredOption('--objective <objective>', 'Objective (ENGAGEMENTS, FOLLOWERS, WEBSITE_CLICKS, etc.)')
  .option('--placements <placements>', 'Placements (comma-separated)', 'ALL_ON_TWITTER')
  .option('--bid <amount>', 'Bid amount in dollars')
  .option('--bid-strategy <strategy>', 'Bid strategy (AUTO, MAX, TARGET)', 'AUTO')
  .option('--status <status>', 'Entity status (ACTIVE, PAUSED, DRAFT)', 'PAUSED')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.lineItems.create(accountId, {
        campaign_id: options.campaign,
        name: options.name,
        objective: options.objective as Objective,
        placements: options.placements.split(',') as Placement[],
        bid_amount_local_micro: options.bid ? parseFloat(options.bid) * 1_000_000 : undefined,
        bid_strategy: options.bidStrategy,
        entity_status: options.status as EntityStatus,
      });
      success(`Created line item: ${result.data.id}`);
      output(result.data);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

lineItemsCmd
  .command('pause <id>')
  .description('Pause a line item')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.lineItems.pause(accountId, id);
      success(`Paused line item: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

lineItemsCmd
  .command('activate <id>')
  .description('Activate a line item')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.lineItems.activate(accountId, id);
      success(`Activated line item: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

lineItemsCmd
  .command('delete <id>')
  .description('Delete a line item')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.lineItems.delete(accountId, id);
      success(`Deleted line item: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Promoted Tweets Commands ============
const promotedCmd = program.command('promoted').description('Manage promoted tweets');

promotedCmd
  .command('list')
  .description('List all promoted tweets')
  .option('--line-item <id>', 'Filter by line item ID')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.promotedTweets.list(accountId, {
        line_item_ids: options.lineItem ? [options.lineItem] : undefined,
      });
      if (result.data.length === 0) {
        info('No promoted tweets found');
        return;
      }
      table(
        ['ID', 'Tweet ID', 'Line Item', 'Status', 'Approval'],
        result.data.map((p) => [p.id, p.tweet_id, p.line_item_id, p.entity_status, p.approval_status])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

promotedCmd
  .command('create')
  .description('Promote tweets')
  .requiredOption('--line-item <id>', 'Line item ID')
  .requiredOption('--tweets <ids>', 'Tweet IDs (comma-separated)')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const tweetIds = options.tweets.split(',').map((t: string) => t.trim());
      const result = await client.promotedTweets.create(accountId, {
        line_item_id: options.lineItem,
        tweet_ids: tweetIds,
      });
      success(`Created ${result.data.length} promoted tweet(s)`);
      output(result.data);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

promotedCmd
  .command('delete <id>')
  .description('Delete a promoted tweet')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.promotedTweets.delete(accountId, id);
      success(`Deleted promoted tweet: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Targeting Commands ============
const targetingCmd = program.command('targeting').description('Manage targeting criteria');

targetingCmd
  .command('list')
  .description('List all targeting criteria')
  .option('--line-item <id>', 'Filter by line item ID')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.targeting.list(accountId, {
        line_item_ids: options.lineItem ? [options.lineItem] : undefined,
      });
      if (result.data.length === 0) {
        info('No targeting criteria found');
        return;
      }
      table(
        ['ID', 'Type', 'Value', 'Line Item'],
        result.data.map((t) => [t.id, t.targeting_type, t.targeting_value, t.line_item_id])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

targetingCmd
  .command('create')
  .description('Create targeting criteria')
  .requiredOption('--line-item <id>', 'Line item ID')
  .requiredOption('--type <type>', 'Targeting type (LOCATION, INTEREST, GENDER, etc.)')
  .requiredOption('--value <value>', 'Targeting value')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.targeting.create(accountId, {
        line_item_id: options.lineItem,
        targeting_type: options.type,
        targeting_value: options.value,
      });
      success(`Created targeting criteria: ${result.data.id}`);
      output(result.data);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

targetingCmd
  .command('delete <id>')
  .description('Delete targeting criteria')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.targeting.delete(accountId, id);
      success(`Deleted targeting criteria: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

targetingCmd
  .command('locations <query>')
  .description('Search for location targeting values')
  .action(async (query: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.targeting.searchLocations(accountId, query);
      if (result.data.length === 0) {
        info('No locations found');
        return;
      }
      table(
        ['Value', 'Name', 'Type'],
        result.data.map((l) => [l.targeting_value, l.name, l.targeting_type])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Audiences Commands ============
const audiencesCmd = program.command('audiences').description('Manage tailored audiences');

audiencesCmd
  .command('list')
  .description('List all tailored audiences')
  .action(async () => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.audiences.list(accountId);
      if (result.data.length === 0) {
        info('No tailored audiences found');
        return;
      }
      table(
        ['ID', 'Name', 'Type', 'Size', 'Targetable'],
        result.data.map((a) => [a.id, a.name, a.audience_type, a.audience_size || '-', a.targetable])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

audiencesCmd
  .command('get <id>')
  .description('Get audience details')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.audiences.get(accountId, id);
      output(result.data, { title: 'Tailored Audience' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

audiencesCmd
  .command('create')
  .description('Create a tailored audience')
  .requiredOption('--name <name>', 'Audience name')
  .requiredOption('--list-type <type>', 'List type (EMAIL, DEVICE_ID, TWITTER_ID, HANDLE, PHONE_NUMBER)')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.audiences.create(accountId, {
        name: options.name,
        list_type: options.listType,
      });
      success(`Created tailored audience: ${result.data.id}`);
      output(result.data);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

audiencesCmd
  .command('delete <id>')
  .description('Delete a tailored audience')
  .action(async (id: string) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      await client.audiences.delete(accountId, id);
      success(`Deleted tailored audience: ${id}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Analytics Commands ============
const analyticsCmd = program.command('analytics').description('View analytics and stats');

analyticsCmd
  .command('campaigns')
  .description('Get campaign analytics')
  .requiredOption('--ids <ids>', 'Campaign IDs (comma-separated)')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--granularity <granularity>', 'Granularity (DAY, HOUR, TOTAL)', 'TOTAL')
  .option('--metrics <metrics>', 'Metric groups (comma-separated)', 'ENGAGEMENT')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const campaignIds = options.ids.split(',').map((id: string) => id.trim());
      const result = await client.analytics.getCampaignStats(accountId, campaignIds, {
        start_time: options.start + 'T00:00:00Z',
        end_time: options.end + 'T23:59:59Z',
        granularity: options.granularity as Granularity,
        metric_groups: options.metrics.split(',') as MetricGroup[],
      });
      output(result, { title: 'Campaign Analytics' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

analyticsCmd
  .command('line-items')
  .description('Get line item analytics')
  .requiredOption('--ids <ids>', 'Line item IDs (comma-separated)')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--granularity <granularity>', 'Granularity (DAY, HOUR, TOTAL)', 'TOTAL')
  .option('--metrics <metrics>', 'Metric groups (comma-separated)', 'ENGAGEMENT')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const lineItemIds = options.ids.split(',').map((id: string) => id.trim());
      const result = await client.analytics.getLineItemStats(accountId, lineItemIds, {
        start_time: options.start + 'T00:00:00Z',
        end_time: options.end + 'T23:59:59Z',
        granularity: options.granularity as Granularity,
        metric_groups: options.metrics.split(',') as MetricGroup[],
      });
      output(result, { title: 'Line Item Analytics' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

analyticsCmd
  .command('reach')
  .description('Get reach estimate for targeting')
  .requiredOption('--objective <objective>', 'Objective (ENGAGEMENTS, FOLLOWERS, etc.)')
  .option('--locations <locations>', 'Location targeting values (comma-separated)')
  .option('--interests <interests>', 'Interest targeting values (comma-separated)')
  .option('--gender <gender>', 'Gender (MALE, FEMALE)')
  .option('--budget <amount>', 'Daily budget in dollars')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.analytics.getReachEstimate(accountId, {
        objective: options.objective as Objective,
        locations: options.locations?.split(','),
        interests: options.interests?.split(','),
        gender: options.gender,
        campaign_daily_budget_amount_local_micro: options.budget
          ? parseFloat(options.budget) * 1_000_000
          : undefined,
      });
      output(result.data, { title: 'Reach Estimate' });
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// ============ Media Commands ============
const mediaCmd = program.command('media').description('Manage media creatives');

mediaCmd
  .command('list')
  .description('List all media creatives')
  .option('--line-item <id>', 'Filter by line item ID')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.media.list(accountId, {
        line_item_ids: options.lineItem ? [options.lineItem] : undefined,
      });
      if (result.data.length === 0) {
        info('No media creatives found');
        return;
      }
      table(
        ['ID', 'Media Key', 'Line Item', 'Status', 'Approval'],
        result.data.map((m) => [m.id, m.media_key, m.line_item_id, m.entity_status, m.approval_status])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

mediaCmd
  .command('library')
  .description('List media library')
  .option('--type <type>', 'Media type (IMAGE, VIDEO, GIF)')
  .action(async (options) => {
    try {
      const opts = program.opts();
      const client = getClient(opts);
      const accountId = getAccountIdFromOptions(opts);
      const result = await client.media.getLibrary(accountId, {
        media_type: options.type,
      });
      if (result.data.length === 0) {
        info('No media found');
        return;
      }
      table(
        ['Media Key', 'Type', 'URL'],
        result.data.map((m) => [m.media_key, m.media_type, m.media_url || '-'])
      );
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// Parse and run
program.parse();
