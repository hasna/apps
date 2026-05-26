#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Mistral } from '../api';
import { MISTRAL_MODELS } from '../types';
import type { MistralModel } from '../types';
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

const CONNECTOR_NAME = 'connect-mistral';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Mistral AI API connector - Chat completions and embeddings')
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
      process.env.MISTRAL_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Mistral {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MISTRAL_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Mistral({ apiKey });
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
    info(`Default Model: ${config.defaultModel || chalk.gray('mistral-small-latest')}`);
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
    info(`Default Model: ${model || chalk.gray('mistral-small-latest')}`);
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
  .option('-m, --model <model>', 'Model to use', getDefaultModel() || 'mistral-small-latest')
  .option('-t, --temperature <temp>', 'Temperature (0-1)', '0.7')
  .option('--max-tokens <tokens>', 'Maximum tokens')
  .option('-s, --system <prompt>', 'System prompt')
  .option('--safe', 'Enable safe prompt mode')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as MistralModel,
        temperature: parseFloat(opts.temperature),
        maxTokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
        systemPrompt: opts.system,
        safePrompt: opts.safe,
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
  .description('Generate code (uses codestral-latest)')
  .option('-m, --model <model>', 'Model to use', 'codestral-latest')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.code(prompt, {
        model: opts.model as MistralModel,
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
  .option('-m, --model <model>', 'Model to use', 'mistral-small-latest')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.json(prompt, {
        model: opts.model as MistralModel,
      });
      console.log(JSON.stringify(response, null, 2));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Embeddings Commands
// ============================================
const embeddingsCmd = program
  .command('embeddings')
  .alias('embed')
  .description('Embeddings commands');

embeddingsCmd
  .command('create <text>')
  .description('Create embedding for text')
  .option('-m, --model <model>', 'Model to use', 'mistral-embed')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const embedding = await client.embeddings.embed(text, {
        model: opts.model,
      });

      const format = getFormat(embeddingsCmd);
      if (format === 'json') {
        print(embedding, format);
      } else {
        console.log(chalk.cyan(`Embedding (${embedding.length} dimensions):\n`));
        console.log(`[${embedding.slice(0, 5).join(', ')}... (${embedding.length - 5} more)]`);
      }
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
  .option('-m, --model <model>', 'Model to use', 'mistral-small-latest')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as MistralModel,
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
      console.log(chalk.bold('Common Mistral Models:\n'));
      console.log(chalk.cyan('Chat Models:'));
      console.log(`  mistral-large-latest   - Most capable model`);
      console.log(`  mistral-small-latest   - Fast and efficient`);
      console.log(`  ministral-8b-latest    - Lightweight 8B model`);
      console.log(`  ministral-3b-latest    - Smallest model`);
      console.log(`  open-mistral-nemo      - Open-weight model`);
      console.log(chalk.cyan('\nCode Models:'));
      console.log(`  codestral-latest       - Optimized for code generation`);
      console.log(chalk.cyan('\nVision Models:'));
      console.log(`  pixtral-large-latest   - Multimodal vision model`);
      console.log(chalk.cyan('\nEmbedding Models:'));
      console.log(`  mistral-embed          - Text embeddings (1024 dimensions)`);
    }
  });

// Parse and execute
program.parse();
