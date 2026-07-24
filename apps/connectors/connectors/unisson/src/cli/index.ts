#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Unisson } from '../api';
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

const CONNECTOR_NAME = 'connect-unisson';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Unisson Runner API connector — product expert agents, tasks, and knowledge base')
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
      process.env.UNISSON_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Unisson {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UNISSON_API_KEY.`);
    process.exit(1);
  }
  return new Unisson({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined): Record<string, string | number | boolean | undefined> | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as Record<string, string | number | boolean | undefined>;
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
      const active = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${active}`);
    });
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
    console.log(chalk.bold(`Profile: ${profileName}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
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
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || 'https://api.unisson.ai/v1 (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const agentsCmd = program.command('agents').description('Product expert agents');

agentsCmd
  .command('list')
  .description('List Unisson agents')
  .option('--query <json>', 'Query parameters as JSON')
  .action(async (opts, cmd) => {
    try {
      const result = await getClient().agents.list(parseJsonOption(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

agentsCmd
  .command('get <agentId>')
  .description('Get an agent by ID')
  .action(async (agentId: string, _opts, cmd) => {
    try {
      const result = await getClient().agents.get(agentId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

agentsCmd
  .command('create')
  .description('Create a product expert agent')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts, cmd) => {
    try {
      const body = parseJsonOption(opts.body) ?? {};
      const result = await getClient().agents.create(body);
      success('Agent created');
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const tasksCmd = program.command('tasks').description('Customer tasks');

tasksCmd
  .command('list')
  .description('List Unisson tasks')
  .option('--query <json>', 'Query parameters as JSON')
  .action(async (opts, cmd) => {
    try {
      const result = await getClient().tasks.list(parseJsonOption(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('get <taskId>')
  .description('Get a task by ID')
  .action(async (taskId: string, _opts, cmd) => {
    try {
      const result = await getClient().tasks.get(taskId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('create')
  .description('Create a customer task')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts, cmd) => {
    try {
      const body = parseJsonOption(opts.body) ?? {};
      const result = await getClient().tasks.create(body);
      success('Task created');
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const knowledgeCmd = program.command('knowledge').description('Knowledge base');

knowledgeCmd
  .command('articles')
  .description('List knowledge base articles')
  .option('--query <json>', 'Query parameters as JSON')
  .action(async (opts, cmd) => {
    try {
      const result = await getClient().knowledge.listArticles(parseJsonOption(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

knowledgeCmd
  .command('sync')
  .description('Sync the knowledge base')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts, cmd) => {
    try {
      const body = parseJsonOption(opts.body) ?? {};
      const result = await getClient().knowledge.sync(body);
      success('Knowledge sync started');
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Call any Unisson API path')
  .requiredOption('--path <path>', 'API path (e.g. /runner/execute)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts, cmd) => {
    try {
      const result = await getClient().rawRequest(opts.path, {
        method: opts.method,
        query: parseJsonOption(opts.query),
        body: parseJsonOption(opts.body),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
