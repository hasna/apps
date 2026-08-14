#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Standout } from '../api';
import type { StandoutQueryParams } from '../types';
import {
  getApiKey,
  getBaseUrl,
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-standout';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Standout connector CLI - hiring candidates, roles, and assessments')
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
      process.env.STANDOUT_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Standout {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STANDOUT_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Standout({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function parseQueryOption(value: string | undefined): StandoutQueryParams | undefined {
  return parseJsonOption(value, 'query') as StandoutQueryParams | undefined;
}

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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
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

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

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
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.standout.ai/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const candidatesCmd = program.command('candidates').description('Manage hiring candidates');

candidatesCmd
  .command('list')
  .description('List candidates')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCandidates(parseQueryOption(opts.query));
      print(result, getFormat(candidatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

candidatesCmd
  .command('get <candidateId>')
  .description('Get a candidate by ID')
  .action(async (candidateId: string) => {
    try {
      const client = getClient();
      const result = await client.getCandidate(candidateId);
      print(result, getFormat(candidatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rolesCmd = program.command('roles').description('Manage open roles');

rolesCmd
  .command('list')
  .description('List roles')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listRoles(parseQueryOption(opts.query));
      print(result, getFormat(rolesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const assessmentsCmd = program.command('assessments').description('Manage candidate assessments');

assessmentsCmd
  .command('list')
  .description('List assessments')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listAssessments(parseQueryOption(opts.query));
      print(result, getFormat(assessmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

assessmentsCmd
  .command('create')
  .description('Create an assessment')
  .option('--body <json>', 'Request body as JSON object', '{"candidateId":"","roleId":""}')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, 'body') || {};
      const result = await client.createAssessment(body);
      print(result, getFormat(assessmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <path>')
  .description('Call any Standout API path')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method,
        path,
        query: parseQueryOption(opts.query),
        body: parseJsonOption(opts.body, 'body'),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
