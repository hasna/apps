#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tisane } from '../api';
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
  loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, readJsonInput } from '../utils/output';

const CONNECTOR_NAME = 'connect-tisane';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tisane NLP API connector — content moderation, sentiment, and language understanding')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API subscription key (overrides config)')
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
      process.env.TISANE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tisane {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TISANE_API_KEY.`);
    process.exit(1);
  }
  return new Tisane({ apiKey, baseUrl: getBaseUrl() });
}

async function runWithBody(
  cmd: Command,
  body: Record<string, unknown>,
  action: (client: Tisane, body: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  try {
    const client = getClient();
    const result = await action(client, body);
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
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
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API subscription key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
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
    info(`Base URL: ${config.baseUrl || chalk.gray('https://api.tisane.ai')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API subscription key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('https://api.tisane.ai')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('languages')
  .description('List supported languages')
  .action(async () => {
    try {
      const client = getClient();
      print(await client.listLanguages(), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('parse')
  .description('Parse text for NLP features')
  .requiredOption('-c, --content <text>', 'Text content to parse')
  .option('-l, --language <code>', 'Language code')
  .option('--body <file>', 'JSON request body file (overrides flags)')
  .action(async (opts, cmd) => {
    const body = await readJsonInput(opts.body);
    if (!Object.keys(body).length) {
      body.content = opts.content;
      if (opts.language) body.language = opts.language;
    }
    await runWithBody(cmd, body, (client, b) => client.parse(b));
  });

program
  .command('extract-text')
  .description('Extract text from HTML or URL')
  .option('-u, --url <url>', 'Source URL')
  .option('--html <html>', 'Raw HTML content')
  .option('--body <file>', 'JSON request body file')
  .action(async (opts, cmd) => {
    const body = await readJsonInput(opts.body);
    if (!Object.keys(body).length) {
      if (opts.url) body.url = opts.url;
      if (opts.html) body.html = opts.html;
    }
    await runWithBody(cmd, body, (client, b) => client.extractText(b));
  });

program
  .command('compare-entities')
  .description('Compare named entities between two texts')
  .option('--text1 <text>', 'First text')
  .option('--text2 <text>', 'Second text')
  .option('--body <file>', 'JSON request body file')
  .action(async (opts, cmd) => {
    const body = await readJsonInput(opts.body);
    if (!Object.keys(body).length) {
      if (opts.text1) body.text1 = opts.text1;
      if (opts.text2) body.text2 = opts.text2;
    }
    await runWithBody(cmd, body, (client, b) => client.compareEntities(b));
  });

program
  .command('similarity')
  .description('Compute similarity between two texts')
  .option('--text1 <text>', 'First text')
  .option('--text2 <text>', 'Second text')
  .option('--body <file>', 'JSON request body file')
  .action(async (opts, cmd) => {
    const body = await readJsonInput(opts.body);
    if (!Object.keys(body).length) {
      if (opts.text1) body.text1 = opts.text1;
      if (opts.text2) body.text2 = opts.text2;
    }
    await runWithBody(cmd, body, (client, b) => client.similarity(b));
  });

program
  .command('detect-language')
  .description('Detect language of text content')
  .option('-c, --content <text>', 'Text content')
  .option('--body <file>', 'JSON request body file')
  .action(async (opts, cmd) => {
    const body = await readJsonInput(opts.body);
    if (!Object.keys(body).length && opts.content) {
      body.content = opts.content;
    }
    await runWithBody(cmd, body, (client, b) => client.detectLanguage(b));
  });

program
  .command('transform')
  .description('Transform text (e.g. translation)')
  .option('-c, --content <text>', 'Text content')
  .option('-t, --target-language <code>', 'Target language code')
  .option('--body <file>', 'JSON request body file')
  .action(async (opts, cmd) => {
    const body = await readJsonInput(opts.body);
    if (!Object.keys(body).length) {
      if (opts.content) body.content = opts.content;
      if (opts.targetLanguage) body.targetLanguage = opts.targetLanguage;
    }
    await runWithBody(cmd, body, (client, b) => client.transform(b));
  });

program
  .command('request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /parse)')
  .option('-m, --method <method>', 'HTTP method', 'POST')
  .option('--body <file>', 'JSON request body file')
  .action(async (opts, cmd) => {
    const body = await readJsonInput(opts.body);
    await runWithBody(cmd, body, (client, b) =>
      client.rawRequest(opts.path, {
        method: opts.method,
        body: Object.keys(b).length ? b : undefined,
      }),
    );
  });

program.parse();
