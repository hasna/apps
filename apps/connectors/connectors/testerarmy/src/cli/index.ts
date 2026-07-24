#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TesterArmy } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
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
import type { JsonBody, QueryParams } from '../types';

const CONNECTOR_NAME = 'testerarmy';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TesterArmy API connector CLI - Agent-first QA automation')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
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
      process.env.TESTERARMY_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.TESTERARMY_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseJson(value: string | undefined, label: string): JsonBody | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as JsonBody;
  } catch (err) {
    error(`Invalid ${label} JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function parseQuery(value: string | undefined): QueryParams | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    const query: QueryParams = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (val === undefined || val === null) continue;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        query[key] = val;
      } else {
        query[key] = String(val);
      }
    }
    return query;
  } catch (err) {
    error(`Invalid query JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  const parsed = parseJson(value, 'headers');
  if (!parsed) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed)) {
    headers[key] = String(val);
  }
  return headers;
}

function getClient(): TesterArmy {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TESTERARMY_API_KEY.`);
    process.exit(1);
  }
  return new TesterArmy({ apiKey, baseUrl: getBaseUrl() });
}

async function runCommand(cmd: Command, action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
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
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
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
    info(`Base URL: ${config.baseUrl || chalk.gray('not set (defaults to https://tester.army)')}`);
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
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('not set (defaults to https://tester.army)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const projectsCmd = program.command('projects').description('Manage TesterArmy projects');

projectsCmd
  .command('list')
  .alias('list-projects')
  .description('List projects')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () => getClient().projects.list(parseQuery(opts.query)));
  });

projectsCmd
  .command('create')
  .alias('create-project')
  .description('Create a project')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () => getClient().projects.create(parseJson(opts.data, 'data') || {}));
  });

projectsCmd
  .command('get <projectId>')
  .alias('get-project')
  .description('Get a project')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.get(projectId, parseQuery(opts.query)));
  });

projectsCmd
  .command('update <projectId>')
  .alias('update-project')
  .description('Update a project')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.update(projectId, parseJson(opts.data, 'data') || {}));
  });

projectsCmd
  .command('delete <projectId>')
  .alias('delete-project')
  .description('Delete a project')
  .action(async function (this: Command, projectId: string) {
    await runCommand(this, async () => getClient().projects.delete(projectId));
  });

projectsCmd
  .command('list-credentials <projectId>')
  .alias('list-project-credentials')
  .description('List project credentials')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.listCredentials(projectId, parseQuery(opts.query)));
  });

projectsCmd
  .command('create-credential <projectId>')
  .alias('create-project-credential')
  .description('Create a project credential')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.createCredential(projectId, parseJson(opts.data, 'data') || {}));
  });

projectsCmd
  .command('list-memories <projectId>')
  .alias('list-project-memories')
  .description('List project memories')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.listMemories(projectId, parseQuery(opts.query)));
  });

projectsCmd
  .command('create-memory <projectId>')
  .alias('create-project-memory')
  .description('Create a project memory')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.createMemory(projectId, parseJson(opts.data, 'data') || {}));
  });

projectsCmd
  .command('delete-memory <projectId> <memoryId>')
  .alias('delete-project-memory')
  .description('Delete a project memory')
  .action(async function (this: Command, projectId: string, memoryId: string) {
    await runCommand(this, async () => getClient().projects.deleteMemory(projectId, memoryId));
  });

projectsCmd
  .command('list-files <projectId>')
  .alias('list-project-files')
  .description('List project files')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.listFiles(projectId, parseQuery(opts.query)));
  });

projectsCmd
  .command('list-mobile-apps <projectId>')
  .alias('list-project-mobile-apps')
  .description('List project mobile apps')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.listMobileApps(projectId, parseQuery(opts.query)));
  });

projectsCmd
  .command('delete-mobile-app <projectId> <appId>')
  .alias('delete-project-mobile-app')
  .description('Delete a project mobile app')
  .action(async function (this: Command, projectId: string, appId: string) {
    await runCommand(this, async () => getClient().projects.deleteMobileApp(projectId, appId));
  });

projectsCmd
  .command('initiate-mobile-upload <projectId>')
  .alias('initiate-project-mobile-app-upload')
  .description('Initiate a mobile app presigned upload')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.initiateMobileAppUpload(projectId, parseJson(opts.data, 'data') || {}));
  });

projectsCmd
  .command('confirm-mobile-upload <projectId>')
  .alias('confirm-project-mobile-app-upload')
  .description('Confirm a completed mobile app upload')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, projectId: string, opts) {
    await runCommand(this, async () => getClient().projects.confirmMobileAppUpload(projectId, parseJson(opts.data, 'data') || {}));
  });

const testsCmd = program.command('tests').description('Manage TesterArmy tests');

testsCmd
  .command('list')
  .alias('list-tests')
  .description('List tests')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () => getClient().tests.list(parseQuery(opts.query)));
  });

testsCmd
  .command('create')
  .alias('create-test')
  .description('Create a test')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () => getClient().tests.create(parseJson(opts.data, 'data') || {}));
  });

testsCmd
  .command('get <testId>')
  .alias('get-test')
  .description('Get a test')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, testId: string, opts) {
    await runCommand(this, async () => getClient().tests.get(testId, parseQuery(opts.query)));
  });

testsCmd
  .command('update <testId>')
  .alias('update-test')
  .description('Update a test')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, testId: string, opts) {
    await runCommand(this, async () => getClient().tests.update(testId, parseJson(opts.data, 'data') || {}));
  });

testsCmd
  .command('delete <testId>')
  .alias('delete-test')
  .description('Delete a test')
  .action(async function (this: Command, testId: string) {
    await runCommand(this, async () => getClient().tests.delete(testId));
  });

testsCmd
  .command('trigger-run <testId>')
  .alias('trigger-test-run')
  .description('Trigger a single test run')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, testId: string, opts) {
    await runCommand(this, async () => getClient().tests.triggerRun(testId, parseJson(opts.data, 'data') || {}));
  });

const groupsCmd = program.command('groups').description('Manage TesterArmy test groups');

groupsCmd
  .command('list')
  .alias('list-groups')
  .description('List groups')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () => getClient().groups.list(parseQuery(opts.query)));
  });

groupsCmd
  .command('create')
  .alias('create-group')
  .description('Create a group')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () => getClient().groups.create(parseJson(opts.data, 'data') || {}));
  });

groupsCmd
  .command('get <groupId>')
  .alias('get-group')
  .description('Get a group')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, groupId: string, opts) {
    await runCommand(this, async () => getClient().groups.get(groupId, parseQuery(opts.query)));
  });

groupsCmd
  .command('update <groupId>')
  .alias('update-group')
  .description('Update a group')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, groupId: string, opts) {
    await runCommand(this, async () => getClient().groups.update(groupId, parseJson(opts.data, 'data') || {}));
  });

groupsCmd
  .command('delete <groupId>')
  .alias('delete-group')
  .description('Delete a group')
  .action(async function (this: Command, groupId: string) {
    await runCommand(this, async () => getClient().groups.delete(groupId));
  });

groupsCmd
  .command('add-test <groupId>')
  .alias('add-test-to-group')
  .description('Add a test to a group')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, groupId: string, opts) {
    await runCommand(this, async () => getClient().groups.addTest(groupId, parseJson(opts.data, 'data') || {}));
  });

groupsCmd
  .command('remove-test <groupId> <testId>')
  .alias('remove-test-from-group')
  .description('Remove a test from a group')
  .action(async function (this: Command, groupId: string, testId: string) {
    await runCommand(this, async () => getClient().groups.removeTest(groupId, testId));
  });

groupsCmd
  .command('trigger-run <groupId>')
  .alias('trigger-group-run')
  .description('Trigger a test group run')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, groupId: string, opts) {
    await runCommand(this, async () => getClient().groups.triggerRun(groupId, parseJson(opts.data, 'data') || {}));
  });

const runsCmd = program.command('runs').description('Manage TesterArmy test runs');

runsCmd
  .command('list')
  .alias('list-runs')
  .description('List runs')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () => getClient().runs.list(parseQuery(opts.query)));
  });

runsCmd
  .command('get <runId>')
  .alias('get-run')
  .description('Get a run')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async function (this: Command, runId: string, opts) {
    await runCommand(this, async () => getClient().runs.get(runId, parseQuery(opts.query)));
  });

runsCmd
  .command('cancel <runId>')
  .alias('cancel-run')
  .description('Cancel a queued or running test run')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .action(async function (this: Command, runId: string, opts) {
    await runCommand(this, async () => getClient().runs.cancel(runId, parseJson(opts.data, 'data') || {}));
  });

const webhooksCmd = program.command('webhooks').description('Trigger TesterArmy webhooks');

webhooksCmd
  .command('trigger-project <webhookId> <secret>')
  .alias('trigger-project-webhook')
  .description('Trigger a project webhook (no API key auth)')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .option('--headers <json>', 'Optional request headers as JSON object')
  .action(async function (this: Command, webhookId: string, secret: string, opts) {
    await runCommand(this, async () =>
      getClient().webhooks.triggerProject(
        webhookId,
        secret,
        parseJson(opts.data, 'data') || {},
        parseHeaders(opts.headers),
      ),
    );
  });

webhooksCmd
  .command('trigger-group <webhookId> <secret>')
  .alias('trigger-group-webhook')
  .description('Trigger a group webhook (no API key auth)')
  .option('--data <json>', 'Request body as JSON object', '{}')
  .option('--headers <json>', 'Optional request headers as JSON object')
  .action(async function (this: Command, webhookId: string, secret: string, opts) {
    await runCommand(this, async () =>
      getClient().webhooks.triggerGroup(
        webhookId,
        secret,
        parseJson(opts.data, 'data') || {},
        parseHeaders(opts.headers),
      ),
    );
  });

program
  .command('raw-request')
  .description('Call any TesterArmy API path')
  .requiredOption('--path <path>', 'API path (e.g. /v1/projects)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--data <json>', 'Request body as JSON object')
  .option('--headers <json>', 'Optional request headers as JSON object')
  .action(async function (this: Command, opts) {
    await runCommand(this, async () =>
      getClient().rawRequest(opts.path, {
        method: opts.method,
        query: parseQuery(opts.query),
        body: parseJson(opts.data, 'data'),
        headers: parseHeaders(opts.headers),
      }),
    );
  });

program.parse();
