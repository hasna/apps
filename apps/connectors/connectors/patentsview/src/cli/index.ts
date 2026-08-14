#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { PatentsView } from '../api';
import { CPCApi } from '../api/cpc';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-patentsview';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('PatentsView USPTO patent analytics API connector - Search patents, inventors, assignees, and CPC classifications')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.PATENTSVIEW_API_KEY = opts.apiKey;
    }
  });

// Helper to get root command format
function getRootFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): PatentsView {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set PATENTSVIEW_API_KEY environment variable.`);
    info('Get an API key at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18');
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new PatentsView({ apiKey, baseUrl });
}

// ============================================
// Patents Commands
// ============================================
const patentsCmd = program
  .command('patents')
  .description('Search and retrieve patent data');

patentsCmd
  .command('search')
  .description('Search patents')
  .option('--title <text>', 'Search by title')
  .option('--abstract <text>', 'Search by abstract')
  .option('--assignee <name>', 'Search by assignee organization')
  .option('--inventor <name>', 'Search by inventor last name')
  .option('--cpc <code>', 'Search by CPC classification')
  .option('--year <year>', 'Filter by year')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--limit <n>', 'Number of results', '25')
  .option('--page <n>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const limit = parseInt(opts.limit);
      const page = parseInt(opts.page);

      let result;

      if (opts.title) {
        result = await client.patents.searchByTitle(opts.title, { per_page: limit, page });
      } else if (opts.abstract) {
        result = await client.patents.searchByAbstract(opts.abstract, { per_page: limit, page });
      } else if (opts.assignee) {
        result = await client.patents.searchByAssignee(opts.assignee, { per_page: limit, page });
      } else if (opts.inventor) {
        result = await client.patents.searchByInventor(opts.inventor, undefined, { per_page: limit, page });
      } else if (opts.cpc) {
        result = await client.patents.searchByCPC(opts.cpc, { per_page: limit, page });
      } else if (opts.year) {
        result = await client.patents.searchByYear(parseInt(opts.year), { per_page: limit, page });
      } else if (opts.from && opts.to) {
        result = await client.patents.searchByDateRange(opts.from, opts.to, { per_page: limit, page });
      } else {
        result = await client.patents.getRecent(limit);
      }

      success(`Found ${result.total_hits} patents (showing ${result.count})`);
      print(result.patents, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentsCmd
  .command('get <patentId>')
  .description('Get a single patent by ID')
  .action(async (patentId: string) => {
    try {
      const client = getClient();
      const patent = await client.patents.get(patentId);

      if (patent) {
        success(`Patent ${patentId}`);
        print(patent, getRootFormat());
      } else {
        error(`Patent ${patentId} not found`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentsCmd
  .command('recent')
  .description('Get recently granted patents')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.patents.getRecent(parseInt(opts.limit));
      success(`Recent patents (${result.count})`);
      print(result.patents, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentsCmd
  .command('cited')
  .description('Get most cited patents')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.patents.getMostCited(parseInt(opts.limit));
      success(`Most cited patents (${result.count})`);
      print(result.patents, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Assignees Commands
// ============================================
const assigneesCmd = program
  .command('assignees')
  .description('Search and retrieve assignee data');

assigneesCmd
  .command('search')
  .description('Search assignees')
  .option('--org <name>', 'Search by organization name')
  .option('--name <lastname>', 'Search by individual last name')
  .option('--country <code>', 'Filter by country')
  .option('--state <code>', 'Filter by state (US only)')
  .option('--limit <n>', 'Number of results', '25')
  .option('--page <n>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const limit = parseInt(opts.limit);
      const page = parseInt(opts.page);

      let result;

      if (opts.org) {
        result = await client.assignees.searchByOrganization(opts.org, { per_page: limit, page });
      } else if (opts.name) {
        result = await client.assignees.searchByName(opts.name, undefined, { per_page: limit, page });
      } else if (opts.country) {
        result = await client.assignees.searchByLocation(opts.country, opts.state, undefined, { per_page: limit, page });
      } else {
        result = await client.assignees.getTopByPatentCount(limit);
      }

      success(`Found ${result.total_hits} assignees (showing ${result.count})`);
      print(result.assignees, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

assigneesCmd
  .command('get <assigneeId>')
  .description('Get a single assignee by ID')
  .action(async (assigneeId: string) => {
    try {
      const client = getClient();
      const assignee = await client.assignees.get(assigneeId);

      if (assignee) {
        success(`Assignee ${assigneeId}`);
        print(assignee, getRootFormat());
      } else {
        error(`Assignee ${assigneeId} not found`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

assigneesCmd
  .command('top')
  .description('Get top assignees by patent count')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.assignees.getTopByPatentCount(parseInt(opts.limit));
      success(`Top assignees by patent count (${result.count})`);
      print(result.assignees, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Inventors Commands
// ============================================
const inventorsCmd = program
  .command('inventors')
  .description('Search and retrieve inventor data');

inventorsCmd
  .command('search')
  .description('Search inventors')
  .option('--name <lastname>', 'Search by last name')
  .option('--first <firstname>', 'Filter by first name')
  .option('--country <code>', 'Filter by country')
  .option('--state <code>', 'Filter by state (US only)')
  .option('--limit <n>', 'Number of results', '25')
  .option('--page <n>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const limit = parseInt(opts.limit);
      const page = parseInt(opts.page);

      let result;

      if (opts.name) {
        result = await client.inventors.searchByName(opts.name, opts.first, { per_page: limit, page });
      } else if (opts.country) {
        result = await client.inventors.searchByLocation(opts.country, opts.state, undefined, { per_page: limit, page });
      } else {
        result = await client.inventors.getTopByPatentCount(limit);
      }

      success(`Found ${result.total_hits} inventors (showing ${result.count})`);
      print(result.inventors, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventorsCmd
  .command('get <inventorId>')
  .description('Get a single inventor by ID')
  .action(async (inventorId: string) => {
    try {
      const client = getClient();
      const inventor = await client.inventors.get(inventorId);

      if (inventor) {
        success(`Inventor ${inventorId}`);
        print(inventor, getRootFormat());
      } else {
        error(`Inventor ${inventorId} not found`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventorsCmd
  .command('top')
  .description('Get top inventors by patent count')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.inventors.getTopByPatentCount(parseInt(opts.limit));
      success(`Top inventors by patent count (${result.count})`);
      print(result.inventors, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventorsCmd
  .command('prolific')
  .description('Get prolific inventors (with many patents)')
  .option('--min <n>', 'Minimum patent count', '100')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.inventors.getProlific(parseInt(opts.min), { per_page: parseInt(opts.limit) });
      success(`Prolific inventors with ${opts.min}+ patents (${result.count})`);
      print(result.inventors, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// CPC Commands
// ============================================
const cpcCmd = program
  .command('cpc')
  .description('Search CPC (Cooperative Patent Classification) data');

cpcCmd
  .command('search')
  .description('Search CPC subgroups')
  .option('--title <text>', 'Search by title')
  .option('--section <id>', 'Filter by section (A-H, Y)')
  .option('--class <id>', 'Filter by class (e.g., G06)')
  .option('--subclass <id>', 'Filter by subclass (e.g., G06F)')
  .option('--group <id>', 'Filter by group (e.g., G06F3/00)')
  .option('--prefix <id>', 'Search by ID prefix')
  .option('--limit <n>', 'Number of results', '25')
  .option('--page <n>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const limit = parseInt(opts.limit);
      const page = parseInt(opts.page);

      let result;

      if (opts.title) {
        result = await client.cpc.searchByTitle(opts.title, { per_page: limit, page });
      } else if (opts.section) {
        result = await client.cpc.searchBySection(opts.section, { per_page: limit, page });
      } else if (opts.class) {
        result = await client.cpc.searchByClass(opts.class, { per_page: limit, page });
      } else if (opts.subclass) {
        result = await client.cpc.searchBySubclass(opts.subclass, { per_page: limit, page });
      } else if (opts.group) {
        result = await client.cpc.searchByGroup(opts.group, { per_page: limit, page });
      } else if (opts.prefix) {
        result = await client.cpc.searchByIdPrefix(opts.prefix, { per_page: limit, page });
      } else {
        result = await client.cpc.getTopByPatentCount(limit);
      }

      success(`Found ${result.total_hits} CPC subgroups (showing ${result.count})`);
      print(result.cpc_subgroups, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cpcCmd
  .command('get <cpcId>')
  .description('Get a single CPC subgroup by ID')
  .action(async (cpcId: string) => {
    try {
      const client = getClient();
      const cpc = await client.cpc.get(cpcId);

      if (cpc) {
        success(`CPC ${cpcId}`);
        print(cpc, getRootFormat());
      } else {
        error(`CPC ${cpcId} not found`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cpcCmd
  .command('sections')
  .description('List CPC sections')
  .action(() => {
    const sections = CPCApi.CPC_SECTIONS;
    success('CPC Sections:');
    Object.entries(sections).forEach(([id, title]) => {
      console.log(`  ${chalk.cyan(id)}: ${title}`);
    });
  });

cpcCmd
  .command('top')
  .description('Get top CPC subgroups by patent count')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.cpc.getTopByPatentCount(parseInt(opts.limit));
      success(`Top CPC subgroups by patent count (${result.count})`);
      print(result.cpc_subgroups, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Locations Commands
// ============================================
const locationsCmd = program
  .command('locations')
  .description('Search location data');

locationsCmd
  .command('search')
  .description('Search locations')
  .option('--country <code>', 'Filter by country')
  .option('--state <code>', 'Filter by state (US only)')
  .option('--city <name>', 'Search by city name')
  .option('--limit <n>', 'Number of results', '25')
  .option('--page <n>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const limit = parseInt(opts.limit);
      const page = parseInt(opts.page);

      let result;

      if (opts.city) {
        result = await client.locations.searchByCity(opts.city, opts.country, opts.state, { per_page: limit, page });
      } else if (opts.state) {
        result = await client.locations.searchByState(opts.state, { per_page: limit, page });
      } else if (opts.country) {
        result = await client.locations.searchByCountry(opts.country, { per_page: limit, page });
      } else {
        result = await client.locations.getTopByPatentCount(limit);
      }

      success(`Found ${result.total_hits} locations (showing ${result.count})`);
      print(result.locations, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

locationsCmd
  .command('top')
  .description('Get top locations by patent count')
  .option('--us', 'US locations only')
  .option('--state <code>', 'Top cities in a specific US state')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const limit = parseInt(opts.limit);

      let result;

      if (opts.state) {
        result = await client.locations.getTopCitiesInState(opts.state, limit);
        success(`Top cities in ${opts.state.toUpperCase()} (${result.count})`);
      } else if (opts.us) {
        result = await client.locations.getTopUSCities(limit);
        success(`Top US cities by patent count (${result.count})`);
      } else {
        result = await client.locations.getTopByPatentCount(limit);
        success(`Top locations by patent count (${result.count})`);
      }

      print(result.locations, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://search.patentsview.org/api/v1)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

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
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://search.patentsview.org/api/v1)')}`);
    if (!apiKey) {
      warn('No API key configured. Get one at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18');
    }
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Parse and execute
program.parse();
