#!/usr/bin/env bun
import { Command } from 'commander';
import { WebPageTest } from '../api';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getActiveProfileName,
  getApiKey,
  getBaseUrl,
  getClassicBaseUrl,
  getConfigDir,
  getCurrentProfile,
  listProfiles,
  loadProfile,
  profileExists,
  setApiKey,
  setBaseUrl,
  setClassicBaseUrl,
  setCurrentProfile,
  setProfileOverride,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { error, info, print, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-webpagetest';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WebPageTest connector - Web performance testing and monitoring')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides profile)')
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
    if (opts.apiKey) {
      process.env.WEBPAGETEST_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WebPageTest {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-api-key <key>" or set WEBPAGETEST_API_KEY.`);
    process.exit(1);
  }

  return new WebPageTest({
    apiKey,
    baseUrl: getBaseUrl(),
    classicBaseUrl: getClassicBaseUrl(),
  });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
    for (const profile of profiles) {
      const marker = profile === current ? ' (active)' : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'REST API base URL')
  .option('--classic-base-url <url>', 'Classic API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      classicBaseUrl: opts.classicBaseUrl,
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
    if (!deleteProfile(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('set-api-key <key>')
  .description('Set API key for the active profile')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile "${getActiveProfileName()}"`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set REST API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`REST base URL saved to profile "${getActiveProfileName()}"`);
  });

configCmd
  .command('set-classic-base-url <url>')
  .description('Set classic API base URL')
  .action((url: string) => {
    setClassicBaseUrl(url);
    success(`Classic base URL saved to profile "${getActiveProfileName()}"`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = loadProfile();
    console.log(`Profile: ${getActiveProfileName()}`);
    console.log(`Config dir: ${getConfigDir()}`);
    console.log(`API key: ${profile.apiKey ? `${profile.apiKey.slice(0, 6)}...` : '(not set)'}`);
    console.log(`REST base URL: ${profile.baseUrl || '(default)'}`);
    console.log(`Classic base URL: ${profile.classicBaseUrl || '(default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear active profile credentials')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

const testsCmd = program.command('tests').description('REST test operations');

testsCmd
  .command('list')
  .description('List tests')
  .option('--limit <n>', 'Maximum results')
  .option('--offset <n>', 'Pagination offset')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.limit) params.limit = Number(opts.limit);
      if (opts.offset) params.offset = Number(opts.offset);
      const result = await client.listTests(params);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('create')
  .description('Create a test via REST API')
  .requiredOption('--url <url>', 'URL to test')
  .option('--location <location>', 'Test location')
  .option('--runs <n>', 'Number of runs', '1')
  .option('--label <label>', 'Test label')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const body = {
        url: opts.url,
        location: opts.location,
        runs: Number(opts.runs),
        label: opts.label,
        ...parseJsonOption(opts.body, '--body'),
      };
      const result = await client.createTest(body);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('get <testId>')
  .description('Get a test by ID')
  .action(async (testId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.getTest(testId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events')
  .option('--limit <n>', 'Maximum results')
  .option('--offset <n>', 'Pagination offset')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.limit) params.limit = Number(opts.limit);
      if (opts.offset) params.offset = Number(opts.offset);
      const result = await client.listEvents(params);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search WebPageTest data')
  .option('--query <query>', 'Search query')
  .option('--body <json>', 'Full JSON search body')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const body = {
        query: opts.query,
        ...parseJsonOption(opts.body, '--body'),
      };
      const result = await client.search(body);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const classicCmd = program.command('classic').description('Classic WebPageTest PHP API');

classicCmd
  .command('run')
  .description('Submit a test via runtest.php')
  .requiredOption('--url <url>', 'URL to test')
  .option('--location <location>', 'Test location')
  .option('--runs <n>', 'Number of runs', '1')
  .option('--label <label>', 'Test label')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.runClassicTest({
        url: opts.url,
        location: opts.location,
        runs: Number(opts.runs),
        label: opts.label,
        f: 'json',
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

classicCmd
  .command('status <testId>')
  .description('Get test status via testStatus.php')
  .action(async (testId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.getClassicTestStatus(testId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

classicCmd
  .command('result <testId>')
  .description('Get test results via jsonResult.php')
  .action(async (testId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.getClassicTestResult(testId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw REST API request')
  .requiredOption('--path <path>', 'API path (e.g. /tests)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        query: parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined> | undefined,
        body: parseJsonOption(opts.body, '--body'),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
