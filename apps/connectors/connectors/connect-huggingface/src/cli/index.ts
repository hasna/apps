#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { HuggingFace } from '../api';
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

// HuggingFace connector CLI
const CONNECTOR_NAME = 'huggingface';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('HuggingFace API connector CLI')
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
      process.env.HUGGINGFACE_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): HuggingFace {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set HUGGINGFACE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new HuggingFace({ apiKey });
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
// Models Commands
// ============================================
const modelsCmd = program.command('models').description('Search and browse HuggingFace models');

modelsCmd
  .command('search')
  .description('Search models')
  .argument('[query]', 'Search query')
  .option('--task <task>', 'Filter by task (text-generation, text2text-generation, etc)')
  .option('--library <lib>', 'Filter by library (transformers, gguf, pytorch)')
  .option('--author <author>', 'Filter by author')
  .option('--sort <field>', 'Sort by: likes, downloads, trending, lastModified', 'trending')
  .option('--limit <n>', 'Max results', '20')
  .action(async (query, opts) => {
    try {
      const client = getClient();
      const results = await client.models.search({
        search: query, filter: opts.task, library: opts.library,
        author: opts.author, sort: opts.sort, limit: parseInt(opts.limit),
      });
      print(results.map(m => ({ id: m.id, task: m.pipeline_tag, library: m.library_name, downloads: m.downloads, likes: m.likes })), getFormat(modelsCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

modelsCmd
  .command('get <id>')
  .description('Get model details (e.g. meta-llama/Meta-Llama-3-8B)')
  .action(async (id) => {
    try {
      const client = getClient();
      const result = await client.models.get(id);
      print(result, getFormat(modelsCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

modelsCmd
  .command('files <id>')
  .description('List files in a model repo')
  .action(async (id) => {
    try {
      const client = getClient();
      const files = await client.models.files(id);
      print(files.map(f => ({ name: f.rfilename, size: f.lfs?.size ?? f.size ?? null })), getFormat(modelsCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

// ============================================
// Inference Commands
// ============================================
const inferCmd = program.command('inference').description('Run model inference via HF Inference API');

inferCmd
  .command('text-generation <model>')
  .description('Generate text from a prompt')
  .requiredOption('--prompt <text>', 'Input prompt')
  .option('--max-tokens <n>', 'Max new tokens', '256')
  .option('--temperature <t>', 'Temperature', '0.7')
  .action(async (model, opts) => {
    try {
      const client = getClient();
      const results = await client.inference.textGeneration(model, opts.prompt, {
        max_new_tokens: parseInt(opts.maxTokens), temperature: parseFloat(opts.temperature),
      });
      print(results, getFormat(inferCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

inferCmd
  .command('chat <model>')
  .description('Chat completion (for chat models)')
  .requiredOption('--messages <json>', 'Messages JSON array')
  .option('--max-tokens <n>', 'Max new tokens', '256')
  .option('--temperature <t>', 'Temperature', '0.7')
  .action(async (model, opts) => {
    try {
      const messages = JSON.parse(opts.messages);
      const client = getClient();
      const result = await client.inference.chat(model, messages, {
        max_new_tokens: parseInt(opts.maxTokens), temperature: parseFloat(opts.temperature),
      });
      print(result, getFormat(inferCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

// ============================================
// Datasets Commands
// ============================================
const datasetsCmd = program.command('datasets').description('Search and browse HuggingFace datasets');

datasetsCmd
  .command('search')
  .description('Search datasets')
  .argument('[query]', 'Search query')
  .option('--author <author>', 'Filter by author')
  .option('--sort <field>', 'Sort by: likes, downloads, trending', 'trending')
  .option('--limit <n>', 'Max results', '20')
  .action(async (query, opts) => {
    try {
      const client = getClient();
      const results = await client.datasets.search({
        search: query, author: opts.author, sort: opts.sort, limit: parseInt(opts.limit),
      });
      print(results.map(d => ({ id: d.id, downloads: d.downloads, likes: d.likes, tags: d.tags?.slice(0, 5) })), getFormat(datasetsCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

datasetsCmd
  .command('get <id>')
  .description('Get dataset details')
  .action(async (id) => {
    try {
      const client = getClient();
      const result = await client.datasets.get(id);
      print(result, getFormat(datasetsCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

datasetsCmd
  .command('preview <id>')
  .description('Preview first N rows of a dataset')
  .option('--split <split>', 'Dataset split', 'train')
  .option('--rows <n>', 'Number of rows', '10')
  .action(async (id, opts) => {
    try {
      const client = getClient();
      const result = await client.datasets.preview(id, 'default', opts.split, parseInt(opts.rows));
      print(result, getFormat(datasetsCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

// ============================================
// Spaces Commands
// ============================================
const spacesCmd = program.command('spaces').description('Search and browse HuggingFace Spaces');

spacesCmd
  .command('search')
  .description('Search spaces')
  .argument('[query]', 'Search query')
  .option('--author <author>', 'Filter by author')
  .option('--sort <field>', 'Sort by: likes, trending', 'trending')
  .option('--limit <n>', 'Max results', '20')
  .action(async (query, opts) => {
    try {
      const client = getClient();
      const results = await client.spaces.search({
        search: query, author: opts.author, sort: opts.sort, limit: parseInt(opts.limit),
      });
      print(results.map(s => ({ id: s.id, sdk: s.sdk, likes: s.likes })), getFormat(spacesCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

spacesCmd
  .command('get <id>')
  .description('Get space details')
  .action(async (id) => {
    try {
      const client = getClient();
      const result = await client.spaces.get(id);
      print(result, getFormat(spacesCmd));
    } catch (err) { error(String(err)); process.exit(1); }
  });

// Parse and execute
program.parse();
