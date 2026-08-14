#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-agent';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Agent.ai API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.AGENT_AI_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set AGENT_AI_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
// Action Commands
// ============================================
const actionCmd = program
  .command('action')
  .description('Execute Agent.ai actions');

actionCmd
  .command('web-text')
  .description('Extract text from a web page')
  .requiredOption('--url <url>', 'URL to extract text from')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.actions.grabWebText({ url: opts.url });
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('invoke')
  .description('Invoke an agent')
  .requiredOption('--agent-id <id>', 'Agent ID to invoke')
  .requiredOption('--input <text>', 'Input text for the agent')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.actions.invokeAgent({
        agent_id: opts.agentId,
        input: opts.input,
      });
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('screenshot')
  .description('Take a screenshot of a web page')
  .requiredOption('--url <url>', 'URL to screenshot')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.actions.screenshot({ url: opts.url });
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('youtube-transcript')
  .description('Get transcript from a YouTube video')
  .requiredOption('--url <url>', 'YouTube video URL')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.actions.youtubeTranscript({ url: opts.url });
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('domain-info')
  .description('Get information about a domain')
  .requiredOption('--domain <domain>', 'Domain name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.actions.domainInfo({ domain: opts.domain });
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('generate-image')
  .description('Generate an image from a prompt')
  .requiredOption('--prompt <text>', 'Image generation prompt')
  .option('--model <model>', 'Model to use')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = { prompt: opts.prompt };
      if (opts.model) data.model = opts.model;
      const result = await client.actions.generateImage(data as any);
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('tts')
  .description('Convert text to speech')
  .requiredOption('--text <text>', 'Text to convert')
  .option('--voice <voice>', 'Voice to use')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = { text: opts.text };
      if (opts.voice) data.voice = opts.voice;
      const result = await client.actions.textToSpeech(data as any);
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

actionCmd
  .command('rest-api')
  .description('Make a REST API call')
  .requiredOption('--url <url>', 'URL to call')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body (JSON)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = {
        url: opts.url,
        method: opts.method,
      };
      if (opts.body) data.body = opts.body;
      const result = await client.actions.restApi(data as any);
      print(result, getFormat(actionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
