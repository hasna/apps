#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TikTok } from '../api';
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
  getAdvertiserId,
  getDefaultAdvertiserId,
  setDefaultAdvertiserId,
  setNamedAdvertiser,
  removeNamedAdvertiser,
  listNamedAdvertisers,
  getExportsDir,
  getImportsDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, formatMoney, formatNumber, formatPercent } from '../utils/output';

const CONNECTOR_NAME = 'connect-tiktok';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TikTok Marketing API CLI - Campaigns, ads, audiences, creatives, and analytics')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-a, --advertiser <id>', 'Advertiser ID (overrides config)')
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
      process.env.TIKTOK_ACCESS_TOKEN = opts.token;
    }
    if (opts.advertiser) {
      process.env.TIKTOK_ADVERTISER_ID = opts.advertiser;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TikTok {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TIKTOK_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  const advertiserId = getDefaultAdvertiserId();
  return new TikTok({ accessToken, advertiserId });
}

function resolveAdvertiserId(nameOrId?: string): string {
  const resolved = getAdvertiserId(nameOrId);
  if (!resolved) {
    error(`No advertiser ID specified. Use --advertiser or set default with "${CONNECTOR_NAME} config set-advertiser <id>"`);
    process.exit(1);
  }
  return resolved;
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
  .option('--advertiser <id>', 'Default advertiser ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
      defaultAdvertiserId: opts.advertiser,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Advertiser: ${config.defaultAdvertiserId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const defaultAdvertiser = getDefaultAdvertiserId();
    const namedAdvertisers = listNamedAdvertisers();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    info(`Imports directory: ${getImportsDir()}`);
    console.log();
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Advertiser: ${defaultAdvertiser || chalk.gray('not set')}`);

    const advertiserNames = Object.keys(namedAdvertisers);
    if (advertiserNames.length > 0) {
      console.log();
      info(`Named Advertisers:`);
      advertiserNames.forEach(name => {
        console.log(`  ${chalk.cyan(name)}: ${namedAdvertisers[name]}`);
      });
    }
  });

configCmd
  .command('set-advertiser <advertiserId>')
  .description('Set default advertiser ID')
  .action((advertiserId: string) => {
    setDefaultAdvertiserId(advertiserId);
    success(`Default advertiser set: ${advertiserId}`);
  });

configCmd
  .command('set-named-advertiser <name> <advertiserId>')
  .description('Set a named advertiser (e.g., main, test)')
  .action((name: string, advertiserId: string) => {
    setNamedAdvertiser(name, advertiserId);
    success(`Advertiser "${name}" set to: ${advertiserId}`);
  });

configCmd
  .command('remove-named-advertiser <name>')
  .description('Remove a named advertiser')
  .action((name: string) => {
    if (removeNamedAdvertiser(name)) {
      success(`Named advertiser "${name}" removed`);
    } else {
      error(`Named advertiser "${name}" not found`);
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
// Advertiser Commands
// ============================================
const advertiserCmd = program
  .command('advertiser')
  .description('Manage advertiser accounts');

advertiserCmd
  .command('info [advertiserId]')
  .description('Get advertiser info')
  .action(async (advertiserId?: string) => {
    try {
      const client = getClient();
      const advId = resolveAdvertiserId(advertiserId);
      const result = await client.advertisers.get(advId);
      print(result, getFormat(advertiserCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

advertiserCmd
  .command('balance [advertiserId]')
  .description('Get advertiser balance')
  .action(async (advertiserId?: string) => {
    try {
      const client = getClient();
      const advId = resolveAdvertiserId(advertiserId);
      const result = await client.advertisers.getBalance(advId);

      if (getFormat(advertiserCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold('Advertiser Balance:'));
        console.log(`  Balance:     ${formatMoney(result.balance)}`);
        console.log(`  Cash:        ${formatMoney(result.cash)}`);
        console.log(`  Grant:       ${formatMoney(result.grant)}`);
        console.log(`  Transfer In: ${formatMoney(result.transfer_in)}`);
        console.log(`  Transfer Out: ${formatMoney(result.transfer_out)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Campaign Commands
// ============================================
const campaignsCmd = program
  .command('campaigns')
  .description('Manage campaigns');

campaignsCmd
  .command('list')
  .description('List campaigns')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--page <number>', 'Page number')
  .option('--status <status>', 'Filter by status')
  .option('--objective <objective>', 'Filter by objective')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.campaigns.list({
        advertiser_id: advertiserId,
        page: opts.page ? parseInt(opts.page) : undefined,
        page_size: parseInt(opts.limit),
        filtering: opts.status || opts.objective ? {
          primary_status: opts.status,
          objective_type: opts.objective,
        } : undefined,
      });

      if (getFormat(campaignsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Campaigns (${result.page_info?.total_number || result.list?.length || 0} total):`);
        result.list?.forEach(campaign => {
          const statusColor = campaign.operation_status === 'ENABLE' ? chalk.green : chalk.yellow;
          console.log(`  ${chalk.bold(campaign.campaign_name)} [${statusColor(campaign.operation_status)}]`);
          console.log(`    ID: ${campaign.campaign_id}`);
          console.log(`    Objective: ${campaign.objective_type}`);
          console.log(`    Budget: ${campaign.budget ? formatMoney(campaign.budget) : 'Unlimited'}`);
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
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.campaigns.get(advertiserId, campaignId);
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('create')
  .description('Create a campaign')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .requiredOption('-o, --objective <objective>', 'Objective type (REACH, TRAFFIC, VIDEO_VIEWS, ENGAGEMENT, APP_PROMOTION, LEAD_GENERATION, WEBSITE_CONVERSIONS, PRODUCT_SALES)')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--budget <amount>', 'Budget amount')
  .option('--budget-mode <mode>', 'Budget mode (BUDGET_MODE_INFINITE, BUDGET_MODE_DAY, BUDGET_MODE_TOTAL)', 'BUDGET_MODE_INFINITE')
  .option('--status <status>', 'Operation status (ENABLE, DISABLE)', 'ENABLE')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.campaigns.create({
        advertiser_id: advertiserId,
        campaign_name: opts.name,
        objective_type: opts.objective,
        budget_mode: opts.budgetMode,
        budget: opts.budget ? parseFloat(opts.budget) : undefined,
        operation_status: opts.status,
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
  .option('--advertiser <id>', 'Advertiser ID')
  .option('-n, --name <name>', 'Campaign name')
  .option('--budget <amount>', 'Budget amount')
  .option('--status <status>', 'Operation status (ENABLE, DISABLE)')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.campaigns.update({
        advertiser_id: advertiserId,
        campaign_id: campaignId,
        campaign_name: opts.name,
        budget: opts.budget ? parseFloat(opts.budget) : undefined,
        operation_status: opts.status,
      });
      success('Campaign updated!');
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('enable <campaignIds...>')
  .description('Enable campaigns')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (campaignIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.campaigns.enable(advertiserId, campaignIds);
      success(`Enabled ${result.campaign_ids.length} campaign(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('disable <campaignIds...>')
  .description('Disable campaigns')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (campaignIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.campaigns.disable(advertiserId, campaignIds);
      success(`Disabled ${result.campaign_ids.length} campaign(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('delete <campaignIds...>')
  .description('Delete campaigns')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (campaignIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.campaigns.delete(advertiserId, campaignIds);
      success(`Deleted ${result.campaign_ids.length} campaign(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Ad Group Commands
// ============================================
const adgroupsCmd = program
  .command('adgroups')
  .description('Manage ad groups');

adgroupsCmd
  .command('list')
  .description('List ad groups')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--campaign <id>', 'Filter by campaign ID')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--page <number>', 'Page number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.adgroups.list({
        advertiser_id: advertiserId,
        page: opts.page ? parseInt(opts.page) : undefined,
        page_size: parseInt(opts.limit),
        filtering: opts.campaign ? { campaign_ids: [opts.campaign] } : undefined,
      });

      if (getFormat(adgroupsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ad Groups (${result.page_info?.total_number || result.list?.length || 0} total):`);
        result.list?.forEach(adgroup => {
          const statusColor = adgroup.operation_status === 'ENABLE' ? chalk.green : chalk.yellow;
          console.log(`  ${chalk.bold(adgroup.adgroup_name)} [${statusColor(adgroup.operation_status)}]`);
          console.log(`    ID: ${adgroup.adgroup_id}`);
          console.log(`    Campaign: ${adgroup.campaign_id}`);
          console.log(`    Optimization: ${adgroup.optimization_goal}`);
          console.log(`    Budget: ${adgroup.budget ? formatMoney(adgroup.budget) : 'Unlimited'}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adgroupsCmd
  .command('get <adgroupId>')
  .description('Get ad group details')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adgroupId: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.adgroups.get(advertiserId, adgroupId);
      print(result, getFormat(adgroupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adgroupsCmd
  .command('enable <adgroupIds...>')
  .description('Enable ad groups')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adgroupIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.adgroups.enable(advertiserId, adgroupIds);
      success(`Enabled ${result.adgroup_ids.length} ad group(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adgroupsCmd
  .command('disable <adgroupIds...>')
  .description('Disable ad groups')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adgroupIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.adgroups.disable(advertiserId, adgroupIds);
      success(`Disabled ${result.adgroup_ids.length} ad group(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adgroupsCmd
  .command('delete <adgroupIds...>')
  .description('Delete ad groups')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adgroupIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.adgroups.delete(advertiserId, adgroupIds);
      success(`Deleted ${result.adgroup_ids.length} ad group(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Ad Commands
// ============================================
const adsCmd = program
  .command('ads')
  .description('Manage ads');

adsCmd
  .command('list')
  .description('List ads')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--campaign <id>', 'Filter by campaign ID')
  .option('--adgroup <id>', 'Filter by ad group ID')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--page <number>', 'Page number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.ads.list({
        advertiser_id: advertiserId,
        page: opts.page ? parseInt(opts.page) : undefined,
        page_size: parseInt(opts.limit),
        filtering: (opts.campaign || opts.adgroup) ? {
          campaign_ids: opts.campaign ? [opts.campaign] : undefined,
          adgroup_ids: opts.adgroup ? [opts.adgroup] : undefined,
        } : undefined,
      });

      if (getFormat(adsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Ads (${result.page_info?.total_number || result.list?.length || 0} total):`);
        result.list?.forEach(ad => {
          const statusColor = ad.operation_status === 'ENABLE' ? chalk.green : chalk.yellow;
          console.log(`  ${chalk.bold(ad.ad_name)} [${statusColor(ad.operation_status)}]`);
          console.log(`    ID: ${ad.ad_id}`);
          console.log(`    Ad Group: ${ad.adgroup_id}`);
          console.log(`    Format: ${ad.ad_format}`);
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
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adId: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.ads.get(advertiserId, adId);
      print(result, getFormat(adsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('enable <adIds...>')
  .description('Enable ads')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.ads.enable(advertiserId, adIds);
      success(`Enabled ${result.ad_ids.length} ad(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('disable <adIds...>')
  .description('Disable ads')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.ads.disable(advertiserId, adIds);
      success(`Disabled ${result.ad_ids.length} ad(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adsCmd
  .command('delete <adIds...>')
  .description('Delete ads')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (adIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.ads.delete(advertiserId, adIds);
      success(`Deleted ${result.ad_ids.length} ad(s)`);
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
  .description('Manage creative assets');

creativesCmd
  .command('images')
  .description('List images')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--page <number>', 'Page number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.creatives.listImages(advertiserId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        page_size: parseInt(opts.limit),
      });
      print(result, getFormat(creativesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('videos')
  .description('List videos')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--page <number>', 'Page number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.creatives.listVideos(advertiserId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        page_size: parseInt(opts.limit),
      });
      print(result, getFormat(creativesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('upload-image <url>')
  .description('Upload an image by URL')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('-n, --name <name>', 'File name')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.creatives.uploadImageByUrl(advertiserId, url, opts.name);
      success('Image uploaded!');
      print(result, getFormat(creativesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creativesCmd
  .command('upload-video <url>')
  .description('Upload a video by URL')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('-n, --name <name>', 'File name')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.creatives.uploadVideoByUrl(advertiserId, url, opts.name);
      success('Video uploaded!');
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
  .description('Manage custom audiences');

audiencesCmd
  .command('list')
  .description('List audiences')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--page <number>', 'Page number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.audiences.list({
        advertiser_id: advertiserId,
        page: opts.page ? parseInt(opts.page) : undefined,
        page_size: parseInt(opts.limit),
      });

      if (getFormat(audiencesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Audiences (${result.page_info?.total_number || result.list?.length || 0} total):`);
        result.list?.forEach(audience => {
          console.log(`  ${chalk.bold(audience.name)} [${audience.status}]`);
          console.log(`    ID: ${audience.audience_id}`);
          console.log(`    Type: ${audience.audience_type}`);
          console.log(`    Size: ${formatNumber(audience.cover_num)}`);
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
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (audienceId: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.audiences.get(advertiserId, audienceId);
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('delete <audienceIds...>')
  .description('Delete audiences')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (audienceIds: string[], opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.audiences.delete(advertiserId, audienceIds);
      success(`Deleted ${result.custom_audience_ids.length} audience(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Targeting Commands
// ============================================
const targetingCmd = program
  .command('targeting')
  .description('View targeting options');

targetingCmd
  .command('locations')
  .description('Search location targeting options')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.targeting.searchLocations(advertiserId, opts.query);
      print(result, getFormat(targetingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

targetingCmd
  .command('interests')
  .description('Get interest categories')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.targeting.getInterestCategories(advertiserId);
      print(result, getFormat(targetingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

targetingCmd
  .command('languages')
  .description('Get language options')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.targeting.getLanguages(advertiserId);
      print(result, getFormat(targetingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

targetingCmd
  .command('devices')
  .description('Get device model options')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--brand <brand>', 'Filter by brand')
  .option('--os <os>', 'Filter by OS (IOS, ANDROID)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.targeting.getDeviceModels(advertiserId, {
        brand: opts.brand,
        os: opts.os,
      });
      print(result, getFormat(targetingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Reports Commands
// ============================================
const reportsCmd = program
  .command('reports')
  .description('View performance reports');

reportsCmd
  .command('summary')
  .description('Get advertiser summary report')
  .option('--advertiser <id>', 'Advertiser ID')
  .requiredOption('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.reports.getAdvertiserSummary({
        advertiser_id: advertiserId,
        metrics: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversion', 'cost_per_conversion'],
        start_date: opts.start,
        end_date: opts.end,
      });

      if (getFormat(reportsCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold('Advertiser Summary:'));
        console.log(`  Spend:       ${formatMoney(Number(result.metrics.spend) || 0)}`);
        console.log(`  Impressions: ${formatNumber(Number(result.metrics.impressions) || 0)}`);
        console.log(`  Clicks:      ${formatNumber(Number(result.metrics.clicks) || 0)}`);
        console.log(`  CTR:         ${formatPercent(Number(result.metrics.ctr) || 0)}`);
        console.log(`  CPC:         ${formatMoney(Number(result.metrics.cpc) || 0)}`);
        console.log(`  CPM:         ${formatMoney(Number(result.metrics.cpm) || 0)}`);
        console.log(`  Conversions: ${formatNumber(Number(result.metrics.conversion) || 0)}`);
        console.log(`  Cost/Conv:   ${formatMoney(Number(result.metrics.cost_per_conversion) || 0)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('campaigns')
  .description('Get campaign level report')
  .option('--advertiser <id>', 'Advertiser ID')
  .requiredOption('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.reports.getCampaignReport({
        advertiser_id: advertiserId,
        metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion', 'cost_per_conversion'],
        start_date: opts.start,
        end_date: opts.end,
        page_size: parseInt(opts.limit),
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('adgroups')
  .description('Get ad group level report')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--campaign <id>', 'Filter by campaign ID')
  .requiredOption('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.reports.getAdGroupReport({
        advertiser_id: advertiserId,
        campaign_ids: opts.campaign ? [opts.campaign] : undefined,
        metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion', 'cost_per_conversion'],
        start_date: opts.start,
        end_date: opts.end,
        page_size: parseInt(opts.limit),
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('ads')
  .description('Get ad level report')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--campaign <id>', 'Filter by campaign ID')
  .option('--adgroup <id>', 'Filter by ad group ID')
  .requiredOption('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.reports.getAdReport({
        advertiser_id: advertiserId,
        campaign_ids: opts.campaign ? [opts.campaign] : undefined,
        adgroup_ids: opts.adgroup ? [opts.adgroup] : undefined,
        metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversion', 'cost_per_conversion'],
        start_date: opts.start,
        end_date: opts.end,
        page_size: parseInt(opts.limit),
      });
      print(result, getFormat(reportsCmd));
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
  .description('Manage pixels');

pixelsCmd
  .command('list')
  .description('List pixels')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.pixels.list(advertiserId);
      print(result, getFormat(pixelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('get <pixelId>')
  .description('Get pixel details')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (pixelId: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.pixels.get(advertiserId, pixelId);
      print(result, getFormat(pixelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pixelsCmd
  .command('create')
  .description('Create a pixel')
  .requiredOption('-n, --name <name>', 'Pixel name')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--advanced-matching', 'Enable advanced matching')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.pixels.create({
        advertiser_id: advertiserId,
        pixel_name: opts.name,
        advanced_matching: opts.advancedMatching,
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
  .description('Get pixel code snippet')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (pixelId: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.pixels.getCode(advertiserId, pixelId);
      print(result, getFormat(pixelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Business Center Commands
// ============================================
const businessCmd = program
  .command('business')
  .description('Manage Business Center');

businessCmd
  .command('list')
  .description('List Business Centers')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.business.list();
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('members <bcId>')
  .description('List Business Center members')
  .action(async (bcId: string) => {
    try {
      const client = getClient();
      const result = await client.business.listMembers(bcId);
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('advertisers <bcId>')
  .description('List advertisers under Business Center')
  .action(async (bcId: string) => {
    try {
      const client = getClient();
      const result = await client.business.listAdvertisers(bcId);
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd
  .command('balance <bcId>')
  .description('Get Business Center balance')
  .action(async (bcId: string) => {
    try {
      const client = getClient();
      const result = await client.business.getBalance(bcId);
      print(result, getFormat(businessCmd));
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
  .command('list <bcId>')
  .description('List catalogs')
  .action(async (bcId: string) => {
    try {
      const client = getClient();
      const result = await client.catalogs.list(bcId);
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('get <bcId> <catalogId>')
  .description('Get catalog details')
  .action(async (bcId: string, catalogId: string) => {
    try {
      const client = getClient();
      const result = await client.catalogs.get(bcId, catalogId);
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('create')
  .description('Create a catalog')
  .requiredOption('--bc <bcId>', 'Business Center ID')
  .requiredOption('-n, --name <name>', 'Catalog name')
  .option('--type <type>', 'Catalog type (PRODUCT, VEHICLE, HOTEL, FLIGHT, DESTINATION, HOME_LISTING)', 'PRODUCT')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.create({
        bc_id: opts.bc,
        catalog_name: opts.name,
        catalog_type: opts.type,
      });
      success('Catalog created!');
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('products <bcId> <catalogId>')
  .description('List products in catalog')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .action(async (bcId: string, catalogId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.listProducts(bcId, catalogId, {
        page_size: parseInt(opts.limit),
      });
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Identity Commands
// ============================================
const identityCmd = program
  .command('identity')
  .description('Manage TikTok identities for Spark Ads');

identityCmd
  .command('list')
  .description('List identities')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.identity.list(advertiserId);
      print(result, getFormat(identityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

identityCmd
  .command('create')
  .description('Create a customized identity')
  .option('--advertiser <id>', 'Advertiser ID')
  .requiredOption('-n, --name <name>', 'Display name')
  .option('--image <url>', 'Profile image URL')
  .action(async (opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.identity.create({
        advertiser_id: advertiserId,
        identity_type: 'CUSTOMIZED_USER',
        display_name: opts.name,
        profile_image: opts.image,
      });
      success('Identity created!');
      print(result, getFormat(identityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

identityCmd
  .command('auth-info <authCode>')
  .description('Get authorization info for a TikTok post')
  .option('--advertiser <id>', 'Advertiser ID')
  .action(async (authCode: string, opts) => {
    try {
      const client = getClient();
      const advertiserId = resolveAdvertiserId(opts.advertiser);
      const result = await client.identity.getAuthInfo(advertiserId, authCode);
      print(result, getFormat(identityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
