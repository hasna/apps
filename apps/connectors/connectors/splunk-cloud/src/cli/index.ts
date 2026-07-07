#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SplunkCloud } from '../api';
import {
  getBaseUrl,
  setBaseUrl,
  getToken,
  setToken,
  getUsername,
  getPassword,
  setBasicAuth,
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

const CONNECTOR_NAME = 'connect-splunk-cloud';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Splunk Cloud Platform connector - search jobs, saved searches, indexes, HEC, users, and alerts')
  .version(VERSION)
  .option('-b, --base-url <url>', 'Splunk Cloud REST base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
    if (opts.baseUrl) {
      process.env.SPLUNK_CLOUD_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format;
    if (fmt) return fmt as OutputFormat;
    node = node.parent;
  }
  return 'pretty';
}

function getClient(): SplunkCloud {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    error(`No base URL configured. Run "${CONNECTOR_NAME} config set-base-url <url>" or set SPLUNK_CLOUD_BASE_URL.`);
    process.exit(1);
  }
  const token = getToken();
  const username = getUsername();
  const password = getPassword();
  if (!token && !(username && password)) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-token" with SPLUNK_CLOUD_TOKEN set, or set SPLUNK_CLOUD_TOKEN for this command.`);
    process.exit(1);
  }
  return new SplunkCloud({ baseUrl, token, username, password });
}

