#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SnovIo } from '../api';
import {
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getBaseUrl,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-snov-io';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Snov.io connector CLI — email outreach, prospecting, and campaigns')
  .version(VERSION)
  .option('--client-id <id>', 'API User ID (overrides config)')
  .option('--client-secret <secret>', 'API Secret (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }

    if (opts.clientId) {
      process.env.SNOV_IO_CLIENT_ID = opts.clientId;
    }
    if (opts.clientSecret) {
      process.env.SNOV_IO_CLIENT_SECRET = opts.clientSecret;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SnovIo {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const baseUrl = getBaseUrl();

  if (!clientId) {
    error(`No client ID configured. Run "${CONNECTOR_NAME} config set-client-id <id>" or set SNOV_IO_CLIENT_ID.`);
    process.exit(1);
  }
  if (!clientSecret) {
    error(`No client secret configured. Run "${CONNECTOR_NAME} config set-client-secret <secret>" or set SNOV_IO_CLIENT_SECRET.`);
    process.exit(1);
  }

  return new SnovIo({ clientId, clientSecret, baseUrl });
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
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--client-id <id>', 'API User ID')
  .option('--client-secret <secret>', 'API Secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
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
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${config.clientSecret ? chalk.gray('configured') : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-client-id <id>')
  .description('Set API User ID')
  .action((id: string) => {
    setClientId(id);
    success(`Client ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-client-secret <secret>')
  .description('Set API Secret')
  .action((secret: string) => {
    setClientSecret(secret);
    success(`Client secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const clientId = getClientId();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${getClientSecret() ? chalk.gray('configured') : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || 'https://api.snov.io (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const campaignsCmd = program.command('campaigns').description('Campaign operations');

campaignsCmd
  .command('list')
  .description('List all user campaigns')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.campaigns.list();
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const domainSearchCmd = program.command('domain-search').description('Domain search and prospecting');

domainSearchCmd
  .command('start')
  .description('Start company info search by domain')
  .requiredOption('-d, --domain <domain>', 'Domain to search (e.g. snov.io)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.domainSearch.start({ domain: opts.domain });
      print(result, getFormat(domainSearchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainSearchCmd
  .command('result')
  .description('Get domain search results by task hash')
  .requiredOption('-t, --task <hash>', 'Task hash from start response')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.domainSearch.getResult(opts.task);
      print(result, getFormat(domainSearchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const accountCmd = program.command('account').description('Account operations');

accountCmd
  .command('info')
  .description('Show account credit balance')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.account.getBalance();
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <method> <path>')
  .description('Make a raw API request (escape hatch)')
  .option('-d, --data <json>', 'JSON request body')
  .option('--v1', 'Use v1 auth style (access_token query param)')
  .action(async (method: string, path: string, opts) => {
    const httpMethod = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(httpMethod)) {
      error(`Invalid HTTP method: ${method}`);
      process.exit(1);
    }

    try {
      const client = getClient();
      const body = opts.data ? JSON.parse(opts.data) : undefined;
      const result = await client.getClient().raw(
        httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        path.startsWith('/') ? path : `/${path}`,
        {
          body,
          authStyle: opts.v1 ? 'v1' : undefined,
        },
      );
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
