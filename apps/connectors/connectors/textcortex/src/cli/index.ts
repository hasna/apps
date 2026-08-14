#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TextCortex } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-textcortex';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TextCortex API connector - AI text generation, summarization, rewriting, and classification')
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
      process.env.TEXTCORTEX_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const opts = cmd.opts();
  const parentOpts = cmd.parent?.opts();
  return (opts.format || parentOpts?.format || 'pretty') as OutputFormat;
}

function getClient(): TextCortex {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TEXTCORTEX_API_KEY environment variable.`);
    process.exit(1);
  }
  return new TextCortex({ apiKey, baseUrl: getBaseUrl() });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

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

    success('Profiles:');
    profiles.forEach((p) => {
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.textcortex.com)')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set custom API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('https://api.textcortex.com')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('generate <prompt>')
  .description('Generate text from a prompt')
  .option('--max-tokens <tokens>', 'Maximum tokens', '256')
  .option('--model <model>', 'Model identifier')
  .option('--temperature <temp>', 'Temperature')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const body: Record<string, unknown> = {
        prompt,
        max_tokens: parseInt(opts.maxTokens, 10),
      };
      if (opts.model) body.model = opts.model;
      if (opts.temperature) body.temperature = parseFloat(opts.temperature);

      const response = await client.hemingwai.generateText(body as { prompt: string; max_tokens?: number });
      const format = getFormat(program);

      if (format === 'json') {
        print(response, format);
      } else {
        console.log(client.hemingwai.extractText(response));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('summarize <text>')
  .description('Summarize text')
  .option('--max-tokens <tokens>', 'Maximum tokens', '256')
  .option('--mode <mode>', 'Summarization mode')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const body: Record<string, unknown> = {
        text,
        max_tokens: parseInt(opts.maxTokens, 10),
      };
      if (opts.mode) body.mode = opts.mode;

      const response = await client.hemingwai.summarizeText(body as { text: string; max_tokens?: number });
      const format = getFormat(program);

      if (format === 'json') {
        print(response, format);
      } else {
        console.log(client.hemingwai.extractText(response));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('rewrite <text>')
  .description('Rewrite text')
  .option('--mode <mode>', 'Rewrite mode')
  .option('--max-tokens <tokens>', 'Maximum tokens', '256')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const body: Record<string, unknown> = {
        text,
        max_tokens: parseInt(opts.maxTokens, 10),
      };
      if (opts.mode) body.mode = opts.mode;

      const response = await client.hemingwai.rewriteText(body as { text: string; max_tokens?: number });
      const format = getFormat(program);

      if (format === 'json') {
        print(response, format);
      } else {
        console.log(client.hemingwai.extractText(response));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('classify <text>')
  .description('Classify text')
  .option('--labels <labels>', 'Comma-separated labels')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();
      const body: Record<string, unknown> = { text };
      if (opts.labels) {
        body.labels = opts.labels.split(',').map((l: string) => l.trim()).filter(Boolean);
      }

      const response = await client.hemingwai.classifyText(body as { text: string });
      const format = getFormat(program);

      if (format === 'json') {
        print(response, format);
      } else {
        console.log(client.hemingwai.extractText(response));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /hemingwai/generate_text_v3/)')
  .option('--method <method>', 'HTTP method', 'POST')
  .option('--body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const response = await client.hemingwai.rawRequest({
        path: opts.path,
        method: opts.method,
        body,
      });
      print(response, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
