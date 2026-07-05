#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { VercelBlobPlatform } from '../api';
import {
  CONNECTOR_NAME,
  clearConfig,
  createProfile,
  deleteProfile,
  getConfigDir,
  getCurrentProfile,
  getOidcToken,
  getStoreId,
  getToken,
  listProfiles,
  loadProfile,
  profileExists,
  setCurrentProfile,
  setOidcToken,
  setProfileOverride,
  setStoreId,
  setToken,
} from '../utils/config';
import type { BlobAccessType } from '../types';
import type { OutputFormat } from '../utils/output';
import { error, info, print, success } from '../utils/output';

const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vercel Blob Platform connector - object storage via Vercel Blob')
  .version(VERSION)
  .option('-t, --token <token>', 'BLOB_READ_WRITE_TOKEN (overrides config)')
  .option('--store-id <id>', 'Blob store ID (required for OIDC auth)')
  .option('--oidc-token <token>', 'VERCEL_OIDC_TOKEN (overrides config)')
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
    if (opts.token) {
      process.env.BLOB_READ_WRITE_TOKEN = opts.token;
    }
    if (opts.storeId) {
      process.env.BLOB_STORE_ID = opts.storeId;
    }
    if (opts.oidcToken) {
      process.env.VERCEL_OIDC_TOKEN = opts.oidcToken;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): VercelBlobPlatform {
  const token = getToken();
  const oidcToken = getOidcToken();
  const storeId = getStoreId();

  if (!token && !oidcToken) {
    error(
      `No blob credentials configured. Set BLOB_READ_WRITE_TOKEN or run "${CONNECTOR_NAME} config set-token <token>".`,
    );
    process.exit(1);
  }

  if (oidcToken && !storeId) {
    error(`OIDC auth requires a store ID. Set BLOB_STORE_ID or run "${CONNECTOR_NAME} config set-store <id>".`);
    process.exit(1);
  }

  return new VercelBlobPlatform({
    token,
    oidcToken,
    storeId,
  });
}

function parseAccess(value: string): BlobAccessType {
  if (value !== 'public' && value !== 'private') {
    throw new Error('access must be public or private');
  }
  return value;
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
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
  .description('Create a profile')
  .option('--token <token>', 'BLOB_READ_WRITE_TOKEN')
  .option('--store-id <id>', 'Blob store ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      token: opts.token,
      storeId: opts.storeId,
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
    info(`Token: ${config.token ? `${config.token.substring(0, 12)}...` : chalk.gray('not set')}`);
    info(`Store ID: ${config.storeId || chalk.gray('not set')}`);
    info(`OIDC token: ${config.oidcToken ? chalk.green('set') : chalk.gray('not set')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set BLOB_READ_WRITE_TOKEN for active profile')
  .action((token: string) => {
    setToken(token);
    success(`Token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-store <storeId>')
  .description('Set blob store ID for active profile')
  .action((storeId: string) => {
    setStoreId(storeId);
    success(`Store ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-oidc <token>')
  .description('Set VERCEL_OIDC_TOKEN for active profile')
  .action((token: string) => {
    setOidcToken(token);
    success(`OIDC token saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const token = getToken();
  const storeId = getStoreId();
  console.log(chalk.bold(`Active profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 12)}...` : chalk.gray('not set')}`);
  info(`Store ID: ${storeId || chalk.gray('not set (derived from token when using read-write token)')}`);
  info(`OIDC token: ${getOidcToken() ? chalk.green('set') : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear active profile configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Blob commands
const blobCmd = program.command('blob').description('Vercel Blob operations');

blobCmd
  .command('put <pathname> <file>')
  .description('Upload a file to blob storage')
  .requiredOption('--access <access>', 'public or private')
  .option('--content-type <type>', 'Content type override')
  .option('--allow-overwrite', 'Allow overwriting an existing blob')
  .option('--add-random-suffix', 'Append a random suffix to the pathname')
  .action(async (pathname: string, filePath: string, opts) => {
    try {
      const access = parseAccess(opts.access);
      const body = readFileSync(filePath);
      const client = getClient();
      const result = await client.put(pathname, body, {
        access,
        contentType: opts.contentType,
        allowOverwrite: opts.allowOverwrite || undefined,
        addRandomSuffix: opts.addRandomSuffix || undefined,
      });
      success('Blob uploaded');
      print(result, getFormat(blobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blobCmd
  .command('list')
  .description('List blobs in the store')
  .option('-l, --limit <number>', 'Maximum blobs to return', '100')
  .option('--prefix <prefix>', 'Filter by pathname prefix')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--mode <mode>', 'expanded or folded', 'expanded')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.list({
        limit: parseInt(opts.limit, 10),
        prefix: opts.prefix,
        cursor: opts.cursor,
        mode: opts.mode,
      });
      print(result, getFormat(blobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blobCmd
  .command('get <urlOrPathname>')
  .description('Download blob content')
  .requiredOption('--access <access>', 'public or private (when using pathname)')
  .option('-o, --output <file>', 'Write body to file instead of stdout metadata')
  .action(async (urlOrPathname: string, opts) => {
    try {
      const access = parseAccess(opts.access);
      const client = getClient();
      const result = await client.get(urlOrPathname, access);
      if (!result) {
        error('Blob not found');
        process.exit(1);
      }
      if (opts.output && result.body) {
        await Bun.write(opts.output, result.body);
        success(`Wrote blob body to ${opts.output}`);
      }
      print(
        opts.output
          ? { statusCode: result.statusCode, blob: result.blob, output: opts.output }
          : result,
        getFormat(blobCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blobCmd
  .command('head <urlOrPathname>')
  .description('Fetch blob metadata without downloading content')
  .action(async (urlOrPathname: string) => {
    try {
      const client = getClient();
      const result = await client.head(urlOrPathname);
      print(result, getFormat(blobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blobCmd
  .command('del <urlOrPathname...>')
  .description('Delete one or more blobs by URL or pathname')
  .option('--if-match <etag>', 'Only delete if ETag matches (single blob)')
  .action(async (urls: string[], opts) => {
    try {
      const client = getClient();
      await client.del(urls.length === 1 ? urls[0]! : urls, {
        ifMatch: opts.ifMatch,
      });
      success(urls.length === 1 ? 'Blob deleted' : `${urls.length} blobs deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
