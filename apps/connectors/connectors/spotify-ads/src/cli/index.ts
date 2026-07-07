#!/usr/bin/env bun
import { program } from 'commander';
import chalk from 'chalk';
import { SpotifyAds } from '../api';
import {
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  setProfileOverride,
  setCredentials,
  getClientId,
  getClientSecret,
  isAuthenticated,
  loadTokens,
  saveTokens,
  clearTokens,
  getAdAccountId,
  setAdAccountId,
  getBusinessId,
  setBusinessId,
  getBaseUrl,
  getConfigDir,
} from '../utils/config';
import {
  getAuthUrl,
  startCallbackServer,
  getValidAccessToken,
  refreshAccessToken,
} from '../utils/auth';
import { success, error, info, print } from '../utils/output';
import type { OutputFormat } from '../utils/output';

async function getClient(): Promise<SpotifyAds> {
  const accessToken = await getValidAccessToken();
  return new SpotifyAds({
    accessToken,
    baseUrl: getBaseUrl(),
  });
}

function resolveAdAccountId(flag?: string): string {
  const adAccountId = flag || getAdAccountId();
  if (!adAccountId) {
    throw new Error('Ad account ID required. Use --ad-account or "connect-spotify-ads config set-ad-account <id>".');
  }
  return adAccountId;
}

function getFormat(opts: { json?: boolean }): OutputFormat {
  return opts.json ? 'json' : 'pretty';
}

program
  .name('connect-spotify-ads')
  .description('Spotify Ads API v3 connector CLI')
  .version('0.0.1')
  .option('-p, --profile <profile>', 'Use specific profile')
  .option('--json', 'Output as JSON')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist.`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

const auth = program.command('auth').description('OAuth authentication');

auth
  .command('setup')
  .description('Save OAuth client credentials')
  .argument('<clientId>', 'Spotify app client ID')
  .argument('<clientSecret>', 'Spotify app client secret')
  .action((clientId: string, clientSecret: string) => {
    setCredentials(clientId, clientSecret);
    success('OAuth credentials saved');
    info('Run: connect-spotify-ads auth login');
  });

auth
  .command('login')
  .description('Authenticate via OAuth authorization code flow')
  .action(async () => {
    if (!getClientId() || !getClientSecret()) {
      error('Run "connect-spotify-ads auth setup <clientId> <clientSecret>" first.');
      process.exit(1);
    }

    info('Starting OAuth flow...');
    const authUrl = getAuthUrl();
    console.log('\nOpen this URL in your browser:\n');
    console.log(chalk.cyan(authUrl));
    console.log('\nWaiting for callback...\n');

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
      error(`Authentication failed: ${result.error}`);
      process.exit(1);
    }
  });

auth
  .command('refresh')
  .description('Refresh the access token')
  .action(async () => {
    try {
      const tokens = await refreshAccessToken();
      success(`Token refreshed; expires ${new Date(tokens.expiresAt).toLocaleString()}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

auth
  .command('logout')
  .description('Clear stored tokens')
  .action(() => {
    clearTokens();
    success(`Logged out from profile "${getCurrentProfile()}"`);
  });

auth
  .command('status')
  .description('Show authentication status')
  .action(() => {
    const tokens = loadTokens();
    console.log(`
Profile: ${chalk.bold(getCurrentProfile())}
Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}
${tokens ? `Token expires: ${new Date(tokens.expiresAt).toLocaleString()}` : ''}
Business ID: ${getBusinessId() || chalk.yellow('Not set')}
Ad Account ID: ${getAdAccountId() || chalk.yellow('Not set')}
Config dir: ${getConfigDir()}
`);
  });

const profile = program.command('profile').description('Manage profiles');

profile
  .command('list')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found.');
      return;
    }
    for (const name of profiles) {
      console.log(`  ${name}${name === current ? chalk.green(' (active)') : ''}`);
    }
  });

