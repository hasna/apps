#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { StabilityAI } from '../api';
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  ensureExportsDir,
  getExportsDir,
  getImportsDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import type { AspectRatio, StylePreset, OutputFormatImage, UpscaleMode } from '../types';

const CONNECTOR_NAME = 'connect-stabilityai';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stability AI API CLI - Image generation, editing, upscaling, and 3D model generation')
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
      process.env.STABILITY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): StabilityAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STABILITY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new StabilityAI({ apiKey });
}

function generateFilename(prefix: string, extension: string = 'png'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}-${timestamp}.${extension}`;
}

async function saveImage(base64: string, filename: string): Promise<string> {
  const exportsDir = ensureExportsDir();
  const filepath = join(exportsDir, filename);
  const buffer = Buffer.from(base64, 'base64');
  writeFileSync(filepath, buffer);
  return filepath;
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
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    info(`Imports directory: ${getImportsDir()}`);
    console.log();
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
// User/Account Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User account information');

userCmd
  .command('account')
  .description('Get account information')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.user.getAccount();

      if (getFormat(userCmd) === 'json') {
        print(result, 'json');
      } else {
        success('Account Information:');
        console.log(`  ID: ${result.id}`);
        console.log(`  Email: ${result.email}`);
        if (result.profile_picture) {
          console.log(`  Profile Picture: ${result.profile_picture}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('balance')
  .description('Get credit balance')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.user.getBalance();

      if (getFormat(userCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Credit Balance: ${result.credits}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Engines Commands
// ============================================
const enginesCmd = program
  .command('engines')
  .description('List available engines/models');

enginesCmd
  .command('list')
  .description('List all available engines')
  .option('-t, --type <type>', 'Filter by engine type (PICTURE, TEXT, etc.)')
  .action(async (opts) => {
    try {
      const client = getClient();
      let engines = await client.engines.list();

      if (opts.type) {
        engines = engines.filter(e => e.type === opts.type.toUpperCase());
      }

      if (getFormat(enginesCmd) === 'json') {
        print(engines, 'json');
      } else {
        success(`Engines (${engines.length} found):`);
        engines.forEach(engine => {
          console.log(`  ${chalk.cyan(engine.id)}`);
          console.log(`    Name: ${engine.name}`);
          console.log(`    Type: ${engine.type}`);
          console.log(`    Description: ${engine.description}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Text-to-Image Commands
// ============================================
const textToImageCmd = program
  .command('text-to-image')
  .alias('t2i')
  .description('Generate images from text prompts');

textToImageCmd
  .command('generate <prompt>')
  .description('Generate an image from a text prompt')
  .option('-m, --model <model>', 'Model to use (sd3.5-large, sd3.5-medium, core, ultra)', 'sd3.5-large')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('-a, --aspect-ratio <ratio>', 'Aspect ratio (16:9, 1:1, 9:16, etc.)', '1:1')
  .option('-s, --seed <number>', 'Random seed')
  .option('--style <preset>', 'Style preset (photographic, anime, cinematic, etc.)')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();

      info(`Generating image with ${opts.model}...`);

      const result = await client.textToImage.generate({
        prompt,
        model: opts.model,
        negativePrompt: opts.negative,
        aspectRatio: opts.aspectRatio as AspectRatio,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        stylePreset: opts.style as StylePreset,
        outputFormat: opts.output as OutputFormatImage,
      });

      const imageData = result.image || (result.artifacts?.[0]?.base64);
      if (!imageData) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('text-to-image', opts.output);
      const filepath = await saveImage(imageData, filename);

      if (getFormat(textToImageCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Image generated!`);
        console.log(`  File: ${filepath}`);
        if (result.seed) console.log(`  Seed: ${result.seed}`);
        if (result.finish_reason) console.log(`  Status: ${result.finish_reason}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Image-to-Image Commands
// ============================================
const imageToImageCmd = program
  .command('image-to-image')
  .alias('i2i')
  .description('Transform images with AI');

imageToImageCmd
  .command('transform <image> <prompt>')
  .description('Transform an image based on a prompt')
  .option('-m, --model <model>', 'Model to use', 'sd3.5-large')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--strength <number>', 'Transform strength (0-1)', '0.5')
  .option('-s, --seed <number>', 'Random seed')
  .option('--style <preset>', 'Style preset')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, prompt: string, opts) => {
    try {
      const client = getClient();

      info(`Transforming image with ${opts.model}...`);

      const result = await client.imageToImage.transform({
        image,
        prompt,
        model: opts.model,
        negativePrompt: opts.negative,
        strength: parseFloat(opts.strength),
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        stylePreset: opts.style as StylePreset,
        outputFormat: opts.output as OutputFormatImage,
      });

      const imageData = result.image || (result.artifacts?.[0]?.base64);
      if (!imageData) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('image-to-image', opts.output);
      const filepath = await saveImage(imageData, filename);

      if (getFormat(imageToImageCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Image transformed!`);
        console.log(`  File: ${filepath}`);
        if (result.seed) console.log(`  Seed: ${result.seed}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Inpaint Commands
// ============================================
const inpaintCmd = program
  .command('inpaint')
  .description('Inpaint masked areas of images');

inpaintCmd
  .command('fill <image> <mask> <prompt>')
  .description('Fill masked area with generated content')
  .option('-m, --model <model>', 'Model to use', 'sd3.5-large')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('-s, --seed <number>', 'Random seed')
  .option('--grow-mask <pixels>', 'Grow mask by pixels')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, mask: string, prompt: string, opts) => {
    try {
      const client = getClient();

      info(`Inpainting with ${opts.model}...`);

      const result = await client.inpaint.inpaint({
        image,
        mask,
        prompt,
        model: opts.model,
        negativePrompt: opts.negative,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        growMask: opts.growMask ? parseInt(opts.growMask) : undefined,
        outputFormat: opts.output as OutputFormatImage,
      });

      const imageData = result.image || (result.artifacts?.[0]?.base64);
      if (!imageData) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('inpaint', opts.output);
      const filepath = await saveImage(imageData, filename);

      if (getFormat(inpaintCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Inpainting complete!`);
        console.log(`  File: ${filepath}`);
        if (result.seed) console.log(`  Seed: ${result.seed}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Outpaint Commands
// ============================================
const outpaintCmd = program
  .command('outpaint')
  .description('Extend image boundaries');

outpaintCmd
  .command('extend <image>')
  .description('Extend image boundaries')
  .option('--left <pixels>', 'Extend left by pixels')
  .option('--right <pixels>', 'Extend right by pixels')
  .option('--up <pixels>', 'Extend up by pixels')
  .option('--down <pixels>', 'Extend down by pixels')
  .option('--all <pixels>', 'Extend all directions equally')
  .option('-p, --prompt <prompt>', 'Prompt for extended content')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--creativity <value>', 'Creativity level (0-1)', '0.5')
  .option('-s, --seed <number>', 'Random seed')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, opts) => {
    try {
      const client = getClient();

      // Determine extension amounts
      let left = opts.left ? parseInt(opts.left) : undefined;
      let right = opts.right ? parseInt(opts.right) : undefined;
      let up = opts.up ? parseInt(opts.up) : undefined;
      let down = opts.down ? parseInt(opts.down) : undefined;

      if (opts.all) {
        const amount = parseInt(opts.all);
        left = right = up = down = amount;
      }

      if (!left && !right && !up && !down) {
        error('At least one direction must be specified (--left, --right, --up, --down, or --all)');
        process.exit(1);
      }

      info('Extending image boundaries...');

      const result = await client.outpaint.outpaint({
        image,
        left,
        right,
        up,
        down,
        prompt: opts.prompt,
        negativePrompt: opts.negative,
        creativity: opts.creativity ? parseFloat(opts.creativity) : undefined,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        outputFormat: opts.output as OutputFormatImage,
      });

      if (!result.image) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('outpaint', opts.output);
      const filepath = await saveImage(result.image, filename);

      if (getFormat(outpaintCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Image extended!`);
        console.log(`  File: ${filepath}`);
        if (result.seed) console.log(`  Seed: ${result.seed}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Upscale Commands
// ============================================
const upscaleCmd = program
  .command('upscale')
  .description('Upscale images with AI enhancement');

upscaleCmd
  .command('enhance <image>')
  .description('Upscale an image')
  .option('-m, --mode <mode>', 'Upscale mode (conservative, creative, fast)', 'conservative')
  .option('-p, --prompt <prompt>', 'Prompt for creative upscaling')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('--creativity <value>', 'Creativity level (0-1)')
  .option('-s, --seed <number>', 'Random seed')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, opts) => {
    try {
      const client = getClient();

      info(`Upscaling image (${opts.mode} mode)...`);

      const result = await client.upscale.upscale({
        image,
        prompt: opts.prompt,
        negativePrompt: opts.negative,
        creativity: opts.creativity ? parseFloat(opts.creativity) : undefined,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        outputFormat: opts.output as OutputFormatImage,
      }, opts.mode as UpscaleMode);

      if (!result.image) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename(`upscale-${opts.mode}`, opts.output);
      const filepath = await saveImage(result.image, filename);

      if (getFormat(upscaleCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Image upscaled!`);
        console.log(`  File: ${filepath}`);
        if (result.seed) console.log(`  Seed: ${result.seed}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Edit Commands
// ============================================
const editCmd = program
  .command('edit')
  .description('Image editing operations');

editCmd
  .command('erase <image>')
  .description('Erase objects using a mask')
  .option('--mask <path>', 'Mask image path')
  .option('--grow-mask <pixels>', 'Grow mask by pixels')
  .option('-s, --seed <number>', 'Random seed')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, opts) => {
    try {
      const client = getClient();

      info('Erasing objects from image...');

      const result = await client.edit.erase({
        image,
        mask: opts.mask,
        growMask: opts.growMask ? parseInt(opts.growMask) : undefined,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        outputFormat: opts.output as OutputFormatImage,
      });

      if (!result.image) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('erase', opts.output);
      const filepath = await saveImage(result.image, filename);

      if (getFormat(editCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Objects erased!`);
        console.log(`  File: ${filepath}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

editCmd
  .command('search-replace <image> <searchPrompt> <replacePrompt>')
  .description('Search for objects and replace them')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('-s, --seed <number>', 'Random seed')
  .option('--grow-mask <pixels>', 'Grow mask by pixels')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, searchPrompt: string, replacePrompt: string, opts) => {
    try {
      const client = getClient();

      info(`Searching for "${searchPrompt}" and replacing with "${replacePrompt}"...`);

      const result = await client.edit.searchAndReplace({
        image,
        searchPrompt,
        prompt: replacePrompt,
        negativePrompt: opts.negative,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        growMask: opts.growMask ? parseInt(opts.growMask) : undefined,
        outputFormat: opts.output as OutputFormatImage,
      });

      if (!result.image) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('search-replace', opts.output);
      const filepath = await saveImage(result.image, filename);

      if (getFormat(editCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Search and replace complete!`);
        console.log(`  File: ${filepath}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

editCmd
  .command('remove-background <image>')
  .description('Remove background from image')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, opts) => {
    try {
      const client = getClient();

      info('Removing background...');

      const result = await client.edit.removeBackground({
        image,
        outputFormat: opts.output as OutputFormatImage,
      });

      if (!result.image) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('remove-bg', opts.output);
      const filepath = await saveImage(result.image, filename);

      if (getFormat(editCmd) === 'json') {
        print({ filepath, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Background removed!`);
        console.log(`  File: ${filepath}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

editCmd
  .command('replace-background <image> <prompt>')
  .description('Replace background with AI-generated content')
  .option('-n, --negative <prompt>', 'Negative prompt')
  .option('-s, --seed <number>', 'Random seed')
  .option('-o, --output <format>', 'Output format (png, jpeg, webp)', 'png')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, prompt: string, opts) => {
    try {
      const client = getClient();

      info('Replacing background...');

      const result = await client.edit.replaceBackground({
        image,
        prompt,
        negativePrompt: opts.negative,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        outputFormat: opts.output as OutputFormatImage,
      });

      if (!result.image) {
        error('No image data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('replace-bg', opts.output);
      const filepath = await saveImage(result.image, filename);

      if (getFormat(editCmd) === 'json') {
        print({ filepath, seed: result.seed, finish_reason: result.finish_reason }, 'json');
      } else {
        success(`Background replaced!`);
        console.log(`  File: ${filepath}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// 3D Commands
// ============================================
const threeDCmd = program
  .command('3d')
  .description('Generate 3D models from images');

threeDCmd
  .command('fast <image>')
  .description('Generate 3D model using Stable Fast 3D')
  .option('--texture-resolution <value>', 'Texture resolution (512, 1024, 2048)', '1024')
  .option('--foreground-ratio <value>', 'Foreground ratio (0.1-1.0)', '0.85')
  .option('--remesh <type>', 'Remesh type (none, triangle, quad)', 'none')
  .option('--vertex-count <number>', 'Vertex count for remeshing')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, opts) => {
    try {
      const client = getClient();

      info('Generating 3D model (Stable Fast 3D)...');

      const result = await client.threeD.stableFast3D({
        image,
        textureResolution: parseInt(opts.textureResolution) as 512 | 1024 | 2048,
        foregroundRatio: parseFloat(opts.foregroundRatio),
        remesh: opts.remesh as 'none' | 'triangle' | 'quad',
        vertexCount: opts.vertexCount ? parseInt(opts.vertexCount) : undefined,
      });

      if (!result.glb) {
        error('No GLB data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('model', 'glb');
      const filepath = await saveImage(result.glb, filename);

      if (getFormat(threeDCmd) === 'json') {
        print({ filepath }, 'json');
      } else {
        success(`3D model generated!`);
        console.log(`  File: ${filepath}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

threeDCmd
  .command('video <image>')
  .description('Generate 3D model using Stable Video 3D (higher quality)')
  .option('--texture-resolution <value>', 'Texture resolution (512, 1024, 2048)', '1024')
  .option('--foreground-ratio <value>', 'Foreground ratio (0.1-1.0)', '0.85')
  .option('--remesh <type>', 'Remesh type (none, triangle, quad)', 'none')
  .option('--vertex-count <number>', 'Vertex count for remeshing')
  .option('--save-as <filename>', 'Custom filename for output')
  .action(async (image: string, opts) => {
    try {
      const client = getClient();

      info('Generating 3D model (Stable Video 3D)...');

      const result = await client.threeD.stableVideo3D({
        image,
        textureResolution: parseInt(opts.textureResolution) as 512 | 1024 | 2048,
        foregroundRatio: parseFloat(opts.foregroundRatio),
        remesh: opts.remesh as 'none' | 'triangle' | 'quad',
        vertexCount: opts.vertexCount ? parseInt(opts.vertexCount) : undefined,
      });

      if (!result.glb) {
        error('No GLB data in response');
        process.exit(1);
      }

      const filename = opts.saveAs || generateFilename('model-sv3d', 'glb');
      const filepath = await saveImage(result.glb, filename);

      if (getFormat(threeDCmd) === 'json') {
        print({ filepath }, 'json');
      } else {
        success(`3D model generated!`);
        console.log(`  File: ${filepath}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
