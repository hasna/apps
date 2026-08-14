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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-wappalyzer';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wappalyzer connector CLI - website technology lookup and enrichment')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
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
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.WAPPALYZER_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WAPPALYZER_API_KEY.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

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
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const lookupCmd = program.command('lookup').description('Look up technologies for website URLs');

lookupCmd
  .command('run <urls...>')
  .description('Look up technologies for one to ten URLs')
  .option('--live', 'Scan websites in real-time')
  .option('--recursive', 'Index multiple pages (default true on API)')
  .option('--no-recursive', 'Shallow scan in the same request')
  .option('--sets <sets>', 'Additional field sets (e.g. company,contact or all)')
  .option('--callback-url <url>', 'Callback URL for async crawl results')
  .option('--denoise', 'Exclude low confidence results')
  .option('--no-denoise', 'Include low confidence results')
  .option('--min-age <months>', 'Minimum result age in months', parseInt)
  .option('--max-age <months>', 'Maximum result age in months', parseInt)
  .option('--squash', 'Merge monthly historic results')
  .option('--no-squash', 'Group historic results by month')
  .action(async (urls: string[], opts) => {
    try {
      const client = getClient();
      const result = await client.lookup.lookup({
        urls,
        live: opts.live,
        recursive: opts.recursive === false ? false : opts.recursive,
        callback_url: opts.callbackUrl,
        sets: opts.sets,
        denoise: opts.denoise,
        min_age: opts.minAge,
        max_age: opts.maxAge,
        squash: opts.squash,
      });

      const meta = client.getClient().getLastResponseMeta();
      if (meta.creditsRemaining !== undefined) {
        info(`Credits remaining: ${meta.creditsRemaining}`);
      }

      print(result, getFormat(lookupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('lookup <urls...>')
  .description('Alias for lookup run')
  .option('--live', 'Scan websites in real-time')
  .option('--recursive', 'Index multiple pages')
  .option('--no-recursive', 'Shallow scan in the same request')
  .option('--sets <sets>', 'Additional field sets')
  .option('--callback-url <url>', 'Callback URL for async crawl results')
  .option('--denoise', 'Exclude low confidence results')
  .option('--no-denoise', 'Include low confidence results')
  .option('--min-age <months>', 'Minimum result age in months', parseInt)
  .option('--max-age <months>', 'Maximum result age in months', parseInt)
  .option('--squash', 'Merge monthly historic results')
  .option('--no-squash', 'Group historic results by month')
  .action(async (urls: string[], opts) => {
    try {
      const client = getClient();
      const result = await client.lookup.lookup({
        urls,
        live: opts.live,
        recursive: opts.recursive === false ? false : opts.recursive,
        callback_url: opts.callbackUrl,
        sets: opts.sets,
        denoise: opts.denoise,
        min_age: opts.minAge,
        max_age: opts.maxAge,
        squash: opts.squash,
      });

      const meta = client.getClient().getLastResponseMeta();
      if (meta.creditsRemaining !== undefined) {
        info(`Credits remaining: ${meta.creditsRemaining}`);
      }

      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const creditsCmd = program.command('credits').description('API credit operations');

creditsCmd
  .command('balance')
  .description('Get remaining API credit balance')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.credits.balance();
      print(result, getFormat(creditsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
