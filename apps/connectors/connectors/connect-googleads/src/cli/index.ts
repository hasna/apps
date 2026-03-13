#!/usr/bin/env bun
import { program } from 'commander';
import chalk from 'chalk';
import { GoogleAds } from '../api';
import {
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  setProfileOverride,
  setCredentials,
  setDeveloperToken,
  getDeveloperToken,
  getClientId,
  getClientSecret,
  isAuthenticated,
  loadTokens,
  saveTokens,
  clearTokens,
  getCustomerId,
  setCustomerId,
  getLoginCustomerId,
  setLoginCustomerId,
  getAccountName,
  setAccountName,
  getConfigDir,
} from '../utils/config';
import {
  getAuthUrl,
  startCallbackServer,
  getValidAccessToken,
} from '../utils/auth';
import {
  success,
  error,
  info,
  print,
  formatMicros,
  formatNumber,
  formatPercent,
  formatCustomerId,
} from '../utils/output';
import type { KeywordMatchType, CampaignStatus, AdGroupStatus, AdStatus } from '../types';

// ============================================
// Helper Functions
// ============================================

async function getClient(customerId?: string): Promise<GoogleAds> {
  const accessToken = await getValidAccessToken();
  const developerToken = getDeveloperToken();
  const resolvedCustomerId = customerId || getCustomerId();
  const loginCustomerId = getLoginCustomerId();

  if (!developerToken) {
    throw new Error('Developer token not configured. Run "connect-googleads config set-developer-token <token>"');
  }

  return new GoogleAds({
    accessToken,
    developerToken,
    customerId: resolvedCustomerId,
    loginCustomerId,
  });
}

function formatCampaignRow(row: any): void {
  const campaign = row.campaign || {};
  const metrics = row.metrics || {};

  console.log(`
${chalk.bold(campaign.name || 'Unknown')} (${campaign.id || 'N/A'})
  Status: ${campaign.status || 'N/A'}
  Channel: ${campaign.advertisingChannelType || 'N/A'}
  Bidding: ${campaign.biddingStrategyType || 'N/A'}
  Impressions: ${formatNumber(metrics.impressions)}
  Clicks: ${formatNumber(metrics.clicks)}
  Cost: ${formatMicros(metrics.costMicros)}
  Conversions: ${metrics.conversions?.toFixed(2) || '0'}
  CTR: ${formatPercent(metrics.ctr)}
  Avg CPC: ${formatMicros(metrics.averageCpc ? metrics.averageCpc * 1000000 : 0)}
`);
}

function formatAdGroupRow(row: any): void {
  const adGroup = row.adGroup || {};
  const campaign = row.campaign || {};
  const metrics = row.metrics || {};

  console.log(`
${chalk.bold(adGroup.name || 'Unknown')} (${adGroup.id || 'N/A'})
  Campaign: ${campaign.name || 'N/A'}
  Status: ${adGroup.status || 'N/A'}
  Type: ${adGroup.type || 'N/A'}
  CPC Bid: ${formatMicros(adGroup.cpcBidMicros)}
  Impressions: ${formatNumber(metrics.impressions)}
  Clicks: ${formatNumber(metrics.clicks)}
  Cost: ${formatMicros(metrics.costMicros)}
`);
}

function formatKeywordRow(row: any): void {
  const criterion = row.adGroupCriterion || {};
  const keyword = criterion.keyword || {};
  const adGroup = row.adGroup || {};
  const metrics = row.metrics || {};

  console.log(`
${chalk.bold(keyword.text || 'Unknown')} [${keyword.matchType || 'N/A'}]
  Ad Group: ${adGroup.name || 'N/A'} (${adGroup.id || 'N/A'})
  Status: ${criterion.status || 'N/A'}
  Quality Score: ${criterion.qualityInfo?.qualityScore || 'N/A'}
  CPC Bid: ${formatMicros(criterion.cpcBidMicros)}
  Impressions: ${formatNumber(metrics.impressions)}
  Clicks: ${formatNumber(metrics.clicks)}
  Cost: ${formatMicros(metrics.costMicros)}
  CTR: ${formatPercent(metrics.ctr)}
`);
}

// ============================================
// CLI Setup
// ============================================

program
  .name('connect-googleads')
  .description('Google Ads API connector CLI')
  .version('0.1.0')
  .option('-p, --profile <profile>', 'Use specific profile')
  .option('-c, --customer <customerId>', 'Use specific customer ID')
  .option('--json', 'Output as JSON')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth Commands
