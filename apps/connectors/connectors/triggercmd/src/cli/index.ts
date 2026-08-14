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

const CONNECTOR_NAME = 'connect-triggercmd';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TRIGGERcmd remote command automation API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
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
      process.env.TRIGGERCMD_API_KEY = opts.apiKey;
      debug('API token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set TRIGGERCMD_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
  .option('--api-key <key>', 'API token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
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
    info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API token from TRIGGERcmd Instructions page')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Commands API
// ============================================
const commandsCmd = program
  .command('commands')
  .description('List TRIGGERcmd commands');

commandsCmd
  .command('list')
  .description('List commands for a computer')
  .option('--computer-id <id>', 'Computer ID to filter commands')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.commands.list(
        opts.computerId ? { computer_id: opts.computerId } : undefined,
      );
      print(result, getFormat(commandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commandsCmd
  .command('commandlist')
  .description('List all commands across all computers')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.commands.commandlist();
      print(result, getFormat(commandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Trigger Commands
// ============================================
const triggerCmd = program
  .command('trigger')
  .description('Trigger remote commands');

triggerCmd
  .command('run <computer> <trigger>')
  .description('Trigger a command on a computer')
  .option('--params <params>', 'Optional command parameters')
  .action(async (computer: string, trigger: string, opts) => {
    try {
      const client = getClient();
      const result = await client.trigger.run({
        computer,
        trigger,
        params: opts.params,
      });
      success(`Triggered "${trigger}" on ${computer}`);
      print(result, getFormat(triggerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Runs Commands
// ============================================
const runsCmd = program
  .command('runs')
  .description('Command run history');

runsCmd
  .command('list')
  .description('List command run history')
  .option('--command-id <id>', 'Filter by command ID')
  .option('--sort-on <sort>', 'Sort field and direction (e.g. createdAt,DESC)', 'createdAt,DESC')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.runs.list({
        command_id: opts.commandId,
        sortOn: opts.sortOn,
      });
      print(result, getFormat(runsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Computers Commands
// ============================================
const computersCmd = program
  .command('computers')
  .description('Manage registered computers');

computersCmd
  .command('list')
  .description('List registered computers')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.computers.list();
      print(result, getFormat(computersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
