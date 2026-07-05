#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Waboxapp } from '../api';
import {
  getToken,
  setToken,
  getUid,
  setUid,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-waboxapp';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WaboxApp WhatsApp messaging API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'API token (overrides config)')
  .option('-u, --uid <uid>', 'Sender WhatsApp number with country code (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) {
      process.env.WABOXAPP_TOKEN = opts.token;
    }
    if (opts.uid) {
      process.env.WABOXAPP_UID = opts.uid;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Waboxapp {
  const token = getToken();
  const uid = getUid();
  const baseUrl = getBaseUrl();

  if (!token) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set WABOXAPP_TOKEN.`);
    process.exit(1);
  }
  if (!uid) {
    error(`No sender uid configured. Run "${CONNECTOR_NAME} config set-uid <uid>" or set WABOXAPP_UID.`);
    process.exit(1);
  }

  return new Waboxapp({ token, uid, baseUrl });
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
    for (const name of profiles) {
      const active = name === current ? chalk.green(' (active)') : '';
      console.log(`  ${name}${active}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'API token')
  .option('--uid <uid>', 'Sender WhatsApp number')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { token?: string; uid?: string; use?: boolean }) => {
    if (!createProfile(name, { token: opts.token, uid: opts.uid })) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
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
    if (!deleteProfile(name)) {
      error(`Profile "${name}" could not be deleted`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`UID: ${config.uid || chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set WaboxApp API token')
  .action((token: string) => {
    setToken(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-uid <uid>')
  .description('Set sender WhatsApp number (international format)')
  .action((uid: string) => {
    setUid(uid);
    success(`Sender uid saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const token = getToken();
    const uid = getUid();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`UID: ${uid || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const sendCmd = program.command('send').description('Send WhatsApp messages');

sendCmd
  .command('chat')
  .description('Send a text message')
  .requiredOption('--to <number>', 'Recipient phone number with country code')
  .requiredOption('--custom-uid <id>', 'Your unique message ID')
  .requiredOption('--text <text>', 'Message text')
  .action(async (opts: { to: string; customUid: string; text: string }) => {
    try {
      const client = getClient();
      const result = await client.messages.sendChat({
        to: opts.to,
        custom_uid: opts.customUid,
        text: opts.text,
      });
      success('Message queued');
      print(result, getFormat(sendCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sendCmd
  .command('image')
  .description('Send an image message')
  .requiredOption('--to <number>', 'Recipient phone number with country code')
  .requiredOption('--custom-uid <id>', 'Your unique message ID')
  .requiredOption('--url <url>', 'Image URL')
  .option('--caption <caption>', 'Image caption')
  .option('--description <description>', 'Image description')
  .action(async (opts: { to: string; customUid: string; url: string; caption?: string; description?: string }) => {
    try {
      const client = getClient();
      const result = await client.messages.sendImage({
        to: opts.to,
        custom_uid: opts.customUid,
        url: opts.url,
        caption: opts.caption,
        description: opts.description,
      });
      success('Image message queued');
      print(result, getFormat(sendCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sendCmd
  .command('link')
  .description('Send a link message with preview')
  .requiredOption('--to <number>', 'Recipient phone number with country code')
  .requiredOption('--custom-uid <id>', 'Your unique message ID')
  .requiredOption('--url <url>', 'Link URL')
  .option('--caption <caption>', 'Link preview title')
  .option('--description <description>', 'Link preview description')
  .option('--url-thumb <url>', 'Thumbnail image URL')
  .action(async (opts: {
    to: string;
    customUid: string;
    url: string;
    caption?: string;
    description?: string;
    urlThumb?: string;
  }) => {
    try {
      const client = getClient();
      const result = await client.messages.sendLink({
        to: opts.to,
        custom_uid: opts.customUid,
        url: opts.url,
        caption: opts.caption,
        description: opts.description,
        url_thumb: opts.urlThumb,
      });
      success('Link message queued');
      print(result, getFormat(sendCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sendCmd
  .command('media')
  .description('Send a media/file message')
  .requiredOption('--to <number>', 'Recipient phone number with country code')
  .requiredOption('--custom-uid <id>', 'Your unique message ID')
  .requiredOption('--url <url>', 'File URL')
  .option('--caption <caption>', 'File preview title')
  .option('--description <description>', 'File preview description')
  .option('--url-thumb <url>', 'Thumbnail image URL')
  .action(async (opts: {
    to: string;
    customUid: string;
    url: string;
    caption?: string;
    description?: string;
    urlThumb?: string;
  }) => {
    try {
      const client = getClient();
      const result = await client.messages.sendMedia({
        to: opts.to,
        custom_uid: opts.customUid,
        url: opts.url,
        caption: opts.caption,
        description: opts.description,
        url_thumb: opts.urlThumb,
      });
      success('Media message queued');
      print(result, getFormat(sendCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const statusCmd = program.command('status').description('Account status commands');

statusCmd
  .command('get')
  .description('Get account status for the configured sender uid')
  .option('--uid <uid>', 'Override account uid to check')
  .action(async (opts: { uid?: string }) => {
    try {
      const client = getClient();
      const result = await client.status.getStatus(opts.uid);
      print(result, getFormat(statusCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
