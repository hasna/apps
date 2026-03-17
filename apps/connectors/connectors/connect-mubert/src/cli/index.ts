#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Mubert } from '../api';
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

const CONNECTOR_NAME = 'connect-mubert';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Mubert AI connector CLI - AI music generation with multi-profile support')
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
      process.env.MUBERT_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Mubert {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MUBERT_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Mubert({ apiKey });
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
// Track Commands
// ============================================
const trackCmd = program
  .command('track')
  .description('Music track generation commands');

trackCmd
  .command('create <prompt>')
  .description('Create a new music track from text')
  .option('-d, --duration <seconds>', 'Track duration in seconds')
  .option('-m, --mode <mode>', 'Generation mode')
  .option('-i, --intensity <level>', 'Intensity level (low, medium, high)', 'medium')
  .option('--format <format>', 'Output format (mp3, wav)', 'mp3')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createTrack({
        prompt,
        duration: opts.duration ? parseInt(opts.duration) : undefined,
        mode: opts.mode,
        intensity: opts.intensity as 'low' | 'medium' | 'high',
        format: opts.format as 'mp3' | 'wav',
      });

      const format = getFormat(trackCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Track generation started: ${result.id}`);
        info(`Status: ${result.state}`);
        info(`Check status with: ${CONNECTOR_NAME} track get ${result.id}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trackCmd
  .command('get <id>')
  .description('Get track status')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getTrack(id);
      const format = getFormat(trackCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Track: ${result.id}`));
        info(`Status: ${result.state}`);
        if (result.duration) info(`Duration: ${result.duration}s`);
        if (result.assets?.audio_url) {
          success(`Audio URL: ${result.assets.audio_url}`);
        }
        if (result.failure_reason) {
          error(`Failure: ${result.failure_reason}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trackCmd
  .command('list')
  .description('List tracks')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('-o, --offset <number>', 'Offset', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTracks(parseInt(opts.limit), parseInt(opts.offset));
      print(result, getFormat(trackCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trackCmd
  .command('delete <id>')
  .description('Delete a track')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteTrack(id);
      success(`Track ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
