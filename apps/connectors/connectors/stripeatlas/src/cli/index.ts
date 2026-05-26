#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
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
  saveProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

// Stripe Atlas connector - browser automation (no public API)
const CONNECTOR_NAME = 'stripeatlas';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Atlas connector CLI - Browser automation for Stripe Atlas dashboard (no public API)')
  .version(VERSION)
  .option('-e, --email <email>', 'Stripe Atlas email (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set email from flag if provided
    if (opts.email) {
      process.env.STRIPE_ATLAS_EMAIL = opts.email;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const email = getApiKey(); // getApiKey is aliased to getEmail
  if (!email) {
    error(`No email configured. Run "${CONNECTOR_NAME} config set-email <email>" or set STRIPE_ATLAS_EMAIL environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey: email });
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

    success(`Profiles:`);
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
  .option('--email <email>', 'Stripe Atlas email')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      email: opts.email,
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
    info(`Email: ${config.email ? `${config.email}` : chalk.gray('not set')}`);
    info(`Password: ${config.password ? '********' : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-email <email>')
  .description('Set Stripe Atlas email')
  .action((email: string) => {
    setApiKey(email); // setApiKey is aliased to setEmail
    success(`Email saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-password <password>')
  .description('Set Stripe Atlas password')
  .action((password: string) => {
    const config = loadProfile();
    config.password = password;
    saveProfile(config);
    success(`Password saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const config = loadProfile();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Email: ${config.email || chalk.gray('not set')}`);
    info(`Password: ${config.password ? '********' : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Stripe Atlas Commands
// Note: These require browser automation implementation
// ============================================
const atlasCmd = program
  .command('atlas')
  .description('Stripe Atlas dashboard commands (browser automation)');

atlasCmd
  .command('status')
  .description('Get company/application status')
  .action(async () => {
    try {
      const client = getClient();
      info('Checking Stripe Atlas status...');
      info(`Configured email: ${client.getApiKeyPreview()}`);
      warn('Note: Browser automation not yet implemented');
      // TODO: Implement browser automation
      // const result = await client.atlas.getCompany();
      // print(result, getFormat(atlasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

atlasCmd
  .command('documents')
  .description('List available documents')
  .action(async () => {
    try {
      const client = getClient();
      info('Fetching documents from Stripe Atlas...');
      warn('Note: Browser automation not yet implemented');
      // TODO: Implement browser automation
      // const result = await client.atlas.listDocuments();
      // print(result, getFormat(atlasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

atlasCmd
  .command('check')
  .description('Check connection to Stripe Atlas')
  .action(async () => {
    try {
      const client = getClient();
      info('Checking Stripe Atlas connection...');
      info(`Email: ${client.getApiKeyPreview()}`);
      info(`Password: ${loadProfile().password ? 'configured' : 'not configured'}`);
      warn('Note: Browser automation not yet implemented');
      // TODO: Implement browser automation
      // const connected = await client.atlas.checkConnection();
      // if (connected) {
      //   success('Successfully connected to Stripe Atlas');
      // } else {
      //   error('Failed to connect to Stripe Atlas');
      // }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
