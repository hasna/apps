#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Surtr } from '../api';
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

const CONNECTOR_NAME = 'connect-surtrdefensesystems';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Surtr Defense Systems connector - counter-UAS sensors, threats, situation picture, and engagements')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
      process.env.SURTRDEFENSESYSTEMS_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.SURTRDEFENSESYSTEMS_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let parent: Command | null = cmd;
  while (parent) {
    const fmt = parent.opts().format;
    if (fmt) return fmt as OutputFormat;
    parent = parent.parent;
  }
  return 'pretty';
}

function getClient(): Surtr {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SURTRDEFENSESYSTEMS_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Surtr({ apiKey, baseUrl: getBaseUrl() });
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
  .command('set-key <key>')
  .description('Set API key')
  .action((key: string) => {
    setApiKey(key);
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
    info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Sensor Commands
// ============================================
const sensorCmd = program
  .command('sensor')
  .description('Sensor management');

sensorCmd
  .command('list')
  .description('List sensors')
  .option('--status <status>', 'Filter by status (online, offline, degraded, maintenance)')
  .option('--type <type>', 'Filter by sensor type (radar, rf, eo, ir, acoustic, lidar)')
  .option('--site <id>', 'Filter by site ID')
  .option('--limit <number>', 'Maximum results')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSensors({
        status: opts.status,
        type: opts.type,
        site_id: opts.site,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(sensorCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sensorCmd
  .command('get <sensorId>')
  .description('Get a sensor by ID')
  .action(async (sensorId: string) => {
    try {
      const client = getClient();
      const result = await client.getSensor(sensorId);
      print(result, getFormat(sensorCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Threat Commands
// ============================================
const threatCmd = program
  .command('threat')
  .description('Threat management');

threatCmd
  .command('list')
  .description('List threats')
  .option('--state <state>', 'Filter by state (active, lost, resolved)')
  .option('--severity <severity>', 'Filter by severity (low, medium, high, critical)')
  .option('--classification <class>', 'Filter by classification (uav, group1, bird, unknown, ...)')
  .option('--since <timestamp>', 'Only threats updated since this ISO timestamp')
  .option('--limit <number>', 'Maximum results')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listThreats({
        state: opts.state,
        severity: opts.severity,
        classification: opts.classification,
        since: opts.since,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(threatCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

threatCmd
  .command('get <threatId>')
  .description('Get a threat by ID')
  .action(async (threatId: string) => {
    try {
      const client = getClient();
      const result = await client.getThreat(threatId);
      print(result, getFormat(threatCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Situation Commands
// ============================================
const situationCmd = program
  .command('situation')
  .description('Situation picture');

situationCmd
  .command('get')
  .description('Get the current fused situation picture')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getSituationPicture();
      print(result, getFormat(situationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Engagement Commands
// ============================================
const engagementCmd = program
  .command('engagement')
  .description('Engagement management');

engagementCmd
  .command('list')
  .description('List engagements')
  .option('--status <status>', 'Filter by status (proposed, authorized, active, complete, aborted)')
  .option('--threat <id>', 'Filter by threat ID')
  .option('--limit <number>', 'Maximum results')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEngagements({
        status: opts.status,
        threat_id: opts.threat,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(engagementCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

engagementCmd
  .command('recommend')
  .description('Request an engagement recommendation for a threat')
  .requiredOption('--threat <id>', 'Threat ID')
  .option('--effector <id>', 'Preferred effector ID')
  .option('--method <method>', 'Preferred engagement method')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createEngagementRecommendation({
        threat_id: opts.threat,
        effector_id: opts.effector,
        method: opts.method,
      });
      print(result, getFormat(engagementCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request Command
// ============================================
program
  .command('raw <path>')
  .description('Make a raw authenticated request to an arbitrary API path')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-d, --data <json>', 'Request body as JSON string')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const method = String(opts.method).toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      let body: Record<string, unknown> | undefined;
      if (opts.data) {
        try {
          body = JSON.parse(opts.data);
        } catch {
          error('Invalid JSON provided to --data');
          process.exit(1);
        }
      }
      const result = await client.rawRequest(path, { method, body });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
