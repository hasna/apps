#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wayco, WaycoClient } from '../api';
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

const CONNECTOR_NAME = 'connect-wayco';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wayco connector - Med-legal case management, lead intake, and voice AI')
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
      process.env.WAYCO_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Wayco {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WAYCO_API_KEY.`);
    process.exit(1);
  }
  return new Wayco({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function parseQueryOption(value: string | undefined, label: string): Record<string, string | number | boolean | undefined> | undefined {
  const parsed = parseJsonOption(value, label);
  if (!parsed) return undefined;
  return parsed as Record<string, string | number | boolean | undefined>;
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all CLI profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }
    success('Profiles:');
    profiles.forEach((p) => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a CLI profile')
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
  .description('Create a new CLI profile')
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

profileCmd
  .command('delete <name>')
  .description('Delete a CLI profile')
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
  .description('Show CLI profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || WaycoClient.getDefaultBaseUrl()}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
  .description('Set API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || WaycoClient.getDefaultBaseUrl()}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('list-cases')
  .description('List Wayco med-legal cases')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--status <status>', 'Filter by case status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = parseQueryOption(opts.query, 'query') ?? (opts.status ? { status: opts.status } : undefined);
      print(await client.listCases(query), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-case <caseId>')
  .description('Get a Wayco med-legal case')
  .action(async (caseId: string) => {
    try {
      print(await getClient().getCase(caseId), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create-lead')
  .description('Create a Wayco intake lead')
  .requiredOption('--body <json>', 'Lead payload as JSON object')
  .action(async (opts) => {
    try {
      const body = parseJsonOption(opts.body, 'body') ?? {};
      print(await getClient().createLead(body), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('qualify-lead <leadId>')
  .description('Qualify a Wayco intake lead')
  .option('--body <json>', 'Qualification payload as JSON object', '{}')
  .action(async (leadId: string, opts) => {
    try {
      const body = parseJsonOption(opts.body, 'body') ?? {};
      print(await getClient().qualifyLead(leadId, body), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('summarize-medical-records <caseId>')
  .description('Summarize medical records for a Wayco case')
  .option('--body <json>', 'Summary request payload as JSON object', '{}')
  .action(async (caseId: string, opts) => {
    try {
      const body = parseJsonOption(opts.body, 'body') ?? {};
      print(await getClient().summarizeMedicalRecords(caseId, body), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('match-providers <caseId>')
  .description('Match providers for a Wayco case')
  .option('--body <json>', 'Provider match payload as JSON object', '{}')
  .action(async (caseId: string, opts) => {
    try {
      const body = parseJsonOption(opts.body, 'body') ?? {};
      print(await getClient().matchProviders(caseId, body), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-voice-call <callId>')
  .description('Get a Wayco voice call')
  .action(async (callId: string) => {
    try {
      print(await getClient().getVoiceCall(callId), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Call any Wayco API path')
  .requiredOption('--path <path>', 'API path (e.g. /cases or /custom/intake)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .action(async (opts) => {
    try {
      const method = String(opts.method || 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      const result = await getClient().rawRequest({
        path: opts.path,
        method,
        query: parseQueryOption(opts.query, 'query'),
        body: parseJsonOption(opts.body, 'body'),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
