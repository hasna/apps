#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccountId,
  setAccountId,
  getApiVersion,
  setApiVersion,
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

const CONNECTOR_NAME = 'stripe-sigma';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Sigma connector CLI — SQL analytics via Query Runs API')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Stripe secret API key (overrides config)')
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
      process.env.STRIPE_SIGMA_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_SIGMA_API_KEY.`,
    );
    process.exit(1);
  }
  return new Connector({
    apiKey,
    accountId: getAccountId(),
    apiVersion: getApiVersion(),
  });
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
  .option('--api-key <key>', 'Stripe secret API key')
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
    info(`API key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
    info(`API version: ${config.apiVersion || chalk.gray('default preview')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (active profile)');

configCmd
  .command('set-key <key>')
  .description('Set Stripe secret API key')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-account <accountId>')
  .description('Set Stripe account ID (required for org API keys)')
  .action((accountId: string) => {
    setAccountId(accountId);
    success(`Account ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-api-version <version>')
  .description('Set Stripe API version (Sigma requires a preview version)')
  .action((version: string) => {
    setApiVersion(version);
    success(`API version saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const config = loadProfile();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
    info(`API version: ${config.apiVersion || chalk.gray('default preview')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const queryRunsCmd = program.command('query-runs').description('Stripe Sigma query runs');

queryRunsCmd
  .command('create')
  .description('Create and start a Sigma SQL query run')
  .option('--sql <sql>', 'SQL statement to execute')
  .option('--from-saved-query <id>', 'ID of a saved Sigma query to run')
  .action(async (opts, cmd) => {
    try {
      if (!opts.sql && !opts.fromSavedQuery) {
        error('Provide --sql or --from-saved-query');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.queryRuns.create({
        sql: opts.sql,
        from_saved_query: opts.fromSavedQuery,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

queryRunsCmd
  .command('get <id>')
  .description('Retrieve a query run by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.queryRuns.get(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
