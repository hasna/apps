#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Verdex } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-verdex';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Verdex API connector — insurance claims verification and satellite monitoring')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    if (opts.apiKey) {
      process.env.VERDEX_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Verdex {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VERDEX_API_KEY.`);
    process.exit(1);
  }

  return new Verdex({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error('Invalid JSON body');
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.verdexai.com/v1)')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || 'https://api.verdexai.com/v1 (default)'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const claimsCmd = program.command('claims').description('Insurance claims');

claimsCmd
  .command('list')
  .description('List claims')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Page size')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.status) params.status = opts.status;
      if (opts.limit) params.limit = opts.limit;
      print(await client.listClaims(params), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

claimsCmd.command('get <claimId>').description('Get a claim by ID').action(async function (this: Command, claimId: string) {
  try {
    print(await getClient().getClaim(claimId), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const verificationsCmd = program.command('verifications').description('Claim verifications');

verificationsCmd
  .command('create <claimId>')
  .description('Create a verification for a claim')
  .option('--body <json>', 'JSON request body')
  .action(async function (this: Command, claimId: string, opts) {
    try {
      print(await getClient().createVerification(claimId, parseJsonOption(opts.body)), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

verificationsCmd
  .command('get <verificationId>')
  .description('Get a verification by ID')
  .action(async function (this: Command, verificationId: string) {
    try {
      print(await getClient().getVerification(verificationId), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const portfoliosCmd = program.command('portfolios').description('Portfolio management');

portfoliosCmd
  .command('list')
  .description('List portfolios')
  .option('--limit <n>', 'Page size')
  .action(async function (this: Command, opts) {
    try {
      const params: Record<string, string> = {};
      if (opts.limit) params.limit = opts.limit;
      print(await getClient().listPortfolios(params), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

portfoliosCmd
  .command('get <portfolioId>')
  .description('Get a portfolio by ID')
  .action(async function (this: Command, portfolioId: string) {
    try {
      print(await getClient().getPortfolio(portfolioId), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const sitesCmd = program.command('sites').description('Site conditions');

sitesCmd
  .command('conditions <siteId>')
  .description('Get satellite/site conditions for a site')
  .option('--date <date>', 'Filter by date')
  .action(async function (this: Command, siteId: string, opts) {
    try {
      const params: Record<string, string> = {};
      if (opts.date) params.date = opts.date;
      print(await getClient().getSiteConditions(siteId, params), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const monitoringCmd = program.command('monitoring').description('Monitoring jobs');

monitoringCmd
  .command('list')
  .description('List monitoring jobs')
  .option('--status <status>', 'Filter by status')
  .action(async function (this: Command, opts) {
    try {
      const params: Record<string, string> = {};
      if (opts.status) params.status = opts.status;
      print(await getClient().listMonitoringJobs(params), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

monitoringCmd
  .command('run <jobId>')
  .description('Run a monitoring check for a job')
  .option('--body <json>', 'JSON request body')
  .action(async function (this: Command, jobId: string, opts) {
    try {
      print(await getClient().runMonitoringCheck(jobId, parseJsonOption(opts.body)), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send an arbitrary API request')
  .requiredOption('--path <path>', 'API path (e.g. /claims)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().rawRequest({
        method: opts.method,
        path: opts.path,
        query: opts.query ? (JSON.parse(opts.query) as Record<string, string>) : undefined,
        body: opts.body ? parseJsonOption(opts.body) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
