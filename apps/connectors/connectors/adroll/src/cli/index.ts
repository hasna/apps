#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-adroll';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('AdRoll / NextRoll API connector CLI - manage advertisables, campaigns, adgroups, ads, and segments')
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
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.ADROLL_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ADROLL_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key (Personal Access Token)')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Organization Commands
// ============================================
const orgCmd = program
  .command('org')
  .description('Manage organizations');

orgCmd
  .command('list')
  .description('List all organizations')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.organizations.list();
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('get <eid>')
  .description('Get organization by EID')
  .action(async (eid: string) => {
    try {
      const client = getClient();
      const result = await client.organizations.get(eid);
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Advertisable Commands
// ============================================
const advCmd = program
  .command('advertisable')
  .description('Manage advertisables');

advCmd
  .command('list <orgEid>')
  .description('List advertisables for an organization')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (orgEid: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, number | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.offset) params.offset = parseInt(opts.offset);
      const result = await client.advertisables.list(orgEid, params);
      print(result, getFormat(advCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

advCmd
  .command('get <eid>')
  .description('Get advertisable by EID')
  .action(async (eid: string) => {
    try {
      const client = getClient();
      const result = await client.advertisables.get(eid);
      print(result, getFormat(advCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

advCmd
  .command('create <orgEid>')
  .description('Create a new advertisable')
  .requiredOption('-n, --name <name>', 'Advertisable name')
  .option('-u, --url <url>', 'Website URL')
  .option('--product-name <name>', 'Product name')
  .action(async (orgEid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.advertisables.create(orgEid, {
        name: opts.name,
        url: opts.url,
        product_name: opts.productName,
      });
      success('Advertisable created!');
      print(result, getFormat(advCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Campaign Commands
// ============================================
const campaignCmd = program
  .command('campaign')
  .description('Manage campaigns');

campaignCmd
  .command('list <advertisableEid>')
  .description('List campaigns for an advertisable')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (advertisableEid: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, number | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.offset) params.offset = parseInt(opts.offset);
      const result = await client.campaigns.list(advertisableEid, params);
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('get <eid>')
  .description('Get campaign by EID')
  .action(async (eid: string) => {
    try {
      const client = getClient();
      const result = await client.campaigns.get(eid);
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('create <advertisableEid>')
  .description('Create a new campaign')
  .requiredOption('-n, --name <name>', 'Campaign name')
  .option('-b, --budget <amount>', 'Campaign budget')
  .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date (YYYY-MM-DD)')
  .action(async (advertisableEid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.create(advertisableEid, {
        name: opts.name,
        budget: opts.budget ? parseFloat(opts.budget) : undefined,
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
  .command('edit <eid>')
  .description('Edit a campaign')
  .option('-n, --name <name>', 'Campaign name')
  .option('-b, --budget <amount>', 'Campaign budget')
  .option('-s, --status <status>', 'Campaign status')
  .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date (YYYY-MM-DD)')
  .action(async (eid: string, opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = {};
      if (opts.name) data.name = opts.name;
      if (opts.budget) data.budget = parseFloat(opts.budget);
      if (opts.status) data.status = opts.status;
      if (opts.startDate) data.start_date = opts.startDate;
      if (opts.endDate) data.end_date = opts.endDate;
      const result = await client.campaigns.edit(eid, data);
      success('Campaign updated!');
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Adgroup Commands
// ============================================
const adgroupCmd = program
  .command('adgroup')
  .description('Manage ad groups');

adgroupCmd
  .command('list <campaignEid>')
  .description('List ad groups for a campaign')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (campaignEid: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, number | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.offset) params.offset = parseInt(opts.offset);
      const result = await client.adgroups.list(campaignEid, params);
      print(result, getFormat(adgroupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adgroupCmd
  .command('get <eid>')
  .description('Get ad group by EID')
  .action(async (eid: string) => {
    try {
      const client = getClient();
      const result = await client.adgroups.get(eid);
      print(result, getFormat(adgroupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adgroupCmd
  .command('create')
  .description('Create a new ad group')
  .requiredOption('-n, --name <name>', 'Ad group name')
  .requiredOption('-c, --campaign <eid>', 'Campaign EID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.adgroups.create({
        name: opts.name,
        campaign: opts.campaign,
      });
      success('Ad group created!');
      print(result, getFormat(adgroupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Ad Commands
// ============================================
const adCmd = program
  .command('ad')
  .description('Manage ads');

adCmd
  .command('list <advertisableEid>')
  .description('List ads for an advertisable')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (advertisableEid: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, number | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.offset) params.offset = parseInt(opts.offset);
      const result = await client.ads.list(advertisableEid, params);
      print(result, getFormat(adCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adCmd
  .command('get <eid>')
  .description('Get ad by EID')
  .action(async (eid: string) => {
    try {
      const client = getClient();
      const result = await client.ads.get(eid);
      print(result, getFormat(adCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adCmd
  .command('create <advertisableEid>')
  .description('Create a new ad')
  .requiredOption('-n, --name <name>', 'Ad name')
  .requiredOption('-t, --type <type>', 'Ad type')
  .option('-w, --width <pixels>', 'Ad width')
  .option('-h, --height <pixels>', 'Ad height')
  .action(async (advertisableEid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.ads.create(advertisableEid, {
        name: opts.name,
        type: opts.type,
        width: opts.width ? parseInt(opts.width) : undefined,
        height: opts.height ? parseInt(opts.height) : undefined,
      });
      success('Ad created!');
      print(result, getFormat(adCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Segment Commands
// ============================================
const segmentCmd = program
  .command('segment')
  .description('Manage audience segments');

segmentCmd
  .command('list <advertisableEid>')
  .description('List segments for an advertisable')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (advertisableEid: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, number | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.offset) params.offset = parseInt(opts.offset);
      const result = await client.segments.list(advertisableEid, params);
      print(result, getFormat(segmentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentCmd
  .command('get <eid>')
  .description('Get segment by EID')
  .action(async (eid: string) => {
    try {
      const client = getClient();
      const result = await client.segments.get(eid);
      print(result, getFormat(segmentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
