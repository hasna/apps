#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SparkPost } from '../api';
import {
  getApiKey,
  getRegion,
  setApiKey,
  setRegion,
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

const CONNECTOR_NAME = 'connect-sparkpost';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SparkPost connector - Transactional email delivery, templates, domains, and analytics')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-r, --region <region>', 'API region (us or eu)')
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
      process.env.SPARKPOST_API_KEY = opts.apiKey;
    }
    if (opts.region) {
      process.env.SPARKPOST_REGION = opts.region;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SparkPost {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPARKPOST_API_KEY environment variable.`);
    process.exit(1);
  }
  return new SparkPost({ apiKey, region: getRegion() });
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
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--region <region>', 'API region (us or eu)')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, region: opts.region });
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
  info(`Region: ${config.region ?? 'us'}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-region <region>').description('Set API region (us or eu)').action((region: string) => {
  if (region !== 'us' && region !== 'eu') {
    error('Region must be "us" or "eu"');
    process.exit(1);
  }
  setRegion(region);
  success(`Region set to ${region} for profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Region: ${getRegion()}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Transmission Commands
const transmissionCmd = program.command('transmission').description('Email transmission operations');

transmissionCmd.command('send').description('Send an email')
  .requiredOption('--to <emails>', 'Recipient email(s), comma-separated')
  .requiredOption('--from <email>', 'Sender email')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--text <text>', 'Plain text content')
  .option('--html <html>', 'HTML content')
  .option('--reply-to <email>', 'Reply-to email')
  .option('--sandbox', 'Send via sandbox domain')
  .action(async (opts) => {
    try {
      const client = getClient();
      const toEmails = opts.to.split(',').map((e: string) => e.trim());
      const result = await client.sendSimpleEmail({
        to: toEmails,
        from: opts.from,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        replyTo: opts.replyTo,
        sandbox: opts.sandbox,
      });
      success('Email sent successfully!');
      print(result, getFormat(transmissionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transmissionCmd.command('ls').description('List transmissions')
  .option('--from <date>', 'Start date filter')
  .option('--to <date>', 'End date filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTransmissions({ from: opts.from, to: opts.to });
      print(result, getFormat(transmissionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transmissionCmd.command('get <id>').description('Get a transmission by ID').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.getTransmission(id);
    print(result, getFormat(transmissionCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

transmissionCmd.command('delete <id>').description('Delete a scheduled transmission').action(async (id: string) => {
  try {
    const client = getClient();
    await client.deleteTransmission(id);
    success(`Transmission ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Template Commands
const templateCmd = program.command('template').description('Template operations');

templateCmd.command('ls').description('List templates')
  .option('--draft', 'List draft templates')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTemplates({ draft: opts.draft });
      print(result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd.command('get <id>').description('Get a template by ID')
  .option('--draft', 'Get draft version')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getTemplate(id, opts.draft);
      print(result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd.command('create <id>').description('Create a template')
  .option('--name <name>', 'Template name')
  .option('--subject <subject>', 'Email subject')
  .option('--html <html>', 'HTML content')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createTemplate({
        id,
        name: opts.name,
        content: {
          subject: opts.subject,
          html: opts.html,
        },
      });
      success('Template created!');
      print(result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd.command('delete <id>').description('Delete a template').action(async (id: string) => {
  try {
    const client = getClient();
    await client.deleteTemplate(id);
    success(`Template ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Sending Domain Commands
const domainCmd = program.command('domain').description('Sending domain operations');

domainCmd.command('ls').description('List sending domains').action(async () => {
  try {
    const client = getClient();
    const result = await client.listSendingDomains();
    print(result, getFormat(domainCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

domainCmd.command('get <domain>').description('Get a sending domain').action(async (domain: string) => {
  try {
    const client = getClient();
    const result = await client.getSendingDomain(domain);
    print(result, getFormat(domainCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

domainCmd.command('create <domain>').description('Create a sending domain').action(async (domain: string) => {
  try {
    const client = getClient();
    const result = await client.createSendingDomain({ domain });
    success('Sending domain created!');
    print(result, getFormat(domainCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

domainCmd.command('verify <domain>').description('Verify a sending domain')
  .option('--dkim', 'Verify DKIM')
  .option('--cname', 'Verify CNAME')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();
      const result = await client.verifySendingDomain(domain, {
        dkim_verify: opts.dkim,
        cname_verify: opts.cname,
      });
      print(result, getFormat(domainCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd.command('delete <domain>').description('Delete a sending domain').action(async (domain: string) => {
  try {
    const client = getClient();
    await client.deleteSendingDomain(domain);
    success(`Sending domain ${domain} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Suppression Commands
const suppressionCmd = program.command('suppression').description('Suppression list operations');

suppressionCmd.command('ls').description('List suppressions')
  .option('--types <types>', 'Filter by types (comma-separated)')
  .option('-l, --limit <number>', 'Limit results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSuppressions({
        types: opts.types,
        per_page: parseInt(opts.limit),
      });
      print(result, getFormat(suppressionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

suppressionCmd.command('add <email>').description('Add email to suppression list')
  .option('--type <type>', 'Suppression type', 'transactional')
  .action(async (email: string, opts) => {
    try {
      const client = getClient();
      await client.addSuppression([{ recipient: email, type: opts.type }]);
      success(`Added ${email} to suppression list`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

suppressionCmd.command('delete <email>').description('Remove email from suppression list').action(async (email: string) => {
  try {
    const client = getClient();
    await client.deleteSuppression(email);
    success(`Removed ${email} from suppression list`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Webhook Commands
const webhookCmd = program.command('webhook').description('Webhook operations');

webhookCmd.command('ls').description('List webhooks').action(async () => {
  try {
    const client = getClient();
    const result = await client.listWebhooks();
    print(result, getFormat(webhookCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webhookCmd.command('create').description('Create a webhook')
  .requiredOption('-n, --name <name>', 'Webhook name')
  .requiredOption('-t, --target <url>', 'Target URL')
  .requiredOption('-e, --events <events>', 'Comma-separated event types')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createWebhook({
        name: opts.name,
        target: opts.target,
        events: opts.events.split(',').map((e: string) => e.trim()),
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
    const client = getClient();
    await client.deleteWebhook(id);
    success(`Webhook ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Recipient List Commands
const recipientListCmd = program.command('recipient-list').description('Recipient list operations');

recipientListCmd.command('ls').description('List recipient lists').action(async () => {
  try {
    const client = getClient();
    const result = await client.listRecipientLists();
    print(result, getFormat(recipientListCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

recipientListCmd.command('create <id>').description('Create a recipient list')
  .option('--name <name>', 'List name')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createRecipientList(id, { name: opts.name });
      success('Recipient list created!');
      print(result, getFormat(recipientListCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Account Commands
const accountCmd = program.command('account').description('Account operations');

accountCmd.command('show').description('Show account info').action(async () => {
  try {
    const client = getClient();
    const result = await client.getAccount();
    print(result, getFormat(accountCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Events Commands
const eventsCmd = program.command('events').description('Event operations');

eventsCmd.command('ls').description('List message events')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .option('--events <events>', 'Event types filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents({
        from: opts.from,
        to: opts.to,
        events: opts.events,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Validation Commands
const validateCmd = program.command('validate').description('Recipient validation');

validateCmd.command('email <address>').description('Validate a single email address').action(async (address: string) => {
  try {
    const client = getClient();
    const result = await client.validateRecipient(address);
    print(result, getFormat(validateCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
