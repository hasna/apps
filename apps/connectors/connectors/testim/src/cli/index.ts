#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Testim } from '../api';
import {
  getApiKey,
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

const CONNECTOR_NAME = 'testim';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Testim API connector CLI - AI test automation')
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
      process.env.TESTIM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Testim {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TESTIM_API_KEY.`);
    process.exit(1);
  }
  return new Testim({ apiKey, baseUrl: process.env.TESTIM_BASE_URL });
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
    profiles.forEach((p) => {
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
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${process.env.TESTIM_BASE_URL || 'https://api.testim.io'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const testsCmd = program.command('tests').description('Test management commands');

testsCmd
  .command('list')
  .description('List tests for a branch')
  .option('-b, --branch <branch>', 'Branch name', 'master')
  .option('--include-status', 'Include test status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tests.list({
        branch: opts.branch,
        includeTestStatus: opts.includeStatus,
      });
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('get <testId>')
  .description('Get test details by ID')
  .option('-b, --branch <branch>', 'Branch name', 'master')
  .action(async (testId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tests.get(testId, { branch: opts.branch });
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('search <name>')
  .description('Search tests by name')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.tests.search(name);
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('search-suites <name>')
  .description('Search suites by name')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.tests.searchSuites(name);
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('search-plans <name>')
  .description('Search test plans by name')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.tests.searchTestPlans(name);
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('set-status <testId> <status>')
  .description('Update test status (active, draft, evaluating, quarantine)')
  .option('-b, --branch <branch>', 'Branch name', 'master')
  .action(async (testId: string, status: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tests.updateStatus(testId, {
        status,
        branch: opts.branch,
      });
      success('Test status updated');
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('run <testId>')
  .description('Execute a test remotely')
  .option('-b, --branch <branch>', 'Branch name')
  .requiredOption('--grid <grid>', 'Grid name')
  .option('--base-url <url>', 'Base URL override for the run')
  .action(async (testId: string, opts) => {
    try {
      const client = getClient();
      const body: { branch?: string; grid: string; baseUrl?: string } = { grid: opts.grid };
      if (opts.branch) body.branch = opts.branch;
      if (opts.baseUrl) body.baseUrl = opts.baseUrl;

      const result = await client.tests.run(testId, body);
      success('Test execution started');
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('raw')
  .description('Send a raw API request')
  .requiredOption('-m, --method <method>', 'HTTP method')
  .requiredOption('-p, --path <path>', 'API path (e.g. /tests)')
  .option('-q, --query <json>', 'Query parameters as JSON object')
  .option('-b, --body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = opts.query ? JSON.parse(opts.query) : undefined;
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.tests.rawRequest(opts.path, {
        method: opts.method.toUpperCase(),
        params: query,
        body,
      });
      print(result, getFormat(testsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
