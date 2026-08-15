#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TopazLabs } from '../api';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getApiKey,
  getConfigDir,
  getCurrentProfile,
  listProfiles,
  loadProfile,
  profileExists,
  setApiKey,
  setCurrentProfile,
  setProfileOverride,
} from '../utils/config';
import type { TopazAsyncImageRequest, TopazEstimateRequest, TopazOutputFormat } from '../types';
import type { OutputFormat } from '../utils/output';
import { debug, error, info, print, setVerboseMode, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-topaz-labs';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Topaz Labs Image API connector')
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
  let current: Command = cmd;
  while (current.parent) {
    current = current.parent;
  }
  return (current.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TopazLabs {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TOPAZ_LABS_API_KEY.`);
    process.exit(1);
  }
  return new TopazLabs({
    apiKey,
    baseUrl: process.env.TOPAZ_LABS_BASE_URL,
  });
}

async function run<T>(cmd: Command, fn: (client: TopazLabs) => Promise<T>): Promise<void> {
  try {
    const result = await fn(getClient());
    print(result, getFormat(cmd));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function parseNumber(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return number;
}

function parseJsonObject(value: string | undefined): Record<string, string | number | boolean> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--settings must be a JSON object');
  }
  return parsed as Record<string, string | number | boolean>;
}

type AsyncCliOptions = {
  image?: string;
  sourceId?: string;
  sourceUrl?: string;
  model?: string;
  outputHeight?: number;
  outputWidth?: number;
  cropToFill?: boolean;
  outputFormat?: TopazOutputFormat;
  webhookUrl?: string;
  settings?: string;
};

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || 'image';
}

function buildAsyncOptions(opts: AsyncCliOptions): TopazAsyncImageRequest {
  return {
    image: opts.image ? Bun.file(opts.image) : undefined,
    filename: opts.image ? basename(opts.image) : undefined,
    sourceId: opts.sourceId,
    sourceUrl: opts.sourceUrl,
    model: opts.model,
    outputHeight: opts.outputHeight,
    outputWidth: opts.outputWidth,
    cropToFill: opts.cropToFill,
    outputFormat: opts.outputFormat,
    webhookUrl: opts.webhookUrl,
    modelSettings: parseJsonObject(opts.settings),
  };
}

function addAsyncOptions(command: Command): Command {
  return command
    .option('--image <path>', 'Image file to upload as multipart/form-data')
    .option('--source-url <url>', 'Source image URL')
    .option('--source-id <id>', 'Previously uploaded source image ID')
    .option('--model <model>', 'Topaz model name')
    .option('--output-height <px>', 'Output height', parseNumber)
    .option('--output-width <px>', 'Output width', parseNumber)
    .option('--crop-to-fill', 'Crop output to fill requested dimensions')
    .option('--output-format <format>', 'Output format (jpeg, jpg, png, tiff, tif)')
    .option('--webhook-url <url>', 'Webhook URL for status notifications')
    .option('--settings <json>', 'Additional model settings JSON object');
}

function buildEstimateOptions(opts: {
  category?: TopazEstimateRequest['category'];
  model?: string;
  inputHeight: number;
  inputWidth: number;
  outputHeight?: number;
  outputWidth?: number;
  cropToFill?: boolean;
  outputFormat?: TopazOutputFormat;
  settings?: string;
}): TopazEstimateRequest {
  return {
    category: opts.category,
    model: opts.model,
    inputHeight: opts.inputHeight,
    inputWidth: opts.inputWidth,
    outputHeight: opts.outputHeight,
    outputWidth: opts.outputWidth,
    cropToFill: opts.cropToFill,
    outputFormat: opts.outputFormat,
    modelSettings: parseJsonObject(opts.settings),
  };
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

addAsyncOptions(imageCmd.command('enhance').description('Enhance an image'))
  .action(async (opts, cmd) => run(cmd, c => c.enhance(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('enhance-gen').description('Enhance an image with generative models'))
  .action(async (opts, cmd) => run(cmd, c => c.enhanceGenerative(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('sharpen').description('Sharpen an image'))
  .action(async (opts, cmd) => run(cmd, c => c.sharpen(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('sharpen-gen').description('Sharpen an image with generative models'))
  .action(async (opts, cmd) => run(cmd, c => c.sharpenGenerative(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('denoise').description('Denoise an image'))
  .action(async (opts, cmd) => run(cmd, c => c.denoise(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('restore').description('Restore an image'))
  .action(async (opts, cmd) => run(cmd, c => c.restore(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('lighting').description('Adjust image lighting'))
  .action(async (opts, cmd) => run(cmd, c => c.lighting(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('matting').description('Run image matting'))
  .action(async (opts, cmd) => run(cmd, c => c.matting(buildAsyncOptions(opts))));

addAsyncOptions(imageCmd.command('tool').description('Run a Topaz image tool'))
  .action(async (opts, cmd) => run(cmd, c => c.tool(buildAsyncOptions(opts))));

const statusCmd = program.command('status').description('Status management');

statusCmd.command('list').description('List statuses')
  .option('--paginated', 'Enable paginated response')
  .option('--limit <n>', 'Page size', parseNumber)
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts, cmd) => run(cmd, c => c.listStatuses({
    paginated: opts.paginated,
    limit: opts.limit,
    cursor: opts.cursor,
  })));

statusCmd.command('get <processId>').description('Get status by process ID')
  .action(async (processId: string, _opts, cmd) => run(cmd, c => c.getStatus(processId)));

statusCmd.command('delete <processId>').description('Delete status by process ID')
  .action(async (processId: string, _opts, cmd) => run(cmd, c => c.deleteStatus(processId).then(() => ({ deleted: processId }))));

statusCmd.command('clear').description('Delete all statuses')
  .action(async (_opts, cmd) => run(cmd, c => c.deleteAllStatuses()));

const downloadCmd = program.command('download').description('Download URL helpers');

downloadCmd.command('output <processId>').description('Get processed image download URL')
  .action(async (processId: string, _opts, cmd) => run(cmd, c => c.getDownloadOutput(processId)));

downloadCmd.command('input <processId>').description('Get input image download URL')
  .action(async (processId: string, _opts, cmd) => run(cmd, c => c.getDownloadInput(processId)));

program.command('cancel <processId>').description('Cancel a pending process')
  .action(async (processId: string, _opts, cmd) => run(cmd, c => c.cancel(processId).then(() => ({ cancelled: processId }))));

const estimateCmd = program.command('estimate').description('Estimate processing duration and credits');

function addEstimateOptions(command: Command): Command {
  return command
    .option('--category <category>', 'Model category')
    .option('--model <model>', 'Topaz model name')
    .requiredOption('--input-height <px>', 'Input height', parseNumber)
    .requiredOption('--input-width <px>', 'Input width', parseNumber)
    .option('--output-height <px>', 'Output height', parseNumber)
    .option('--output-width <px>', 'Output width', parseNumber)
    .option('--crop-to-fill', 'Crop output to fill requested dimensions')
    .option('--output-format <format>', 'Output format (jpeg, jpg, png, tiff, tif)')
    .option('--settings <json>', 'Additional model settings JSON object');
}

addEstimateOptions(estimateCmd.command('standard').description('Estimate standard model processing'))
  .action(async (opts, cmd) => run(cmd, c => c.estimate(buildEstimateOptions(opts))));

addEstimateOptions(estimateCmd.command('gen').description('Estimate generative model processing'))
  .action(async (opts, cmd) => run(cmd, c => c.estimateGenerative(buildEstimateOptions(opts))));

estimateCmd.command('bulk').description('Estimate a JSON array of requests')
  .requiredOption('--items <json>', 'JSON array of estimate requests')
  .action(async (opts, cmd) => run(cmd, c => c.estimateBulk(JSON.parse(opts.items))));

program.parse();
