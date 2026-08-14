#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Fal } from '../api';
import { COMMON_MODELS } from '../types';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-fal';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('fal.ai connector CLI - Serverless AI inference with multi-profile support')
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
      process.env.FAL_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Fal {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set FAL_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Fal({ apiKey });
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
// Run Commands
// ============================================
const runCmd = program
  .command('run')
  .description('Run AI models');

runCmd
  .command('image <prompt>')
  .description('Generate images using FLUX or other models')
  .option('-m, --model <model>', 'Model to use (flux-schnell, flux-dev, flux-pro, sdxl, etc.)', 'flux-schnell')
  .option('-s, --size <size>', 'Image size (e.g., 1024x1024, landscape_16_9, square)', 'square_hd')
  .option('-n, --num <number>', 'Number of images', '1')
  .option('--steps <number>', 'Number of inference steps')
  .option('--guidance <number>', 'Guidance scale')
  .option('--seed <number>', 'Random seed')
  .option('--no-safety', 'Disable safety checker')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const input: Record<string, unknown> = {
        prompt,
        image_size: opts.size,
        num_images: parseInt(opts.num),
        enable_safety_checker: opts.safety !== false,
      };

      if (opts.steps) input.num_inference_steps = parseInt(opts.steps);
      if (opts.guidance) input.guidance_scale = parseFloat(opts.guidance);
      if (opts.seed) input.seed = parseInt(opts.seed);

      const result = await client.generateImage(opts.model, input as any);

      const format = getFormat(runCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Generated ${result.images.length} image(s)`);
        result.images.forEach((img, i) => {
          console.log(chalk.bold(`\nImage ${i + 1}:`));
          info(`URL: ${img.url}`);
          info(`Size: ${img.width}x${img.height}`);
        });
        if (result.seed !== undefined) {
          info(`\nSeed: ${result.seed}`);
        }
        if (result.timings?.inference) {
          info(`Inference time: ${result.timings.inference.toFixed(2)}s`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Queue Commands
// ============================================
const queueCmd = program
  .command('queue')
  .description('Queue-based inference (async)');

queueCmd
  .command('submit <model>')
  .description('Submit a job to the queue')
  .requiredOption('-i, --input <json>', 'Input JSON')
  .option('-w, --webhook <url>', 'Webhook URL for completion notification')
  .action(async (model: string, opts) => {
    try {
      const client = getClient();
      const input = JSON.parse(opts.input);
      const result = await client.submit(model, input, opts.webhook);

      const format = getFormat(queueCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Job submitted`);
        info(`Request ID: ${result.request_id}`);
        info(`Status URL: ${result.status_url}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

queueCmd
  .command('status <model> <requestId>')
  .description('Check job status')
  .action(async (model: string, requestId: string) => {
    try {
      const client = getClient();
      const result = await client.status(model, requestId);

      const format = getFormat(queueCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Request: ${result.request_id}`));
        info(`Status: ${result.status}`);
        if (result.logs && result.logs.length > 0) {
          console.log(chalk.bold('\nLogs:'));
          result.logs.forEach(log => {
            console.log(`  [${log.timestamp}] ${log.message}`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

queueCmd
  .command('result <model> <requestId>')
  .description('Get job result')
  .action(async (model: string, requestId: string) => {
    try {
      const client = getClient();
      const result = await client.result(model, requestId);

      const format = getFormat(queueCmd);
      print(result, format);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

queueCmd
  .command('cancel <model> <requestId>')
  .description('Cancel a queued job')
  .action(async (model: string, requestId: string) => {
    try {
      const client = getClient();
      await client.cancel(model, requestId);
      success(`Job cancelled: ${requestId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Model Commands
// ============================================
const modelCmd = program
  .command('model')
  .description('Model information');

modelCmd
  .command('list')
  .description('List common model aliases')
  .action(() => {
    success('Common model aliases:');
    Object.entries(COMMON_MODELS).forEach(([alias, model]) => {
      console.log(`  ${chalk.bold(alias)} → ${model}`);
    });
    info('\nYou can also use full model paths like: fal-ai/flux/dev');
  });

program.parse();
