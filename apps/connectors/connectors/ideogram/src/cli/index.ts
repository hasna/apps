#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Ideogram } from '../api';
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

const CONNECTOR_NAME = 'connect-ideogram';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Ideogram AI connector CLI - AI image generation with multi-profile support')
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
      process.env.IDEOGRAM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Ideogram {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set IDEOGRAM_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Ideogram({ apiKey });
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
// Image Commands
// ============================================
const imageCmd = program
  .command('image')
  .description('Image generation commands');

imageCmd
  .command('generate <prompt>')
  .description('Generate images from text prompt')
  .option('-r, --ratio <ratio>', 'Aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4)', '1:1')
  .option('-s, --style <style>', 'Style type (auto, general, realistic, design, render_3d, anime)', 'auto')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--seed <number>', 'Random seed')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const result = await client.generate({
        prompt,
        aspect_ratio: opts.ratio,
        style_type: opts.style,
        negative_prompt: opts.negative,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
      });

      const format = getFormat(imageCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Generated ${result.data.length} image(s)`);
        result.data.forEach((img, i) => {
          console.log(chalk.bold(`\nImage ${i + 1}:`));
          info(`URL: ${img.url}`);
          info(`Seed: ${img.seed}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imageCmd
  .command('describe <imageUrl>')
  .description('Describe an image')
  .action(async (imageUrl: string) => {
    try {
      const client = getClient();
      const result = await client.describe({ image_url: imageUrl });
      const format = getFormat(imageCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Image descriptions:');
        result.descriptions.forEach((desc, i) => {
          console.log(chalk.bold(`\n${i + 1}. (confidence: ${(desc.confidence * 100).toFixed(1)}%)`));
          console.log(`   ${desc.text}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imageCmd
  .command('remix <prompt>')
  .description('Remix an existing image with a new prompt')
  .requiredOption('-i, --image <url>', 'Source image URL')
  .option('-r, --ratio <ratio>', 'Aspect ratio', '1:1')
  .option('-s, --style <style>', 'Style type', 'auto')
  .option('-w, --weight <number>', 'Image weight (0-1)', '0.5')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const result = await client.remix({
        prompt,
        image_url: opts.image,
        aspect_ratio: opts.ratio,
        style_type: opts.style,
        image_weight: parseFloat(opts.weight),
      });

      const format = getFormat(imageCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Generated ${result.data.length} remixed image(s)`);
        result.data.forEach((img, i) => {
          console.log(chalk.bold(`\nImage ${i + 1}:`));
          info(`URL: ${img.url}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imageCmd
  .command('upscale <imageUrl>')
  .description('Upscale an image')
  .option('-s, --scale <number>', 'Scale factor', '2')
  .action(async (imageUrl: string, opts) => {
    try {
      const client = getClient();
      const result = await client.upscale({
        image_url: imageUrl,
        scale: parseInt(opts.scale),
      });

      const format = getFormat(imageCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success('Image upscaled');
        info(`URL: ${result.url}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
