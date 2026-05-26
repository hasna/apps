#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { XAI } from '../api';
import { XAI_MODELS } from '../types';
import type { XAIModel } from '../types';
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

const CONNECTOR_NAME = 'connect-xai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('xAI Grok API connector - Chat completions with Grok models')
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
      process.env.XAI_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): XAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set XAI_API_KEY environment variable.`);
    process.exit(1);
  }
  return new XAI({ apiKey });
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
    info(`Default Model: ${config.defaultModel || chalk.gray('grok-2')}`);
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
    info(`Default Model: ${model || chalk.gray('grok-2')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Chat Commands
// ============================================
const chatCmd = program
  .command('chat')
  .description('Chat completion commands');

chatCmd
  .command('ask <question>')
  .description('Ask a question')
  .option('-m, --model <model>', 'Model to use', getDefaultModel() || 'grok-2')
  .option('-t, --temperature <temp>', 'Temperature (0-2)', '0.7')
  .option('--max-tokens <tokens>', 'Maximum tokens')
  .option('-s, --system <prompt>', 'System prompt')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as XAIModel,
        temperature: parseFloat(opts.temperature),
        maxTokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
        systemPrompt: opts.system,
      });

      const format = getFormat(chatCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = client.chat.getContent(response);
        console.log(chalk.cyan('\nAnswer:\n'));
        console.log(content);
        console.log(chalk.gray(`\n(${response.usage.total_tokens} tokens, model: ${response.model})`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd
  .command('code <prompt>')
  .description('Generate code')
  .option('-m, --model <model>', 'Model to use', 'grok-3')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.code(prompt, {
        model: opts.model as XAIModel,
      });

      const format = getFormat(chatCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = client.chat.getContent(response);
        console.log(content);
        console.log(chalk.gray(`\n(${response.usage.total_tokens} tokens)`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd
  .command('json <prompt>')
  .description('Get JSON response')
  .option('-m, --model <model>', 'Model to use', 'grok-2')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.json(prompt, {
        model: opts.model as XAIModel,
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
  .description('Quick ask (shortcut for "chat ask")')
  .option('-m, --model <model>', 'Model to use', 'grok-2')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as XAIModel,
      });
      console.log(client.chat.getContent(response));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('models')
  .description('List available models')
  .option('--all', 'List all models from API')
  .action(async (opts) => {
    if (opts.all) {
      try {
        const client = getClient();
        const response = await client.listModels();
        const models = response.data
          .map(m => m.id)
          .sort();
        console.log(chalk.bold('Available Models:\n'));
        models.forEach(m => console.log(`  ${m}`));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    } else {
      console.log(chalk.bold('xAI Grok Models:\n'));
      console.log(chalk.cyan('Chat Models:'));
      console.log(`  grok-3         - Most capable Grok model`);
      console.log(`  grok-3-fast    - Faster version of Grok 3`);
      console.log(`  grok-2         - Standard Grok model`);
      console.log(`  grok-2-vision  - Grok 2 with vision capabilities`);
    }
  });

// Parse and execute
program.parse();
