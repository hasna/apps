#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Leonardo } from '../api';
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

const CONNECTOR_NAME = 'connect-leonardo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Leonardo AI connector CLI - AI image generation with multi-profile support')
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
      process.env.LEONARDO_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Leonardo {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set LEONARDO_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Leonardo({ apiKey });
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
// Image Generation Commands
// ============================================
const imageCmd = program
  .command('image')
  .description('Image generation commands');

imageCmd
  .command('generate <prompt>')
  .description('Generate images from text prompt')
  .option('-m, --model <id>', 'Model ID')
  .option('-w, --width <number>', 'Image width', '1024')
  .option('-h, --height <number>', 'Image height', '1024')
  .option('-n, --num <number>', 'Number of images', '1')
  .option('-g, --guidance <number>', 'Guidance scale', '7')
  .option('--negative <prompt>', 'Negative prompt')
  .option('--seed <number>', 'Random seed')
  .option('--alchemy', 'Enable Alchemy')
  .option('--photo-real', 'Enable PhotoReal')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const result = await client.generate({
        prompt,
        modelId: opts.model,
        width: parseInt(opts.width),
        height: parseInt(opts.height),
        num_images: parseInt(opts.num),
        guidance_scale: parseFloat(opts.guidance),
        negative_prompt: opts.negative,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        alchemy: opts.alchemy || undefined,
        photoReal: opts.photoReal || undefined,
      });

      const format = getFormat(imageCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Generation started`);
        info(`Generation ID: ${result.sdGenerationJob.generationId}`);
        info(`Use "connect-leonardo image get ${result.sdGenerationJob.generationId}" to check status`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imageCmd
  .command('get <generationId>')
  .description('Get generation by ID')
  .action(async (generationId: string) => {
    try {
      const client = getClient();
      const result = await client.getGeneration(generationId);
      const format = getFormat(imageCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const gen = result.generations_by_pk;
        console.log(chalk.bold(`Generation: ${gen.id}`));
        info(`Status: ${gen.status}`);
        info(`Prompt: ${gen.prompt}`);
        if (gen.generated_images.length > 0) {
          success(`Generated ${gen.generated_images.length} image(s)`);
          gen.generated_images.forEach((img, i) => {
            console.log(chalk.bold(`\nImage ${i + 1}:`));
            info(`URL: ${img.url}`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imageCmd
  .command('variation <imageId>')
  .description('Create a variation of an image')
  .option('-t, --type <type>', 'Transform type (OUTPAINT, INPAINT, UPSCALE, UNZOOM)', 'UPSCALE')
  .action(async (imageId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createVariation({
        id: imageId,
        isVariation: true,
        transformType: opts.type as 'OUTPAINT' | 'INPAINT' | 'UPSCALE' | 'UNZOOM',
      });

      const format = getFormat(imageCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Variation started`);
        info(`Generation ID: ${result.sdGenerationJob.generationId}`);
      }
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
  .description('Model commands');

modelCmd
  .command('list')
  .description('List platform models')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listModels();
      const format = getFormat(modelCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Platform Models:`);
        result.platform_models.forEach(model => {
          console.log(chalk.bold(`\n${model.name}`));
          info(`ID: ${model.id}`);
          if (model.description) info(`Description: ${model.description}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User commands');

userCmd
  .command('me')
  .description('Get current user info')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getUser();
      const format = getFormat(userCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const user = result.user;
        console.log(chalk.bold(`User: ${user.username}`));
        info(`ID: ${user.id}`);
        info(`Subscription Tokens: ${user.subscriptionTokens}`);
        info(`GPT Tokens: ${user.subscriptionGptTokens}`);
        info(`Model Tokens: ${user.subscriptionModelTokens}`);
        info(`Token Renewal: ${user.tokenRenewalDate}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
