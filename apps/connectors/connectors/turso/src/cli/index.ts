#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Turso } from '../api';
import {
  getApiKey,
  setApiKey,
  getOrganization,
  setOrganization,
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

const CONNECTOR_NAME = 'connect-turso';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Turso Platform connector - Manage organizations, databases, groups, and usage')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
  .option('-o, --organization <slug>', 'Organization slug')
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
      process.env.TURSO_API_TOKEN = opts.apiKey;
    }
    if (opts.organization) {
      process.env.TURSO_ORGANIZATION = opts.organization;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Turso {
  const apiKey = getApiKey();
  const organization = getOrganization();

  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set TURSO_API_TOKEN.`);
    process.exit(1);
  }

  if (!organization) {
    error(`No organization configured. Run "${CONNECTOR_NAME} config set-org <slug>" or set TURSO_ORGANIZATION.`);
    process.exit(1);
  }

  return new Turso({ apiKey, organization });
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
  .option('--api-key <key>', 'API token')
  .option('--organization <slug>', 'Organization slug')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      organization: opts.organization,
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
    info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Organization: ${config.organization || chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API token')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-org <organization>')
  .description('Set organization slug')
  .action((organization: string) => {
    setOrganization(organization);
    success(`Organization saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const organization = getOrganization();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Organization: ${organization || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const orgCmd = program.command('org').description('Organization operations');

orgCmd
  .command('list')
  .description('List organizations for the authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listOrganizations();
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const authCmd = program.command('auth').description('Authentication operations');

authCmd
  .command('validate')
  .description('Validate the configured API token')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.validateToken();
      print(result, getFormat(authCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const databaseCmd = program.command('database').description('Database operations');

databaseCmd
  .command('list')
  .description('List databases in the configured organization')
  .option('--group <name>', 'Filter by group name')
  .option('--parent <id>', 'Filter branches by parent database ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDatabases({
        group: opts.group,
        parent: opts.parent,
      });
      print(result, getFormat(databaseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databaseCmd
  .command('get <name>')
  .description('Get a database by name')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.getDatabase(name);
      print(result, getFormat(databaseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databaseCmd
  .command('create <name>')
  .description('Create a database')
  .requiredOption('--group <name>', 'Group name (must already exist)')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createDatabase({ name, group: opts.group });
      success('Database created!');
      print(result, getFormat(databaseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

databaseCmd
  .command('delete <name>')
  .description('Delete a database')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.deleteDatabase(name);
      success(`Database ${name} deleted`);
      print(result, getFormat(databaseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const groupCmd = program.command('group').description('Group operations');

groupCmd
  .command('list')
  .description('List groups in the configured organization')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listGroups();
      print(result, getFormat(groupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const usageCmd = program.command('usage').description('Usage operations');

usageCmd
  .command('get')
  .description('Get organization usage for the current billing cycle')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getOrganizationUsage();
      print(result, getFormat(usageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
