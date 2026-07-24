#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Upstash } from '../api';
import {
  getEmail,
  setEmail,
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

const CONNECTOR_NAME = 'connect-upstash';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Upstash connector CLI - Serverless Redis and Kafka control-plane management')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-e, --email <email>', 'Upstash account email')
  .option('-k, --api-key <key>', 'Upstash API key')
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

function getClient(): Upstash {
  const email = getEmail();
  const apiKey = getApiKey();

  if (!email || !apiKey) {
    error(`Configuration incomplete. Run "${CONNECTOR_NAME} config setup" or set UPSTASH_EMAIL and UPSTASH_API_KEY environment variables.`);
    process.exit(1);
  }
  return new Upstash({ email, apiKey });
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
  .option('--email <email>', 'Upstash account email')
  .option('--api-key <key>', 'Upstash API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      email: opts.email,
      apiKey: opts.apiKey,
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
    info(`Email: ${config.email || chalk.gray('not set')}`);
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('setup')
  .description('Configure Upstash credentials')
  .requiredOption('--email <email>', 'Upstash account email')
  .requiredOption('--api-key <key>', 'Upstash API key')
  .action((opts) => {
    setEmail(opts.email);
    setApiKey(opts.apiKey);
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-email <email>')
  .description('Set Upstash account email')
  .action((email: string) => {
    setEmail(email);
    success(`Email saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-key <apiKey>')
  .description('Set Upstash API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const email = getEmail();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Email: ${email || chalk.gray('not set')}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Database Commands
// ============================================
const databasesCmd = program
  .command('databases')
  .description('Manage Upstash Redis databases');

databasesCmd
  .command('list')
  .description('List all Redis databases')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listDatabases();
      print(result, getFormat(databasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databasesCmd
  .command('get <id>')
  .description('Get a Redis database by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getDatabase(id);
      print(result, getFormat(databasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databasesCmd
  .command('create')
  .description('Create a new Redis database')
  .requiredOption('-n, --name <name>', 'Database name')
  .option('-r, --region <region>', 'Region (default: us-east-1)', 'us-east-1')
  .option('--no-tls', 'Disable TLS')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createDatabase({
        name: opts.name,
        region: opts.region,
        tls: opts.tls !== false,
      });
      success('Database created');
      print(result, getFormat(databasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Stats Commands
// ============================================
const statsCmd = program
  .command('stats')
  .description('Redis database statistics');

statsCmd
  .command('get <id>')
  .description('Get stats for a Redis database')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getStats(id);
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Topics Commands
// ============================================
const topicsCmd = program
  .command('topics')
  .description('Upstash Kafka topics');

topicsCmd
  .command('list')
  .description('List all Kafka topics')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listTopics();
      print(result, getFormat(topicsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
