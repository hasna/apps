#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Midjourney } from '../api';
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
  getDiscordToken,
  setDiscordToken,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'midjourney';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Midjourney image generation connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.MIDJOURNEY_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Midjourney {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MIDJOURNEY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Midjourney({ apiKey });
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
  .option('--discord-token <token>', 'Discord token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      discordToken: opts.discordToken,
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
    info(`Discord Token: ${config.discordToken ? `${config.discordToken.substring(0, 8)}...` : chalk.gray('not set')}`);
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
  .command('set-discord-token <token>')
  .description('Set Discord token')
  .action((token: string) => {
    setDiscordToken(token);
    success(`Discord token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const discordToken = getDiscordToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Discord Token: ${discordToken ? `${discordToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Imagine Commands
// ============================================
program
  .command('imagine <prompt>')
  .description('Generate an image from a prompt')
  .option('--ar, --aspect-ratio <ratio>', 'Aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4)', '1:1')
  .option('--chaos <value>', 'Chaos value (0-100)', '0')
  .option('--quality <value>', 'Quality (0.25, 0.5, 1, 2)', '1')
  .option('--stylize <value>', 'Stylize value (0-1000)')
  .option('--seed <value>', 'Seed for reproducibility')
  .option('--tile', 'Generate tileable pattern')
  .option('--version <version>', 'Midjourney version (e.g., 5.2, 6)')
  .option('--style <style>', 'Style (raw, cute, scenic, original)')
  .option('--no <negative>', 'Negative prompt')
  .option('--wait', 'Wait for completion')
  .action(async (prompt: string, opts) => {
    try {
      const client = getClient();
      const job = await client.imagine.create({
        prompt,
        aspectRatio: opts.aspectRatio,
        chaos: opts.chaos ? parseInt(opts.chaos) : undefined,
        quality: opts.quality ? parseFloat(opts.quality) : undefined,
        stylize: opts.stylize ? parseInt(opts.stylize) : undefined,
        seed: opts.seed ? parseInt(opts.seed) : undefined,
        tile: opts.tile,
        version: opts.version,
        style: opts.style,
        negative: opts.no,
      });

      if (opts.wait) {
        info('Waiting for completion...');
        const completed = await client.imagine.waitForCompletion(job.id);
        print(completed, getFormat(program));
      } else {
        success('Image generation started!');
        print(job, getFormat(program));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Job Commands
// ============================================
const jobCmd = program
  .command('job')
  .description('Manage generation jobs');

jobCmd
  .command('list')
  .description('List recent jobs')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.imagine.list({ limit: parseInt(opts.limit) });
      print(result, getFormat(jobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobCmd
  .command('status <id>')
  .description('Get job status')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.imagine.get(id);
      print(result, getFormat(jobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobCmd
  .command('cancel <id>')
  .description('Cancel a pending job')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.imagine.cancel(id);
      success(`Job ${id} cancelled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobCmd
  .command('variation <id>')
  .description('Create a variation of an image')
  .requiredOption('-i, --index <number>', 'Image index (1-4)')
  .option('-t, --type <type>', 'Variation type (subtle, strong)', 'subtle')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.imagine.variation({
        jobId: id,
        index: parseInt(opts.index) as 1 | 2 | 3 | 4,
        type: opts.type,
      });
      success('Variation started!');
      print(result, getFormat(jobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobCmd
  .command('upscale <id>')
  .description('Upscale an image')
  .requiredOption('-i, --index <number>', 'Image index (1-4)')
  .option('-t, --type <type>', 'Upscale type (subtle, creative)', 'subtle')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.imagine.upscale({
        jobId: id,
        index: parseInt(opts.index) as 1 | 2 | 3 | 4,
        type: opts.type,
      });
      success('Upscale started!');
      print(result, getFormat(jobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