// ============================================

const auth = program.command('auth').description('Authentication commands');

auth
  .command('setup')
  .description('Setup OAuth credentials')
  .argument('<clientId>', 'OAuth2 Client ID')
  .argument('<clientSecret>', 'OAuth2 Client Secret')
  .action((clientId: string, clientSecret: string) => {
    setCredentials(clientId, clientSecret);
    success(`OAuth credentials saved for profile "${getCurrentProfile()}"`);
    info('Now run: connect-googleads auth login');
  });

auth
  .command('login')
  .description('Authenticate with Google Ads')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error('OAuth credentials not configured. Run "connect-googleads auth setup <clientId> <clientSecret>" first.');
      process.exit(1);
    }

    info('Starting OAuth flow...');
    const authUrl = getAuthUrl();

    console.log('\nOpen this URL in your browser:\n');
    console.log(chalk.cyan(authUrl));
    console.log('\nWaiting for authentication...\n');

    // Try to open browser automatically
    try {
      const open = await import('open');
      await open.default(authUrl);
    } catch {
      // Manual open required
    }

    const result = await startCallbackServer();

    if (result.success && result.tokens) {
      saveTokens(result.tokens);
      success('Authentication successful!');

      // Try to get account info
      try {
        const client = await getClient();
        const accessible = await client.listAccessibleCustomers();
        if (accessible.resourceNames?.length > 0) {
          const firstCustomer = accessible.resourceNames[0].split('/')[1];
          info(`Found ${accessible.resourceNames.length} accessible customer(s)`);
          info(`First customer ID: ${formatCustomerId(firstCustomer)}`);
          info('Run: connect-googleads config set-customer <customerId> to set your customer ID');
        }
      } catch (err) {
        info('Run: connect-googleads config set-customer <customerId> to set your customer ID');
      }
    } else {
      error(`Authentication failed: ${result.error}`);
      process.exit(1);
    }
  });

auth
  .command('logout')
  .description('Clear authentication tokens')
  .action(() => {
    clearTokens();
    success(`Logged out from profile "${getCurrentProfile()}"`);
  });

auth
  .command('status')
  .description('Check authentication status')
  .action(() => {
    const profile = getCurrentProfile();
    const authenticated = isAuthenticated();
    const tokens = loadTokens();
    const customerId = getCustomerId();
    const developerToken = getDeveloperToken();

    console.log(`
Profile: ${chalk.bold(profile)}
Authenticated: ${authenticated ? chalk.green('Yes') : chalk.red('No')}
${tokens ? `Token expires: ${new Date(tokens.expiresAt).toLocaleString()}` : ''}
Customer ID: ${customerId ? formatCustomerId(customerId) : chalk.yellow('Not set')}
Developer Token: ${developerToken ? chalk.green('Set') : chalk.red('Not set')}
`);
  });

// ============================================
// Config Commands
// ============================================

const config = program.command('config').description('Configuration commands');

config
  .command('set-customer')
  .description('Set default customer ID')
  .argument('<customerId>', 'Google Ads customer ID')
  .action((customerId: string) => {
    setCustomerId(customerId.replace(/-/g, ''));
    success(`Customer ID set to ${formatCustomerId(customerId)}`);
  });

config
  .command('set-login-customer')
  .description('Set login customer ID (for manager accounts)')
  .argument('<customerId>', 'Login customer ID')
  .action((customerId: string) => {
    setLoginCustomerId(customerId.replace(/-/g, ''));
    success(`Login customer ID set to ${formatCustomerId(customerId)}`);
  });

config
  .command('set-developer-token')
  .description('Set developer token')
  .argument('<token>', 'Google Ads API developer token')
  .action((token: string) => {
    setDeveloperToken(token);
    success('Developer token saved');
  });

config
  .command('show')
  .description('Show current configuration')
  .action(() => {
    console.log(`
Profile: ${chalk.bold(getCurrentProfile())}
Config Directory: ${getConfigDir()}
Customer ID: ${getCustomerId() ? formatCustomerId(getCustomerId()!) : chalk.yellow('Not set')}
Login Customer ID: ${getLoginCustomerId() ? formatCustomerId(getLoginCustomerId()!) : 'Not set'}
Developer Token: ${getDeveloperToken() ? chalk.green('Set') : chalk.red('Not set')}
Client ID: ${getClientId() ? chalk.green('Set') : chalk.red('Not set')}
Client Secret: ${getClientSecret() ? chalk.green('Set') : chalk.red('Not set')}
`);
  });

