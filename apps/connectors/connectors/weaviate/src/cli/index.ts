#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Weaviate } from '../api';
import {
  getHost,
  setHost,
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

const CONNECTOR_NAME = 'connect-weaviate';
const VERSION = '0.0.1';

const program = new Command();
let hostOverride: string | undefined;
let apiKeyOverride: string | undefined;

program
  .name(CONNECTOR_NAME)
  .description('Weaviate vector database connector for self-hosted instances')
  .version(VERSION)
  .option('-H, --host <url>', 'Weaviate host URL (overrides config)')
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
    if (opts.host) hostOverride = opts.host;
    if (opts.apiKey) apiKeyOverride = opts.apiKey;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Weaviate {
  const host = hostOverride || getHost();
  if (!host) {
    error(`No Weaviate host configured. Run "${CONNECTOR_NAME} config set-host <url>" or set WEAVIATE_HOST environment variable.`);
    process.exit(1);
  }
  return new Weaviate({ host, apiKey: apiKeyOverride || getApiKey() });
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
  .option('--host <url>', 'Weaviate host URL')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { host: opts.host, apiKey: opts.apiKey });
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
    if (deleteProfile(name)) success(`Profile "${name}" deleted`);
    else {
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
    info(`Host: ${config.host || chalk.gray('not set')}`);
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-host <url>')
  .description('Set Weaviate host URL')
  .action((host: string) => {
    setHost(host);
    success(`Host saved to profile: ${getCurrentProfile()}`);
  });

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
    const host = getHost();
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Host: ${host || chalk.gray('not set')}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const schemaCmd = program.command('schema').description('Manage Weaviate schema');

schemaCmd
  .command('get')
  .description('Get the full schema')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getSchema();
      print(result, getFormat(schemaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schemaCmd
  .command('create')
  .description('Create a class')
  .requiredOption('-c, --class <name>', 'Class name')
  .option('-d, --description <text>', 'Class description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createClass({ className: opts.class, description: opts.description });
      success('Class created');
      print(result, getFormat(schemaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

schemaCmd
  .command('delete <className>')
  .description('Delete a class')
  .action(async (className: string) => {
    try {
      const client = getClient();
      const result = await client.deleteClass(className);
      success(`Class "${className}" deleted`);
      print(result, getFormat(schemaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const objectsCmd = program.command('objects').description('Manage Weaviate objects');

objectsCmd
  .command('add')
  .description('Add an object')
  .requiredOption('-c, --class <name>', 'Class name')
  .requiredOption('-p, --properties <json>', 'Object properties as JSON')
  .option('-i, --id <id>', 'Object ID')
  .action(async (opts) => {
    try {
      const properties = JSON.parse(opts.properties) as Record<string, unknown>;
      const client = getClient();
      const result = await client.addObject({ className: opts.class, properties, id: opts.id });
      success('Object added');
      print(result, getFormat(objectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

objectsCmd
  .command('get <className> <id>')
  .description('Get an object by ID')
  .action(async (className: string, id: string) => {
    try {
      const client = getClient();
      const result = await client.getObject(className, id);
      print(result, getFormat(objectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

objectsCmd
  .command('update <className> <id>')
  .description('Update an object')
  .requiredOption('-p, --properties <json>', 'Updated properties as JSON')
  .action(async (className: string, id: string, opts) => {
    try {
      const properties = JSON.parse(opts.properties) as Record<string, unknown>;
      const client = getClient();
      const result = await client.updateObject({ className, id, properties });
      success('Object updated');
      print(result, getFormat(objectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

objectsCmd
  .command('delete <className> <id>')
  .description('Delete an object')
  .action(async (className: string, id: string) => {
    try {
      const client = getClient();
      const result = await client.deleteObject(className, id);
      success('Object deleted');
      print(result, getFormat(objectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const graphqlCmd = program.command('graphql').description('Run GraphQL queries');

graphqlCmd
  .command('query')
  .description('Execute a GraphQL query')
  .requiredOption('-q, --query <query>', 'GraphQL query string')
  .option('-v, --variables <json>', 'Query variables as JSON')
  .action(async (opts) => {
    try {
      const variables = opts.variables ? (JSON.parse(opts.variables) as Record<string, unknown>) : undefined;
      const client = getClient();
      const result = await client.graphqlQuery(opts.query, variables);
      print(result, getFormat(graphqlCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Vector search commands');

searchCmd
  .command('near-text')
  .description('Near-text semantic search')
  .requiredOption('-c, --class <name>', 'Class name')
  .requiredOption('--concepts <json>', 'Search concepts as JSON array')
  .option('-l, --limit <number>', 'Result limit', '5')
  .action(async (opts) => {
    try {
      const concepts = JSON.parse(opts.concepts) as string[];
      const client = getClient();
      const result = await client.nearTextSearch({
        className: opts.class,
        concepts,
        limit: parseInt(opts.limit, 10),
      });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const nodesCmd = program.command('nodes').description('Cluster node information');

nodesCmd
  .command('get')
  .description('Get node status')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getNode();
      print(result, getFormat(nodesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
