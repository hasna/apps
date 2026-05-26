#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Runway } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-runway';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Runway connector CLI - AI video generation with multi-profile support')
  .version(VERSION)
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
    if (opts.apiKey) {
      process.env.RUNWAY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Runway {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set RUNWAY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Runway({ apiKey });
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

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

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

// ============================================
// Video Commands
// ============================================
const videoCmd = program
  .command('video')
  .description('Video generation commands');

videoCmd
  .command('generate')
  .description('Generate video from image or text')
  .option('-m, --model <model>', 'Model to use', 'gen3a_turbo')
  .option('-i, --image <url>', 'Image URL for image-to-video')
  .option('-t, --text <prompt>', 'Text prompt')
  .option('-d, --duration <seconds>', 'Duration in seconds', '5')
  .option('-r, --ratio <ratio>', 'Aspect ratio', '16:9')
  .option('-s, --seed <seed>', 'Random seed')
  .action(async (opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.image) {
        result = await client.imageToVideo({
          model: opts.model,
          promptImage: opts.image,
          promptText: opts.text,
          duration: parseInt(opts.duration),
          ratio: opts.ratio,
          seed: opts.seed ? parseInt(opts.seed) : undefined,
        });
      } else if (opts.text) {
        result = await client.textToVideo({
          model: opts.model,
          promptText: opts.text,
          duration: parseInt(opts.duration),
          ratio: opts.ratio,
          seed: opts.seed ? parseInt(opts.seed) : undefined,
        });
      } else {
        error('Either --image or --text is required');
        process.exit(1);
      }

      const format = getFormat(videoCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Task created: ${result.id}`);
        info(`Check status with: ${CONNECTOR_NAME} task get ${result.id}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Task Commands
// ============================================
const taskCmd = program
  .command('task')
  .description('Manage video generation tasks');

taskCmd
  .command('get <taskId>')
  .description('Get task status')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.getTask(taskId);
      const format = getFormat(taskCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Task: ${result.id}`));
        info(`Status: ${result.status}`);
        if (result.progress !== undefined) {
          info(`Progress: ${result.progress}%`);
        }
        if (result.output && result.output.length > 0) {
          success(`Output: ${result.output.join(', ')}`);
        }
        if (result.failure) {
          error(`Failure: ${result.failure}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('cancel <taskId>')
  .description('Cancel a task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      await client.cancelTask(taskId);
      success(`Task ${taskId} cancelled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
