#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tidio } from '../api';
import type { OutputFormat } from '../types';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getClientCredentials,
  getConfigDir,
  getCurrentProfile,
  listProfiles,
  loadProfile,
  profileExists,
  setClientCredentials,
  setCurrentProfile,
  setProfileOverride,
} from '../utils/config';
import { error, info, print, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-tidio';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tidio connector - contacts, contact messages, departments, operators, project, tickets, products, and Lyro')
  .version(VERSION)
  .option('--client-id <id>', 'OpenAPI client id (overrides config)')
  .option('--client-secret <secret>', 'OpenAPI client secret (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', thisCommand => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.clientId) process.env.TIDIO_CLIENT_ID = opts.clientId;
    if (opts.clientSecret) process.env.TIDIO_CLIENT_SECRET = opts.clientSecret;
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.opts().format || cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tidio {
  const { clientId, clientSecret } = getClientCredentials();
  if (!clientId || !clientSecret) {
    error(
      `No Tidio credentials configured. Run "${CONNECTOR_NAME} config set-credentials <client-id> <client-secret>" or set TIDIO_CLIENT_ID and TIDIO_CLIENT_SECRET.`,
    );
    process.exit(1);
  }
  return new Tidio({ clientId, clientSecret });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach(profile => {
    const active = profile === current ? chalk.green(' (active)') : '';
    console.log(`  ${profile}${active}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--client-id <id>', 'OpenAPI client id')
  .option('--client-secret <secret>', 'OpenAPI client secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (!createProfile(name, { clientId: opts.clientId, clientSecret: opts.clientSecret })) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (deleteProfile(name)) {
    success(`Profile "${name}" deleted`);
    return;
  }
  error(`Profile "${name}" was not deleted`);
  process.exit(1);
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Client Secret: ${config.clientSecret ? chalk.gray('set') : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-credentials <client-id> <client-secret>').description('Set OpenAPI credentials').action((clientId: string, clientSecret: string) => {
  setClientCredentials(clientId, clientSecret);
  success(`Credentials saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const { clientId, clientSecret } = getClientCredentials();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Client Secret: ${clientSecret ? chalk.gray('set') : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const contactCmd = program.command('contact').description('Manage contacts and contact messages');

contactCmd.command('list').description('List contacts').option('-n, --limit <number>').option('--cursor <cursor>').action(async opts => {
  print(await getClient().listContacts({ limit: opts.limit ? Number(opts.limit) : undefined, cursor: opts.cursor }), getFormat(contactCmd));
});

contactCmd.command('get <id>').description('Get a contact').action(async (id: string) => {
  print(await getClient().getContact(id), getFormat(contactCmd));
});

contactCmd
  .command('create')
  .description('Create a contact')
  .option('--email <email>')
  .option('--phone <phone>')
  .option('--first-name <name>')
  .option('--last-name <name>')
  .option('--distinct-id <id>')
  .action(async opts => {
    print(
      await getClient().createContact({
        email: opts.email,
        phone: opts.phone,
        firstName: opts.firstName,
        lastName: opts.lastName,
        distinctId: opts.distinctId,
      }),
      getFormat(contactCmd),
    );
  });

contactCmd
  .command('update <id>')
  .description('Update a contact')
  .option('--email <email>')
  .option('--phone <phone>')
  .option('--first-name <name>')
  .option('--last-name <name>')
  .option('--distinct-id <id>')
  .action(async (id: string, opts) => {
    print(
      await getClient().updateContact(id, {
        email: opts.email,
        phone: opts.phone,
        firstName: opts.firstName,
        lastName: opts.lastName,
        distinctId: opts.distinctId,
      }),
      getFormat(contactCmd),
    );
  });

contactCmd.command('delete <id>').description('Delete a contact').action(async (id: string) => {
  await getClient().deleteContact(id);
  success('Contact deleted');
});

contactCmd.command('properties').description('Get contact property definitions').action(async () => {
  print(await getClient().getContactProperties(), getFormat(contactCmd));
});

contactCmd.command('viewed-pages <id>').description('Get viewed pages history').action(async (id: string) => {
  print(await getClient().getContactViewedPages(id), getFormat(contactCmd));
});

contactCmd.command('messages <id>').description('List contact messages').option('--cursor <cursor>').action(async (id: string, opts) => {
  print(await getClient().listContactMessages(id, { cursor: opts.cursor }), getFormat(contactCmd));
});

contactCmd.command('send-message <id>').description('Send a message on behalf of a contact').requiredOption('-m, --message <message>').action(async (id: string, opts) => {
  print(await getClient().sendContactMessage(id, { message: opts.message }), getFormat(contactCmd));
});

program.command('operator').description('List operators').action(async () => {
  print(await getClient().listOperators(), getFormat(program));
});

program.command('department').description('List departments').action(async () => {
  print(await getClient().listDepartments(), getFormat(program));
});

program.command('project').description('Get project info').action(async () => {
  print(await getClient().getProject(), getFormat(program));
});

const ticketCmd = program.command('ticket').description('Manage tickets');

ticketCmd.command('list').option('-n, --limit <number>').option('--cursor <cursor>').option('--status <status>').option('--priority <priority>').action(async opts => {
  print(
    await getClient().listTickets({
      limit: opts.limit ? Number(opts.limit) : undefined,
      cursor: opts.cursor,
      status: opts.status,
      priority: opts.priority,
    }),
    getFormat(ticketCmd),
  );
});

ticketCmd.command('get <id>').action(async (id: string) => {
  print(await getClient().getTicket(id), getFormat(ticketCmd));
});

ticketCmd.command('reply <id>').requiredOption('-m, --message <message>').option('--author-type <type>').action(async (id: string, opts) => {
  print(await getClient().replyToTicket(id, { message: opts.message, authorType: opts.authorType }), getFormat(ticketCmd));
});

ticketCmd.command('tags').description('Get ticket tags').action(async () => {
  print(await getClient().getTicketTags(), getFormat(ticketCmd));
});

ticketCmd.command('custom-fields').description('Get ticket custom fields').action(async () => {
  print(await getClient().getTicketCustomFields(), getFormat(ticketCmd));
});

const lyroCmd = program.command('lyro').description('Manage Lyro data sources');

lyroCmd.command('sources').option('-n, --limit <number>').option('--cursor <cursor>').option('--kind <kind>').action(async opts => {
  print(
    await getClient().listLyroDataSources({
      limit: opts.limit ? Number(opts.limit) : undefined,
      cursor: opts.cursor,
      kind: opts.kind,
    }),
    getFormat(lyroCmd),
  );
});

lyroCmd
  .command('ask-ticket')
  .description('Ask Lyro to answer a ticket from a single contact message')
  .requiredOption('--ticket-id <id>')
  .requiredOption('--subject <subject>')
  .requiredOption('--contact-email <email>')
  .requiredOption('--contact-name <name>')
  .requiredOption('--recipient-email <email>')
  .requiredOption('--message-id <id>')
  .requiredOption('--message <message>')
  .option('--created-at <iso>', 'Message creation timestamp', new Date().toISOString())
  .action(async opts => {
    print(
      await getClient().askLyroToAnswerTicket({
        ticketId: opts.ticketId,
        subject: opts.subject,
        contactEmail: opts.contactEmail,
        contactName: opts.contactName,
        recipientEmail: opts.recipientEmail,
        messages: [
          {
            created_at: opts.createdAt,
            message_id: opts.messageId,
            author_type: 'contact',
            message_type: 'public',
            message_content: opts.message,
          },
        ],
      }),
      getFormat(lyroCmd),
    );
  });

program.parse();
