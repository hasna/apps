#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Meta } from '../api';
import {
  getAccessToken,
  setAccessToken,
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
  getDefaultPixelId,
  setDefaultPixelId,
  getDefaultBusinessId,
  setDefaultBusinessId,
  getDefaultPageId,
  setDefaultPageId,
  getExportsDir,
  getImportsDir,
  formatAdAccountId,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, formatMoney, formatNumber, formatPercent } from '../utils/output';

const CONNECTOR_NAME = 'connect-meta';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Meta Marketing API CLI - Facebook/Instagram ads, campaigns, audiences, and insights')
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
      process.env.META_ACCESS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Meta {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set META_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Meta({ accessToken });
}

function resolveAdAccountId(nameOrId?: string): string {
  const resolved = getAdAccountId(nameOrId);
  if (!resolved) {
    error(`No ad account specified. Use --account or set default with "${CONNECTOR_NAME} config set-account <id>"`);
    process.exit(1);
  }
  return formatAdAccountId(resolved);
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
  .option('--token <token>', 'Access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 10)}...` : chalk.gray('not set')}`);
    info(`Default Ad Account: ${config.defaultAdAccountId || chalk.gray('not set')}`);
    info(`Default Pixel: ${config.defaultPixelId || chalk.gray('not set')}`);
    info(`Default Business: ${config.defaultBusinessId || chalk.gray('not set')}`);
    info(`Default Page: ${config.defaultPageId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <accessToken>')
  .description('Set access token')
  .action((accessToken: string) => {
    setAccessToken(accessToken);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const defaultAccount = getDefaultAdAccountId();
    const defaultPixel = getDefaultPixelId();
    const defaultBusiness = getDefaultBusinessId();
    const defaultPage = getDefaultPageId();
    const namedAccounts = listNamedAdAccounts();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    info(`Imports directory: ${getImportsDir()}`);
    console.log();
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 10)}...` : chalk.gray('not set')}`);
    info(`Default Ad Account: ${defaultAccount || chalk.gray('not set')}`);
    info(`Default Pixel: ${defaultPixel || chalk.gray('not set')}`);
    info(`Default Business: ${defaultBusiness || chalk.gray('not set')}`);
    info(`Default Page: ${defaultPage || chalk.gray('not set')}`);

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
  .command('set-account <adAccountId>')
  .description('Set default ad account ID')
  .action((adAccountId: string) => {
    setDefaultAdAccountId(adAccountId);
    success(`Default ad account set: ${adAccountId}`);
  });

configCmd
  .command('set-pixel <pixelId>')
  .description('Set default pixel ID')
  .action((pixelId: string) => {
    setDefaultPixelId(pixelId);
    success(`Default pixel set: ${pixelId}`);
  });

configCmd
  .command('set-business <businessId>')
  .description('Set default business ID')
  .action((businessId: string) => {
    setDefaultBusinessId(businessId);
    success(`Default business set: ${businessId}`);
  });

configCmd
  .command('set-page <pageId>')
  .description('Set default page ID')
  .action((pageId: string) => {
    setDefaultPageId(pageId);
    success(`Default page set: ${pageId}`);
  });

configCmd
  .command('set-named-account <name> <adAccountId>')
  .description('Set a named ad account (e.g., main, client1)')
  .action((name: string, adAccountId: string) => {
    setNamedAdAccount(name, adAccountId);
    success(`Account "${name}" set to: ${adAccountId}`);
  });

configCmd
  .command('remove-named-account <name>')
  .description('Remove a named ad account')
  .action((name: string) => {
    if (removeNamedAdAccount(name)) {
      success(`Named account "${name}" removed`);
    } else {
      error(`Named account "${name}" not found`);
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
// Accounts Commands
// ============================================
const accountsCmd = program
  .command('accounts')
  .description('Manage ad accounts');

accountsCmd
  .command('list')
  .description('List ad accounts')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--business <id>', 'List accounts for a business')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = opts.business
        ? await client.accounts.listForBusiness(opts.business, { limit: opts.limit ? parseInt(opts.limit) : undefined })
        : await client.accounts.list({ limit: opts.limit ? parseInt(opts.limit) : undefined });

      if (getFormat(accountsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ad Accounts:`);
        result.data.forEach(account => {
          console.log(`  ${chalk.bold(account.name)} (${account.currency})`);
          console.log(`    ID: ${account.id}`);
          console.log(`    Account ID: ${account.account_id}`);
          console.log(`    Status: ${account.account_status}`);
          console.log(`    Spent: ${account.amount_spent}`);
          console.log(`    Timezone: ${account.timezone_name}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('get [account]')
  .description('Get ad account details (account: ID, name, or default)')
  .action(async (account?: string) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.accounts.get(accountId);
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
  .command('list [account]')
  .description('List campaigns')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-s, --status <status>', 'Filter by status (ACTIVE, PAUSED, etc.)')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.campaigns.list(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        effective_status: opts.status ? [opts.status] : undefined,
      });

      if (getFormat(campaignsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Campaigns:`);
        result.data.forEach(campaign => {
          const statusColor = campaign.effective_status === 'ACTIVE' ? chalk.green : chalk.yellow;
          console.log(`  ${chalk.bold(campaign.name)}`);
          console.log(`    ID: ${campaign.id}`);
          console.log(`    Objective: ${campaign.objective}`);
          console.log(`    Status: ${statusColor(campaign.effective_status)}`);
          if (campaign.daily_budget) console.log(`    Daily Budget: ${campaign.daily_budget}`);
          if (campaign.lifetime_budget) console.log(`    Lifetime Budget: ${campaign.lifetime_budget}`);
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
  .description('Create a campaign')
  .option('-a, --account <account>', 'Ad account (ID, name, or default)')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .requiredOption('-o, --objective <objective>', 'Campaign objective')
  .option('-s, --status <status>', 'Status (ACTIVE, PAUSED)', 'PAUSED')
  .option('--daily-budget <amount>', 'Daily budget in cents')
  .option('--lifetime-budget <amount>', 'Lifetime budget in cents')
  .option('--special-ad-category <category>', 'Special ad category (NONE, EMPLOYMENT, HOUSING, CREDIT)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.campaigns.create(accountId, {
        name: opts.name,
        objective: opts.objective,
        status: opts.status,
        daily_budget: opts.dailyBudget,
        lifetime_budget: opts.lifetimeBudget,
        special_ad_categories: opts.specialAdCategory ? [opts.specialAdCategory] : ['NONE'],
      });
      success('Campaign created!');
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

campaignsCmd
  .command('insights <campaignId>')
  .description('Get campaign insights')
  .option('-d, --date-preset <preset>', 'Date preset (last_7d, last_30d, etc.)', 'last_7d')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.getInsights(campaignId, {
        date_preset: opts.datePreset,
      });
      print(result.data, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Ad Sets Commands
// ============================================
const adsetsCmd = program
  .command('adsets')
  .description('Manage ad sets');

adsetsCmd
  .command('list [account]')
  .description('List ad sets')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-s, --status <status>', 'Filter by status')
  .option('-c, --campaign <id>', 'Filter by campaign')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();

      let result;
      if (opts.campaign) {
        result = await client.adsets.listByCampaign(opts.campaign, {
          limit: opts.limit ? parseInt(opts.limit) : undefined,
          effective_status: opts.status ? [opts.status] : undefined,
        });
      } else {
        const accountId = resolveAdAccountId(account);
        result = await client.adsets.list(accountId, {
          limit: opts.limit ? parseInt(opts.limit) : undefined,
          effective_status: opts.status ? [opts.status] : undefined,
        });
      }

      if (getFormat(adsetsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ad Sets:`);
        result.data.forEach(adset => {
          const statusColor = adset.effective_status === 'ACTIVE' ? chalk.green : chalk.yellow;
          console.log(`  ${chalk.bold(adset.name)}`);
          console.log(`    ID: ${adset.id}`);
          console.log(`    Campaign: ${adset.campaign_id}`);
          console.log(`    Status: ${statusColor(adset.effective_status)}`);
          if (adset.daily_budget) console.log(`    Daily Budget: ${adset.daily_budget}`);
          if (adset.optimization_goal) console.log(`    Optimization: ${adset.optimization_goal}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsetsCmd
  .command('get <adsetId>')
  .description('Get ad set details')
  .action(async (adsetId: string) => {
    try {
      const client = getClient();
      const result = await client.adsets.get(adsetId);
      print(result, getFormat(adsetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsetsCmd
  .command('pause <adsetId>')
  .description('Pause an ad set')
  .action(async (adsetId: string) => {
    try {
      const client = getClient();
      await client.adsets.pause(adsetId);
      success('Ad set paused');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsetsCmd
  .command('activate <adsetId>')
  .description('Activate an ad set')
  .action(async (adsetId: string) => {
    try {
      const client = getClient();
      await client.adsets.activate(adsetId);
      success('Ad set activated');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsetsCmd
  .command('delete <adsetId>')
  .description('Delete an ad set')
  .action(async (adsetId: string) => {
    try {
      const client = getClient();
      await client.adsets.delete(adsetId);
      success('Ad set deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsetsCmd
  .command('insights <adsetId>')
  .description('Get ad set insights')
  .option('-d, --date-preset <preset>', 'Date preset', 'last_7d')
  .action(async (adsetId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.adsets.getInsights(adsetId, {
        date_preset: opts.datePreset,
      });
      print(result.data, getFormat(adsetsCmd));
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
  .command('list [account]')
  .description('List ads')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-s, --status <status>', 'Filter by status')
  .option('--adset <id>', 'Filter by ad set')
  .option('--campaign <id>', 'Filter by campaign')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();

      let result;
      if (opts.adset) {
        result = await client.ads.listByAdSet(opts.adset, {
          limit: opts.limit ? parseInt(opts.limit) : undefined,
          effective_status: opts.status ? [opts.status] : undefined,
        });
      } else if (opts.campaign) {
        result = await client.ads.listByCampaign(opts.campaign, {
          limit: opts.limit ? parseInt(opts.limit) : undefined,
          effective_status: opts.status ? [opts.status] : undefined,
        });
      } else {
        const accountId = resolveAdAccountId(account);
        result = await client.ads.list(accountId, {
          limit: opts.limit ? parseInt(opts.limit) : undefined,
          effective_status: opts.status ? [opts.status] : undefined,
        });
      }

      if (getFormat(adsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ads:`);
        result.data.forEach(ad => {
          const statusColor = ad.effective_status === 'ACTIVE' ? chalk.green : chalk.yellow;
          console.log(`  ${chalk.bold(ad.name)}`);
          console.log(`    ID: ${ad.id}`);
          console.log(`    Ad Set: ${ad.adset_id}`);
          console.log(`    Status: ${statusColor(ad.effective_status)}`);
          if (ad.creative) console.log(`    Creative: ${ad.creative.id}`);
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

adsCmd
  .command('preview <adId>')
  .description('Get ad preview')
  .option('--format <format>', 'Preview format (DESKTOP_FEED_STANDARD, MOBILE_FEED_STANDARD, etc.)', 'DESKTOP_FEED_STANDARD')
  .action(async (adId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.ads.getPreview(adId, opts.format);
      print(result, getFormat(adsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('insights <adId>')
  .description('Get ad insights')
  .option('-d, --date-preset <preset>', 'Date preset', 'last_7d')
  .action(async (adId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.ads.getInsights(adId, {
        date_preset: opts.datePreset,
      });
      print(result.data, getFormat(adsCmd));
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
  .description('Manage ad creatives');

creativesCmd
  .command('list [account]')
  .description('List ad creatives')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.creatives.list(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(creativesCmd));
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

creativesCmd
  .command('images [account]')
  .description('List ad images')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.creatives.listImages(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(creativesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('videos [account]')
  .description('List ad videos')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.creatives.listVideos(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(creativesCmd));
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
  .description('Manage audiences');

audiencesCmd
  .command('list [account]')
  .description('List custom audiences')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.audiences.list(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (getFormat(audiencesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Custom Audiences:`);
        result.data.forEach(audience => {
          console.log(`  ${chalk.bold(audience.name)}`);
          console.log(`    ID: ${audience.id}`);
          console.log(`    Type: ${audience.subtype}`);
          if (audience.approximate_count_lower_bound && audience.approximate_count_upper_bound) {
            console.log(`    Size: ${formatNumber(audience.approximate_count_lower_bound)} - ${formatNumber(audience.approximate_count_upper_bound)}`);
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
  .command('get <audienceId>')
  .description('Get audience details')
  .action(async (audienceId: string) => {
    try {
      const client = getClient();
      const result = await client.audiences.get(audienceId);
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('create')
  .description('Create a custom audience')
  .option('-a, --account <account>', 'Ad account')
  .requiredOption('-n, --name <name>', 'Audience name')
  .option('-d, --description <desc>', 'Description')
  .option('-t, --type <type>', 'Subtype (CUSTOM, WEBSITE, APP, etc.)', 'CUSTOM')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(opts.account);
      const result = await client.audiences.create(accountId, {
        name: opts.name,
        description: opts.description,
        subtype: opts.type,
      });
      success('Audience created!');
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('delete <audienceId>')
  .description('Delete an audience')
  .action(async (audienceId: string) => {
    try {
      const client = getClient();
      await client.audiences.delete(audienceId);
      success('Audience deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('saved [account]')
  .description('List saved audiences')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.audiences.listSavedAudiences(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Insights Commands
// ============================================
const insightsCmd = program
  .command('insights')
  .description('Get performance insights');

insightsCmd
  .command('account [account]')
  .description('Get account insights')
  .option('-d, --date-preset <preset>', 'Date preset (today, yesterday, last_7d, last_30d, etc.)', 'last_7d')
  .option('--since <date>', 'Start date (YYYY-MM-DD)')
  .option('--until <date>', 'End date (YYYY-MM-DD)')
  .option('-b, --breakdown <breakdown>', 'Breakdown (age, gender, country, device_platform, etc.)')
  .option('-l, --level <level>', 'Level (account, campaign, adset, ad)')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);

      const params: Record<string, unknown> = {
        date_preset: opts.since ? undefined : opts.datePreset,
        time_range: opts.since && opts.until ? { since: opts.since, until: opts.until } : undefined,
        level: opts.level,
      };

      if (opts.breakdown) {
        params.breakdowns = [opts.breakdown];
      }

      const result = await client.insights.getAccountInsights(accountId, params as never);

      if (getFormat(insightsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Account Insights (${opts.datePreset || `${opts.since} to ${opts.until}`}):`);
        result.data.forEach(insight => {
          console.log(`  Period: ${insight.date_start} to ${insight.date_stop}`);
          console.log(`    Impressions: ${formatNumber(insight.impressions || '0')}`);
          console.log(`    Clicks: ${formatNumber(insight.clicks || '0')}`);
          console.log(`    Spend: ${insight.spend || '0'}`);
          console.log(`    Reach: ${formatNumber(insight.reach || '0')}`);
          console.log(`    CPC: ${insight.cpc || 'N/A'}`);
          console.log(`    CPM: ${insight.cpm || 'N/A'}`);
          console.log(`    CTR: ${insight.ctr ? formatPercent(insight.ctr) : 'N/A'}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

insightsCmd
  .command('daily [account]')
  .description('Get daily insights breakdown')
  .option('-d, --date-preset <preset>', 'Date preset', 'last_7d')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.insights.getDailyInsights(accountId, {
        date_preset: opts.datePreset,
      });
      print(result.data, getFormat(insightsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

insightsCmd
  .command('demographics [account]')
  .description('Get demographic insights (age/gender)')
  .option('-d, --date-preset <preset>', 'Date preset', 'last_7d')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.insights.getDemographicInsights(accountId, {
        date_preset: opts.datePreset,
      });
      print(result.data, getFormat(insightsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

insightsCmd
  .command('geo [account]')
  .description('Get geographic insights')
  .option('-d, --date-preset <preset>', 'Date preset', 'last_7d')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.insights.getGeoInsights(accountId, {
        date_preset: opts.datePreset,
      });
      print(result.data, getFormat(insightsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

insightsCmd
  .command('platform [account]')
  .description('Get platform insights (Facebook, Instagram, etc.)')
  .option('-d, --date-preset <preset>', 'Date preset', 'last_7d')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAdAccountId(account);
      const result = await client.insights.getPlatformInsights(accountId, {
        date_preset: opts.datePreset,
      });
      print(result.data, getFormat(insightsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pages Commands
// ============================================
const pagesCmd = program
  .command('pages')
  .description('Manage Facebook pages');

pagesCmd
  .command('list')
  .description('List pages')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--business <id>', 'List pages for a business')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = opts.business
        ? await client.pages.listForBusiness(opts.business, { limit: opts.limit ? parseInt(opts.limit) : undefined })
        : await client.pages.list({ limit: opts.limit ? parseInt(opts.limit) : undefined });

      if (getFormat(pagesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Pages:`);
        result.data.forEach(page => {
          console.log(`  ${chalk.bold(page.name)}`);
          console.log(`    ID: ${page.id}`);
          console.log(`    Category: ${page.category}`);
          if (page.fan_count) console.log(`    Fans: ${formatNumber(page.fan_count)}`);
          if (page.username) console.log(`    Username: @${page.username}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('get <pageId>')
  .description('Get page details')
  .action(async (pageId: string) => {
    try {
      const client = getClient();
      const result = await client.pages.get(pageId);
      print(result, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('posts <pageId>')
  .description('List page posts')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (pageId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.pages.getPosts(pageId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('insights <pageId>')
  .description('Get page insights')
  .option('-m, --metric <metrics>', 'Comma-separated metrics')
  .option('-p, --period <period>', 'Period (day, week, days_28, month, lifetime)', 'day')
  .action(async (pageId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.pages.getInsights(pageId, {
        metric: opts.metric ? opts.metric.split(',') : undefined,
        period: opts.period,
      });
      print(result, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Instagram Commands
// ============================================
const instagramCmd = program
  .command('instagram')
  .description('Manage Instagram accounts');

instagramCmd
  .command('get <pageId>')
  .description('Get Instagram account connected to a page')
  .action(async (pageId: string) => {
    try {
      const client = getClient();
      const result = await client.instagram.getAccountForPage(pageId);
      if (result) {
        print(result, getFormat(instagramCmd));
      } else {
        info('No Instagram account connected to this page');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

instagramCmd
  .command('media <instagramAccountId>')
  .description('List Instagram media')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (instagramAccountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.instagram.listMedia(instagramAccountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(instagramCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

instagramCmd
  .command('insights <instagramAccountId>')
  .description('Get Instagram account insights')
  .option('-p, --period <period>', 'Period (day, week, days_28, lifetime)', 'day')
  .action(async (instagramAccountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.instagram.getAccountInsights(instagramAccountId, {
        period: opts.period,
      });
      print(result, getFormat(instagramCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

instagramCmd
  .command('stories <instagramAccountId>')
  .description('Get Instagram stories')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (instagramAccountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.instagram.getStories(instagramAccountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(instagramCmd));
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
  .description('Manage conversion pixels');

pixelsCmd
  .command('list [account]')
  .description('List pixels')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--business <id>', 'List pixels for a business')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();

      const result = opts.business
        ? await client.pixels.listForBusiness(opts.business, { limit: opts.limit ? parseInt(opts.limit) : undefined })
        : await client.pixels.list(resolveAdAccountId(account), { limit: opts.limit ? parseInt(opts.limit) : undefined });

      if (getFormat(pixelsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Pixels:`);
        result.data.forEach(pixel => {
          console.log(`  ${chalk.bold(pixel.name)}`);
          console.log(`    ID: ${pixel.id}`);
          if (pixel.last_fired_time) console.log(`    Last Fired: ${pixel.last_fired_time}`);
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
  .command('code <pixelId>')
  .description('Get pixel code snippet')
  .action(async (pixelId: string) => {
    try {
      const client = getClient();
      const result = await client.pixels.getCode(pixelId);
      if (result.code) {
        console.log(result.code);
      } else {
        info('No pixel code available');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('stats <pixelId>')
  .description('Get pixel event stats')
  .action(async (pixelId: string) => {
    try {
      const client = getClient();
      const result = await client.pixels.getStats(pixelId);
      print(result, getFormat(pixelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('send-event <pixelId>')
  .description('Send a test event via Conversions API')
  .requiredOption('-e, --event <name>', 'Event name (Purchase, Lead, etc.)')
  .option('--email <email>', 'User email (will be hashed)')
  .option('--value <amount>', 'Event value')
  .option('--currency <code>', 'Currency code', 'USD')
  .option('--test-code <code>', 'Test event code')
  .action(async (pixelId: string, opts) => {
    try {
      const client = getClient();
      const event = client.pixels.createEvent({
        eventName: opts.event,
        actionSource: 'website',
        userData: {
          email: opts.email,
        },
        customData: opts.value ? {
          value: parseFloat(opts.value),
          currency: opts.currency,
        } : undefined,
      });

      const result = await client.pixels.sendEvent(pixelId, event, opts.testCode);
      success(`Event sent! Received: ${result.events_received}`);
      print(result, getFormat(pixelsCmd));
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
  .command('list <businessId>')
  .description('List product catalogs')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (businessId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.list(businessId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(catalogsCmd));
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
  .command('products <catalogId>')
  .description('List products in a catalog')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (catalogId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.listProducts(catalogId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('feeds <catalogId>')
  .description('List product feeds')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (catalogId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.listFeeds(catalogId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('product-sets <catalogId>')
  .description('List product sets')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (catalogId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.listProductSets(catalogId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Business Commands
// ============================================
const businessCmd = program
  .command('business')
  .description('Manage Business Manager');

businessCmd
  .command('list')
  .description('List businesses')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.business.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (getFormat(businessCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Businesses:`);
        result.data.forEach(biz => {
          console.log(`  ${chalk.bold(biz.name)}`);
          console.log(`    ID: ${biz.id}`);
          if (biz.verification_status) console.log(`    Verification: ${biz.verification_status}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('get <businessId>')
  .description('Get business details')
  .action(async (businessId: string) => {
    try {
      const client = getClient();
      const result = await client.business.get(businessId);
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('users <businessId>')
  .description('List business users')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (businessId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.business.listUsers(businessId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('ad-accounts <businessId>')
  .description('List ad accounts in business')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (businessId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.business.listAdAccounts(businessId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('pages-owned <businessId>')
  .description('List pages owned by business')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (businessId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.business.listPages(businessId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('pixels-owned <businessId>')
  .description('List pixels owned by business')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (businessId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.business.listPixels(businessId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('instagram-accounts <businessId>')
  .description('List Instagram accounts in business')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (businessId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.business.listInstagramAccounts(businessId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
