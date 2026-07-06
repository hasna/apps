#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TopazLabs } from '../api';
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-topaz-labs';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Topaz Labs Image API — enhance, upscale, restore, and batch image processing')
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
    }
    if (opts.apiKey) {
      process.env.TOPAZ_LABS_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TopazLabs {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TOPAZ_LABS_API_KEY.`);
    process.exit(1);
  }
  return new TopazLabs({ apiKey });
}

async function run<T>(cmd: Command, fn: (client: TopazLabs) => Promise<T>): Promise<void> {
  try {
    const result = await fn(getClient());
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`));
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const imageCmd = program.command('image').description('Image processing operations');

imageCmd.command('enhance').description('Enhance an image')
  .requiredOption('--image-url <url>', 'Source image URL')
  .option('--model <model>', 'Enhancement model')
  .option('--output-format <format>', 'Output format (jpg, png, tiff)')
  .option('--preset <preset>', 'Preset ID')
  .action(async (opts, cmd) => run(cmd, c => c.enhance({
    imageUrl: opts.imageUrl,
    model: opts.model,
    outputFormat: opts.outputFormat,
    preset: opts.preset,
  })));

imageCmd.command('upscale').description('Upscale an image')
  .requiredOption('--image-url <url>', 'Source image URL')
  .option('--scale <n>', 'Scale factor', '2')
  .option('--model <model>', 'Upscale model')
  .action(async (opts, cmd) => run(cmd, c => c.upscale({
    imageUrl: opts.imageUrl,
    scale: parseInt(opts.scale, 10) as 1 | 2 | 4 | 6,
    model: opts.model,
  })));

imageCmd.command('sharpen').description('Sharpen an image')
  .requiredOption('--image-url <url>', 'Source image URL')
  .option('--sharpen-amount <n>', 'Sharpen amount', parseFloat)
  .action(async (opts, cmd) => run(cmd, c => c.sharpen({
    imageUrl: opts.imageUrl,
    sharpenAmount: opts.sharpenAmount,
  })));

imageCmd.command('denoise').description('Denoise an image')
  .requiredOption('--image-url <url>', 'Source image URL')
  .option('--model <model>', 'Denoise model')
  .option('--strength <n>', 'Denoise strength', parseFloat)
  .action(async (opts, cmd) => run(cmd, c => c.denoise({
    imageUrl: opts.imageUrl,
    model: opts.model,
    strength: opts.strength,
  })));

imageCmd.command('restore').description('Restore an image')
  .requiredOption('--image-url <url>', 'Source image URL')
  .option('--restoration-strength <n>', 'Restoration strength', parseFloat)
  .option('--recover-faces', 'Recover faces')
  .action(async (opts, cmd) => run(cmd, c => c.restore({
    imageUrl: opts.imageUrl,
    restorationStrength: opts.restorationStrength,
    recoverFaces: opts.recoverFaces,
  })));

imageCmd.command('generative-upscale').description('Generative upscale')
  .requiredOption('--image-url <url>', 'Source image URL')
  .option('--scale <n>', 'Scale factor', parseInt)
  .option('--prompt <text>', 'Prompt')
  .action(async (opts, cmd) => run(cmd, c => c.generativeUpscale({
    imageUrl: opts.imageUrl,
    scale: opts.scale,
    prompt: opts.prompt,
  })));

imageCmd.command('lighting').description('Adjust image lighting')
  .requiredOption('--image-url <url>', 'Source image URL')
  .option('--strength <n>', 'Strength', parseFloat)
  .option('--relight', 'Relight')
  .action(async (opts, cmd) => run(cmd, c => c.lighting({
    imageUrl: opts.imageUrl,
    strength: opts.strength,
    relight: opts.relight,
  })));

imageCmd.command('preview-enhance').description('Preview enhancement')
  .requiredOption('--image-url <url>', 'Source image URL')
  .action(async (opts, cmd) => run(cmd, c => c.previewEnhance({ imageUrl: opts.imageUrl })));

const jobsCmd = program.command('jobs').description('Job management');

jobsCmd.command('get <id>').description('Get job by ID')
  .action(async (id: string, _opts, cmd) => run(cmd, c => c.getJob(id)));

jobsCmd.command('list').description('List jobs')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts, cmd) => run(cmd, c => c.listJobs({
    status: opts.status,
    limit: opts.limit,
    cursor: opts.cursor,
  })));

jobsCmd.command('cancel <id>').description('Cancel a job')
  .action(async (id: string, _opts, cmd) => run(cmd, c => c.cancelJob(id)));

