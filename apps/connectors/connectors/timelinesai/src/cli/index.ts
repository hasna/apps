#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TimelinesAI } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-timelinesai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TimelinesAI Public REST API connector - WhatsApp team inbox chats, messages, and accounts')
  .version(VERSION)
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
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TimelinesAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TIMELINESAI_API_KEY.`);
    process.exit(1);
  }
  return new TimelinesAI({ apiKey, baseUrl: getBaseUrl() });
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
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'TimelinesAI API key')
  .option('--base-url <url>', 'Custom API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; baseUrl?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set TimelinesAI API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set custom API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://app.timelines.ai/integrations/api)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('path')
  .description('Show configuration directory path')
  .action(() => {
    console.log(getConfigDir());
  });

const chatsCmd = program.command('chats').description('Manage WhatsApp chats');

chatsCmd
  .command('list')
  .description('List chats in the workspace')
  .option('--label <labels>', 'Filter by labels (comma-separated)')
  .option('--phone <phone>', 'Filter by phone number')
  .option('--page <page>', 'Page number', '1')
  .option('--closed', 'Show closed chats only')
  .option('--open', 'Show open chats only')
  .action(async (opts: { label?: string; phone?: string; page: string; closed?: boolean; open?: boolean }) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean> = { page: Number(opts.page) };
      if (opts.label) params.label = opts.label;
      if (opts.phone) params.phone = opts.phone;
      if (opts.closed) params.closed = true;
      if (opts.open) params.closed = false;
      const result = await client.chats.list(params);
      print(result.data, getFormat(chatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatsCmd
  .command('get <chatId>')
  .description('Get chat details')
  .action(async (chatId: string) => {
    try {
      const client = getClient();
      const result = await client.chats.get(chatId);
      print(result.data, getFormat(chatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatsCmd
  .command('update <chatId>')
  .description('Update chat properties')
  .option('--name <name>', 'Chat name')
  .option('--responsible <email>', 'Assign responsible teammate email (empty string to unassign)')
  .option('--closed', 'Close chat')
  .option('--open', 'Re-open chat')
  .option('--read', 'Mark chat as read')
  .option('--unread', 'Mark chat as unread')
  .action(async (chatId: string, opts: { name?: string; responsible?: string; closed?: boolean; open?: boolean; read?: boolean; unread?: boolean }) => {
    try {
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.responsible !== undefined) body.responsible = opts.responsible;
      if (opts.closed) body.closed = true;
      if (opts.open) body.closed = false;
      if (opts.read) body.read = true;
      if (opts.unread) body.read = false;
      const client = getClient();
      const result = await client.chats.update(chatId, body);
      success('Chat updated');
      print(result.data, getFormat(chatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const messagesCmd = program.command('messages').description('Send and list messages');

messagesCmd
  .command('send <phone> <text>')
  .description('Send a message to a phone number')
  .option('--whatsapp-account <phone>', 'WhatsApp account phone to send from')
  .option('--file-uid <uid>', 'Attachment file UID')
  .option('--label <label>', 'Label to apply to the chat')
  .action(async (phone: string, text: string, opts: { whatsappAccount?: string; fileUid?: string; label?: string }) => {
    try {
      const client = getClient();
      const result = await client.messages.sendToPhone({
        phone,
        text,
        whatsapp_account_phone: opts.whatsappAccount,
        file_uid: opts.fileUid,
        label: opts.label,
      });
      success(`Message queued (uid: ${result.data.message_uid})`);
      print(result.data, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('send-chat <chatId> <text>')
  .description('Send a message to an existing chat')
  .option('--file-uid <uid>', 'Attachment file UID')
  .option('--reply-to <uid>', 'Message UID to reply to')
  .action(async (chatId: string, text: string, opts: { fileUid?: string; replyTo?: string }) => {
    try {
      const client = getClient();
      const result = await client.messages.sendToChat(chatId, {
        text,
        file_uid: opts.fileUid,
        reply_to: opts.replyTo,
      });
      success(`Message queued (uid: ${result.data.message_uid})`);
      print(result.data, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('list <chatId>')
  .description('List messages in a chat')
  .option('--page <page>', 'Page number', '1')
  .option('--from-me', 'Only messages sent by workspace')
  .option('--sort <order>', 'Sort order (asc or desc)')
  .action(async (chatId: string, opts: { page: string; fromMe?: boolean; sort?: string }) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean> = { page: Number(opts.page) };
      if (opts.fromMe) params.from_me = true;
      if (opts.sort === 'asc' || opts.sort === 'desc') params.sorting_order = opts.sort;
      const result = await client.messages.listForChat(chatId, params);
      print(result.data, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('whatsapp-accounts')
  .description('List connected WhatsApp accounts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.whatsappAccounts.list();
      print(result.data.whatsapp_accounts, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <path>')
  .description('Make a raw API request (advanced)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .action(async (path: string, opts: { method: string; body?: string }) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest(path, {
        method: opts.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
