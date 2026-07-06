#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TikTokEventsApi, tiktokEventsApiCommandSpecs } from '../api';
import { hashUserData } from '../api/events';
import type { JsonRecord, TikTokTrackOptions } from '../types';
import {
  CONNECTOR_NAME,
  getAccessToken,
  setAccessToken,
  getAdvertiserId,
  setAdvertiserId,
  getPixelCode,
  setPixelCode,
  getAppId,
  setAppId,
  getOfflineEventSetId,
  setOfflineEventSetId,
  getCrmEventSetId,
  setCrmEventSetId,
  getTestEventCode,
  setTestEventCode,
  getApiBaseUrl,
  setApiBaseUrl,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TikTok Events API 2.0 connector CLI - server-side conversion events, pixels, offline and CRM event sets')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setVerboseMode(true);
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) process.env.TIKTOK_ACCESS_TOKEN = opts.token;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseDataOption(value?: string): JsonRecord {
  if (!value) return {};
  try {
    return JSON.parse(value) as JsonRecord;
  } catch {
    error('Invalid JSON passed to --data');
    process.exit(1);
  }
}

function getClient(): TikTokEventsApi {
  try {
    return TikTokEventsApi.fromEnv();
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function runApi<T>(cmd: Command, fn: (client: TikTokEventsApi) => Promise<T>): Promise<void> {
  try {
    const result = await fn(getClient());
    print(result, getFormat(cmd));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function addJsonDataOption(cmd: Command): Command {
  return cmd.option('-d, --data <json>', 'Command payload as JSON object');
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'Access token')
  .option('--advertiser <id>', 'Advertiser ID')
  .option('--pixel <code>', 'Pixel code')
  .option('--app-id <id>', 'TikTok app ID')
  .option('--offline-set <id>', 'Offline event set ID')
  .option('--crm-set <id>', 'CRM event set ID')
  .option('--test-code <code>', 'Test event code')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      accessToken: opts.token,
      advertiserId: opts.advertiser,
      pixelCode: opts.pixel,
      appId: opts.appId,
      offlineEventSetId: opts.offlineSet,
      crmEventSetId: opts.crmSet,
      testEventCode: opts.testCode,
      baseUrl: opts.baseUrl,
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
    if (deleteProfile(name)) success(`Profile "${name}" deleted`);
    else {
      error(`Profile "${name}" not found or cannot be deleted`);
      process.exit(1);
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profile = name || getCurrentProfile();
    const config = loadProfile(profile);
    print({ profile, ...config }, 'pretty');
  });

// Config commands
const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('set-token <token>')
  .description('Set TikTok access token')
  .action((token: string) => {
    setAccessToken(token);
    success('Access token saved');
  });

configCmd
  .command('set-advertiser <id>')
  .description('Set default advertiser ID')
  .action((id: string) => {
    setAdvertiserId(id);
    success('Advertiser ID saved');
  });

configCmd
  .command('set-pixel <code>')
  .description('Set default pixel code')
  .action((code: string) => {
    setPixelCode(code);
    success('Pixel code saved');
  });

configCmd
  .command('set-app-id <id>')
  .description('Set default TikTok app ID')
  .action((id: string) => {
    setAppId(id);
    success('App ID saved');
  });

configCmd
  .command('set-offline-set <id>')
  .description('Set default offline event set ID')
  .action((id: string) => {
    setOfflineEventSetId(id);
    success('Offline event set ID saved');
  });

configCmd
  .command('set-crm-set <id>')
  .description('Set default CRM event set ID')
  .action((id: string) => {
    setCrmEventSetId(id);
    success('CRM event set ID saved');
  });

configCmd
  .command('set-test-code <code>')
  .description('Set default test event code')
  .action((code: string) => {
    setTestEventCode(code);
    success('Test event code saved');
  });

configCmd
  .command('set-base-url <url>')
  .description('Set TikTok Business API base URL')
  .action((url: string) => {
    setApiBaseUrl(url);
    success('API base URL saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    print(
      {
        profile: getCurrentProfile(),
        configDir: getConfigDir(),
        baseDir: getBaseConfigDir(),
        accessToken: getAccessToken() ? '***configured***' : undefined,
        advertiserId: getAdvertiserId(),
        pixelCode: getPixelCode(),
        appId: getAppId(),
        offlineEventSetId: getOfflineEventSetId(),
        crmEventSetId: getCrmEventSetId(),
        testEventCode: getTestEventCode(),
        baseUrl: getApiBaseUrl(),
      },
      'pretty',
    );
  });

configCmd
  .command('clear')
  .description('Clear profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// Track / event commands from command specs
const trackMethodMap: Record<string, keyof TikTokEventsApi> = {
  trackEvent: 'trackEvent',
  trackEvents: 'trackEvents',
  trackWebEvent: 'trackWebEvent',
  trackAppEvent: 'trackAppEvent',
  trackOfflineEvent: 'trackOfflineEvent',
  trackCrmEvent: 'trackCrmEvent',
  trackTestEvent: 'trackTestEvent',
  trackAddPaymentInfo: 'trackAddPaymentInfo',
  trackAddToCart: 'trackAddToCart',
  trackAddToWishlist: 'trackAddToWishlist',
  trackApplicationApproval: 'trackApplicationApproval',
  trackCompleteRegistration: 'trackCompleteRegistration',
  trackContact: 'trackContact',
  trackCustomizeProduct: 'trackCustomizeProduct',
  trackDownload: 'trackDownload',
  trackFindLocation: 'trackFindLocation',
  trackInitiateCheckout: 'trackInitiateCheckout',
  trackLead: 'trackLead',
  trackPurchase: 'trackPurchase',
  trackSchedule: 'trackSchedule',
  trackSearch: 'trackSearch',
  trackStartTrial: 'trackStartTrial',
  trackSubmitApplication: 'trackSubmitApplication',
  trackSubscribe: 'trackSubscribe',
  trackViewContent: 'trackViewContent',
  hashUserData: 'hashUserData',
  listPixels: 'listPixels',
  createPixel: 'createPixel',
  updatePixel: 'updatePixel',
  createPixelEvents: 'createPixelEvents',
  updatePixelEvent: 'updatePixelEvent',
  deletePixelEvent: 'deletePixelEvent',
  getPixelEventStats: 'getPixelEventStats',
  listOfflineEventSets: 'listOfflineEventSets',
  createOfflineEventSet: 'createOfflineEventSet',
  updateOfflineEventSet: 'updateOfflineEventSet',
  deleteOfflineEventSet: 'deleteOfflineEventSet',
  listCrmEventSets: 'listCrmEventSets',
  createCrmEventSet: 'createCrmEventSet',
};

for (const [apiMethod, cliName, description] of tiktokEventsApiCommandSpecs) {
  if (cliName === 'raw-request') continue;
  if (!(apiMethod in trackMethodMap)) continue;

  addJsonDataOption(
    program
      .command(cliName)
      .description(description)
      .action(async function (this: Command, opts: { data?: string }) {
        const payload = parseDataOption(opts.data);
        if (apiMethod === 'hashUserData') {
          print(hashUserData((payload.user as JsonRecord | undefined) ?? {}), getFormat(this));
          return;
        }
        await runApi(this, async (client) => {
          const method = client[trackMethodMap[apiMethod] as keyof TikTokEventsApi] as (
            options: TikTokTrackOptions | JsonRecord,
          ) => Promise<unknown>;
          return method.call(client, payload);
        });
      }),
  );
}

addJsonDataOption(
  program
    .command('raw-request')
    .description('Call a TikTok Business API endpoint on the configured origin')
    .option('-m, --method <method>', 'HTTP method', 'GET')
    .option('--path <path>', 'API path or absolute URL on configured origin')
    .option('--query <json>', 'Query parameters as JSON')
    .option('--body <json>', 'Request body as JSON')
    .action(async function (
      this: Command,
      opts: { data?: string; method?: string; path?: string; query?: string; body?: string },
    ) {
      const payload = parseDataOption(opts.data);
      const path = opts.path ?? (payload.path as string | undefined);
      if (!path) {
        error('--path or data.path is required');
        process.exit(1);
      }
      await runApi(this, (client) =>
        client.rawRequest({
          method: opts.method ?? (payload.method as string | undefined) ?? 'GET',
          path,
          query: opts.query ? parseDataOption(opts.query) : (payload.query as JsonRecord | undefined),
          body: opts.body ? parseDataOption(opts.body) : (payload.body as JsonRecord | undefined),
        }),
      );
    }),
);

program.parseAsync(process.argv).catch((err) => {
  debug('Unhandled CLI error', err);
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