jobsCmd.command('delete <id>').description('Delete a job')
  .action(async (id: string, _opts, cmd) => run(cmd, c => c.deleteJob(id).then(() => ({ deleted: id }))));

const batchCmd = program.command('batch').description('Batch operations');

batchCmd.command('submit').description('Submit a batch job')
  .requiredOption('--items <json>', 'JSON array of batch items')
  .option('--preset <preset>', 'Preset ID')
  .option('--webhook-url <url>', 'Webhook URL')
  .action(async (opts, cmd) => run(cmd, c => c.batchSubmit({
    items: JSON.parse(opts.items),
    preset: opts.preset,
    webhookUrl: opts.webhookUrl,
  })));

const modelsCmd = program.command('models').description('Model catalog');

modelsCmd.command('list').description('List models')
  .option('--feature <feature>', 'Filter by feature')
  .action(async (opts, cmd) => run(cmd, c => c.listModels({ feature: opts.feature })));

modelsCmd.command('get <id>').description('Get model by ID')
  .action(async (id: string, _opts, cmd) => run(cmd, c => c.getModel(id)));

const presetsCmd = program.command('presets').description('Preset management');

presetsCmd.command('list').description('List presets')
  .option('--feature <feature>', 'Filter by feature')
  .action(async (opts, cmd) => run(cmd, c => c.listPresets({ feature: opts.feature })));

presetsCmd.command('create').description('Create a preset')
  .requiredOption('--name <name>', 'Preset name')
  .requiredOption('--feature <feature>', 'Feature')
  .requiredOption('--settings <json>', 'Settings JSON')
  .option('--description <text>', 'Description')
  .action(async (opts, cmd) => run(cmd, c => c.createPreset({
    name: opts.name,
    feature: opts.feature,
    settings: JSON.parse(opts.settings),
    description: opts.description,
  })));

presetsCmd.command('update <id>').description('Update a preset')
  .requiredOption('--data <json>', 'Update data JSON')
  .action(async (id: string, opts, cmd) => run(cmd, c => c.updatePreset(id, JSON.parse(opts.data))));

presetsCmd.command('delete <id>').description('Delete a preset')
  .action(async (id: string, _opts, cmd) => run(cmd, c => c.deletePreset(id).then(() => ({ deleted: id }))));

const tagsCmd = program.command('tags').description('Tag management');

tagsCmd.command('list').description('List tags')
  .action(async (_opts, cmd) => run(cmd, c => c.listTags()));

tagsCmd.command('create <name>').description('Create a tag')
  .action(async (name: string, _opts, cmd) => run(cmd, c => c.createTag(name)));

tagsCmd.command('delete <id>').description('Delete a tag')
  .action(async (id: string, _opts, cmd) => run(cmd, c => c.deleteTag(id).then(() => ({ deleted: id }))));

const uploadsCmd = program.command('uploads').description('Upload helpers');

uploadsCmd.command('create-url').description('Create a presigned upload URL')
  .requiredOption('--filename <name>', 'Filename')
  .option('--content-type <type>', 'Content type')
  .action(async (opts, cmd) => run(cmd, c => c.createUploadUrl({
    filename: opts.filename,
    contentType: opts.contentType,
  })));

const accountCmd = program.command('account').description('Account and usage');

accountCmd.command('get').description('Get account info')
  .action(async (_opts, cmd) => run(cmd, c => c.getAccount()));

accountCmd.command('credits').description('Get credit balance')
  .action(async (_opts, cmd) => run(cmd, c => c.getCredits()));

accountCmd.command('usage').description('Get usage stats')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .action(async (opts, cmd) => run(cmd, c => c.getUsage({ from: opts.from, to: opts.to })));

const webhooksCmd = program.command('webhooks').description('Webhook management');

webhooksCmd.command('list').description('List webhooks')
  .action(async (_opts, cmd) => run(cmd, c => c.listWebhooks()));

webhooksCmd.command('create').description('Create a webhook')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--events <json>', 'JSON array of events')
  .option('--secret <secret>', 'Signing secret')
  .option('--active', 'Mark webhook active')
  .action(async (opts, cmd) => run(cmd, c => c.createWebhook({
    url: opts.url,
    events: JSON.parse(opts.events),
    secret: opts.secret,
    active: opts.active,
  })));

webhooksCmd.command('delete <id>').description('Delete a webhook')
  .action(async (id: string, _opts, cmd) => run(cmd, c => c.deleteWebhook(id).then(() => ({ deleted: id }))));

program.parse();
