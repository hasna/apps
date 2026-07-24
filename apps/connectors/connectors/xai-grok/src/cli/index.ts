#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { XAIGrok } from '../api';
import { DEFAULT_CHAT_MODEL } from '../types';
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
  getDefaultModel,
  setDefaultModel,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, printBinary } from '../utils/output';

const CONNECTOR_NAME = 'connect-xai-grok';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('xAI Grok API connector — models, chat, responses, embeddings, media, files, batches, collections')
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

function getClient(): XAIGrok {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set XAI_API_KEY.`);
    process.exit(1);
  }
  return new XAIGrok({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) {
    error(`${label} is required (pass JSON string or @file path)`);
    process.exit(1);
  }
  const raw = value.startsWith('@') ? readFileSync(value.slice(1), 'utf-8') : value;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function parseMessagesOption(messagesJson: string | undefined, message: string | undefined): Array<{ role: string; content: string }> {
  if (messagesJson) {
    const parsed = parseJsonOption(messagesJson, '--messages');
    if (!Array.isArray(parsed)) {
      error('--messages must be a JSON array');
      process.exit(1);
    }
    return parsed as Array<{ role: string; content: string }>;
  }
  if (message) {
    return [{ role: 'user', content: message }];
  }
  error('Provide --message or --messages JSON array');
  process.exit(1);
}

function buildAudioFormData(opts: { model: string; file: string; language?: string; prompt?: string }): FormData {
  const formData = new FormData();
  formData.append('model', opts.model);
  const fileBuffer = readFileSync(opts.file);
  const blob = new Blob([fileBuffer]);
  formData.append('file', blob, opts.file.split('/').pop() || 'audio');
  if (opts.language) formData.append('language', opts.language);
  if (opts.prompt) formData.append('prompt', opts.prompt);
  return formData;
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'Base URL')
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
    if (deleteProfile(name)) success(`Profile "${name}" deleted`);
    else {
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
    info(`Profile: ${profileName}`);
    console.log(`  API Key: ${config.apiKey ? chalk.green('configured') : chalk.gray('not set')}`);
    console.log(`  Base URL: ${config.baseUrl || chalk.gray('https://api.x.ai/v1 (default)')}`);
    console.log(`  Default Model: ${config.defaultModel || chalk.gray(DEFAULT_CHAT_MODEL)}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key for current profile')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL for current profile')
  .action((url: string) => {
    setBaseUrl(url);
    success('Base URL saved');
  });

