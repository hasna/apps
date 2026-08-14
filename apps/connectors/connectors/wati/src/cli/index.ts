#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wati } from '../api';
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
import type {
  AttributeType,
  ChatStatus,
  CustomParam,
  MessageDirection,
  MessageEventType,
} from '../types';

const CONNECTOR_NAME = 'connect-wati';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WATI WhatsApp Business API connector - contacts, messages, templates, operators, and broadcasts')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'Tenant base URL (overrides config)')
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
      process.env.WATI_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.WATI_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Wati {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WATI_API_KEY.`);
    process.exit(1);
  }
  if (!baseUrl) {
    error(`No base URL configured. Run "${CONNECTOR_NAME} config set-base-url <url>" or set WATI_BASE_URL.`);
    process.exit(1);
  }

  return new Wati({ apiKey, baseUrl });
}

function parseJson<T>(value: string | undefined, label: string): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function runAction(cmd: Command, fn: () => Promise<unknown>): void {
  fn()
    .then((result) => print(result, getFormat(cmd)))
    .catch((err) => {
      error(String(err));
      process.exit(1);
    });
}

// Profile commands
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
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'Tenant base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (!createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl })) {
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
      error(`Profile "${name}" not found or cannot be deleted`);
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
    console.log(`  API Key: ${config.apiKey ? '***configured***' : chalk.gray('not set')}`);
    console.log(`  Base URL: ${config.baseUrl || chalk.gray('not set')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key for current profile')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('set-base-url <url>')
  .description('Set tenant base URL for current profile')
  .action((url: string) => {
    setBaseUrl(url);
    success('Base URL saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold('Configuration'));
    console.log(`  Profile: ${getCurrentProfile()}`);
    console.log(`  Config dir: ${getConfigDir()}`);
    console.log(`  API Key: ${apiKey ? '***configured***' : chalk.gray('not set')}`);
    console.log(`  Base URL: ${baseUrl || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear current profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// Contact commands
const contactsCmd = program.command('contacts').description('Manage WATI contacts');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('--page-size <n>', 'Page size', parseInt)
  .option('--page-number <n>', 'Page number', parseInt)
  .option('--name <name>', 'Filter by name')
  .option('--created-date <date>', 'Filter by created date')
  .option('--attribute <attribute>', 'Filter by attribute')
  .action((opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().contacts.getContacts({
        pageSize: opts.pageSize,
        pageNumber: opts.pageNumber,
        name: opts.name,
        createdDate: opts.createdDate,
        attribute: opts.attribute,
      }),
    );
  });

contactsCmd
  .command('add <whatsappNumber>')
  .description('Add a contact')
  .option('--name <name>', 'Contact name')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--custom-params <json>', 'Custom params JSON array')
  .action((whatsappNumber: string, opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().contacts.addContact({
        whatsappNumber,
        name: opts.name,
        firstName: opts.firstName,
        lastName: opts.lastName,
        email: opts.email,
        phone: opts.phone,
        customParams: parseJson<CustomParam[]>(opts.customParams, 'custom-params'),
      }),
    );
  });

contactsCmd
  .command('update-attributes <whatsappNumber>')
  .description('Update contact custom attributes')
  .requiredOption('--custom-params <json>', 'Custom params JSON array')
  .action((whatsappNumber: string, opts, cmd: Command) => {
    const customParams = parseJson<CustomParam[]>(opts.customParams, 'custom-params');
    if (!customParams?.length) {
      error('custom-params must be a non-empty JSON array');
      process.exit(1);
    }
    runAction(cmd, () =>
      getClient().contacts.updateContactAttributes({ whatsappNumber, customParams }),
    );
  });

// Message commands
const messagesCmd = program.command('messages').description('Send and retrieve messages');

messagesCmd
  .command('send-session <whatsappNumber> <messageText>')
  .description('Send a session message')
  .action((whatsappNumber: string, messageText: string, cmd: Command) => {
    runAction(cmd, () =>
      getClient().messages.sendSessionMessage({ whatsappNumber, messageText }),
    );
  });

messagesCmd
  .command('send-file <whatsappNumber> <fileUrl>')
  .description('Send a session file')
  .option('--caption <caption>', 'File caption')
  .action((whatsappNumber: string, fileUrl: string, opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().messages.sendSessionFile({ whatsappNumber, fileUrl, caption: opts.caption }),
    );
  });

messagesCmd
  .command('send-template <whatsappNumber> <templateName>')
  .description('Send a template message')
  .option('--broadcast-name <name>', 'Broadcast name')
  .option('--parameters <json>', 'Template parameters JSON array')
  .option('--channel-number <number>', 'Channel number')
  .action((whatsappNumber: string, templateName: string, opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().messages.sendTemplateMessage({
        whatsappNumber,
        templateName,
        broadcastName: opts.broadcastName,
        parameters: parseJson<CustomParam[]>(opts.parameters, 'parameters'),
        channelNumber: opts.channelNumber,
      }),
    );
  });

messagesCmd
  .command('send-templates')
  .description('Send template messages to multiple receivers')
  .requiredOption('--template-name <name>', 'Template name')
  .requiredOption('--broadcast-name <name>', 'Broadcast name')
  .requiredOption('--receivers <json>', 'Receivers JSON array')
  .option('--channel-number <number>', 'Channel number')
  .action((opts, cmd: Command) => {
    const receivers = parseJson<Array<{ whatsappNumber: string; customParams?: CustomParam[] }>>(
      opts.receivers,
      'receivers',
    );
    if (!receivers?.length) {
      error('receivers must be a non-empty JSON array');
      process.exit(1);
    }
    runAction(cmd, () =>
      getClient().messages.sendTemplateMessages({
        templateName: opts.templateName,
        broadcastName: opts.broadcastName,
        receivers,
        channelNumber: opts.channelNumber,
      }),
    );
  });

messagesCmd
  .command('send-buttons <whatsappNumber>')
  .description('Send an interactive buttons message')
  .requiredOption('--body <text>', 'Message body')
  .requiredOption('--buttons <json>', 'Buttons JSON array')
  .option('--header <json>', 'Header JSON object')
  .option('--footer <text>', 'Footer text')
  .action((whatsappNumber: string, opts, cmd: Command) => {
    const buttons = parseJson<Array<{ text: string }>>(opts.buttons, 'buttons');
    if (!buttons?.length) {
      error('buttons must be a non-empty JSON array');
      process.exit(1);
    }
    runAction(cmd, () =>
      getClient().messages.sendInteractiveButtonsMessage({
        whatsappNumber,
        header: parseJson(opts.header, 'header'),
        body: opts.body,
        footer: opts.footer,
        buttons,
      }),
    );
  });

messagesCmd
  .command('send-list <whatsappNumber>')
  .description('Send an interactive list message')
  .requiredOption('--body <text>', 'Message body')
  .requiredOption('--button-text <text>', 'Button text')
  .requiredOption('--sections <json>', 'Sections JSON array')
  .option('--header <text>', 'Header text')
  .option('--footer <text>', 'Footer text')
  .action((whatsappNumber: string, opts, cmd: Command) => {
    const sections = parseJson<Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>>(
      opts.sections,
      'sections',
    );
    if (!sections?.length) {
      error('sections must be a non-empty JSON array');
      process.exit(1);
    }
    runAction(cmd, () =>
      getClient().messages.sendInteractiveListMessage({
        whatsappNumber,
        header: opts.header,
        body: opts.body,
        footer: opts.footer,
        buttonText: opts.buttonText,
        sections,
      }),
    );
  });

messagesCmd
  .command('list <whatsappNumber>')
  .description('Get messages for a contact')
  .option('--page-size <n>', 'Page size', parseInt)
  .option('--page-number <n>', 'Page number', parseInt)
  .option('--created-date <date>', 'Filter by created date')
  .option('--event-type <type>', 'Event type (sent|delivered|read|received)')
  .option('--message-direction <dir>', 'Direction (inbound|outbound)')
  .action((whatsappNumber: string, opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().messages.getMessages({
        whatsappNumber,
        pageSize: opts.pageSize,
        pageNumber: opts.pageNumber,
        createdDate: opts.createdDate,
        eventType: opts.eventType as MessageEventType | undefined,
        messageDirection: opts.messageDirection as MessageDirection | undefined,
      }),
    );
  });

messagesCmd
  .command('get-media <fileName>')
  .description('Get media file metadata')
  .action((fileName: string, cmd: Command) => {
    runAction(cmd, () => getClient().messages.getMediaFile({ fileName }));
  });

// Template commands
program
  .command('templates list')
  .description('List message templates')
  .option('--page-size <n>', 'Page size', parseInt)
  .option('--page-number <n>', 'Page number', parseInt)
  .action((opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().templates.getMessageTemplates({
        pageSize: opts.pageSize,
        pageNumber: opts.pageNumber,
      }),
    );
  });

// Operator commands
const operatorsCmd = program.command('operators').description('Manage operators and chat status');

operatorsCmd
  .command('list')
  .description('List operators')
  .action((_opts, cmd: Command) => {
    runAction(cmd, () => getClient().operators.getOperators());
  });

operatorsCmd
  .command('assign <whatsappNumber> <email>')
  .description('Assign an operator to a chat')
  .action((whatsappNumber: string, email: string, cmd: Command) => {
    runAction(cmd, () => getClient().operators.assignOperator({ whatsappNumber, email }));
  });

operatorsCmd
  .command('unassign <whatsappNumber>')
  .description('Unassign operator from a chat')
  .action((whatsappNumber: string, cmd: Command) => {
    runAction(cmd, () => getClient().operators.unassignOperator({ whatsappNumber }));
  });

operatorsCmd
  .command('update-chat-status <whatsappNumber> <status>')
  .description('Update chat status (PENDING|OPEN|EXPIRED|RESOLVED|BOT)')
  .action((whatsappNumber: string, status: string, cmd: Command) => {
    runAction(cmd, () =>
      getClient().operators.updateChatStatus({
        whatsappNumber,
        status: status as ChatStatus,
      }),
    );
  });

// Label commands
const labelsCmd = program.command('labels').description('Manage contact labels');

labelsCmd
  .command('add <whatsappNumber>')
  .description('Add labels to a contact')
  .requiredOption('--labels <json>', 'Labels JSON array')
  .action((whatsappNumber: string, opts, cmd: Command) => {
    const labels = parseJson<string[]>(opts.labels, 'labels');
    if (!labels?.length) {
      error('labels must be a non-empty JSON array');
      process.exit(1);
    }
    runAction(cmd, () => getClient().labels.addLabelsToContact({ whatsappNumber, labels }));
  });

labelsCmd
  .command('remove <whatsappNumber>')
  .description('Remove labels from a contact')
  .requiredOption('--labels <json>', 'Labels JSON array')
  .action((whatsappNumber: string, opts, cmd: Command) => {
    const labels = parseJson<string[]>(opts.labels, 'labels');
    if (!labels?.length) {
      error('labels must be a non-empty JSON array');
      process.exit(1);
    }
    runAction(cmd, () => getClient().labels.removeLabelsFromContact({ whatsappNumber, labels }));
  });

// Attribute commands
const attributesCmd = program.command('attributes').description('Manage custom attributes');

attributesCmd
  .command('list')
  .description('List custom attributes')
  .action((_opts, cmd: Command) => {
    runAction(cmd, () => getClient().attributes.getCustomAttributes());
  });

attributesCmd
  .command('create <name> <type>')
  .description('Create a custom attribute (Text|Number|Date|DateTime|List)')
  .action((name: string, type: string, cmd: Command) => {
    runAction(cmd, () =>
      getClient().attributes.createCustomAttribute({
        name,
        type: type as AttributeType,
      }),
    );
  });

// Broadcast commands
const broadcastsCmd = program.command('broadcasts').description('Manage broadcasts');

broadcastsCmd
  .command('list')
  .description('List broadcasts')
  .option('--page-size <n>', 'Page size', parseInt)
  .option('--page-number <n>', 'Page number', parseInt)
  .action((opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().broadcasts.getBroadcasts({
        pageSize: opts.pageSize,
        pageNumber: opts.pageNumber,
      }),
    );
  });

broadcastsCmd
  .command('details <broadcastName>')
  .description('Get broadcast details')
  .option('--page-size <n>', 'Page size', parseInt)
  .option('--page-number <n>', 'Page number', parseInt)
  .action((broadcastName: string, opts, cmd: Command) => {
    runAction(cmd, () =>
      getClient().broadcasts.getBroadcastDetails({
        broadcastName,
        pageSize: opts.pageSize,
        pageNumber: opts.pageNumber,
      }),
    );
  });

program.parse();