async function run(cmd: Command, fn: (client: SplunkCloud) => Promise<unknown>): Promise<void> {
  try {
    const client = getClient();
    const result = await fn(client);
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}

// ============================================
// Profile Commands
// ============================================
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
  .option('--base-url <url>', 'Base URL')
  .option('--with-env-token', 'Save SPLUNK_CLOUD_TOKEN into this profile')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    if (opts.withEnvToken && !process.env.SPLUNK_CLOUD_TOKEN) {
      error('Set SPLUNK_CLOUD_TOKEN before using --with-env-token.');
      process.exit(1);
    }
    createProfile(name, { baseUrl: opts.baseUrl, token: opts.withEnvToken ? process.env.SPLUNK_CLOUD_TOKEN : undefined });
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
    info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Username: ${config.username || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-base-url <url>')
  .description('Set the Splunk Cloud REST base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success('Base URL saved');
  });

configCmd
  .command('set-token')
  .description('Set the authentication token from SPLUNK_CLOUD_TOKEN')
  .action(() => {
    const token = process.env.SPLUNK_CLOUD_TOKEN;
    if (!token) {
      error('Set SPLUNK_CLOUD_TOKEN before running this command.');
      process.exit(1);
    }
    setToken(token);
    success('Token saved');
  });

configCmd
  .command('set-basic <username>')
  .description('Set username/password (Basic auth) from username plus SPLUNK_CLOUD_PASSWORD')
  .action((username: string) => {
    const password = process.env.SPLUNK_CLOUD_PASSWORD;
    if (!password) {
      error('Set SPLUNK_CLOUD_PASSWORD before running this command.');
      process.exit(1);
    }
    setBasicAuth(username, password);
    success('Basic auth credentials saved');
  });

configCmd
  .command('clear')
  .description('Clear stored credentials for the active profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

configCmd
  .command('path')
  .description('Show the configuration directory')
  .action(() => {
    info(getConfigDir());
  });

// ============================================
// Server Commands
// ============================================
const serverCmd = program.command('server').description('Server information and health');

serverCmd
  .command('info')
  .description('Get server info (version, build, OS)')
  .action((_opts, cmd) => run(cmd, c => c.getServerInfo()));

serverCmd
  .command('health')
  .description('Get splunkd health status')
  .action((_opts, cmd) => run(cmd, c => c.getHealth()));

// ============================================
// Search Commands
// ============================================
const searchCmd = program.command('search').description('Search jobs');

searchCmd
  .command('list')
  .description('List search jobs')
  .option('--count <n>', 'Max results', (v) => parseInt(v, 10))
  .option('--offset <n>', 'Result offset', (v) => parseInt(v, 10))
  .action((opts, cmd) => run(cmd, c => c.listSearchJobs({ count: opts.count, offset: opts.offset })));

searchCmd
  .command('create <spl>')
  .description('Create a search job (returns sid)')
  .option('--earliest <time>', 'Earliest time (e.g. -24h)')
  .option('--latest <time>', 'Latest time (e.g. now)')
  .option('--exec-mode <mode>', 'normal, blocking, or oneshot', 'normal')
  .option('--max-count <n>', 'Result count limit', (v) => parseInt(v, 10))
  .action((spl: string, opts, cmd) =>
    run(cmd, c =>
      c.createSearchJob({
        search: spl,
        earliestTime: opts.earliest,
        latestTime: opts.latest,
        execMode: opts.execMode,
        maxCount: opts.maxCount,
      }),
    ),
  );

searchCmd
  .command('get <sid>')
  .description('Get a search job status')
  .action((sid: string, _opts, cmd) => run(cmd, c => c.getSearchJob(sid)));

searchCmd
  .command('results <sid>')
  .description('Get search job results')
  .option('--count <n>', 'Max results', (v) => parseInt(v, 10))
  .option('--offset <n>', 'Result offset', (v) => parseInt(v, 10))
  .action((sid: string, opts, cmd) =>
    run(cmd, c => c.getSearchResults(sid, { count: opts.count, offset: opts.offset })),
  );

searchCmd
  .command('pause <sid>')
  .description('Pause a search job')
  .action((sid: string, _opts, cmd) => run(cmd, c => c.pauseSearchJob(sid)));

searchCmd
  .command('unpause <sid>')
  .description('Unpause a search job')
  .action((sid: string, _opts, cmd) => run(cmd, c => c.unpauseSearchJob(sid)));

searchCmd
  .command('finalize <sid>')
  .description('Finalize (stop) a search job')
  .action((sid: string, _opts, cmd) => run(cmd, c => c.finalizeSearchJob(sid)));

searchCmd
  .command('delete <sid>')
  .description('Delete a search job')
  .action((sid: string, _opts, cmd) => run(cmd, c => c.deleteSearchJob(sid)));

// ============================================
// Saved Search Commands
// ============================================
const savedCmd = program.command('saved').description('Saved searches');

savedCmd
  .command('list')
  .description('List saved searches')
  .option('--count <n>', 'Max results', (v) => parseInt(v, 10))
  .action((opts, cmd) => run(cmd, c => c.listSavedSearches({ count: opts.count })));

savedCmd
  .command('get <name>')
  .description('Get a saved search')
  .action((name: string, _opts, cmd) => run(cmd, c => c.getSavedSearch(name)));

savedCmd
  .command('create <name> <spl>')
  .description('Create a saved search')
  .option('--description <text>', 'Description')
  .option('--cron <schedule>', 'Cron schedule (implies scheduled)')
  .option('--earliest <time>', 'Dispatch earliest time')
  .option('--latest <time>', 'Dispatch latest time')
  .action((name: string, spl: string, opts, cmd) =>
    run(cmd, c =>
      c.createSavedSearch({
        name,
        search: spl,
        description: opts.description,
        cronSchedule: opts.cron,
        isScheduled: Boolean(opts.cron),
        earliestTime: opts.earliest,
        latestTime: opts.latest,
      }),
    ),
  );

savedCmd
  .command('update <name>')
  .description('Update a saved search')
  .option('--search <spl>', 'New SPL')
  .option('--description <text>', 'Description')
  .option('--cron <schedule>', 'Cron schedule')
  .option('--disabled <bool>', 'Disable (true/false)', (v) => v === 'true')
  .action((name: string, opts, cmd) =>
    run(cmd, c =>
      c.updateSavedSearch(name, {
        search: opts.search,
        description: opts.description,
        cronSchedule: opts.cron,
        disabled: opts.disabled,
      }),
    ),
  );

savedCmd
  .command('delete <name>')
  .description('Delete a saved search')
  .action((name: string, _opts, cmd) => run(cmd, c => c.deleteSavedSearch(name)));

// ============================================
// Index Commands
// ============================================
const indexCmd = program.command('index').description('Indexes');

indexCmd
  .command('list')
  .description('List indexes')
  .option('--count <n>', 'Max results', (v) => parseInt(v, 10))
  .action((opts, cmd) => run(cmd, c => c.listIndexes({ count: opts.count })));

indexCmd
  .command('get <name>')
  .description('Get an index')
  .action((name: string, _opts, cmd) => run(cmd, c => c.getIndex(name)));

indexCmd
  .command('create <name>')
  .description('Create an index')
  .option('--max-size <mb>', 'Max total data size (MB)', (v) => parseInt(v, 10))
  .option('--frozen-secs <secs>', 'Frozen time period (seconds)', (v) => parseInt(v, 10))
  .option('--datatype <type>', 'event or metric')
  .action((name: string, opts, cmd) =>
    run(cmd, c =>
      c.createIndex({
        name,
        maxTotalDataSizeMB: opts.maxSize,
        frozenTimePeriodInSecs: opts.frozenSecs,
        datatype: opts.datatype,
      }),
    ),
  );

indexCmd
  .command('delete <name>')
  .description('Delete an index')
  .action((name: string, _opts, cmd) => run(cmd, c => c.deleteIndex(name)));

// ============================================
// HEC Token Commands
// ============================================
const hecCmd = program.command('hec').description('HTTP Event Collector tokens');

hecCmd
  .command('list')
  .description('List HEC tokens')
  .action((_opts, cmd) => run(cmd, c => c.listHecTokens()));

hecCmd
  .command('create <name>')
  .description('Create a HEC token')
  .option('--index <index>', 'Default index')
  .option('--source <source>', 'Default source')
  .option('--sourcetype <sourcetype>', 'Default sourcetype')
  .option('--ack', 'Enable indexer acknowledgement')
  .action((name: string, opts, cmd) =>
    run(cmd, c =>
      c.createHecToken({
        name,
        index: opts.index,
        source: opts.source,
        sourcetype: opts.sourcetype,
        useACK: opts.ack,
      }),
    ),
  );

hecCmd
  .command('delete <name>')
  .description('Delete a HEC token')
  .action((name: string, _opts, cmd) => run(cmd, c => c.deleteHecToken(name)));

// ============================================
// User Commands
// ============================================
const userCmd = program.command('user').description('Users');

userCmd
  .command('list')
  .description('List users')
  .action((_opts, cmd) => run(cmd, c => c.listUsers()));

userCmd
  .command('get <name>')
  .description('Get a user')
  .action((name: string, _opts, cmd) => run(cmd, c => c.getUser(name)));

userCmd
  .command('create <name> <password>')
  .description('Create a user')
  .requiredOption('--roles <roles>', 'Comma-separated roles')
  .option('--realname <name>', 'Real name')
  .option('--email <email>', 'Email address')
  .action((name: string, password: string, opts, cmd) =>
    run(cmd, c =>
      c.createUser({
        name,
        password,
        roles: String(opts.roles).split(',').map((r: string) => r.trim()).filter(Boolean),
        realname: opts.realname,
        email: opts.email,
      }),
    ),
  );

userCmd
  .command('delete <name>')
  .description('Delete a user')
  .action((name: string, _opts, cmd) => run(cmd, c => c.deleteUser(name)));

// ============================================
// Role Commands
// ============================================
const roleCmd = program.command('role').description('Roles');

roleCmd
  .command('list')
  .description('List roles')
  .action((_opts, cmd) => run(cmd, c => c.listRoles()));

roleCmd
  .command('get <name>')
  .description('Get a role')
  .action((name: string, _opts, cmd) => run(cmd, c => c.getRole(name)));

// ============================================
// Message Commands
// ============================================
const messageCmd = program.command('message').description('Server messages');

messageCmd
  .command('list')
  .description('List messages')
  .action((_opts, cmd) => run(cmd, c => c.listMessages()));

messageCmd
  .command('delete <name>')
  .description('Delete a message')
  .action((name: string, _opts, cmd) => run(cmd, c => c.deleteMessage(name)));

// ============================================
// Alerts & Apps
// ============================================
program
  .command('alerts')
  .description('List fired alerts')
  .action((_opts, cmd) => run(cmd, c => c.listFiredAlerts()));

program
  .command('apps')
  .description('List installed apps')
  .action((_opts, cmd) => run(cmd, c => c.listApps()));

program.parse();
