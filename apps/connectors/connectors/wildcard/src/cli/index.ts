#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wildcard } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getDefaultCollectionId,
  setDefaultCollectionId,
  getProviderAuthJson,
  setProviderAuthJson,
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
  getWildcardConfig,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import type { ProviderAuthConfig } from '../types';
import { readFileSync } from 'fs';

const CONNECTOR_NAME = 'connect-wildcard';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wildcard API connector - tool discovery, endpoint search, and agents.json flow execution')
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
      process.env.WILDCARD_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Wildcard {
  try {
    return new Wildcard(getWildcardConfig());
  } catch (err) {
    error(String(err));
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WILDCARD_API_KEY.`);
    process.exit(1);
  }
}

function parseJsonArg(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function readAgentsJsonFile(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('agents JSON file must contain an object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Unable to read agents JSON from ${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function agentsJsonOptions(cmd: Command): Record<string, unknown> {
  const opts = cmd.opts();
  if (opts.agentsJson) return parseJsonArg(opts.agentsJson, 'agents-json') ?? {};
  if (opts.agentsJsonFile) return readAgentsJsonFile(opts.agentsJsonFile);
  if (opts.agentsJsonUrl) return { agents_json_url: opts.agentsJsonUrl };
  error('Provide --agents-json, --agents-json-file, or --agents-json-url');
  process.exit(1);
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('https://api.wild-card.ai')}`);
  info(`Default Collection: ${config.defaultCollectionId || chalk.gray('not set')}`);
  info(`Provider Auth: ${config.providerAuthJson ? chalk.green('configured') : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved: ${getBaseUrl()}`);
});

configCmd.command('set-collection <id>').description('Set default collection ID').action((id: string) => {
  setDefaultCollectionId(id);
  success(`Default collection ID saved`);
});

configCmd
  .command('set-provider-auth <json>')
  .description('Set provider auth JSON for flow execution')
  .action((json: string) => {
    const parsed = parseJsonArg(json, 'provider-auth');
    if (!parsed) process.exit(1);
    setProviderAuthJson(parsed as Record<string, ProviderAuthConfig>);
    success('Provider auth JSON saved');
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl()}`);
  info(`Default Collection: ${getDefaultCollectionId() || chalk.gray('not set')}`);
  info(`Provider Auth: ${Object.keys(getProviderAuthJson()).length ? chalk.green('configured') : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// API commands
program
  .command('search-tools <query>')
  .description('Search Wildcard tool collections')
  .option('--collection-id <id>', 'Collection ID')
  .action(async (query: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.search.searchTools({
        query,
        collection_id: opts.collectionId,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-flow <flowId>')
  .description('Get a flow definition from a collection')
  .option('--collection-id <id>', 'Collection ID')
  .action(async (flowId: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.search.getFlow({
        flow_id: flowId,
        collection_id: opts.collectionId,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search-endpoints <q>')
  .description('Semantic endpoint search')
  .option('--q2 <description>', 'Secondary query')
  .option('--limit <n>', 'Result limit', '5')
  .option('--index-name <name>', 'Index/collection name')
  .action(async (q: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.query.searchEndpoints({
        q,
        q2: opts.q2,
        limit: Number(opts.limit),
        index_name: opts.indexName,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-action-schema <id>')
  .description('Get action schema by endpoint ID')
  .option('--collection-name <name>', 'Collection name')
  .action(async (id: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.query.getActionSchema({
        id,
        collection_name: opts.collectionName,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-public-tools')
  .description('List public tools')
  .option('--limit <n>', 'Limit')
  .option('--offset <n>', 'Offset')
  .option('--collection-name <name>', 'Collection name')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.query.listPublicTools({
        limit: opts.limit ? Number(opts.limit) : undefined,
        offset: opts.offset ? Number(opts.offset) : undefined,
        collection_name: opts.collectionName,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-endpoint-count')
  .description('Get endpoint count for a collection')
  .option('--collection-name <name>', 'Collection name')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.query.getEndpointCount({
        collection_name: opts.collectionName,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-endpoints')
  .description('List endpoints in a collection')
  .option('--collection-name <name>', 'Collection name')
  .option('--limit <n>', 'Limit')
  .option('--offset <n>', 'Offset')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.query.listEndpoints({
        collection_name: opts.collectionName,
        limit: opts.limit ? Number(opts.limit) : undefined,
        offset: opts.offset ? Number(opts.offset) : undefined,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const agentsOpts = [
  ['--agents-json <json>', 'Inline agents.json object'],
  ['--agents-json-file <path>', 'Path to agents.json file'],
  ['--agents-json-url <url>', 'HTTPS URL to agents.json'],
] as const;

program
  .command('list-flows')
  .description('List flows from agents.json')
  .option(agentsOpts[0][0], agentsOpts[0][1])
  .option(agentsOpts[1][0], agentsOpts[1][1])
  .option(agentsOpts[2][0], agentsOpts[2][1])
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.flows.listFlows(agentsJsonOptions(cmd));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create-flow-prompt')
  .description('Create a natural-language flow prompt from agents.json')
  .option(agentsOpts[0][0], agentsOpts[0][1])
  .option(agentsOpts[1][0], agentsOpts[1][1])
  .option(agentsOpts[2][0], agentsOpts[2][1])
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.flows.createFlowPrompt(agentsJsonOptions(cmd));
      console.log(result);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create-openai-tools')
  .description('Create OpenAI function tools from agents.json flows')
  .option(agentsOpts[0][0], agentsOpts[0][1])
  .option(agentsOpts[1][0], agentsOpts[1][1])
  .option(agentsOpts[2][0], agentsOpts[2][1])
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.flows.createOpenAiTools(agentsJsonOptions(cmd));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('invoke-flow <flowId>')
  .description('Execute an agents.json flow')
  .option(agentsOpts[0][0], agentsOpts[0][1])
  .option(agentsOpts[1][0], agentsOpts[1][1])
  .option(agentsOpts[2][0], agentsOpts[2][1])
  .option('--parameters <json>', 'Flow parameters JSON')
  .option('--request-body <json>', 'Flow request body JSON')
  .option('--provider-auth <json>', 'Per-source provider auth JSON')
  .option('--source-base-urls <json>', 'Per-source base URL overrides')
  .action(async (flowId: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.flows.invokeFlow({
        ...agentsJsonOptions(cmd),
        flow_id: flowId,
        parameters: parseJsonArg(opts.parameters, 'parameters'),
        request_body: parseJsonArg(opts.requestBody, 'request-body'),
        provider_auth: parseJsonArg(opts.providerAuth, 'provider-auth'),
        source_base_urls: parseJsonArg(opts.sourceBaseUrls, 'source-base-urls'),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw Wildcard API request')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--path <path>', 'Relative API path', '/')
  .option('--query <json>', 'Query parameters JSON')
  .option('--body <json>', 'Request body JSON')
  .option('--headers <json>', 'Extra headers JSON')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method,
        path: opts.path,
        query: parseJsonArg(opts.query, 'query'),
        body: parseJsonArg(opts.body, 'body'),
        headers: parseJsonArg(opts.headers, 'headers'),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
