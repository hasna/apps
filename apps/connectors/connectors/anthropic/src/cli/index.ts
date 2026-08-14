#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Anthropic } from '../api';
import { ANTHROPIC_MODELS, DEFAULT_MODEL } from '../types';
import type { AnthropicModel } from '../types';
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
  getDefaultModel,
  setDefaultModel,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-anthropic';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Anthropic API connector - Claude models for chat and code generation')
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
      process.env.ANTHROPIC_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ANTHROPIC_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Anthropic({ apiKey });
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
    info(`Default Model: ${config.defaultModel || chalk.gray(DEFAULT_MODEL)}`);
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
  .command('set-model <model>')
  .description('Set default model')
  .action((model: string) => {
    if (!ANTHROPIC_MODELS.includes(model as AnthropicModel)) {
      error(`Invalid model. Available models: ${ANTHROPIC_MODELS.join(', ')}`);
      process.exit(1);
    }
    setDefaultModel(model);
    success(`Default model set to: ${model}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const model = getDefaultModel();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Model: ${model || chalk.gray(DEFAULT_MODEL)}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Messages Commands
// ============================================
const messagesCmd = program
  .command('messages')
  .description('Messages API commands');

messagesCmd
  .command('ask <question>')
  .description('Ask a question')
  .option('-m, --model <model>', `Model to use`, getDefaultModel() || DEFAULT_MODEL)
  .option('-t, --temperature <temp>', 'Temperature (0-1)', '0.7')
  .option('--max-tokens <tokens>', 'Maximum tokens', '4096')
  .option('-s, --system <prompt>', 'System prompt')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.messages.ask(question, {
        model: opts.model as AnthropicModel,
        temperature: parseFloat(opts.temperature),
        maxTokens: parseInt(opts.maxTokens),
        systemPrompt: opts.system,
      });

      const format = getFormat(messagesCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        // Pretty print the response
        const content = client.messages.getContent(response);
        console.log(chalk.cyan('\nAnswer:\n'));
        console.log(content);

        const totalTokens = client.messages.getTotalTokens(response);
        console.log(chalk.gray(`\n(${totalTokens} tokens, model: ${response.model})`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('code <prompt>')
  .description('Generate code')
  .option('-m, --model <model>', `Model to use`, 'claude-sonnet-4-20250514')
  .option('--max-tokens <tokens>', 'Maximum tokens', '4096')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.messages.code(prompt, {
        model: opts.model as AnthropicModel,
        maxTokens: parseInt(opts.maxTokens),
      });

      const format = getFormat(messagesCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = client.messages.getContent(response);
        console.log(content);

        const totalTokens = client.messages.getTotalTokens(response);
        console.log(chalk.gray(`\n(${totalTokens} tokens)`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('json <prompt>')
  .description('Get JSON response')
  .option('-m, --model <model>', `Model to use`, getDefaultModel() || DEFAULT_MODEL)
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.messages.json(prompt, {
        model: opts.model as AnthropicModel,
      });
      console.log(JSON.stringify(response, null, 2));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Quick Commands (shortcuts)
// ============================================
program
  .command('ask <question>')
  .description('Quick ask (shortcut for "messages ask")')
  .option('-m, --model <model>', `Model to use`, getDefaultModel() || DEFAULT_MODEL)
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.messages.ask(question, {
        model: opts.model as AnthropicModel,
      });

      const content = client.messages.getContent(response);
      console.log(content);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('models')
  .description('List available models')
  .action(() => {
    console.log(chalk.bold('Available Anthropic Claude Models:\n'));
    console.log(chalk.cyan('Claude 4 Models (Latest):'));
    console.log(`  ${chalk.white('claude-opus-4-20250514')}     - Most capable Claude 4 model`);
    console.log(`  ${chalk.white('claude-sonnet-4-20250514')}   - Balanced performance and speed`);
    console.log(chalk.cyan('\nClaude 3.5 Models:'));
    console.log(`  ${chalk.white('claude-3-5-haiku-20241022')}  - Fastest, most affordable`);
    console.log(`  ${chalk.white('claude-3-5-sonnet-20241022')} - Previous generation Sonnet`);
    console.log(chalk.cyan('\nClaude 3 Models:'));
    console.log(`  ${chalk.white('claude-3-opus-20240229')}     - Previous flagship model`);
    console.log(`  ${chalk.white('claude-3-sonnet-20240229')}   - Previous balanced model`);
    console.log(`  ${chalk.white('claude-3-haiku-20240307')}    - Previous fast model`);
  });

// Parse and execute
program.parse();