// ============================================
// Profile Commands
// ============================================

const profile = program.command('profile').description('Profile management');

profile
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log('No profiles found');
      return;
    }

    console.log('\nProfiles:');
    for (const p of profiles) {
      const marker = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
    }
    console.log('');
  });

profile
  .command('use')
  .description('Switch to a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile "${name}"`);
  });

profile
  .command('create')
  .description('Create a new profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name);
    success(`Created profile "${name}"`);
    info(`Run: connect-googleads profile use ${name}`);
  });

profile
  .command('delete')
  .description('Delete a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    if (deleteProfile(name)) {
      success(`Deleted profile "${name}"`);
    } else {
      error(`Could not delete profile "${name}"`);
    }
  });

// ============================================
// Account Commands
// ============================================

const account = program.command('account').description('Account commands');

account
  .command('info')
  .description('Get account information')
  .action(async () => {
    try {
      const client = await getClient();
      const response = await client.getCustomer();

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      const customer = response.results?.[0]?.customer || {};
      console.log(`
${chalk.bold('Account Information')}
ID: ${formatCustomerId(customer.id)}
Name: ${customer.descriptiveName || 'N/A'}
Currency: ${customer.currencyCode || 'N/A'}
Time Zone: ${customer.timeZone || 'N/A'}
Manager: ${customer.manager ? 'Yes' : 'No'}
Test Account: ${customer.testAccount ? 'Yes' : 'No'}
`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

account
  .command('customers')
  .description('List accessible customers')
  .action(async () => {
    try {
      const client = await getClient();
      const response = await client.listAccessibleCustomers();

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log('\nAccessible Customers:');
      for (const resourceName of response.resourceNames || []) {
        const id = resourceName.split('/')[1];
        console.log(`  ${formatCustomerId(id)}`);
      }
      console.log('');
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

account
  .command('clients')
  .description('List client accounts (for manager accounts)')
  .action(async () => {
    try {
      const client = await getClient();
      const response = await client.getCustomerClients();

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log('\nClient Accounts:');
      for (const row of response.results || []) {
        const cc = row.customerClient || {};
        console.log(`  ${formatCustomerId(cc.id)} - ${cc.descriptiveName || 'N/A'}`);
      }
      console.log('');
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

// ============================================
// Campaign Commands
// ============================================

const campaigns = program.command('campaigns').description('Campaign management');

campaigns
  .command('list')
  .description('List campaigns')
  .option('-s, --status <status>', 'Filter by status (ENABLED, PAUSED, REMOVED)')
  .option('-l, --limit <limit>', 'Limit results', parseInt)
  .action(async (options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.campaigns.list({
        status: options.status as CampaignStatus,
        limit: options.limit,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      if (!response.results?.length) {
        info('No campaigns found');
        return;
      }

      console.log(`\nFound ${response.results.length} campaign(s):`);
      for (const row of response.results) {
        formatCampaignRow(row);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

campaigns
  .command('get')
  .description('Get campaign details')
  .argument('<campaignId>', 'Campaign ID')
  .action(async (campaignId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.campaigns.get(campaignId);

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      if (response.results?.[0]) {
        formatCampaignRow(response.results[0]);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

campaigns
  .command('create')
  .description('Create a new campaign')
  .argument('<name>', 'Campaign name')
  .argument('<budgetMicros>', 'Daily budget in micros')
  .option('-t, --type <type>', 'Channel type (SEARCH, DISPLAY, etc.)', 'SEARCH')
  .option('-s, --status <status>', 'Initial status', 'PAUSED')
  .option('-b, --bidding <strategy>', 'Bidding strategy')
  .action(async (name: string, budgetMicros: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.campaigns.create(name, budgetMicros, options.type, {
        status: options.status,
        biddingStrategy: options.bidding,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      success(`Created campaign: ${response.results?.[0]?.resourceName}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

campaigns
  .command('pause')
  .description('Pause a campaign')
  .argument('<campaignId>', 'Campaign ID')
  .action(async (campaignId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.campaigns.pause(campaignId);
      success(`Paused campaign ${campaignId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

campaigns
  .command('enable')
  .description('Enable a campaign')
  .argument('<campaignId>', 'Campaign ID')
  .action(async (campaignId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.campaigns.enable(campaignId);
      success(`Enabled campaign ${campaignId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

campaigns
  .command('remove')
  .description('Remove a campaign')
  .argument('<campaignId>', 'Campaign ID')
  .action(async (campaignId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.campaigns.remove(campaignId);
      success(`Removed campaign ${campaignId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

campaigns
  .command('performance')
  .description('Get campaign performance report')
  .argument('<campaignId>', 'Campaign ID')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .action(async (campaignId: string, startDate: string, endDate: string) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.campaigns.getPerformance(campaignId, startDate, endDate);

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log(`\nPerformance for campaign ${campaignId}:`);
      for (const row of response.results || []) {
        const segments = row.segments || {};
        const metrics = row.metrics || {};
        console.log(`  ${segments.date}: ${formatNumber(metrics.clicks)} clicks, ${formatMicros(metrics.costMicros)}, ${metrics.conversions?.toFixed(2) || 0} conv`);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

// ============================================
// Ad Group Commands
// ============================================

const adGroups = program.command('adgroups').description('Ad group management');

adGroups
  .command('list')
  .description('List ad groups')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .option('-s, --status <status>', 'Filter by status')
  .option('-l, --limit <limit>', 'Limit results', parseInt)
  .action(async (options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.adGroups.list({
        campaignId: options.campaign,
        status: options.status as AdGroupStatus,
        limit: options.limit,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      if (!response.results?.length) {
        info('No ad groups found');
        return;
      }

      console.log(`\nFound ${response.results.length} ad group(s):`);
      for (const row of response.results) {
        formatAdGroupRow(row);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

adGroups
  .command('get')
  .description('Get ad group details')
  .argument('<adGroupId>', 'Ad group ID')
  .action(async (adGroupId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.adGroups.get(adGroupId);

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      if (response.results?.[0]) {
        formatAdGroupRow(response.results[0]);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

adGroups
  .command('create')
  .description('Create a new ad group')
  .argument('<campaignId>', 'Campaign ID')
  .argument('<name>', 'Ad group name')
  .option('-s, --status <status>', 'Initial status', 'PAUSED')
  .option('-t, --type <type>', 'Ad group type', 'SEARCH_STANDARD')
  .option('-b, --bid <bidMicros>', 'CPC bid in micros')
  .action(async (campaignId: string, name: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.adGroups.create(campaignId, name, {
        status: options.status,
        type: options.type,
        cpcBidMicros: options.bid,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      success(`Created ad group: ${response.results?.[0]?.resourceName}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

adGroups
  .command('pause')
  .description('Pause an ad group')
  .argument('<adGroupId>', 'Ad group ID')
  .action(async (adGroupId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.adGroups.pause(adGroupId);
      success(`Paused ad group ${adGroupId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

adGroups
  .command('enable')
  .description('Enable an ad group')
  .argument('<adGroupId>', 'Ad group ID')
  .action(async (adGroupId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.adGroups.enable(adGroupId);
      success(`Enabled ad group ${adGroupId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

adGroups
  .command('set-bid')
  .description('Set ad group bid')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<bidMicros>', 'CPC bid in micros')
  .action(async (adGroupId: string, bidMicros: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.adGroups.setBid(adGroupId, bidMicros);
      success(`Set bid for ad group ${adGroupId} to ${formatMicros(bidMicros)}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

// ============================================
// Ad Commands
// ============================================

const ads = program.command('ads').description('Ad management');

ads
  .command('list')
  .description('List ads')
  .option('-g, --adgroup <adGroupId>', 'Filter by ad group')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .option('-s, --status <status>', 'Filter by status')
  .option('-l, --limit <limit>', 'Limit results', parseInt)
  .action(async (options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.ads.list({
        adGroupId: options.adgroup,
        campaignId: options.campaign,
        status: options.status as AdStatus,
        limit: options.limit,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      if (!response.results?.length) {
        info('No ads found');
        return;
      }

      console.log(`\nFound ${response.results.length} ad(s):`);
      for (const row of response.results || []) {
        const ad = row.adGroupAd?.ad || {};
        const metrics = row.metrics || {};
        console.log(`
${chalk.bold(`Ad ${ad.id}`)} - ${row.adGroupAd?.status || 'N/A'}
  Type: ${ad.type || 'N/A'}
  Approval: ${row.adGroupAd?.policySummary?.approvalStatus || 'N/A'}
  Impressions: ${formatNumber(metrics.impressions)}
  Clicks: ${formatNumber(metrics.clicks)}
  Cost: ${formatMicros(metrics.costMicros)}
`);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

ads
  .command('create-rsa')
  .description('Create a responsive search ad')
  .argument('<adGroupId>', 'Ad group ID')
  .requiredOption('-h, --headlines <headlines...>', 'Headlines (3-15)')
  .requiredOption('-d, --descriptions <descriptions...>', 'Descriptions (2-4)')
  .requiredOption('-u, --url <finalUrl>', 'Final URL')
  .option('--path1 <path1>', 'Display URL path 1')
  .option('--path2 <path2>', 'Display URL path 2')
  .option('-s, --status <status>', 'Initial status', 'PAUSED')
  .action(async (adGroupId: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.ads.createResponsiveSearchAd(
        adGroupId,
        options.headlines,
        options.descriptions,
        [options.url],
        {
          path1: options.path1,
          path2: options.path2,
          status: options.status,
        }
      );

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      success(`Created responsive search ad: ${response.results?.[0]?.resourceName}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

ads
  .command('pause')
  .description('Pause an ad')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<adId>', 'Ad ID')
  .action(async (adGroupId: string, adId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.ads.pause(adGroupId, adId);
      success(`Paused ad ${adId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

ads
  .command('enable')
  .description('Enable an ad')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<adId>', 'Ad ID')
  .action(async (adGroupId: string, adId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.ads.enable(adGroupId, adId);
      success(`Enabled ad ${adId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

ads
  .command('remove')
  .description('Remove an ad')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<adId>', 'Ad ID')
  .action(async (adGroupId: string, adId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.ads.remove(adGroupId, adId);
      success(`Removed ad ${adId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

// ============================================
// Keyword Commands
// ============================================

const keywords = program.command('keywords').description('Keyword management');

keywords
  .command('list')
  .description('List keywords')
  .option('-g, --adgroup <adGroupId>', 'Filter by ad group')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .option('-s, --status <status>', 'Filter by status')
  .option('-l, --limit <limit>', 'Limit results', parseInt)
  .action(async (options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.keywords.list({
        adGroupId: options.adgroup,
        campaignId: options.campaign,
        status: options.status,
        limit: options.limit,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      if (!response.results?.length) {
        info('No keywords found');
        return;
      }

      console.log(`\nFound ${response.results.length} keyword(s):`);
      for (const row of response.results) {
        formatKeywordRow(row);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

keywords
  .command('add')
  .description('Add a keyword')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<keyword>', 'Keyword text')
  .option('-m, --match <type>', 'Match type (EXACT, PHRASE, BROAD)', 'BROAD')
  .option('-b, --bid <bidMicros>', 'CPC bid in micros')
  .option('-s, --status <status>', 'Initial status', 'ENABLED')
  .action(async (adGroupId: string, keyword: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.keywords.addKeyword(
        adGroupId,
        keyword,
        options.match as KeywordMatchType,
        {
          cpcBidMicros: options.bid,
          status: options.status,
        }
      );

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      success(`Added keyword: ${response.results?.[0]?.resourceName}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

keywords
  .command('add-negative')
  .description('Add negative keywords')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<keywords...>', 'Keywords to add as negatives')
  .option('-m, --match <type>', 'Match type (EXACT, PHRASE, BROAD)', 'PHRASE')
  .action(async (adGroupId: string, keywordList: string[], options) => {
    try {
      const client = await getClient(program.opts().customer);
      const keywords = keywordList.map(text => ({
        text,
        matchType: options.match as KeywordMatchType,
      }));

      const response = await client.keywords.addNegative(adGroupId, keywords);

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      success(`Added ${keywordList.length} negative keyword(s)`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

keywords
  .command('pause')
  .description('Pause a keyword')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<criterionId>', 'Criterion ID')
  .action(async (adGroupId: string, criterionId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.keywords.pause(adGroupId, criterionId);
      success(`Paused keyword ${criterionId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

keywords
  .command('enable')
  .description('Enable a keyword')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<criterionId>', 'Criterion ID')
  .action(async (adGroupId: string, criterionId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.keywords.enable(adGroupId, criterionId);
      success(`Enabled keyword ${criterionId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

keywords
  .command('remove')
  .description('Remove a keyword')
  .argument('<adGroupId>', 'Ad group ID')
  .argument('<criterionId>', 'Criterion ID')
  .action(async (adGroupId: string, criterionId: string) => {
    try {
      const client = await getClient(program.opts().customer);
      await client.keywords.remove(adGroupId, criterionId);
      success(`Removed keyword ${criterionId}`);
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

keywords
  .command('search-terms')
  .description('Get search terms report')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .option('-g, --adgroup <adGroupId>', 'Filter by ad group')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .option('-l, --limit <limit>', 'Limit results', parseInt)
  .action(async (options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.keywords.getSearchTerms({
        campaignId: options.campaign,
        adGroupId: options.adgroup,
        startDate: options.start,
        endDate: options.end,
        limit: options.limit,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log('\nSearch Terms:');
      for (const row of response.results || []) {
        const stv = row.searchTermView || {};
        const metrics = row.metrics || {};
        console.log(`  "${stv.searchTerm}" - ${formatNumber(metrics.clicks)} clicks, ${formatMicros(metrics.costMicros)}`);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

// ============================================
// Report Commands
// ============================================

const reports = program.command('reports').description('Reporting commands');

reports
  .command('query')
  .description('Execute a custom GAQL query')
  .argument('<gaql>', 'GAQL query string')
  .action(async (gaql: string) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.reports.query(gaql);
      print(response, program.opts().json ? 'json' : 'pretty');
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

reports
  .command('account')
  .description('Account performance report')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .action(async (startDate: string, endDate: string) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.reports.accountPerformance(startDate, endDate);

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log('\nAccount Performance:');
      for (const row of response.results || []) {
        const segments = row.segments || {};
        const metrics = row.metrics || {};
        console.log(`  ${segments.date}: ${formatNumber(metrics.impressions)} imp, ${formatNumber(metrics.clicks)} clicks, ${formatMicros(metrics.costMicros)}, ${metrics.conversions?.toFixed(2) || 0} conv`);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

reports
  .command('campaign')
  .description('Campaign performance report')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .action(async (startDate: string, endDate: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.reports.campaignPerformance(startDate, endDate, {
        campaignId: options.campaign,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log('\nCampaign Performance:');
      for (const row of response.results || []) {
        const campaign = row.campaign || {};
        const segments = row.segments || {};
        const metrics = row.metrics || {};
        console.log(`  ${segments.date} | ${campaign.name}: ${formatNumber(metrics.clicks)} clicks, ${formatMicros(metrics.costMicros)}`);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

reports
  .command('keyword')
  .description('Keyword performance report')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .option('-g, --adgroup <adGroupId>', 'Filter by ad group')
  .option('-l, --limit <limit>', 'Limit results', parseInt)
  .action(async (startDate: string, endDate: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.reports.keywordPerformance(startDate, endDate, {
        campaignId: options.campaign,
        adGroupId: options.adgroup,
        limit: options.limit,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      print(response.results, 'pretty');
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

reports
  .command('device')
  .description('Device performance report')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .action(async (startDate: string, endDate: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.reports.devicePerformance(startDate, endDate, {
        campaignId: options.campaign,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log('\nDevice Performance:');
      for (const row of response.results || []) {
        const segments = row.segments || {};
        const metrics = row.metrics || {};
        console.log(`  ${segments.device}: ${formatNumber(metrics.clicks)} clicks, ${formatMicros(metrics.costMicros)}, ${formatPercent(metrics.ctr)} CTR`);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

reports
  .command('geographic')
  .description('Geographic performance report')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .action(async (startDate: string, endDate: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.reports.geographicPerformance(startDate, endDate, {
        campaignId: options.campaign,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      print(response.results, 'pretty');
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

reports
  .command('conversions')
  .description('Conversion tracking report')
  .argument('<startDate>', 'Start date (YYYY-MM-DD)')
  .argument('<endDate>', 'End date (YYYY-MM-DD)')
  .option('-c, --campaign <campaignId>', 'Filter by campaign')
  .action(async (startDate: string, endDate: string, options) => {
    try {
      const client = await getClient(program.opts().customer);
      const response = await client.reports.conversionReport(startDate, endDate, {
        campaignId: options.campaign,
      });

      if (program.opts().json) {
        print(response, 'json');
        return;
      }

      console.log('\nConversion Report:');
      for (const row of response.results || []) {
        const segments = row.segments || {};
        const metrics = row.metrics || {};
        console.log(`  ${segments.conversionActionName}: ${metrics.conversions?.toFixed(2) || 0} conv, ${formatMicros(metrics.conversionsValue ? metrics.conversionsValue * 1000000 : 0)} value`);
      }
    } catch (err: any) {
      error(err.message);
      process.exit(1);
    }
  });

// ============================================
// Parse and Execute
// ============================================

program.parse();
