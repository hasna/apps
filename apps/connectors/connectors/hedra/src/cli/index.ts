#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Hedra } from '../api';
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
import { success, error, info, print, warn } from '../utils/output';

// Hedra connector configuration
const CONNECTOR_NAME = 'hedra';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Hedra API connector CLI - Generate AI-powered talking head videos')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.HEDRA_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Hedra {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set HEDRA_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Hedra({ apiKey });
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
// Characters API Commands
// ============================================
const charactersCmd = program
  .command('characters')
  .description('Manage Hedra characters');

charactersCmd
  .command('list')
  .description('List all characters')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.characters.list();
      print(result, getFormat(charactersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

charactersCmd
  .command('create')
  .description('Create a new character')
  .requiredOption('-n, --name <name>', 'Character name')
  .option('--avatar-url <url>', 'Avatar image URL')
  .option('--voice-id <id>', 'Voice ID to use')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.characters.create({
        name: opts.name,
        avatarUrl: opts.avatarUrl,
        voiceId: opts.voiceId,
      });
      success('Character created!');
      print(result, getFormat(charactersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Voices API Commands
// ============================================
const voicesCmd = program
  .command('voices')
  .description('Manage Hedra voices');

voicesCmd
  .command('list')
  .description('List available voices')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.voices.list();
      print(result, getFormat(voicesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Projects API Commands
// ============================================
const projectsCmd = program
  .command('projects')
  .description('Manage Hedra video projects');

projectsCmd
  .command('list')
  .description('List all projects')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.projects.list();
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('get <id>')
  .description('Get a project by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.projects.get(id);
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('create')
  .description('Create a new video project')
  .requiredOption('-t, --text <text>', 'Text for the character to speak')
  .option('-c, --character-id <id>', 'Character ID')
  .option('-v, --voice-id <id>', 'Voice ID')
  .option('--aspect-ratio <ratio>', 'Aspect ratio (16:9, 9:16, 1:1)', '16:9')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.projects.create({
        text: opts.text,
        characterId: opts.characterId,
        voiceId: opts.voiceId,
        aspectRatio: opts.aspectRatio,
      });
      success('Project created!');
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
