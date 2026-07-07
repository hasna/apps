#!/usr/bin/env bun
import { writeFileSync } from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { Tinypng } from '../api';
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
import type { StoreService } from '../types';

const CONNECTOR_NAME = 'tinypng';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TinyPNG API connector CLI - compress and optimize images')
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
      process.env.TINYPNG_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tinypng {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TINYPNG_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Tinypng({ apiKey });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

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

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

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

const shrinkCmd = program.command('shrink').description('Compress images via TinyPNG');

shrinkCmd
  .command('compress-from-url')
  .description('Compress an image from a public URL')
  .requiredOption('--url <url>', 'Source image URL')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.compressFromUrl(opts.url);
      print(result, getFormat(shrinkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shrinkCmd
  .command('compress-and-preserve-copyright')
  .description('Compress an image while preserving copyright metadata')
  .requiredOption('--url <url>', 'Source image URL')
  .requiredOption('-o, --output <path>', 'Output path for the optimized image')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.compressAndPreserveCopyright(opts.url);
      writeFileSync(opts.output, result.data);
      const { data: _data, ...metadata } = result;
      print({ ...metadata, outputPath: opts.output }, getFormat(shrinkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shrinkCmd
  .command('compress-with-store')
  .description('Compress an image and store to a cloud service')
  .requiredOption('--url <url>', 'Source image URL')
  .option('--service <service>', 'Store service (s3 or gcs)', 's3')
  .requiredOption('--path <path>', 'Destination path, including bucket and filename')
  .option('--aws-access-key-id <key>', 'AWS access key ID for S3')
  .option('--aws-secret-access-key <key>', 'AWS secret access key for S3')
  .option('--region <region>', 'AWS region for S3')
  .option('--gcp-access-token <token>', 'GCP access token for GCS')
  .option('--cache-control <value>', 'Optional Cache-Control header for stored image')
  .action(async (opts) => {
    try {
      const client = getClient();
      const headers = opts.cacheControl ? { 'Cache-Control': opts.cacheControl } : undefined;
      const result = await client.compressWithStore(opts.url, {
        service: opts.service as StoreService,
        aws_access_key_id: opts.awsAccessKeyId,
        aws_secret_access_key: opts.awsSecretAccessKey,
        gcp_access_token: opts.gcpAccessToken,
        region: opts.region,
        path: opts.path,
        headers,
      });
      print(result, getFormat(shrinkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
