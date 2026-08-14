#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TriggerDevApiPlatform } from '../api';
import {
  getApiKey,
  setApiKey,
  getProjectRef,
  setProjectRef,
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

const CONNECTOR_NAME = 'connect-trigger-dev-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Trigger.dev API Platform connector - runs, tasks, schedules, and TRQL queries')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('--project-ref <ref>', 'Project reference (required for PAT auth)')
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
      process.env.TRIGGER_SECRET_KEY = opts.apiKey;
    }
    if (opts.projectRef) {
      process.env.TRIGGER_PROJECT_REF = opts.projectRef;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TriggerDevApiPlatform {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRIGGER_SECRET_KEY / TRIGGER_PAT.`);
    process.exit(1);
  }
  return new TriggerDevApiPlatform({ apiKey, projectRef: getProjectRef() });
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
  .option('--project-ref <ref>', 'Project reference')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, projectRef: opts.projectRef });
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
    info(`Project Ref: ${config.projectRef || chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key (secret key or PAT)')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-project-ref <projectRef>')
  .description('Set project reference (for PAT auth)')
  .action((projectRef: string) => {
    setProjectRef(projectRef);
    success(`Project ref saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    const projectRef = getProjectRef();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Project Ref: ${projectRef || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const runsCmd = program.command('runs').description('Run operations');

runsCmd
  .command('list')
  .description('List runs')
  .option('-l, --limit <number>', 'Page size', '25')
  .option('--after <runId>', 'Cursor: page after run ID')
  .option('--status <statuses>', 'Comma-separated statuses')
  .option('--task <identifiers>', 'Comma-separated task identifiers')
  .option('--period <period>', 'Created-at period (e.g. 7d)')
  .option('--test', 'Filter test runs only')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listRuns({
        pageSize: parseInt(opts.limit, 10),
        pageAfter: opts.after,
        status: opts.status?.split(',').map((s: string) => s.trim()),
        taskIdentifier: opts.task?.split(',').map((s: string) => s.trim()),
        period: opts.period,
        isTest: opts.test ? true : undefined,
      });
      print(result, getFormat(runsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runsCmd
  .command('get <runId>')
  .description('Retrieve a run by ID')
  .action(async (runId: string) => {
    try {
      const client = getClient();
      const result = await client.getRun(runId);
      print(result, getFormat(runsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const tasksCmd = program.command('tasks').description('Task operations');

tasksCmd
  .command('trigger <taskIdentifier>')
  .description('Trigger a task run')
  .option('--payload <json>', 'JSON payload')
  .option('--idempotency-key <key>', 'Idempotency key')
  .action(async (taskIdentifier: string, opts) => {
    try {
      const client = getClient();
      const body: Record<string, unknown> = {};
      if (opts.payload) {
        body.payload = JSON.parse(opts.payload);
      }
      if (opts.idempotencyKey) {
        body.options = { idempotencyKey: opts.idempotencyKey };
      }
      const result = await client.triggerTask(taskIdentifier, body);
      success(`Triggered run: ${result.id}`);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const schedulesCmd = program.command('schedules').description('Schedule operations');

schedulesCmd
  .command('list')
  .description('List schedules')
  .option('--page <number>', 'Page number', '1')
  .option('--per-page <number>', 'Schedules per page', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSchedules({
        page: parseInt(opts.page, 10),
        perPage: parseInt(opts.perPage, 10),
      });
      print(result, getFormat(schedulesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schedulesCmd
  .command('get <scheduleId>')
  .description('Get a schedule by ID')
  .action(async (scheduleId: string) => {
    try {
      const client = getClient();
      const result = await client.getSchedule(scheduleId);
      print(result, getFormat(schedulesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const queryCmd = program.command('query').description('TRQL query operations');

queryCmd
  .command('execute <sql>')
  .description('Execute a TRQL query')
  .option('--scope <scope>', 'environment | project | organization', 'environment')
  .option('--period <period>', 'Time period shorthand (e.g. 7d)')
  .option('--format <format>', 'json | csv', 'json')
  .action(async (sql: string, opts) => {
    try {
      const client = getClient();
      const result = await client.executeQuery({
        query: sql,
        scope: opts.scope,
        period: opts.period,
        format: opts.format,
      });
      print(result, getFormat(queryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
