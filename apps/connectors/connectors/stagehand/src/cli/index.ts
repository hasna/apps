#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Stagehand } from '../api';
import type {
  ActRequest,
  AgentExecuteRequest,
  ExtractRequest,
  NavigateRequest,
  ObserveRequest,
  SessionStartRequest,
} from '../types';
import {
  getBrowserbaseApiKey,
  setBrowserbaseApiKey,
  getBrowserbaseProjectId,
  setBrowserbaseProjectId,
  getModelApiKey,
  setModelApiKey,
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

const CONNECTOR_NAME = 'connect-stagehand';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stagehand session API connector for Browserbase cloud browsers')
  .version(VERSION)
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
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function mask(value?: string): string {
  if (!value) {
    return chalk.gray('not set');
  }
  if (value.length <= 12) {
    return '***';
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getClient(): Stagehand {
  const browserbaseApiKey = getBrowserbaseApiKey();
  const modelApiKey = getModelApiKey();

  if (!browserbaseApiKey) {
    error(`No Browserbase API key configured. Run "${CONNECTOR_NAME} config set-browserbase-key <key>" or set BROWSERBASE_API_KEY.`);
    process.exit(1);
  }

  if (!modelApiKey) {
    error(`No model API key configured. Run "${CONNECTOR_NAME} config set-model-key <key>" or set MODEL_API_KEY.`);
    process.exit(1);
  }

  return new Stagehand({
    browserbaseApiKey,
    browserbaseProjectId: getBrowserbaseProjectId(),
    modelApiKey,
    baseUrl: getBaseUrl(),
  });
}

function parseJson(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid ${label} JSON: ${String(err)}`);
    process.exit(1);
  }
}

function parseJsonFile(path: string, label: string): Record<string, unknown> {
  return parseJson(readFileSync(path, 'utf-8'), label);
}

function loadPayload(opts: { body?: string; file?: string }, label: string): Record<string, unknown> {
  if (opts.body) {
    return parseJson(opts.body, label);
  }
  if (opts.file) {
    return parseJsonFile(opts.file, `${label} file`);
  }
  return {};
}

function parseQueryOption(value: string): Record<string, string | number | boolean | undefined> {
  const parsed = parseJson(value, 'query');
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === undefined
    ) {
      query[key] = entry;
    }
  }
  return query;
}

function numberOption(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    error(`${label} must be a number`);
    process.exit(1);
  }
  return parsed;
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
    profiles.forEach((profile) => {
      const isActive = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${isActive}`);
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
  .option('--browserbase-api-key <key>', 'Browserbase API key')
  .option('--project-id <id>', 'Browserbase project ID, if your account still requires it')
  .option('--model-api-key <key>', 'Model provider API key')
  .option('--base-url <url>', 'Stagehand API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      browserbaseApiKey: opts.browserbaseApiKey,
      browserbaseProjectId: opts.projectId,
      modelApiKey: opts.modelApiKey,
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
    info(`Browserbase API Key: ${mask(config.browserbaseApiKey)}`);
    info(`Browserbase Project ID: ${config.browserbaseProjectId || chalk.gray('not set')}`);
    info(`Model API Key: ${mask(config.modelApiKey)}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-browserbase-key <apiKey>')
  .description('Set Browserbase API key')
  .action((apiKey: string) => {
    setBrowserbaseApiKey(apiKey);
    success(`Browserbase API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-project-id <projectId>')
  .description('Set Browserbase project ID for accounts that still require x-bb-project-id')
  .action((projectId: string) => {
    setBrowserbaseProjectId(projectId);
    success(`Browserbase project ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-model-key <apiKey>')
  .description('Set model provider API key')
  .action((apiKey: string) => {
    setModelApiKey(apiKey);
    success(`Model API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set custom Stagehand API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Browserbase API Key: ${mask(getBrowserbaseApiKey())}`);
    info(`Browserbase Project ID: ${getBrowserbaseProjectId() || chalk.gray('not set')}`);
    info(`Model API Key: ${mask(getModelApiKey())}`);
    info(`Base URL: ${getBaseUrl()}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const sessionsCmd = program.command('sessions').alias('session').description('Stagehand session operations');

sessionsCmd
  .command('start')
  .description('Start a new Stagehand browser session')
  .option('-m, --model <name>', 'Model name, for example openai/gpt-5.4-mini')
  .option('-b, --body <json>', 'Additional session start payload JSON')
  .option('--file <path>', 'Session start payload JSON file')
  .action(async (opts) => {
    try {
      const body = loadPayload(opts, 'session start body') as Partial<SessionStartRequest>;
      const modelName = opts.model || body.modelName;
      if (!modelName || typeof modelName !== 'string') {
        error('Provide --model or a body with modelName');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.startSession({ ...body, modelName } as SessionStartRequest);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('navigate <sessionId> <url>')
  .description('Navigate a session to a URL')
  .option('--wait-until <state>', 'load, domcontentloaded, or networkidle')
  .option('--timeout <ms>', 'Navigation timeout in milliseconds')
  .option('-b, --body <json>', 'Additional navigate payload JSON')
  .option('--file <path>', 'Additional navigate payload JSON file')
  .action(async (sessionId: string, url: string, opts) => {
    try {
      const body = loadPayload(opts, 'navigate body') as Partial<NavigateRequest>;
      const options = {
        ...(body.options || {}),
        ...(opts.waitUntil ? { waitUntil: opts.waitUntil } : {}),
        ...(opts.timeout ? { timeout: numberOption(opts.timeout, '--timeout') } : {}),
      };

      const client = getClient();
      const result = await client.navigate(sessionId, { ...body, url, options });
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('act <sessionId> <instruction>')
  .description('Perform an action in a session')
  .option('-b, --body <json>', 'Additional act payload JSON')
  .option('--file <path>', 'Additional act payload JSON file')
  .action(async (sessionId: string, instruction: string, opts) => {
    try {
      const body = loadPayload(opts, 'act body') as Partial<ActRequest>;
      const client = getClient();
      const result = await client.act(sessionId, { ...body, input: body.input || instruction } as ActRequest);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('observe <sessionId> [instruction]')
  .description('Observe available actions in a session')
  .option('-b, --body <json>', 'Additional observe payload JSON')
  .option('--file <path>', 'Additional observe payload JSON file')
  .action(async (sessionId: string, instruction: string | undefined, opts) => {
    try {
      const body = loadPayload(opts, 'observe body') as Partial<ObserveRequest>;
      const client = getClient();
      const result = await client.observe(sessionId, { ...body, instruction: body.instruction || instruction });
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('extract <sessionId> [instruction]')
  .description('Extract data from a session page')
  .option('--schema <json>', 'JSON Schema object for extracted data')
  .option('-b, --body <json>', 'Additional extract payload JSON')
  .option('--file <path>', 'Additional extract payload JSON file')
  .action(async (sessionId: string, instruction: string | undefined, opts) => {
    try {
      const body = loadPayload(opts, 'extract body') as Partial<ExtractRequest>;
      const schema = opts.schema ? parseJson(opts.schema, 'schema') : body.schema;
      const client = getClient();
      const result = await client.extract(sessionId, { ...body, instruction: body.instruction || instruction, schema });
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('agent <sessionId> <instruction>')
  .description('Execute an AI agent in a session')
  .option('-m, --model <name>', 'Agent model name')
  .option('--max-steps <number>', 'Maximum agent steps')
  .option('-b, --body <json>', 'Additional agentExecute payload JSON')
  .option('--file <path>', 'Additional agentExecute payload JSON file')
  .action(async (sessionId: string, instruction: string, opts) => {
    try {
      const body = loadPayload(opts, 'agent body') as Partial<AgentExecuteRequest>;
      const agentConfig = {
        ...(body.agentConfig || {}),
        ...(opts.model ? { model: opts.model } : {}),
      };
      const executeOptions = {
        ...(body.executeOptions || {}),
        instruction,
        ...(opts.maxSteps ? { maxSteps: numberOption(opts.maxSteps, '--max-steps') } : {}),
      };

      const client = getClient();
      const result = await client.agentExecute(sessionId, { ...body, agentConfig, executeOptions } as AgentExecuteRequest);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('replay <sessionId>')
  .description('Get replay metrics for a session')
  .action(async (sessionId: string) => {
    try {
      const result = await getClient().replay(sessionId);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('end <sessionId>')
  .description('End a browser session')
  .action(async (sessionId: string) => {
    try {
      const result = await getClient().endSession(sessionId);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Make a raw API request');

rawCmd
  .command('request')
  .description('Send a raw HTTP request to the Stagehand API')
  .requiredOption('-p, --path <path>', 'API path, for example /v1/sessions/start')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-q, --query <json>', 'Query parameters JSON object')
  .option('-b, --body <json>', 'Request body JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        query: opts.query ? parseQueryOption(opts.query) : undefined,
        body: opts.body ? parseJson(opts.body, 'body') : undefined,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
