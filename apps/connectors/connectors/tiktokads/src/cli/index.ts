#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TikTokAds } from '../api';
import {
  clearConfig,
  clearTokens,
  createProfile,
  deleteProfile,
  getAccessToken,
  getAdvertiserId,
  getClientId,
  getClientSecret,
  getConfigDir,
  getCurrentProfile,
  isAuthenticated,
  listProfiles,
  loadProfile,
  profileExists,
  saveTokens,
  setAccessToken,
  setAdvertiserId,
  setCredentials,
  setCurrentProfile,
  setProfileOverride,
} from '../utils/config';
import { getAuthUrl, getValidAccessToken, startCallbackServer } from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { error, info, print, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-tiktokads';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TikTok Ads Marketing API connector CLI')
  .version(VERSION)
  .option('-p, --profile <profile>', 'Use specific profile')
  .option('-a, --advertiser <id>', 'Advertiser account ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.advertiser) {
      process.env.TIKTOK_ADS_ADVERTISER_ID = opts.advertiser;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || program.opts().format || 'pretty') as OutputFormat;
}

async function getClient(): Promise<TikTokAds> {
  const accessToken = process.env.TIKTOK_ADS_ACCESS_TOKEN || (await getValidAccessToken().catch(() => getAccessToken()));
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} auth login" or set TIKTOK_ADS_ACCESS_TOKEN.`);
    process.exit(1);
  }
  return new TikTokAds({
    accessToken,
    advertiserId: getAdvertiserId(),
  });
}

function resolveAdvertiser(client: TikTokAds, explicit?: string): string {
  return client.getClient().requireAdvertiserId(explicit || getAdvertiserId());
}

function parseJsonOption(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return JSON.parse(value);
}

function parseParamsOption(
  value?: string,
): Record<string, string | number | boolean | string[] | undefined> | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as Record<string, string | number | boolean | string[] | undefined>;
}

