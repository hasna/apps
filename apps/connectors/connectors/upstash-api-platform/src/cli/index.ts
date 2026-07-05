#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { UpstashApiPlatform } from '../api';
import {
  getApiKey,
  getEmail,
  setApiKey,
  setEmail,
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
  isConfigured,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-upstash-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Upstash Developer API connector — teams, vector indices, audit logs')
  .version(VERSION)
  .option('-e, --email <email>', 'Upstash account email (overrides config)')
  .option('-k, --api-key <key>', 'Management API key (overrides config)')
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
    if (opts.email) {
      process.env.UPSTASH_EMAIL = opts.email;
    }
    if (opts.apiKey) {
      process.env.UPSTASH_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): UpstashApiPlatform {
  const email = getEmail();
  const apiKey = getApiKey();
  if (!email || !apiKey) {
    error(`Credentials not configured. Run "${CONNECTOR_NAME} auth set-email <email>" and "${CONNECTOR_NAME} auth set-key <key>" or set UPSTASH_EMAIL and UPSTASH_API_KEY.`);
    process.exit(1);
  }
  return new UpstashApiPlatform({ email, apiKey });
}

const authCmd = program.command('auth').description('Manage authentication credentials');

authCmd
  .command('set-email <email>')
  .description('Set Upstash account email')
  .action((email: string) => {
    setEmail(email);
    success(`Email saved to profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('set-key <apiKey>')
  .description('Set Upstash management API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('status')
  .description('Show authentication status')
  .action(() => {
    const profileName = getCurrentProfile();
    const email = getEmail();
    const apiKey = getApiKey();
    console.log(chalk.bold(`Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Email: ${email || chalk.gray('not set')}`);
    info(`API key: ${apiKey ? `${apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Configured: ${isConfigured() ? chalk.green('yes') : chalk.red('no')}`);
  });

authCmd
  .command('clear')
  .description('Clear stored credentials for the active profile')
  .action(() => {
    clearConfig();
    success(`Credentials cleared for profile: ${getCurrentProfile()}`);
  });

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
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--email <email>', 'Upstash account email')
  .option('--api-key <key>', 'Management API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { email: opts.email, apiKey: opts.apiKey });
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
    info(`Email: ${config.email || chalk.gray('not set')}`);
    info(`API key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
  });

const teamCmd = program.command('team').description('Team operations');

teamCmd
  .command('list')
  .description('List teams')
  .action(async () => {
    try {
      const client = getClient();
      print(await client.listTeams(), getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('create <name>')
  .description('Create a team')
  .option('--copy-cc', 'Copy credit card information to the team', false)
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createTeam({ team_name: name, copy_cc: Boolean(opts.copyCc) });
      success('Team created');
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('members <teamId>')
  .description('List members of a team')
  .action(async (teamId: string) => {
    try {
      const client = getClient();
      print(await client.getTeamMembers(teamId), getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const vectorCmd = program.command('vector').description('Vector index operations');

vectorCmd
  .command('list')
  .description('List vector indices')
  .action(async () => {
    try {
      const client = getClient();
      print(await client.listVectorIndices(), getFormat(vectorCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

vectorCmd
  .command('get <id>')
  .description('Get a vector index by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      print(await client.getVectorIndex(id), getFormat(vectorCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

vectorCmd
  .command('create')
  .description('Create a vector index')
  .requiredOption('--name <name>', 'Index name')
  .requiredOption('--region <region>', 'Region (eu-west-1, us-east-1, us-central1)')
  .requiredOption('--similarity <fn>', 'Similarity function (COSINE, EUCLIDEAN, DOT_PRODUCT)')
  .requiredOption('--dimensions <count>', 'Vector dimension count', parseInt)
  .option('--type <plan>', 'Plan type (payg, fixed, paid)')
  .option('--embedding-model <model>', 'Embedding model')
  .option('--index-type <type>', 'Index type (DENSE, SPARSE, HYBRID)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createVectorIndex({
        name: opts.name,
        region: opts.region,
        similarity_function: opts.similarity,
        dimension_count: opts.dimensions,
        type: opts.type,
        embedding_model: opts.embeddingModel,
        index_type: opts.indexType,
      });
      success('Vector index created');
      print(result, getFormat(vectorCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

vectorCmd
  .command('delete <id>')
  .description('Delete a vector index')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.deleteVectorIndex(id);
      success(`Vector index ${id} deleted`);
      print(result, getFormat(vectorCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const accountCmd = program.command('account').description('Account operations');

accountCmd
  .command('audit-logs')
  .description('List audit logs')
  .action(async () => {
    try {
      const client = getClient();
      print(await client.listAuditLogs(), getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Raw API request escape hatch');

rawCmd
  .command('request')
  .description('Send a raw authenticated request')
  .requiredOption('-X, --method <method>', 'HTTP method')
  .requiredOption('--path <path>', 'API path (e.g. /teams or /vector/index)')
  .option('--base-url <url>', 'Override base URL')
  .option('--body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest(method, opts.path, {
        body,
        baseUrl: opts.baseUrl,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
