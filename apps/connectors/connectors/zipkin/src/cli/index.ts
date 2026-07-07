#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Zipkin } from '../api';
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

const CONNECTOR_NAME = 'zipkin';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zipkin connector - Distributed tracing platform API')
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
      process.env.ZIPKIN_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.ZIPKIN_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Zipkin {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZIPKIN_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Zipkin({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

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
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.zipkin.io/v1)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

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
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.zipkin.io/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Traces Commands
// ============================================
const tracesCmd = program
  .command('traces')
  .description('Manage distributed traces');

tracesCmd
  .command('list')
  .description('List traces')
  .option('--service-name <name>', 'Filter by service name')
  .option('--span-name <name>', 'Filter by span name')
  .option('--annotation-query <query>', 'Annotation query filter')
  .option('--min-duration <micros>', 'Minimum span duration in microseconds')
  .option('--max-duration <micros>', 'Maximum span duration in microseconds')
  .option('--end-ts <ms>', 'End timestamp in epoch milliseconds')
  .option('--lookback <ms>', 'Lookback window in milliseconds')
  .option('-n, --limit <number>', 'Maximum number of traces', '10')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTraces({
        serviceName: opts.serviceName,
        spanName: opts.spanName,
        annotationQuery: opts.annotationQuery,
        minDuration: opts.minDuration ? parseInt(opts.minDuration, 10) : undefined,
        maxDuration: opts.maxDuration ? parseInt(opts.maxDuration, 10) : undefined,
        endTs: opts.endTs ? parseInt(opts.endTs, 10) : undefined,
        lookback: opts.lookback ? parseInt(opts.lookback, 10) : undefined,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      print(result, getFormat(tracesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tracesCmd
  .command('get <traceId>')
  .description('Get a trace by ID')
  .action(async (traceId: string) => {
    try {
      const client = getClient();
      const result = await client.getTrace(traceId);
      print(result, getFormat(tracesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tracesCmd
  .command('create')
  .description('Create a trace from JSON spans')
  .requiredOption('--json <json>', 'JSON array of spans or single span object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const spans = parseJsonOption(opts.json, '--json');
      const result = await client.createTrace(spans as never);
      success('Trace created');
      if (result && Object.keys(result as object).length > 0) {
        print(result, getFormat(tracesCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Events Commands
// ============================================
const eventsCmd = program
  .command('events')
  .description('Manage trace events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--trace-id <id>', 'Filter by trace ID')
  .option('--span-id <id>', 'Filter by span ID')
  .option('-n, --limit <number>', 'Maximum number of events')
  .option('--offset <number>', 'Pagination offset')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents({
        traceId: opts.traceId,
        spanId: opts.spanId,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Command
// ============================================
program
  .command('search')
  .description('Search traces via POST /search')
  .option('--json <json>', 'Full search request body as JSON')
  .option('--query <query>', 'Search query string')
  .option('--service-name <name>', 'Filter by service name')
  .option('--span-name <name>', 'Filter by span name')
  .option('--annotation-query <query>', 'Annotation query filter')
  .option('--min-duration <micros>', 'Minimum span duration in microseconds')
  .option('--max-duration <micros>', 'Maximum span duration in microseconds')
  .option('--end-ts <ms>', 'End timestamp in epoch milliseconds')
  .option('--lookback <ms>', 'Lookback window in milliseconds')
  .option('-n, --limit <number>', 'Maximum number of traces', '10')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params = opts.json
        ? (parseJsonOption(opts.json, '--json') as import('../types').SearchParams)
        : {
            query: opts.query,
            serviceName: opts.serviceName,
            spanName: opts.spanName,
            annotationQuery: opts.annotationQuery,
            minDuration: opts.minDuration ? parseInt(opts.minDuration, 10) : undefined,
            maxDuration: opts.maxDuration ? parseInt(opts.maxDuration, 10) : undefined,
            endTs: opts.endTs ? parseInt(opts.endTs, 10) : undefined,
            lookback: opts.lookback ? parseInt(opts.lookback, 10) : undefined,
            limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
          };

      const result = await client.searchTraces(params);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request Command
// ============================================
program
  .command('raw <method> <path>')
  .description('Send a raw API request')
  .option('--json <json>', 'Request body as JSON')
  .option('--params <json>', 'Query parameters as JSON object')
  .action(async (method: string, path: string, opts, cmd) => {
    const normalizedMethod = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(normalizedMethod)) {
      error(`Unsupported HTTP method: ${method}`);
      process.exit(1);
    }

    try {
      const client = getClient();
      const body = opts.json ? parseJsonOption(opts.json, '--json') : undefined;
      const params = opts.params
        ? (parseJsonOption(opts.params, '--params') as Record<string, string | number | boolean | undefined>)
        : undefined;

      const result = await client.rawRequest(
        normalizedMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        path,
        { body: body as never, params },
      );
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