// Profile
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (!profiles.length) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--use', 'Switch to profile after creation').action((name: string, opts) => {
  if (!createProfile(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  success(`Profile "${name}" created`);
  if (opts.use) {
    setCurrentProfile(name);
    info(`Switched to profile: ${name}`);
  }
});

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Access token: ${config.accessToken ? 'set' : chalk.gray('not set')}`);
  info(`Advertiser ID: ${config.advertiserId || chalk.gray('not set')}`);
});

// Config
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setAccessToken(token);
  success(`Access token saved for profile "${getCurrentProfile()}"`);
});

configCmd.command('set-advertiser <id>').action((id: string) => {
  setAdvertiserId(id);
  success(`Advertiser ID saved for profile "${getCurrentProfile()}"`);
});

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Access token: ${getAccessToken() ? 'set' : chalk.gray('not set')}`);
  info(`Advertiser ID: ${getAdvertiserId() || chalk.gray('not set')}`);
  info(`Client ID: ${getClientId() ? 'set' : chalk.gray('not set')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared for active profile');
});

// Auth
const authCmd = program.command('auth').description('OAuth authentication');

authCmd.command('setup <clientId> <clientSecret>').action((clientId: string, clientSecret: string) => {
  setCredentials(clientId, clientSecret);
  success(`OAuth credentials saved`);
  info(`Run: ${CONNECTOR_NAME} auth login`);
});

authCmd.command('login').action(async () => {
  if (!getClientId() || !getClientSecret()) {
    error(`Run "${CONNECTOR_NAME} auth setup <clientId> <clientSecret>" first`);
    process.exit(1);
  }
  const authUrl = getAuthUrl();
  console.log('\nOpen this URL in your browser:\n');
  console.log(chalk.cyan(authUrl));
  console.log('\nWaiting for authentication...\n');
  try {
    const open = await import('open');
    await open.default(authUrl);
  } catch {
    // manual open
  }
  const result = await startCallbackServer();
  if (result.success && result.tokens) {
    saveTokens(result.tokens);
    success('Authentication successful');
  } else {
    error(result.error || 'Authentication failed');
    process.exit(1);
  }
});

authCmd.command('status').action(() => {
  if (isAuthenticated()) {
    success('Authenticated');
    info(`Advertiser ID: ${getAdvertiserId() || 'not set'}`);
  } else {
    info('Not authenticated');
  }
});

authCmd.command('logout').action(() => {
  clearTokens();
  success('Logged out');
});

// Advertisers
const advertisersCmd = program.command('advertisers').description('Manage advertiser accounts');

advertisersCmd.command('list').option('--app-id <id>', 'TikTok app ID').action(async (opts) => {
  try {
    const client = await getClient();
    const result = await client.advertisers.list({ app_id: opts.appId });
    print(result, getFormat(advertisersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

advertisersCmd.command('get <id>').action(async (id: string) => {
  try {
    const client = await getClient();
    print(await client.advertisers.get(id), getFormat(advertisersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Campaigns
const campaignsCmd = program.command('campaigns').description('Manage campaigns');

campaignsCmd.command('list').option('--status <status>', 'Filter by status').option('--page <n>', 'Page number').option('--page-size <n>', 'Page size').action(async (opts) => {
  try {
    const client = await getClient();
    const advertiserId = resolveAdvertiser(client);
    const result = await client.campaigns.list({
      advertiser_id: advertiserId,
      filtering: opts.status ? { status: opts.status.toUpperCase() } : undefined,
      page: opts.page ? Number(opts.page) : undefined,
      page_size: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(result, getFormat(campaignsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

campaignsCmd.command('get <id>').action(async (id: string) => {
  try {
    const client = await getClient();
    print(await client.campaigns.get(resolveAdvertiser(client), id), getFormat(campaignsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

campaignsCmd
  .command('create')
  .requiredOption('--name <name>', 'Campaign name')
  .requiredOption('--objective <objective>', 'Objective type')
  .requiredOption('--budget-mode <mode>', 'Budget mode')
  .option('--budget <amount>', 'Budget amount')
  .option('--body <json>', 'Additional JSON fields')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const body = parseJsonOption(opts.body) || {};
      const result = await client.campaigns.create({
        advertiser_id: resolveAdvertiser(client),
        campaign_name: opts.name,
        objective_type: opts.objective,
        budget_mode: opts.budgetMode,
        budget: opts.budget ? Number(opts.budget) : undefined,
        ...body,
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('update <id>')
  .option('--body <json>', 'Update payload JSON')
  .action(async (id: string, opts) => {
    try {
      const client = await getClient();
      const body = parseJsonOption(opts.body) || {};
      const result = await client.campaigns.update({
        advertiser_id: resolveAdvertiser(client),
        campaign_id: id,
        ...body,
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd.command('delete <ids...>').action(async (ids: string[]) => {
  try {
    const client = await getClient();
    print(await client.campaigns.delete(resolveAdvertiser(client), ids), getFormat(campaignsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Ad groups
const adgroupsCmd = program.command('adgroups').description('Manage ad groups');

adgroupsCmd.command('list').option('--campaign <id>', 'Filter by campaign').option('--page <n>', 'Page').option('--page-size <n>', 'Page size').action(async (opts) => {
  try {
    const client = await getClient();
    const result = await client.adGroups.list({
      advertiser_id: resolveAdvertiser(client),
      filtering: opts.campaign ? { campaign_ids: [opts.campaign] } : undefined,
      page: opts.page ? Number(opts.page) : undefined,
      page_size: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(result, getFormat(adgroupsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adgroupsCmd.command('get <id>').action(async (id: string) => {
  try {
    const client = await getClient();
    print(await client.adGroups.get(resolveAdvertiser(client), id), getFormat(adgroupsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adgroupsCmd.command('create').option('--body <json>', 'Create payload JSON', '{}').action(async (opts) => {
  try {
    const client = await getClient();
    const body = parseJsonOption(opts.body) || {};
    const result = await client.adGroups.create({
      advertiser_id: resolveAdvertiser(client),
      ...body,
    });
    print(result, getFormat(adgroupsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adgroupsCmd.command('update <id>').option('--body <json>', 'Update payload JSON', '{}').action(async (id: string, opts) => {
  try {
    const client = await getClient();
    const body = parseJsonOption(opts.body) || {};
    const result = await client.adGroups.update({
      advertiser_id: resolveAdvertiser(client),
      adgroup_id: id,
      ...body,
    });
    print(result, getFormat(adgroupsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adgroupsCmd.command('delete <ids...>').action(async (ids: string[]) => {
  try {
    const client = await getClient();
    print(await client.adGroups.delete(resolveAdvertiser(client), ids), getFormat(adgroupsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Ads
const adsCmd = program.command('ads').description('Manage ads');

adsCmd.command('list').option('--adgroup <id>', 'Filter by ad group').option('--page <n>', 'Page').option('--page-size <n>', 'Page size').action(async (opts) => {
  try {
    const client = await getClient();
    const result = await client.ads.list({
      advertiser_id: resolveAdvertiser(client),
      filtering: opts.adgroup ? { adgroup_ids: [opts.adgroup] } : undefined,
      page: opts.page ? Number(opts.page) : undefined,
      page_size: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(result, getFormat(adsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adsCmd.command('get <id>').action(async (id: string) => {
  try {
    const client = await getClient();
    print(await client.ads.get(resolveAdvertiser(client), id), getFormat(adsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adsCmd.command('create').option('--body <json>', 'Create payload JSON', '{}').action(async (opts) => {
  try {
    const client = await getClient();
    const body = parseJsonOption(opts.body) || {};
    const result = await client.ads.create({
      advertiser_id: resolveAdvertiser(client),
      ...body,
    });
    print(result, getFormat(adsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adsCmd.command('update <id>').option('--body <json>', 'Update payload JSON', '{}').action(async (id: string, opts) => {
  try {
    const client = await getClient();
    const body = parseJsonOption(opts.body) || {};
    const result = await client.ads.update({
      advertiser_id: resolveAdvertiser(client),
      ad_id: id,
      ...body,
    });
    print(result, getFormat(adsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

adsCmd.command('delete <ids...>').action(async (ids: string[]) => {
  try {
    const client = await getClient();
    print(await client.ads.delete(resolveAdvertiser(client), ids), getFormat(adsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Reports
const reportsCmd = program.command('reports').description('Integrated reporting');

reportsCmd
  .command('integrated')
  .requiredOption('--start <date>', 'Start date YYYY-MM-DD')
  .requiredOption('--end <date>', 'End date YYYY-MM-DD')
  .requiredOption('--metrics <csv>', 'Comma-separated metrics')
  .option('--data-level <level>', 'Data level', 'AUCTION_CAMPAIGN')
  .option('--dimensions <csv>', 'Comma-separated dimensions', 'stat_time_day')
  .option('--report-type <type>', 'Report type', 'BASIC')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const result = await client.reports.getIntegrated({
        advertiser_id: resolveAdvertiser(client),
        report_type: opts.reportType,
        data_level: opts.dataLevel,
        dimensions: opts.dimensions.split(',').map((s: string) => s.trim()),
        metrics: opts.metrics.split(',').map((s: string) => s.trim()),
        start_date: opts.start,
        end_date: opts.end,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Pixels
const pixelsCmd = program.command('pixels').description('Manage pixels');

pixelsCmd.command('list').option('--page <n>', 'Page').option('--page-size <n>', 'Page size').action(async (opts) => {
  try {
    const client = await getClient();
    const result = await client.pixels.list(resolveAdvertiser(client), {
      page: opts.page ? Number(opts.page) : undefined,
      page_size: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(result, getFormat(pixelsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Files
const filesCmd = program.command('files').description('Manage creative files');

const videosCmd = filesCmd.command('videos').description('Video assets');

videosCmd.command('list').option('--page <n>', 'Page').option('--page-size <n>', 'Page size').action(async (opts) => {
  try {
    const client = await getClient();
    const result = await client.files.listVideos(resolveAdvertiser(client), {
      page: opts.page ? Number(opts.page) : undefined,
      page_size: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(result, getFormat(videosCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

videosCmd
  .command('upload')
  .requiredOption('--url <url>', 'Video URL')
  .option('--name <name>', 'File name')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const result = await client.files.uploadVideo({
        advertiser_id: resolveAdvertiser(client),
        video_url: opts.url,
        file_name: opts.name,
      });
      print(result, getFormat(videosCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const imagesCmd = filesCmd.command('images').description('Image assets');

imagesCmd.command('list').option('--page <n>', 'Page').option('--page-size <n>', 'Page size').action(async (opts) => {
  try {
    const client = await getClient();
    const result = await client.files.listImages(resolveAdvertiser(client), {
      page: opts.page ? Number(opts.page) : undefined,
      page_size: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(result, getFormat(imagesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

imagesCmd
  .command('upload')
  .requiredOption('--url <url>', 'Image URL')
  .option('--name <name>', 'File name')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const result = await client.files.uploadImage({
        advertiser_id: resolveAdvertiser(client),
        image_url: opts.url,
        file_name: opts.name,
      });
      print(result, getFormat(imagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw
program
  .command('raw')
  .description('Raw API request')
  .requiredOption('--path <path>', 'API path e.g. /campaign/get/')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--params <json>', 'Query params JSON')
  .option('--body <json>', 'Request body JSON')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const result = await client.rawRequest(opts.path, {
        method: opts.method,
        params: parseParamsOption(opts.params),
        body: parseJsonOption(opts.body),
      });
      print(result, program.opts().format as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
