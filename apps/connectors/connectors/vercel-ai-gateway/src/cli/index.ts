#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { VercelAiGateway } from '../api';
import {
  getApiKey, setApiKey, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-vercel-ai-gateway';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vercel AI Gateway connector CLI - unified LLM gateway access')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): VercelAiGateway {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VERCEL_AI_GATEWAY_API_KEY`);
    process.exit(1);
  }
  return new VercelAiGateway({ apiKey });
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) { info('No profiles found'); return; }
  profiles.forEach(p => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) { error(`Profile "${name}" does not exist`); process.exit(1); }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) { error(`Profile "${name}" already exists`); process.exit(1); }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) { setCurrentProfile(name); info(`Switched to profile: ${name}`); }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') { error('Cannot delete default profile'); process.exit(1); }
  if (deleteProfile(name)) { success(`Profile "${name}" deleted`); }
  else { error(`Profile "${name}" not found`); process.exit(1); }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Models Commands
const modelsCmd = program.command('models').description('Model catalog');

modelsCmd.command('list').description('List available models').action(async () => {
  try {
    const client = getClient();
    const result = await client.listModels();
    if (getFormat(program) === 'json') {
      print(result.data, 'json');
    } else {
      result.data.forEach(m => {
        console.log(chalk.cyan(m.id));
        if (m.owned_by) console.log(`  Owner: ${m.owned_by}`);
      });
    }
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

modelsCmd.command('get <model>').description('Get model details').action(async (model: string) => {
  try {
    const client = getClient();
    const result = await client.getModel(model);
    print(result, getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Chat Command
program.command('chat <message>')
  .description('Send a chat completion request')
  .option('-m, --model <model>', 'Model (required)', 'openai/gpt-4o-mini')
  .option('-t, --temperature <temp>', 'Temperature')
  .option('--max-tokens <n>', 'Max tokens')
  .option('-s, --system <prompt>', 'System prompt')
  .option('--stream', 'Enable streaming')
  .action(async (message: string, opts) => {
    try {
      const client = getClient();
      const messages: { role: 'system' | 'user'; content: string }[] = [];
      if (opts.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: message });

      const result = opts.stream
        ? await client.streamChat({
            model: opts.model,
            messages,
            temperature: opts.temperature ? parseFloat(opts.temperature) : undefined,
            max_tokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
          })
        : await client.chat({
            model: opts.model,
            messages,
            temperature: opts.temperature ? parseFloat(opts.temperature) : undefined,
            max_tokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
          });

      if (getFormat(program) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.green('\nResponse:'));
        console.log(result.choices[0]?.message?.content || '');
        if (result.usage) {
          info(`\nTokens: ${result.usage.prompt_tokens} in, ${result.usage.completion_tokens} out`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Embeddings Command
program.command('embeddings')
  .description('Create embeddings')
  .requiredOption('-m, --model <model>', 'Embedding model')
  .requiredOption('-i, --input <text>', 'Input text (comma-separated for multiple)')
  .option('--dimensions <n>', 'Output dimensions')
  .action(async (opts) => {
    try {
      const client = getClient();
      const input = opts.input.includes(',')
        ? opts.input.split(',').map((s: string) => s.trim())
        : opts.input;
      const result = await client.createEmbedding({
        model: opts.model,
        input,
        dimensions: opts.dimensions ? parseInt(opts.dimensions) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Responses Commands
const responsesCmd = program.command('responses').description('OpenAI Responses API');

responsesCmd.command('create')
  .description('Create a response')
  .requiredOption('-m, --model <model>', 'Model')
  .requiredOption('--input <json>', 'Input JSON')
  .option('--stream', 'Enable streaming')
  .option('--openresponses', 'Use OpenResponses compatibility base URL')
  .action(async (opts) => {
    try {
      const client = getClient();
      const input = JSON.parse(opts.input);
      const request = { model: opts.model, input };
      const result = opts.openresponses
        ? await client.createOpenResponse(request)
        : opts.stream
          ? await client.streamResponse(request)
          : await client.createResponse(request);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Anthropic Message Command
program.command('anthropic')
  .description('Send an Anthropic-compatible message')
  .requiredOption('-m, --model <model>', 'Model')
  .requiredOption('--message <text>', 'User message')
  .option('--max-tokens <n>', 'Max tokens', '1024')
  .option('--system <prompt>', 'System prompt')
  .action(async (opts) => {
    try {
      const client = getClient();
      const messages = [{ role: 'user' as const, content: opts.message }];
      const result = await client.createAnthropicMessage({
        model: opts.model,
        messages,
        max_tokens: parseInt(opts.maxTokens),
        system: opts.system,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw Request Command
program.command('raw')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /models)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body JSON')
  .option('--compatibility <mode>', 'Compatibility mode: openai, anthropic, openresponses', 'openai')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        body: opts.body ? JSON.parse(opts.body) : undefined,
        compatibility: opts.compatibility,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