configCmd
  .command('set-model <model>')
  .description('Set default chat model')
  .action((model: string) => {
    setDefaultModel(model);
    success(`Default model set to: ${model}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const client = getApiKey() ? new XAIGrok({ apiKey: getApiKey()!, baseUrl: getBaseUrl() }) : null;
    info(`Config directory: ${getConfigDir()}`);
    info(`Active profile: ${getCurrentProfile()}`);
    info(`API Key: ${client ? client.getApiKeyPreview() : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || 'https://api.x.ai/v1 (default)'}`);
    info(`Default Model: ${getDefaultModel() || DEFAULT_CHAT_MODEL}`);
  });

configCmd
  .command('clear')
  .description('Clear current profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// API commands (aligned with Alumia inventory)
program
  .command('list-models')
  .description('List models')
  .action(async function (this: Command) {
    const result = await getClient().models.list();
    print(result, getFormat(this));
  });

program
  .command('get-model <model>')
  .description('Get model details')
  .action(async function (this: Command, model: string) {
    const result = await getClient().models.get(model);
    print(result, getFormat(this));
  });

program
  .command('chat')
  .description('Chat completion')
  .option('-m, --model <model>', 'Model', getDefaultModel() || DEFAULT_CHAT_MODEL)
  .option('--message <text>', 'Single user message')
  .option('--messages <json>', 'Messages JSON array')
  .option('--body <json>', 'Full request body JSON')
  .action(async function (this: Command, opts) {
    const client = getClient();
    const body = opts.body
      ? parseJsonOption(opts.body, '--body')
      : {
          model: opts.model,
          messages: parseMessagesOption(opts.messages, opts.message),
        };
    const result = await client.chat.create(body as Parameters<typeof client.chat.create>[0]);
    print(result, getFormat(this));
  });

program
  .command('stream-chat')
  .description('Streaming chat completion (returns raw SSE text)')
  .option('-m, --model <model>', 'Model', getDefaultModel() || DEFAULT_CHAT_MODEL)
  .option('--message <text>', 'Single user message')
  .option('--messages <json>', 'Messages JSON array')
  .option('--body <json>', 'Full request body JSON')
  .action(async function (this: Command, opts) {
    const client = getClient();
    const body = opts.body
      ? parseJsonOption(opts.body, '--body')
      : {
          model: opts.model,
          messages: parseMessagesOption(opts.messages, opts.message),
        };
    const result = await client.chat.stream(body as Parameters<typeof client.chat.stream>[0]);
    console.log(result);
  });

program
  .command('create-response')
  .description('Create a Responses API response')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const result = await getClient().responses.create(parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('get-response <responseId>')
  .description('Get a response')
  .action(async function (this: Command, responseId: string) {
    const result = await getClient().responses.get(responseId);
    print(result, getFormat(this));
  });

program
  .command('delete-response <responseId>')
  .description('Delete a response')
  .action(async function (this: Command, responseId: string) {
    const result = await getClient().responses.delete(responseId);
    print(result, getFormat(this));
  });

program
  .command('cancel-response <responseId>')
  .description('Cancel a response')
  .action(async function (this: Command, responseId: string) {
    const result = await getClient().responses.cancel(responseId);
    print(result, getFormat(this));
  });

program
  .command('create-embedding')
  .description('Create embeddings')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const body = parseJsonOption(opts.body, '--body');
    const result = await getClient().embeddings.create(body as { model: string; input: unknown });
    print(result, getFormat(this));
  });

program
  .command('tokenize-text')
  .description('Tokenize text')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const result = await getClient().tokenize.text(parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('generate-image')
  .description('Generate an image')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const result = await getClient().images.generate(parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('get-image-generation <generationId>')
  .description('Get an image generation')
  .action(async function (this: Command, generationId: string) {
    const result = await getClient().images.get(generationId);
    print(result, getFormat(this));
  });

program
  .command('generate-video')
  .description('Generate a video')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const result = await getClient().video.generate(parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('get-video-generation <generationId>')
  .description('Get a video generation')
  .action(async function (this: Command, generationId: string) {
    const result = await getClient().video.get(generationId);
    print(result, getFormat(this));
  });

program
  .command('list-video-generations')
  .description('List video generations')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .option('--after <cursor>', 'Pagination cursor')
  .action(async function (this: Command, opts) {
    const result = await getClient().video.list({ limit: opts.limit, after: opts.after });
    print(result, getFormat(this));
  });

program
  .command('create-speech')
  .description('Create speech audio (writes binary to stdout)')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const buffer = await getClient().audio.createSpeech(parseJsonOption(opts.body, '--body'));
    printBinary(buffer);
  });

program
  .command('create-transcription')
  .description('Transcribe audio file')
  .requiredOption('-m, --model <model>', 'Model')
  .requiredOption('-f, --file <path>', 'Audio file path')
  .option('--language <code>', 'Language code')
  .option('--prompt <text>', 'Optional prompt')
  .action(async function (this: Command, opts) {
    const formData = buildAudioFormData(opts);
    const result = await getClient().audio.createTranscription(formData);
    print(result, getFormat(this));
  });

program
  .command('create-translation')
  .description('Translate audio file')
  .requiredOption('-m, --model <model>', 'Model')
  .requiredOption('-f, --file <path>', 'Audio file path')
  .option('--prompt <text>', 'Optional prompt')
  .action(async function (this: Command, opts) {
    const formData = buildAudioFormData(opts);
    const result = await getClient().audio.createTranslation(formData);
    print(result, getFormat(this));
  });

program
  .command('list-files')
  .description('List files')
  .option('--purpose <purpose>', 'Filter by purpose')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .option('--after <cursor>', 'Pagination cursor')
  .action(async function (this: Command, opts) {
    const result = await getClient().files.list({ purpose: opts.purpose, limit: opts.limit, after: opts.after });
    print(result, getFormat(this));
  });

program
  .command('get-file <fileId>')
  .description('Get file metadata')
  .action(async function (this: Command, fileId: string) {
    const result = await getClient().files.get(fileId);
    print(result, getFormat(this));
  });

program
  .command('delete-file <fileId>')
  .description('Delete a file')
  .action(async function (this: Command, fileId: string) {
    const result = await getClient().files.delete(fileId);
    print(result, getFormat(this));
  });

program
  .command('get-file-content <fileId>')
  .description('Download file content (writes binary to stdout)')
  .action(async (fileId: string) => {
    const buffer = await getClient().files.getContent(fileId);
    printBinary(buffer);
  });

program
  .command('create-batch')
  .description('Create a batch job')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const result = await getClient().batches.create(parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('list-batches')
  .description('List batch jobs')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .option('--after <cursor>', 'Pagination cursor')
  .action(async function (this: Command, opts) {
    const result = await getClient().batches.list({ limit: opts.limit, after: opts.after });
    print(result, getFormat(this));
  });

program
  .command('get-batch <batchId>')
  .description('Get a batch job')
  .action(async function (this: Command, batchId: string) {
    const result = await getClient().batches.get(batchId);
    print(result, getFormat(this));
  });

program
  .command('cancel-batch <batchId>')
  .description('Cancel a batch job')
  .action(async function (this: Command, batchId: string) {
    const result = await getClient().batches.cancel(batchId);
    print(result, getFormat(this));
  });

program
  .command('list-collections')
  .description('List collections')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .option('--after <cursor>', 'Pagination cursor')
  .action(async function (this: Command, opts) {
    const result = await getClient().collections.list({ limit: opts.limit, after: opts.after });
    print(result, getFormat(this));
  });

program
  .command('create-collection')
  .description('Create a collection')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, opts) {
    const result = await getClient().collections.create(parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('get-collection <collectionId>')
  .description('Get a collection')
  .action(async function (this: Command, collectionId: string) {
    const result = await getClient().collections.get(collectionId);
    print(result, getFormat(this));
  });

program
  .command('delete-collection <collectionId>')
  .description('Delete a collection')
  .action(async function (this: Command, collectionId: string) {
    const result = await getClient().collections.delete(collectionId);
    print(result, getFormat(this));
  });

program
  .command('search-collection <collectionId>')
  .description('Search a collection')
  .requiredOption('--body <json>', 'Search body JSON')
  .action(async function (this: Command, collectionId: string, opts) {
    const result = await getClient().collections.search(collectionId, parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('add-collection-file <collectionId>')
  .description('Add a file to a collection')
  .requiredOption('--body <json>', 'Request body JSON')
  .action(async function (this: Command, collectionId: string, opts) {
    const result = await getClient().collections.addFile(collectionId, parseJsonOption(opts.body, '--body'));
    print(result, getFormat(this));
  });

program
  .command('list-collection-files <collectionId>')
  .description('List collection files')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .option('--after <cursor>', 'Pagination cursor')
  .action(async function (this: Command, collectionId: string, opts) {
    const result = await getClient().collections.listFiles(collectionId, { limit: opts.limit, after: opts.after });
    print(result, getFormat(this));
  });

program
  .command('delete-collection-file <collectionId> <fileId>')
  .description('Delete a collection file')
  .action(async function (this: Command, collectionId: string, fileId: string) {
    const result = await getClient().collections.deleteFile(collectionId, fileId);
    print(result, getFormat(this));
  });

program
  .command('raw-request')
  .description('Call any xAI API path')
  .requiredOption('--path <path>', 'API path (e.g. /models)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body JSON')
  .option('--query <json>', 'Query params JSON')
  .action(async function (this: Command, opts) {
    const result = await getClient().rawRequest({
      path: opts.path,
      method: opts.method,
      body: opts.body ? parseJsonOption(opts.body, '--body') : undefined,
      query: opts.query ? (parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined>) : undefined,
    });
    print(result, getFormat(this));
  });

program.parse();
