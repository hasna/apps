#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { TheTokenCompany } from '../api';
import { DEFAULT_COMPRESSION_MODEL } from '../types';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-the-token-company';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('The Token Company API connector - LLM prompt compression')
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
      process.env.THE_TOKEN_COMPANY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TheTokenCompany {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-api-key <key>" or set THE_TOKEN_COMPANY_API_KEY.`,
    );
    process.exit(1);
  }
  return new TheTokenCompany({ apiKey, baseUrl: getBaseUrl() });
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
      error(`Profile "${name}" does not exist.`);
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
      success(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (!deleteProfile(name)) {
      error(`Cannot delete profile "${name}"`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set-api-key <key>')
  .description('Set API key')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success('Base URL saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const key = getApiKey();
    info(`Profile: ${getCurrentProfile()}`);
    info(`API Key: ${key ? `${key.substring(0, 6)}...` : 'not set'}`);
    info(`Base URL: ${getBaseUrl()}`);
    info(`Config dir: ${getConfigDir()}`);
  });

configCmd
  .command('clear')
  .description('Clear current profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

program
  .command('compress [input]')
  .description('Compress LLM prompt text')
  .option('-f, --file <path>', 'Read input from file')
  .option('-m, --model <model>', 'Compression model (bear-2, bear-1.2)', DEFAULT_COMPRESSION_MODEL)
  .option('-a, --aggressiveness <n>', 'Compression aggressiveness (0.05-0.9)', parseFloat)
  .option('--app-id <id>', 'Optional application identifier')
  .action(async (input: string | undefined, opts, cmd) => {
    const client = getClient();

    let text = input;
    if (opts.file) {
      text = await readFile(opts.file, 'utf-8');
    }

    if (!text) {
      error('Provide input text or --file');
      process.exit(1);
    }

    try {
      const result = await client.compress.compress({
        model: opts.model,
        input: text,
        compression_settings: opts.aggressiveness !== undefined ? { aggressiveness: opts.aggressiveness } : undefined,
        app_id: opts.appId,
      });
      print(result, getFormat(cmd));
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Call any Token Company API path')
  .requiredOption('--path <path>', 'API path (e.g. /compress)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .action(async (opts, cmd) => {
    const client = getClient();

    let body: Record<string, unknown> | undefined;
    if (opts.body) {
      try {
        body = JSON.parse(opts.body);
      } catch {
        error('Invalid JSON body');
        process.exit(1);
      }
    }

    try {
      const result = await client.rawRequest({
        method: opts.method,
        path: opts.path,
        body,
      });
      print(result, getFormat(cmd));
    } catch (e: unknown) {
      error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program.parse();
