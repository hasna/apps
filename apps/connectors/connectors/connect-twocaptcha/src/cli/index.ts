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
import type { CaptchaTask } from '../types';

const CONNECTOR_NAME = 'connect-twocaptcha';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('2Captcha connector CLI - captcha solving API')
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
      process.env.TWOCAPTCHA_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TWOCAPTCHA_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
}

function parseTaskJson(taskJson: string): CaptchaTask {
  try {
    const parsed = JSON.parse(taskJson) as CaptchaTask;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      throw new Error('task JSON must be an object with a "type" field');
    }
    return parsed;
  } catch (err) {
    error(`Invalid task JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
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
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Task commands
const taskCmd = program.command('task').description('Captcha task operations');

taskCmd
  .command('create')
  .description('Create a captcha solving task')
  .option('--task <json>', 'Full task JSON (e.g. \'{"type":"RecaptchaV2TaskProxyless","websiteURL":"...","websiteKey":"..."}\')')
  .option('--type <type>', 'Simple task type when --task is omitted')
  .option('--language-pool <pool>', 'Language pool (en, rn)')
  .option('--callback-url <url>', 'Callback URL for async notifications')
  .action(async (opts) => {
    try {
      const client = getClient();
      let task: CaptchaTask;
      if (opts.task) {
        task = parseTaskJson(opts.task);
      } else if (opts.type) {
        task = { type: opts.type };
      } else {
        error('Provide --task <json> or --type <type>');
        process.exit(1);
      }
      const result = await client.tasks.createTask({
        task,
        languagePool: opts.languagePool,
        callbackUrl: opts.callbackUrl,
      });
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('result <taskId>')
  .description('Get the result of a captcha task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.getTaskResult({ taskId });
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Balance commands
const balanceCmd = program.command('balance').description('Account balance');

balanceCmd.command('get').description('Get account balance').action(async () => {
  try {
    const client = getClient();
    const result = await client.tasks.getBalance();
    print(result, getFormat(balanceCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Report commands
const reportCmd = program.command('report').description('Report captcha solution quality');

reportCmd.command('correct <taskId>').description('Report a correct solution').action(async (taskId: string) => {
  try {
    const client = getClient();
    const result = await client.tasks.reportCorrect({ taskId });
    success(`Reported task ${taskId} as correct`);
    print(result, getFormat(reportCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

reportCmd
  .command('incorrect <taskId>')
  .description('Report an incorrect solution')
  .option('--reason <code>', 'Reason code for incorrect report')
  .action(async (taskId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.reportIncorrect({
        taskId,
        reason: opts.reason !== undefined ? parseInt(opts.reason, 10) : undefined,
      });
      success(`Reported task ${taskId} as incorrect`);
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
