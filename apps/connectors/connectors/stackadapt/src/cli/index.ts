#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  getGraphqlUrl,
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

const CONNECTOR_NAME = 'connect-stackadapt';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('StackAdapt programmatic advertising API connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
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
    }

    if (opts.apiKey) {
      process.env.STACKADAPT_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STACKADAPT_API_KEY.`);
    process.exit(1);
  }
  return new Connector({
    apiKey,
    baseUrl: getBaseUrl(),
    graphqlUrl: getGraphqlUrl(),
  });
}

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
    for (const p of profiles) {
      const active = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${active}`);
    }
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
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
    if (!deleteProfile(name)) {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

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
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`REST base URL: ${getBaseUrl() || 'https://api.stackadapt.com/service/v2 (default)'}`);
    info(`GraphQL URL: ${getGraphqlUrl() || 'https://api.stackadapt.com/graphql (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const campaignCmd = program.command('campaign').description('Manage campaigns');

campaignCmd
  .command('list')
  .description('List all campaigns')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.campaigns.list();
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('get <id>')
  .description('Get campaign by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.campaigns.get(id);
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('create')
  .description('Create a campaign (legacy REST; prefer GraphQL for new integrations)')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .option('-b, --budget <amount>', 'Campaign budget', parseFloat)
  .option('--bid-type <type>', 'Bid type (cpm, cpc, cpe, cps)', 'cpm')
  .option('--bid-amount <amount>', 'Bid amount', parseFloat)
  .option('--state <state>', 'Campaign state', 'active')
  .option('--body <json>', 'Full JSON body (overrides other options)')
  .action(async (opts: { name: string; budget?: number; bidType: string; bidAmount?: number; state: string; body?: string }) => {
    try {
      const client = getClient();
      const data = opts.body
        ? JSON.parse(opts.body)
        : {
            name: opts.name,
            budget: opts.budget,
            bid_type: opts.bidType,
            bid_amount_total: opts.bidAmount,
            state: opts.state,
          };
      const result = await client.campaigns.create(data);
      success('Campaign created');
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Conversion trackers and reporting events');

eventsCmd
  .command('list')
  .description('List conversion trackers')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.events.list();
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <id>')
  .description('Get conversion tracker by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.events.get(id);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('stats')
  .description('Fetch reporting stats')
  .requiredOption('-r, --resource <resource>', 'Resource type (campaign, conversion_tracker, line_item, native_ad, advertiser, buyer_account)')
  .requiredOption('-t, --type <type>', 'Stats type (domain, total, daily, hourly)')
  .option('--id <id>', 'Resource ID')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .option('--timezone <tz>', 'Timezone for date range')
  .option('--group-by <resource>', 'Group-by resource')
  .action(async (opts: { resource: string; type: string; id?: string; startDate?: string; endDate?: string; timezone?: string; groupBy?: string }) => {
    try {
      const client = getClient();
      const result = await client.events.stats({
        resource: opts.resource as 'campaign',
        type: opts.type as 'total',
        id: opts.id,
        start_date: opts.startDate,
        end_date: opts.endDate,
        timezone: opts.timezone,
        group_by_resource: opts.groupBy,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search campaigns by name or ID')
  .action(async (query: string) => {
    try {
      const client = getClient();
      const result = await client.campaigns.search(query);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('graphql')
  .description('Execute a GraphQL query or mutation')
  .requiredOption('-q, --query <query>', 'GraphQL query string')
  .option('-v, --variables <json>', 'GraphQL variables JSON')
  .option('-o, --operation <name>', 'Operation name')
  .option('-f, --file <path>', 'Read query from file')
  .action(async (opts: { query?: string; variables?: string; operation?: string; file?: string }) => {
    try {
      const client = getClient();
      const query = opts.file ? readFileSync(opts.file, 'utf-8') : opts.query!;
      const variables = opts.variables ? JSON.parse(opts.variables) : undefined;
      const result = await client.graphql(query, variables, opts.operation);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <method> <path>')
  .description('Send a raw REST request')
  .option('-p, --params <json>', 'Query parameters JSON')
  .option('-b, --body <json>', 'Request body JSON')
  .option('--base-url <url>', 'Override base URL')
  .action(async (method: string, path: string, opts: { params?: string; body?: string; baseUrl?: string }) => {
    try {
      const client = getClient();
      const upperMethod = method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      const result = await client.rawRequest(upperMethod, path, {
        params: opts.params ? JSON.parse(opts.params) : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
        baseUrl: opts.baseUrl,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
