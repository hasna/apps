#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { OpenAI } from '../api';
import { OPENAI_MODELS } from '../types';
import type { OpenAIModel } from '../types';
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
  getOrganization,
  setOrganization,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-openai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('OpenAI API connector - Chat, embeddings, and images')
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
      process.env.OPENAI_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): OpenAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set OPENAI_API_KEY environment variable.`);
    process.exit(1);
  }
  const organization = getOrganization();
  return new OpenAI({ apiKey, organization });
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
  .option('--org <org>', 'Organization ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      organization: opts.org,
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
    info(`Organization: ${config.organization || chalk.gray('not set')}`);
    info(`Default Model: ${config.defaultModel || chalk.gray('gpt-4o-mini')}`);
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
  .command('set-org <org>')
  .description('Set organization ID')
  .action((org: string) => {
    setOrganization(org);
    success(`Organization set to: ${org}`);
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
    const org = getOrganization();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Organization: ${org || chalk.gray('not set')}`);
    info(`Default Model: ${model || chalk.gray('gpt-4o-mini')}`);
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
  .option('-m, --model <model>', 'Model to use', getDefaultModel() || 'gpt-4o-mini')
  .option('-t, --temperature <temp>', 'Temperature (0-2)', '0.7')
  .option('--max-tokens <tokens>', 'Maximum tokens')
  .option('-s, --system <prompt>', 'System prompt')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as OpenAIModel,
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
  .option('-m, --model <model>', 'Model to use', 'gpt-4o')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.code(prompt, {
        model: opts.model as OpenAIModel,
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
  .command('reason <prompt>')
  .description('Reasoning task (uses o1/o3 models)')
  .option('-m, --model <model>', 'Model to use', 'o1-mini')
  .option('--effort <level>', 'Reasoning effort (low, medium, high)', 'medium')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.reason(prompt, {
        model: opts.model as OpenAIModel,
        reasoningEffort: opts.effort,
      });

      const format = getFormat(chatCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = client.chat.getContent(response);
        console.log(chalk.cyan('\nReasoning:\n'));
        console.log(content);
        const reasoningTokens = response.usage.completion_tokens_details?.reasoning_tokens || 0;
        console.log(chalk.gray(`\n(${response.usage.total_tokens} tokens, ${reasoningTokens} reasoning tokens)`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd
  .command('json <prompt>')
  .description('Get JSON response')
  .option('-m, --model <model>', 'Model to use', 'gpt-4o-mini')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.json(prompt, {
        model: opts.model as OpenAIModel,
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
  .option('-m, --model <model>', 'Model to use', 'text-embedding-3-small')
  .option('-d, --dimensions <dims>', 'Dimensions (for embedding-3 models)')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const embedding = await client.embeddings.embed(text, {
        model: opts.model,
        dimensions: opts.dimensions ? parseInt(opts.dimensions) : undefined,
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
// Images Commands
// ============================================
const imagesCmd = program
  .command('images')
  .alias('image')
  .description('Image generation commands (DALL-E)');

imagesCmd
  .command('generate <prompt>')
  .description('Generate an image')
  .option('-m, --model <model>', 'Model to use', 'dall-e-3')
  .option('-s, --size <size>', 'Image size', '1024x1024')
  .option('-q, --quality <quality>', 'Quality (standard, hd)', 'standard')
  .option('--style <style>', 'Style (vivid, natural)', 'vivid')
  .action(async (prompt: string, opts) => {
    try {
      info('Generating image...');
      const client = getClient();
      const url = await client.images.createImage(prompt, {
        model: opts.model,
        size: opts.size,
        quality: opts.quality,
        style: opts.style,
      });

      const format = getFormat(imagesCmd);
      if (format === 'json') {
        print({ url }, format);
      } else {
        console.log(chalk.cyan('\nImage URL:\n'));
        console.log(url);
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
  .option('-m, --model <model>', 'Model to use', 'gpt-4o-mini')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as OpenAIModel,
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
      console.log(chalk.bold('Common OpenAI Models:\n'));
      console.log(chalk.cyan('Chat Models:'));
      console.log(`  gpt-4o         - Most capable GPT-4 model`);
      console.log(`  gpt-4o-mini    - Fast and affordable`);
      console.log(`  gpt-4-turbo    - GPT-4 Turbo with vision`);
      console.log(`  gpt-3.5-turbo  - Fast, low-cost model`);
      console.log(chalk.cyan('\nReasoning Models:'));
      console.log(`  o1             - Full reasoning model`);
      console.log(`  o1-mini        - Fast reasoning model`);
      console.log(`  o1-preview     - Preview of o1`);
      console.log(`  o3-mini        - Latest mini reasoning model`);
      console.log(chalk.cyan('\nEmbedding Models:'));
      console.log(`  text-embedding-3-small  - Fast, low-cost embeddings`);
      console.log(`  text-embedding-3-large  - Higher quality embeddings`);
      console.log(chalk.cyan('\nImage Models:'));
      console.log(`  dall-e-3       - Latest DALL-E model`);
      console.log(`  dall-e-2       - Previous generation`);
    }
  });

// Parse and execute
program.parse();
