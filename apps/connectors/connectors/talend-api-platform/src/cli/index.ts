#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TalendApiPlatform } from '../api';
import {
  getToken,
  setToken,
  getRegion,
  setRegion,
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
import { success, error, info, print, warn } from '../utils/output';
import type { TalendRegion } from '../types';

const CONNECTOR_NAME = 'connect-talend-api-platform';
const VERSION = '0.1.0';
const REGIONS: TalendRegion[] = ['us', 'eu', 'ap'];

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Talend API Platform connector CLI — manage Talend Cloud tasks, plans, and executions')
  .version(VERSION)
  .option('-t, --token <token>', 'Personal access token (overrides config)')
  .option('-r, --region <region>', 'Talend Cloud region (us, eu, ap)')
  .option('--base-url <url>', 'API base URL override')
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
    if (opts.token) process.env.TALEND_API_TOKEN = opts.token;
    if (opts.region) process.env.TALEND_REGION = opts.region;
    if (opts.baseUrl) process.env.TALEND_BASE_URL = opts.baseUrl;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TalendApiPlatform {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TALEND_API_TOKEN environment variable.`);
    process.exit(1);
  }
  return new TalendApiPlatform({ token, region: getRegion(), baseUrl: getBaseUrl() });
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
  .option('--token <token>', 'Personal access token')
  .option('--region <region>', 'Talend Cloud region (us, eu, ap)')
  .option('--base-url <url>', 'API base URL override')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      token: opts.token,
      region: opts.region,
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
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Region: ${config.region || chalk.gray('default (us)')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set personal access token')
  .action((token: string) => {
    setToken(token);
    success(`Token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-region <region>')
  .description('Set Talend Cloud region (us, eu, ap)')
  .action((region: string) => {
    if (!REGIONS.includes(region as TalendRegion)) {
      error(`Invalid region "${region}". Expected one of: ${REGIONS.join(', ')}`);
      process.exit(1);
    }
    setRegion(region as TalendRegion);
    success(`Region set to ${region} for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL override')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getToken();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Region: ${getRegion()}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Task Commands
// ============================================
const taskCmd = program.command('task').description('Manage tasks (executables)');

taskCmd
  .command('list')
  .description('List tasks')
  .option('-l, --limit <number>', 'Max results')
  .option('--offset <number>', 'Pagination offset')
  .option('--environment <id>', 'Filter by environment id')
  .option('--workspace <id>', 'Filter by workspace id')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listTasks({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        offset: opts.offset ? parseInt(opts.offset) : undefined,
        environmentId: opts.environment,
        workspaceId: opts.workspace,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('get <id>')
  .description('Get a task by executable id')
  .action(async function (this: Command, id: string) {
    try {
      const client = getClient();
      print(await client.getTask(id), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('run <id>')
  .description('Execute a task by executable id')
  .option('--param <key=value...>', 'Runtime parameter override (repeatable)')
  .option('--log-level <level>', 'Log level override')
  .action(async function (this: Command, id: string, opts) {
    try {
      const client = getClient();
      const parameters = parseParams(opts.param);
      const ref = await client.runTask({ executable: id, parameters, logLevel: opts.logLevel });
      success(`Task execution started: ${ref.executionId}`);
      print(ref, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Plan Commands
// ============================================
const planCmd = program.command('plan').description('Manage plans');

planCmd
  .command('list')
  .description('List plans')
  .option('-l, --limit <number>', 'Max results')
  .option('--offset <number>', 'Pagination offset')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listPlans({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        offset: opts.offset ? parseInt(opts.offset) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

planCmd
  .command('get <id>')
  .description('Get a plan by id')
  .action(async function (this: Command, id: string) {
    try {
      const client = getClient();
      print(await client.getPlan(id), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

planCmd
  .command('run <id>')
  .description('Execute a plan by id')
  .action(async function (this: Command, id: string) {
    try {
      const client = getClient();
      const ref = await client.runPlan(id);
      success(`Plan execution started: ${ref.executionId}`);
      print(ref, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Promotion Commands
// ============================================
const promotionCmd = program.command('promotion').description('Manage promotions');

promotionCmd
  .command('list')
  .description('List promotions')
  .option('-l, --limit <number>', 'Max results')
  .option('--offset <number>', 'Pagination offset')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listPromotions({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        offset: opts.offset ? parseInt(opts.offset) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

promotionCmd
  .command('get <id>')
  .description('Get a promotion by id')
  .action(async function (this: Command, id: string) {
    try {
      const client = getClient();
      print(await client.getPromotion(id), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Execution Commands
// ============================================
const executionCmd = program.command('execution').description('Track and control executions');

executionCmd
  .command('status <executionId>')
  .description('Get task execution status')
  .action(async function (this: Command, executionId: string) {
    try {
      const client = getClient();
      const result = await client.getExecution(executionId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

executionCmd
  .command('plan-status <executionId>')
  .description('Get plan execution status')
  .action(async function (this: Command, executionId: string) {
    try {
      const client = getClient();
      print(await client.getPlanExecution(executionId), getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

executionCmd
  .command('stop <executionId>')
  .description('Terminate a running task execution')
  .action(async (executionId: string) => {
    try {
      const client = getClient();
      await client.stopExecution(executionId);
      success(`Execution ${executionId} termination requested`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

/** Parse repeatable `key=value` CLI parameters into a record. */
function parseParams(pairs?: string[]): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) {
      warn(`Ignoring malformed parameter "${pair}" (expected key=value)`);
      continue;
    }
    params[pair.substring(0, idx)] = pair.substring(idx + 1);
  }
  return Object.keys(params).length ? params : undefined;
}

program.parse();
