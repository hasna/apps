#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Perplexity } from '../api';
import { PERPLEXITY_MODELS } from '../types';
import type { PerplexityModel } from '../types';
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-perplexity';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Perplexity AI API connector - Chat completions with web search grounding')
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
      process.env.PERPLEXITY_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Perplexity {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set PERPLEXITY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Perplexity({ apiKey });
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
    info(`Default Model: ${config.defaultModel || chalk.gray('sonar')}`);
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
    if (!PERPLEXITY_MODELS.includes(model as PerplexityModel)) {
      error(`Invalid model. Available models: ${PERPLEXITY_MODELS.join(', ')}`);
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
    info(`Default Model: ${model || chalk.gray('sonar')}`);
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
  .option('-m, --model <model>', `Model to use (${PERPLEXITY_MODELS.join(', ')})`, getDefaultModel() || 'sonar')
  .option('-t, --temperature <temp>', 'Temperature (0-2)', '0.7')
  .option('--max-tokens <tokens>', 'Maximum tokens')
  .option('-s, --system <prompt>', 'System prompt')
  .option('--recency <filter>', 'Search recency filter (hour, day, week, month)')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as PerplexityModel,
        temperature: parseFloat(opts.temperature),
        maxTokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
        systemPrompt: opts.system,
        searchRecencyFilter: opts.recency,
      });

      const format = getFormat(chatCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        // Pretty print the response
        const content = response.choices[0]?.message?.content || '';
        console.log(chalk.cyan('\nAnswer:\n'));
        console.log(content);

        if (response.citations && response.citations.length > 0) {
          console.log(chalk.cyan('\nCitations:'));
          response.citations.forEach((citation, i) => {
            console.log(chalk.gray(`  [${i + 1}] ${citation}`));
          });
        }

        console.log(chalk.gray(`\n(${response.usage.total_tokens} tokens, model: ${response.model})`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd
  .command('search <query>')
  .description('Search the web and get an answer')
  .option('-m, --model <model>', `Model to use`, 'sonar-pro')
  .option('--recency <filter>', 'Search recency filter (hour, day, week, month)')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.search(query, {
        model: opts.model as PerplexityModel,
        recency: opts.recency,
      });

      const format = getFormat(chatCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = response.choices[0]?.message?.content || '';
        console.log(chalk.cyan('\nSearch Results:\n'));
        console.log(content);

        if (response.citations && response.citations.length > 0) {
          console.log(chalk.cyan('\nSources:'));
          response.citations.forEach((citation, i) => {
            console.log(chalk.gray(`  [${i + 1}] ${citation}`));
          });
        }

        console.log(chalk.gray(`\n(${response.usage.total_tokens} tokens)`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd
  .command('research <topic>')
  .description('Deep research on a topic (uses sonar-deep-research)')
  .option('--max-tokens <tokens>', 'Maximum tokens')
  .action(async (topic: string, opts) => {
    try {
      info('Starting deep research (this may take a moment)...');
      const client = getClient();
      const response = await client.chat.research(topic, {
        maxTokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
      });

      const format = getFormat(chatCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = response.choices[0]?.message?.content || '';
        console.log(chalk.cyan('\nResearch Report:\n'));
        console.log(content);

        if (response.citations && response.citations.length > 0) {
          console.log(chalk.cyan('\nReferences:'));
          response.citations.forEach((citation, i) => {
            console.log(chalk.gray(`  [${i + 1}] ${citation}`));
          });
        }

        console.log(chalk.gray(`\n(${response.usage.total_tokens} tokens, model: ${response.model})`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd
  .command('reason <prompt>')
  .description('Reasoning task (uses sonar-reasoning-pro)')
  .option('--max-tokens <tokens>', 'Maximum tokens')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.reason(prompt, {
        maxTokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
      });

      const format = getFormat(chatCmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = response.choices[0]?.message?.content || '';
        console.log(chalk.cyan('\nReasoning:\n'));
        console.log(content);

        console.log(chalk.gray(`\n(${response.usage.total_tokens} tokens, model: ${response.model})`));
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
  .option('-m, --model <model>', `Model to use`, 'sonar')
  .action(async (question: string, opts) => {
    try {
      const client = getClient();
      const response = await client.chat.ask(question, {
        model: opts.model as PerplexityModel,
      });

      const content = response.choices[0]?.message?.content || '';
      console.log(content);

      if (response.citations && response.citations.length > 0) {
        console.log(chalk.cyan('\nSources:'));
        response.citations.forEach((citation, i) => {
          console.log(chalk.gray(`  [${i + 1}] ${citation}`));
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search <query>')
  .description('Quick search (shortcut for "chat search")')
  .action(async (query: string) => {
    try {
      const client = getClient();
      const response = await client.chat.search(query);

      const content = response.choices[0]?.message?.content || '';
      console.log(content);

      if (response.citations && response.citations.length > 0) {
        console.log(chalk.cyan('\nSources:'));
        response.citations.forEach((citation, i) => {
          console.log(chalk.gray(`  [${i + 1}] ${citation}`));
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('models')
  .description('List available models')
  .action(() => {
    console.log(chalk.bold('Available Perplexity Models:\n'));
    console.log(`  ${chalk.cyan('sonar')}           - Standard model for general queries`);
    console.log(`  ${chalk.cyan('sonar-pro')}       - Enhanced model with better accuracy`);
    console.log(`  ${chalk.cyan('sonar-reasoning')} - Model optimized for reasoning tasks`);
    console.log(`  ${chalk.cyan('sonar-reasoning-pro')} - Enhanced reasoning model`);
    console.log(`  ${chalk.cyan('sonar-deep-research')} - Model for comprehensive research`);
  });

// Parse and execute
program.parse();
