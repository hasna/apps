#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Trybloom } from '../api';
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

const CONNECTOR_NAME = 'connect-trybloom';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Bloom connector CLI - On-brand creative API')
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
      process.env.TRYBLOOM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseJsonBody(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function getClient(): Trybloom {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRYBLOOM_API_KEY.`);
    process.exit(1);
  }
  return new Trybloom({ apiKey, baseUrl: getBaseUrl() });
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create a new profile')
  .option('--api-key <key>', 'API key')
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

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://www.trybloom.ai/api/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Brand Commands
const brandsCmd = program.command('brands').description('Brand management');

brandsCmd.command('list')
  .description('List brands')
  .option('--limit <n>', 'Result limit', parseInt)
  .option('--offset <n>', 'Result offset', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, number> = {};
      if (opts.limit !== undefined) params.limit = opts.limit;
      if (opts.offset !== undefined) params.offset = opts.offset;
      const result = await client.listBrands(params);
      print(result, getFormat(brandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

brandsCmd.command('get <brandId>')
  .description('Get a brand by ID')
  .action(async (brandId: string) => {
    try {
      const client = getClient();
      print(await client.getBrand(brandId), getFormat(brandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

brandsCmd.command('create')
  .description('Create a brand')
  .option('--body <json>', 'Request body as JSON')
  .option('--name <name>', 'Brand name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? parseJsonBody(opts.body) : { name: opts.name };
      print(await client.createBrand(body), getFormat(brandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Generation Commands
const generationsCmd = program.command('generations').description('Generation management');

generationsCmd.command('create')
  .description('Create a generation')
  .option('--body <json>', 'Request body as JSON')
  .option('--brand-id <id>', 'Brand ID')
  .option('--prompt <prompt>', 'Generation prompt')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonBody(opts.body)
        : { brandId: opts.brandId, prompt: opts.prompt };
      print(await client.createGeneration(body), getFormat(generationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

generationsCmd.command('get <generationId>')
  .description('Get a generation by ID')
  .action(async (generationId: string) => {
    try {
      const client = getClient();
      print(await client.getGeneration(generationId), getFormat(generationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Image Commands
const imagesCmd = program.command('images').description('Image operations');

imagesCmd.command('edit')
  .description('Edit an image')
  .option('--body <json>', 'Request body as JSON')
  .option('--image-url <url>', 'Source image URL')
  .option('--prompt <prompt>', 'Edit prompt')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonBody(opts.body)
        : { imageUrl: opts.imageUrl, prompt: opts.prompt };
      print(await client.editImage(body), getFormat(imagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imagesCmd.command('resize')
  .description('Resize an image')
  .option('--body <json>', 'Request body as JSON')
  .option('--image-url <url>', 'Source image URL')
  .option('--width <n>', 'Target width', parseInt)
  .option('--height <n>', 'Target height', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonBody(opts.body)
        : { imageUrl: opts.imageUrl, width: opts.width, height: opts.height };
      print(await client.resizeImage(body), getFormat(imagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imagesCmd.command('upload')
  .description('Upload an image')
  .option('--body <json>', 'Request body as JSON')
  .option('--image-url <url>', 'Image URL to upload')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonBody(opts.body)
        : { imageUrl: opts.imageUrl };
      print(await client.uploadImage(body), getFormat(imagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program.command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /brands)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        body: opts.body ? parseJsonBody(opts.body) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
