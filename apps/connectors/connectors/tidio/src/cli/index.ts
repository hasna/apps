#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tidio } from '../api';
import type { ConversationStatus, MessageType, WebhookEvent } from '../types';
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

const CONNECTOR_NAME = 'connect-tidio';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tidio connector - Live chat support, contacts, conversations, and operators')
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
      process.env.TIDIO_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tidio {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TIDIO_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Tidio({ apiKey });
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.key });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <key>').description('Set API key').action((key: string) => {
  setApiKey(key);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Contact Commands
const contactCmd = program.command('contact').description('Manage contacts');

contactCmd
  .command('list')
  .description('List contacts')
  .option('-n, --limit <number>', 'Results limit')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--updated-after <iso>', 'Filter by updated after')
  .option('--updated-before <iso>', 'Filter by updated before')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
        updatedAfter: opts.updatedAfter,
        updatedBefore: opts.updatedBefore,
      });
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd.command('get <id>').description('Get a contact by ID').action(async (id: string) => {
  try {
    print(await getClient().getContact(id), getFormat(contactCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

contactCmd
  .command('create')
  .description('Create a contact')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--name <name>', 'Contact name')
  .option('--external-id <id>', 'External ID')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--subscriber', 'Mark as subscriber')
  .option('--consent', 'Marketing consent')
  .action(async (opts) => {
    try {
      const result = await getClient().createContact({
        email: opts.email,
        phone: opts.phone,
        name: opts.name,
        externalId: opts.externalId,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
        subscriber: opts.subscriber,
        consent: opts.consent,
      });
      success('Contact created!');
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('update <id>')
  .description('Update a contact')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--name <name>', 'Contact name')
  .option('--external-id <id>', 'External ID')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (id: string, opts) => {
    try {
      const result = await getClient().updateContact(id, {
        email: opts.email,
        phone: opts.phone,
        name: opts.name,
        externalId: opts.externalId,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
      });
      success('Contact updated!');
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd.command('delete <id>').description('Delete a contact').action(async (id: string) => {
  try {
    await getClient().deleteContact(id);
    success('Contact deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Conversation Commands
const conversationCmd = program.command('conversation').description('Manage conversations');

conversationCmd
  .command('list')
  .description('List conversations')
  .option('-n, --limit <number>', 'Results limit')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--status <status>', 'Filter by status (open, closed, snoozed)')
  .option('--channel <channel>', 'Filter by channel')
  .option('--updated-after <iso>', 'Filter by updated after')
  .action(async (opts) => {
    try {
      const result = await getClient().listConversations({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
        status: opts.status as ConversationStatus | undefined,
        channel: opts.channel,
        updatedAfter: opts.updatedAfter,
      });
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd.command('get <id>').description('Get a conversation by ID').action(async (id: string) => {
  try {
    print(await getClient().getConversation(id), getFormat(conversationCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

conversationCmd
  .command('messages <id>')
  .description('List messages in a conversation')
  .option('-n, --limit <number>', 'Results limit')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (id: string, opts) => {
    try {
      const result = await getClient().listConversationMessages(id, {
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('send <id>')
  .description('Send a message in a conversation')
  .requiredOption('--type <type>', 'Message type (text, image, file, note)')
  .requiredOption('--content <content>', 'Message content')
  .option('--media-url <url>', 'Media URL for image/file')
  .option('--private', 'Send as private note')
  .option('--operator-id <id>', 'Operator ID')
  .action(async (id: string, opts) => {
    try {
      const result = await getClient().sendConversationMessage(id, {
        type: opts.type as MessageType,
        content: opts.content,
        mediaUrl: opts.mediaUrl,
        private: opts.private,
        operatorId: opts.operatorId,
      });
      success('Message sent!');
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('status <id>')
  .description('Set conversation status')
  .requiredOption('--status <status>', 'Status (open, closed, snoozed)')
  .option('--snoozed-until <iso>', 'Snooze until (ISO datetime)')
  .action(async (id: string, opts) => {
    try {
      const result = await getClient().setConversationStatus(id, {
        status: opts.status as ConversationStatus,
        snoozedUntil: opts.snoozedUntil,
      });
      success('Conversation status updated!');
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('assign <id>')
  .description('Assign a conversation')
  .option('--operator-id <id>', 'Operator ID (omit with --unassign to clear)')
  .option('--unassign', 'Unassign operator')
  .option('--department-id <id>', 'Department ID')
  .action(async (id: string, opts) => {
    try {
      const result = await getClient().assignConversation(id, {
        operatorId: opts.unassign ? null : opts.operatorId ?? null,
        departmentId: opts.departmentId,
      });
      success('Conversation assigned!');
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Operator Commands
const operatorCmd = program.command('operator').description('Manage operators');

operatorCmd.command('list').description('List operators').action(async () => {
  try {
    print(await getClient().listOperators(), getFormat(operatorCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

operatorCmd.command('get <id>').description('Get an operator by ID').action(async (id: string) => {
  try {
    print(await getClient().getOperator(id), getFormat(operatorCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Department Commands
const departmentCmd = program.command('department').description('Manage departments');

departmentCmd.command('list').description('List departments').action(async () => {
  try {
    print(await getClient().listDepartments(), getFormat(departmentCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Tag Commands
const tagCmd = program.command('tag').description('Manage tags');

tagCmd.command('list').description('List tags').action(async () => {
  try {
    print(await getClient().listTags(), getFormat(tagCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

tagCmd
  .command('create <name>')
  .description('Create a tag')
  .option('--color <color>', 'Tag color')
  .action(async (name: string, opts) => {
    try {
      const result = await getClient().createTag({ name, color: opts.color });
      success('Tag created!');
      print(result, getFormat(tagCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagCmd.command('delete <id>').description('Delete a tag').action(async (id: string) => {
  try {
    await getClient().deleteTag(id);
    success('Tag deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Automation Commands
const automationCmd = program.command('automation').description('Manage automations');

automationCmd.command('list').description('List automations').action(async () => {
  try {
    print(await getClient().listAutomations(), getFormat(automationCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Canned Response Commands
const cannedCmd = program.command('canned-response').description('Manage canned responses');

cannedCmd.command('list').description('List canned responses').action(async () => {
  try {
    print(await getClient().listCannedResponses(), getFormat(cannedCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

cannedCmd
  .command('create')
  .description('Create a canned response')
  .requiredOption('--shortcut <shortcut>', 'Shortcut keyword')
  .requiredOption('--content <content>', 'Response content')
  .option('--department-id <id>', 'Department ID')
  .action(async (opts) => {
    try {
      const result = await getClient().createCannedResponse({
        shortcut: opts.shortcut,
        content: opts.content,
        departmentId: opts.departmentId,
      });
      success('Canned response created!');
      print(result, getFormat(cannedCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Webhook Commands
const webhookCmd = program.command('webhook').description('Manage webhooks');

webhookCmd.command('list').description('List webhooks').action(async () => {
  try {
    print(await getClient().listWebhooks(), getFormat(webhookCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webhookCmd
  .command('create')
  .description('Create a webhook')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--events <events>', 'Comma-separated events')
  .option('--secret <secret>', 'Webhook secret')
  .action(async (opts) => {
    try {
      const result = await getClient().createWebhook({
        url: opts.url,
        events: opts.events.split(',').map((e: string) => e.trim()) as WebhookEvent[],
        secret: opts.secret,
      });
      success('Webhook created!');
      print(result, getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd.command('delete <id>').description('Delete a webhook').action(async (id: string) => {
  try {
    await getClient().deleteWebhook(id);
    success('Webhook deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Project Commands
const projectCmd = program.command('project').description('Project information');

projectCmd.command('get').description('Get project details').action(async () => {
  try {
    print(await getClient().getProject(), getFormat(projectCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
