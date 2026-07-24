#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SmartRecruiters } from '../api';
import {
  getApiKey,
  getCompanyId,
  setApiKey,
  setCompanyId,
  clearConfig,
  getConfigDir,
  isAuthenticated,
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

const CONNECTOR_NAME = 'connect-smartrecruiters';
const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SmartRecruiters API connector CLI - Manage jobs, candidates, postings, and configuration')
  .version('0.1.0')
  .option('-k, --api-key <key>', 'API key / SmartToken (overrides config)')
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
      process.env.SMARTRECRUITERS_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format;
    if (fmt) return fmt as OutputFormat;
    node = node.parent;
  }
  return 'pretty';
}

// Helper to get authenticated client
function requireAuth(): SmartRecruiters {
  if (!isAuthenticated()) {
    error(`Not authenticated. Run "${CONNECTOR_NAME} config set-key <key>" or set SMARTRECRUITERS_API_KEY.`);
    process.exit(1);
  }
  return SmartRecruiters.create();
}

function fail(err: unknown): never {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
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

    success('Profiles:');
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
  .option('--api-key <key>', 'API key / SmartToken')
  .option('--company-id <id>', 'Default company identifier for the Posting API')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      companyId: opts.companyId,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Company ID: ${config.companyId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key (SmartToken) for the active profile')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-company <id>')
  .description('Set default company identifier for the active profile')
  .action((id: string) => {
    setCompanyId(id);
    success(`Company identifier saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const companyId = getCompanyId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Company ID: ${companyId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for the active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Job Commands
// ============================================
const jobCmd = program
  .command('job')
  .alias('jobs')
  .description('Manage jobs');

jobCmd
  .command('list')
  .description('List jobs')
  .option('-q, --query <text>', 'Free-text query on job title')
  .option('--status <status>', 'Filter by job status')
  .option('--posting-status <status>', 'Filter by posting status')
  .option('--limit <n>', 'Max results', '10')
  .option('--offset <n>', 'Result offset', '0')
  .action(async (opts) => {
    try {
      const result = await requireAuth().jobs.list({
        q: opts.query,
        status: opts.status,
        postingStatus: opts.postingStatus,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(jobCmd));
    } catch (err) {
      fail(err);
    }
  });

jobCmd
  .command('get <jobId>')
  .description('Get a job by id')
  .action(async (jobId: string) => {
    try {
      print(await requireAuth().jobs.get(jobId), getFormat(jobCmd));
    } catch (err) {
      fail(err);
    }
  });

jobCmd
  .command('status <jobId>')
  .description('Get the status of a job')
  .action(async (jobId: string) => {
    try {
      print(await requireAuth().jobs.getStatus(jobId), getFormat(jobCmd));
    } catch (err) {
      fail(err);
    }
  });

jobCmd
  .command('hiring-team <jobId>')
  .description('List the hiring team for a job')
  .action(async (jobId: string) => {
    try {
      print(await requireAuth().jobs.getHiringTeam(jobId), getFormat(jobCmd));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Candidate Commands
// ============================================
const candidateCmd = program
  .command('candidate')
  .alias('candidates')
  .description('Manage candidates');

candidateCmd
  .command('list')
  .description('List candidates')
  .option('-q, --query <text>', 'Free-text query')
  .option('--updated-after <iso>', 'Only candidates updated on/after this ISO-8601 timestamp')
  .option('--limit <n>', 'Max results', '10')
  .option('--offset <n>', 'Result offset', '0')
  .action(async (opts) => {
    try {
      const result = await requireAuth().candidates.list({
        q: opts.query,
        updatedAfter: opts.updatedAfter,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(candidateCmd));
    } catch (err) {
      fail(err);
    }
  });

candidateCmd
  .command('get <candidateId>')
  .description('Get a candidate by id')
  .action(async (candidateId: string) => {
    try {
      print(await requireAuth().candidates.get(candidateId), getFormat(candidateCmd));
    } catch (err) {
      fail(err);
    }
  });

candidateCmd
  .command('list-by-job <jobId>')
  .description('List candidates (applications) on a job')
  .option('--status <status>', 'Filter by candidate status')
  .option('--limit <n>', 'Max results', '10')
  .option('--offset <n>', 'Result offset', '0')
  .action(async (jobId: string, opts) => {
    try {
      const result = await requireAuth().candidates.listByJob(jobId, {
        status: opts.status,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(candidateCmd));
    } catch (err) {
      fail(err);
    }
  });

candidateCmd
  .command('status <jobId> <candidateId>')
  .description('Get a candidate status on a job')
  .action(async (jobId: string, candidateId: string) => {
    try {
      print(await requireAuth().candidates.getStatus(jobId, candidateId), getFormat(candidateCmd));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Posting (public job board) Commands
// ============================================
const postingCmd = program
  .command('posting')
  .alias('postings')
  .description('Read public job postings');

postingCmd
  .command('list')
  .description('List public postings for a company')
  .option('-c, --company <id>', 'Company identifier (defaults to configured company)')
  .option('-q, --query <text>', 'Free-text query')
  .option('--department <id>', 'Filter by department id')
  .option('--city <city>', 'Filter by city')
  .option('--country <code>', 'Filter by country code')
  .option('--limit <n>', 'Max results', '10')
  .option('--offset <n>', 'Result offset', '0')
  .action(async (opts) => {
    try {
      const result = await requireAuth().postings.list(
        {
          q: opts.query,
          department: opts.department,
          city: opts.city,
          country: opts.country,
          limit: parseInt(opts.limit, 10),
          offset: parseInt(opts.offset, 10),
        },
        opts.company
      );
      print(result, getFormat(postingCmd));
    } catch (err) {
      fail(err);
    }
  });

postingCmd
  .command('get <postingId>')
  .description('Get a public posting by id')
  .option('-c, --company <id>', 'Company identifier (defaults to configured company)')
  .action(async (postingId: string, opts) => {
    try {
      print(await requireAuth().postings.get(postingId, opts.company), getFormat(postingCmd));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .alias('users')
  .description('Manage users');

userCmd
  .command('list')
  .description('List users')
  .option('-q, --query <text>', 'Free-text query')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results', '10')
  .option('--offset <n>', 'Result offset', '0')
  .action(async (opts) => {
    try {
      const result = await requireAuth().users.list({
        q: opts.query,
        status: opts.status,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(userCmd));
    } catch (err) {
      fail(err);
    }
  });

userCmd
  .command('get <userId>')
  .description('Get a user by id')
  .action(async (userId: string) => {
    try {
      print(await requireAuth().users.get(userId), getFormat(userCmd));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Configuration Commands
// ============================================
const cfgCmd = program
  .command('configuration')
  .alias('config-data')
  .description('Read company configuration reference data');

cfgCmd
  .command('departments')
  .description('List departments')
  .action(async () => {
    try {
      print(await requireAuth().configuration.departments(), getFormat(cfgCmd));
    } catch (err) {
      fail(err);
    }
  });

cfgCmd
  .command('locations')
  .description('List locations')
  .action(async () => {
    try {
      print(await requireAuth().configuration.locations(), getFormat(cfgCmd));
    } catch (err) {
      fail(err);
    }
  });

cfgCmd
  .command('functions')
  .description('List job functions')
  .action(async () => {
    try {
      print(await requireAuth().configuration.functions(), getFormat(cfgCmd));
    } catch (err) {
      fail(err);
    }
  });

cfgCmd
  .command('industries')
  .description('List industries')
  .action(async () => {
    try {
      print(await requireAuth().configuration.industries(), getFormat(cfgCmd));
    } catch (err) {
      fail(err);
    }
  });

// Parse and execute
program.parse();
