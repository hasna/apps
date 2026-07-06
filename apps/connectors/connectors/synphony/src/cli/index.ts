#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-synphony';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Synphony farm-robotics connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
      process.env.SYNPHONY_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.SYNPHONY_BASE_URL = opts.baseUrl;
      debug('Base URL set from command line flag');
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SYNPHONY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
}

// Parse repeatable --query key=value flags into a params object
function collectKeyValue(value: string, previous: Record<string, string> = {}): Record<string, string> {
  const idx = value.indexOf('=');
  if (idx === -1) {
    error(`Invalid --query value "${value}". Expected key=value.`);
    process.exit(1);
  }
  const key = value.slice(0, idx);
  const val = value.slice(idx + 1);
  return { ...previous, [key]: val };
}

async function run<T>(cmd: Command, fn: () => Promise<T>): Promise<void> {
  try {
    const result = await fn();
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
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
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
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
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
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
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.synphony.ai/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Farm Commands
// ============================================
const farmsCmd = program
  .command('farms')
  .description('Manage and inspect farms');

farmsCmd
  .command('list')
  .description('List farms')
  .option('-q, --query <key=value>', 'Query parameter (repeatable)', collectKeyValue, {})
  .action((opts, cmd) => run(cmd, () => getClient().synphony.listFarms(opts.query)));

farmsCmd
  .command('get <farmId>')
  .description('Get a single farm by ID')
  .action((farmId: string, _opts, cmd) => run(cmd, () => getClient().synphony.getFarm(farmId)));

farmsCmd
  .command('bed-analytics <farmId>')
  .description('Get bed analytics for a farm')
  .option('-q, --query <key=value>', 'Query parameter (repeatable)', collectKeyValue, {})
  .action((farmId: string, opts, cmd) => run(cmd, () => getClient().synphony.getBedAnalytics(farmId, opts.query)));

// ============================================
// Robot Commands
// ============================================
const robotsCmd = program
  .command('robots')
  .description('Manage and inspect robots');

robotsCmd
  .command('list')
  .description('List robots')
  .option('-q, --query <key=value>', 'Query parameter (repeatable)', collectKeyValue, {})
  .action((opts, cmd) => run(cmd, () => getClient().synphony.listRobots(opts.query)));

robotsCmd
  .command('get <robotId>')
  .description('Get a single robot by ID')
  .action((robotId: string, _opts, cmd) => run(cmd, () => getClient().synphony.getRobot(robotId)));

robotsCmd
  .command('telemetry <robotId>')
  .description('Get telemetry for a robot')
  .option('-q, --query <key=value>', 'Query parameter (repeatable)', collectKeyValue, {})
  .action((robotId: string, opts, cmd) => run(cmd, () => getClient().synphony.getTelemetry(robotId, opts.query)));

// ============================================
// Harvest Run Commands
// ============================================
const harvestCmd = program
  .command('harvest-runs')
  .description('Inspect harvest runs');

harvestCmd
  .command('list')
  .description('List harvest runs')
  .option('-q, --query <key=value>', 'Query parameter (repeatable)', collectKeyValue, {})
  .action((opts, cmd) => run(cmd, () => getClient().synphony.listHarvestRuns(opts.query)));

// ============================================
// Raw Request
// ============================================
program
  .command('raw <path>')
  .description('Make a raw authenticated request to the Synphony API')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-q, --query <key=value>', 'Query parameter (repeatable)', collectKeyValue, {})
  .option('-d, --data <json>', 'Request body as a JSON string')
  .action((path: string, opts, cmd) => run(cmd, () => {
    let body: Record<string, unknown> | undefined;
    if (opts.data) {
      try {
        body = JSON.parse(opts.data);
      } catch {
        error('Invalid JSON provided to --data');
        process.exit(1);
      }
    }
    return getClient().synphony.rawRequest({
      path,
      method: (opts.method || 'GET').toUpperCase(),
      query: opts.query,
      body,
    });
  }));

// Parse and execute
program.parse();