profile
  .command('use <name>')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profile
  .command('create <name>')
  .action((name: string) => {
    if (!createProfile(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    success(`Created profile: ${name}`);
  });

profile
  .command('delete <name>')
  .action((name: string) => {
    if (!deleteProfile(name)) {
      error(`Could not delete profile "${name}"`);
      process.exit(1);
    }
    success(`Deleted profile: ${name}`);
  });

const config = program.command('config').description('Profile configuration');

config
  .command('set-ad-account')
  .argument('<adAccountId>', 'Default ad account UUID')
  .action((adAccountId: string) => {
    setAdAccountId(adAccountId);
    success(`Default ad account set to ${adAccountId}`);
  });

config
  .command('set-business')
  .argument('<businessId>', 'Default business UUID')
  .action((businessId: string) => {
    setBusinessId(businessId);
    success(`Default business set to ${businessId}`);
  });

config
  .command('show')
  .action((_, cmd) => {
    print({
      profile: getCurrentProfile(),
      businessId: getBusinessId(),
      adAccountId: getAdAccountId(),
      baseUrl: getBaseUrl(),
      clientId: getClientId() ? `${getClientId()!.slice(0, 6)}...` : undefined,
    }, getFormat(cmd.parent?.parent?.opts() || {}));
  });

const businesses = program.command('businesses').description('Business resources');

businesses
  .command('list')
  .action(async (_, cmd) => {
    const client = await getClient();
    const result = await client.businesses.list();
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

businesses
  .command('get')
  .argument('<businessId>', 'Business UUID')
  .action(async (businessId: string, _, cmd) => {
    const client = await getClient();
    const result = await client.businesses.get(businessId);
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

const adAccounts = program.command('ad-accounts').description('Ad account resources');

adAccounts
  .command('list')
  .argument('[businessId]', 'Business UUID (defaults to profile business)')
  .action(async (businessId: string | undefined, _, cmd) => {
    const resolvedBusinessId = businessId || getBusinessId();
    if (!resolvedBusinessId) {
      error('Business ID required. Pass argument or set via config set-business.');
      process.exit(1);
    }
    const client = await getClient();
    const result = await client.adAccounts.listByBusiness(resolvedBusinessId);
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

adAccounts
  .command('get')
  .argument('<adAccountId>', 'Ad account UUID')
  .action(async (adAccountId: string, _, cmd) => {
    const client = await getClient();
    const result = await client.adAccounts.get(adAccountId);
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

const campaigns = program.command('campaigns').description('Campaign resources');

campaigns
  .command('list')
  .option('--ad-account <id>', 'Ad account UUID')
  .action(async (opts, cmd) => {
    const client = await getClient();
    const result = await client.campaigns.list(resolveAdAccountId(opts.adAccount));
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

campaigns
  .command('get')
  .argument('<campaignId>', 'Campaign UUID')
  .option('--ad-account <id>', 'Ad account UUID')
  .action(async (campaignId: string, opts, cmd) => {
    const client = await getClient();
    const result = await client.campaigns.get(resolveAdAccountId(opts.adAccount), campaignId);
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

campaigns
  .command('create')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .option('--delivery-goal-group <group>', 'Delivery goal group (e.g. AWARENESS)')
  .option('--ad-account <id>', 'Ad account UUID')
  .action(async (opts, cmd) => {
    const client = await getClient();
    const result = await client.campaigns.create(resolveAdAccountId(opts.adAccount), {
      name: opts.name,
      delivery_goal_group: opts.deliveryGoalGroup,
    });
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

const adSets = program.command('ad-sets').description('Ad set resources');

adSets
  .command('list')
  .option('--ad-account <id>', 'Ad account UUID')
  .action(async (opts, cmd) => {
    const client = await getClient();
    const result = await client.adSets.list(resolveAdAccountId(opts.adAccount));
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

adSets
  .command('get')
  .argument('<adSetId>', 'Ad set UUID')
  .option('--ad-account <id>', 'Ad account UUID')
  .action(async (adSetId: string, opts, cmd) => {
    const client = await getClient();
    const result = await client.adSets.get(resolveAdAccountId(opts.adAccount), adSetId);
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

const ads = program.command('ads').description('Ad resources');

ads
  .command('list')
  .option('--ad-account <id>', 'Ad account UUID')
  .action(async (opts, cmd) => {
    const client = await getClient();
    const result = await client.ads.list(resolveAdAccountId(opts.adAccount));
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

ads
  .command('get')
  .argument('<adId>', 'Ad UUID')
  .option('--ad-account <id>', 'Ad account UUID')
  .action(async (adId: string, opts, cmd) => {
    const client = await getClient();
    const result = await client.ads.get(resolveAdAccountId(opts.adAccount), adId);
    print(result, getFormat(cmd.parent?.parent?.opts() || {}));
  });

program
  .command('raw')
  .description('Raw API request escape hatch')
  .requiredOption('-m, --method <method>', 'HTTP method')
  .requiredOption('-p, --path <path>', 'API path (relative to v3 base)')
  .option('-b, --body <json>', 'JSON request body')
  .action(async (opts, cmd) => {
    const client = await getClient();
    const method = opts.method.toUpperCase();
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      error('Method must be GET, POST, PATCH, or DELETE');
      process.exit(1);
    }
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const result = await client.raw(method as 'GET' | 'POST' | 'PATCH' | 'DELETE', opts.path, { body });
    print(result, getFormat(cmd.parent?.opts() || {}));
  });

program.parseAsync(process.argv).catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
