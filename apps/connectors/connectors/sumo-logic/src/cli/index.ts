#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SumoLogic } from '../api';
import {
  getAccessId,
  setAccessId,
  getAccessKey,
  setAccessKey,
  getDeployment,
  setDeployment,
  getEndpoint,
  setEndpoint,
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

const CONNECTOR_NAME = 'connect-sumo-logic';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Sumo Logic connector - Manage search jobs, collectors, sources, dashboards, monitors, and more')
  .version(VERSION)
  .option('--access-id <id>', 'Access ID (overrides config)')
  .option('--access-key <key>', 'Access key (overrides config)')
  .option('-d, --deployment <deployment>', 'Deployment/region (us1, us2, eu, au, ca, de, jp, in, fed)')
  .option('-e, --endpoint <url>', 'Fully-qualified API endpoint override')
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
    if (opts.accessId) {
      process.env.SUMOLOGIC_ACCESS_ID = opts.accessId;
    }
    if (opts.accessKey) {
      process.env.SUMOLOGIC_ACCESS_KEY = opts.accessKey;
    }
    if (opts.deployment) {
      process.env.SUMOLOGIC_DEPLOYMENT = opts.deployment;
    }
    if (opts.endpoint) {
      process.env.SUMOLOGIC_ENDPOINT = opts.endpoint;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  // Walk up to the root program to read the global --format option.
  let root: Command | null = parent ?? null;
  while (root?.parent) {
    root = root.parent;
  }
  return (root?.opts().format || parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SumoLogic {
  const accessId = getAccessId();
  const accessKey = getAccessKey();
  const deployment = getDeployment();
  const endpoint = getEndpoint();

  if (!accessId) {
    error(`No Access ID configured. Run "${CONNECTOR_NAME} config set-access-id <id>" or set SUMOLOGIC_ACCESS_ID environment variable.`);
    process.exit(1);
  }
  if (!accessKey) {
    error(`No Access key configured. Run "${CONNECTOR_NAME} config set-access-key <key>" or set SUMOLOGIC_ACCESS_KEY environment variable.`);
    process.exit(1);
  }
  return new SumoLogic({ accessId, accessKey, deployment, endpoint });
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
  .option('--access-id <id>', 'Access ID')
  .option('--access-key <key>', 'Access key')
  .option('--deployment <deployment>', 'Deployment/region')
  .option('--endpoint <url>', 'API endpoint override')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessId: opts.accessId,
      accessKey: opts.accessKey,
      deployment: opts.deployment,
      endpoint: opts.endpoint,
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
    info(`Access ID: ${config.accessId ? `${config.accessId.substring(0, 4)}...` : chalk.gray('not set')}`);
    info(`Access Key: ${config.accessKey ? chalk.gray('set') : chalk.gray('not set')}`);
    info(`Deployment: ${config.deployment || chalk.gray('us1 (default)')}`);
    info(`Endpoint: ${config.endpoint || chalk.gray('derived from deployment')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-access-id <accessId>')
  .description('Set Access ID')
  .action((accessId: string) => {
    setAccessId(accessId);
    success(`Access ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-access-key <accessKey>')
  .description('Set Access key')
  .action((accessKey: string) => {
    setAccessKey(accessKey);
    success(`Access key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-deployment <deployment>')
  .description('Set deployment/region (us1, us2, eu, au, ca, de, jp, in, fed)')
  .action((deployment: string) => {
    setDeployment(deployment);
    success(`Deployment saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-endpoint <endpoint>')
  .description('Set API endpoint override (e.g., https://api.eu.sumologic.com)')
  .action((endpoint: string) => {
    setEndpoint(endpoint);
    success(`Endpoint saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessId = getAccessId();
    const accessKey = getAccessKey();
    const deployment = getDeployment();
    const endpoint = getEndpoint();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access ID: ${accessId ? `${accessId.substring(0, 4)}...` : chalk.gray('not set')}`);
    info(`Access Key: ${accessKey ? chalk.gray('set') : chalk.gray('not set')}`);
    info(`Deployment: ${deployment || chalk.gray('us1 (default)')}`);
    info(`Endpoint: ${endpoint || chalk.gray('derived from deployment')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Validate Command
// ============================================
program
  .command('validate')
  .description('Validate API credentials')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.validate();
      if (result.valid) {
        success('API credentials are valid');
      } else {
        error('API credentials are invalid');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Commands
// ============================================
const searchCmd = program
  .command('search')
  .description('Manage log search jobs');

searchCmd
  .command('create')
  .description('Create a search job')
  .requiredOption('-q, --query <query>', 'Search query')
  .requiredOption('--from <time>', 'Start time (ISO 8601 or epoch ms)')
  .requiredOption('--to <time>', 'End time (ISO 8601 or epoch ms)')
  .option('--time-zone <tz>', 'IANA time zone', 'UTC')
  .option('--by-receipt-time', 'Search by receipt time')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createSearchJob({
        query: opts.query,
        from: opts.from,
        to: opts.to,
        timeZone: opts.timeZone,
        byReceiptTime: opts.byReceiptTime,
      });
      print(result, getFormat(this));
      success(`Search job created: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('status <jobId>')
  .description('Get search job status')
  .action(async function(this: Command, jobId: string) {
    try {
      const client = getClient();
      const result = await client.getSearchJobStatus(jobId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('messages <jobId>')
  .description('Get raw messages for a search job')
  .option('--offset <offset>', 'Result offset', '0')
  .option('--limit <limit>', 'Result limit', '100')
  .action(async function(this: Command, jobId: string, opts) {
    try {
      const client = getClient();
      const result = await client.getSearchJobMessages(jobId, {
        offset: parseInt(opts.offset),
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('records <jobId>')
  .description('Get aggregate records for a search job')
  .option('--offset <offset>', 'Result offset', '0')
  .option('--limit <limit>', 'Result limit', '100')
  .action(async function(this: Command, jobId: string, opts) {
    try {
      const client = getClient();
      const result = await client.getSearchJobRecords(jobId, {
        offset: parseInt(opts.offset),
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('delete <jobId>')
  .description('Delete/cancel a search job')
  .action(async function(this: Command, jobId: string) {
    try {
      const client = getClient();
      await client.deleteSearchJob(jobId);
      success(`Search job ${jobId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Collectors Commands
// ============================================
const collectorsCmd = program
  .command('collectors')
  .description('Manage collectors');

collectorsCmd
  .command('list')
  .description('List collectors')
  .option('--limit <limit>', 'Number of collectors', '100')
  .option('--offset <offset>', 'Start offset', '0')
  .option('--filter <filter>', 'Filter (installed, hosted, dead, alive)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listCollectors({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
        filter: opts.filter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

collectorsCmd
  .command('get <id>')
  .description('Get a collector')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getCollector(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

collectorsCmd
  .command('delete <id>')
  .description('Delete a collector')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      await client.deleteCollector(parseInt(id));
      success(`Collector ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sources Commands
// ============================================
const sourcesCmd = program
  .command('sources')
  .description('Manage collector sources');

sourcesCmd
  .command('list <collectorId>')
  .description('List sources for a collector')
  .action(async function(this: Command, collectorId: string) {
    try {
      const client = getClient();
      const result = await client.listSources(parseInt(collectorId));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sourcesCmd
  .command('get <collectorId> <sourceId>')
  .description('Get a source')
  .action(async function(this: Command, collectorId: string, sourceId: string) {
    try {
      const client = getClient();
      const result = await client.getSource(parseInt(collectorId), parseInt(sourceId));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Dashboards Commands
// ============================================
const dashboardsCmd = program
  .command('dashboards')
  .description('Manage dashboards');

dashboardsCmd
  .command('get <id>')
  .description('Get a dashboard (v2)')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getDashboard(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Content Commands
// ============================================
const contentCmd = program
  .command('content')
  .description('Manage content library items');

contentCmd
  .command('folder <id>')
  .description('Get a content folder and its children')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getFolder(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contentCmd
  .command('personal')
  .description('Get the personal (root) folder')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getPersonalFolder();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contentCmd
  .command('path <id>')
  .description('Get the full path of a content item')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getContentPath(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contentCmd
  .command('resolve <path>')
  .description('Resolve a content item by its path')
  .action(async function(this: Command, path: string) {
    try {
      const client = getClient();
      const result = await client.getContentByPath(path);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Monitors Commands
// ============================================
const monitorsCmd = program
  .command('monitors')
  .description('Manage monitors');

monitorsCmd
  .command('root')
  .description('Get the root monitors folder')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getMonitorsRoot();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

monitorsCmd
  .command('get <id>')
  .description('Get a monitor or monitor folder')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getMonitor(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Roles Commands
// ============================================
const rolesCmd = program
  .command('roles')
  .description('Manage roles');

rolesCmd
  .command('list')
  .description('List roles')
  .option('--limit <limit>', 'Number of roles', '100')
  .option('--token <token>', 'Continuation token for pagination')
  .option('--name <name>', 'Filter by role name')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listRoles({
        limit: parseInt(opts.limit),
        token: opts.token,
        name: opts.name,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

rolesCmd
  .command('get <id>')
  .description('Get a role')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getRole(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================
const usersCmd = program
  .command('users')
  .description('Manage users');

usersCmd
  .command('list')
  .description('List users')
  .option('--limit <limit>', 'Number of users', '100')
  .option('--token <token>', 'Continuation token for pagination')
  .option('--email <email>', 'Filter by email')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listUsers({
        limit: parseInt(opts.limit),
        token: opts.token,
        email: opts.email,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <id>')
  .description('Get a user')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getUser(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Partitions Commands
// ============================================
const partitionsCmd = program
  .command('partitions')
  .description('Manage index partitions');

partitionsCmd
  .command('list')
  .description('List partitions')
  .option('--limit <limit>', 'Number of partitions', '100')
  .option('--token <token>', 'Continuation token for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listPartitions({
        limit: parseInt(opts.limit),
        token: opts.token,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

partitionsCmd
  .command('get <id>')
  .description('Get a partition')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getPartition(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Fields Commands
// ============================================
const fieldsCmd = program
  .command('fields')
  .description('Manage custom fields');

fieldsCmd
  .command('list')
  .description('List custom fields')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listFields();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fieldsCmd
  .command('get <id>')
  .description('Get a custom field')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getField(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
