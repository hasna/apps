#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PandaDoc } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccessToken,
  setAccessToken,
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
  getExportsDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-pandadoc';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('PandaDoc API connector CLI - Manage documents, templates, contacts and more')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-t, --access-token <token>', 'OAuth access token (overrides config)')
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
    // Set API key/token from flag if provided
    if (opts.apiKey) {
      process.env.PANDADOC_API_KEY = opts.apiKey;
    }
    if (opts.accessToken) {
      process.env.PANDADOC_ACCESS_TOKEN = opts.accessToken;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): PandaDoc {
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  if (!apiKey && !accessToken) {
    error(`No API key or access token configured. Run "${CONNECTOR_NAME} config set-key <key>" or set PANDADOC_API_KEY environment variable.`);
    process.exit(1);
  }
  return new PandaDoc({ apiKey, accessToken });
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
  .option('--access-token <token>', 'OAuth access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      accessToken: opts.accessToken,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
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
  .command('set-token <accessToken>')
  .description('Set OAuth access token')
  .action((accessToken: string) => {
    setAccessToken(accessToken);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Documents Commands
// ============================================
const documentsCmd = program
  .command('documents')
  .alias('docs')
  .description('Manage documents');

documentsCmd
  .command('list')
  .description('List documents')
  .option('-q, --query <query>', 'Search query')
  .option('-s, --status <status>', 'Filter by status (comma-separated for multiple)')
  .option('--tag <tag>', 'Filter by tag')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .option('--order-by <field>', 'Order by (name, date_created, date_modified, date_completed)')
  .option('--folder <uuid>', 'Filter by folder UUID')
  .option('--template <id>', 'Filter by template ID')
  .option('--deleted', 'Include deleted documents')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.documents.list({
        q: opts.query,
        status: opts.status?.split(','),
        tag: opts.tag,
        count: parseInt(opts.count),
        page: parseInt(opts.page),
        order_by: opts.orderBy,
        folder_uuid: opts.folder,
        template_id: opts.template,
        deleted: opts.deleted,
      });
      print(result.results || result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('get <id>')
  .description('Get document details')
  .option('--include-links', 'Include signing links')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.documents.get(id, { include_links: opts.includeLinks });
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('status <id>')
  .description('Get document status')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.documents.status(id);
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('create')
  .description('Create a document from template')
  .requiredOption('-n, --name <name>', 'Document name')
  .option('-t, --template <uuid>', 'Template UUID')
  .option('--folder <uuid>', 'Folder UUID')
  .option('--recipients <json>', 'Recipients JSON array')
  .option('--tokens <json>', 'Tokens JSON object')
  .option('--metadata <json>', 'Metadata JSON object')
  .option('--tags <tags>', 'Tags (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = { name: opts.name };

      if (opts.template) params.template_uuid = opts.template;
      if (opts.folder) params.folder_uuid = opts.folder;
      if (opts.recipients) params.recipients = JSON.parse(opts.recipients);
      if (opts.tokens) params.tokens = JSON.parse(opts.tokens);
      if (opts.metadata) params.metadata = JSON.parse(opts.metadata);
      if (opts.tags) params.tags = opts.tags.split(',');

      const result = await client.documents.create(params as any);
      success('Document created!');
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('create-from-url')
  .description('Create a document from a PDF URL')
  .requiredOption('-n, --name <name>', 'Document name')
  .requiredOption('-u, --url <url>', 'PDF URL')
  .option('--folder <uuid>', 'Folder UUID')
  .option('--recipients <json>', 'Recipients JSON array')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.folder) params.folder_uuid = opts.folder;
      if (opts.recipients) params.recipients = JSON.parse(opts.recipients);

      const result = await client.documents.createFromUrl(opts.name, opts.url, params as any);
      success('Document created from URL!');
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('send <id>')
  .description('Send document for signing')
  .option('-m, --message <message>', 'Custom message')
  .option('-s, --subject <subject>', 'Email subject')
  .option('--silent', 'Send without notification')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.documents.send(id, {
        message: opts.message,
        subject: opts.subject,
        silent: opts.silent,
      });
      success('Document sent!');
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('download <id>')
  .description('Download document as PDF')
  .option('-o, --output <path>', 'Output file path')
  .option('--separate-files', 'Download attachments separately')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const response = await client.documents.download(id, { separate_files: opts.separateFiles });
      const buffer = await response.arrayBuffer();
      const outputPath = opts.output || join(getExportsDir(), `document-${id}.pdf`);
      writeFileSync(outputPath, Buffer.from(buffer));
      success(`Document saved to: ${outputPath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('delete <id>')
  .description('Delete a document')
  .option('--force', 'Permanently delete')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      if (opts.force) {
        await client.documents.deletePermanently(id);
        success('Document permanently deleted!');
      } else {
        await client.documents.delete(id);
        success('Document moved to trash!');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('void <id>')
  .description('Void a sent document')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.documents.void(id);
      success('Document voided!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('move <id> <folderUuid>')
  .description('Move document to folder')
  .action(async (id: string, folderUuid: string) => {
    try {
      const client = getClient();
      await client.documents.move(id, folderUuid);
      success('Document moved!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('recipients <id>')
  .description('Get document recipients')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.documents.getRecipients(id);
      print(result.recipients || result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('add-recipient <id>')
  .description('Add recipient to document')
  .requiredOption('-e, --email <email>', 'Recipient email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--type <type>', 'Recipient type (signer, CC, approver)', 'signer')
  .option('--role <role>', 'Role name')
  .option('--order <number>', 'Signing order')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.documents.addRecipient(id, {
        email: opts.email,
        first_name: opts.firstName,
        last_name: opts.lastName,
        recipient_type: opts.type,
        role: opts.role,
        signing_order: opts.order ? parseInt(opts.order) : undefined,
      });
      success('Recipient added!');
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('fields <id>')
  .description('Get document fields')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.documents.getFields(id);
      print(result.fields || result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('update-fields <id>')
  .description('Update document fields')
  .requiredOption('--fields <json>', 'Fields JSON object')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const fields = JSON.parse(opts.fields);
      const result = await client.documents.updateFields(id, fields);
      success('Fields updated!');
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('attachments <id>')
  .description('Get document attachments')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.documents.getAttachments(id);
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd
  .command('share-link <id> <recipientId>')
  .description('Get sharing link for recipient')
  .option('--lifetime <seconds>', 'Link lifetime in seconds')
  .action(async (id: string, recipientId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.documents.getSharingLink(id, recipientId, {
        lifetime: opts.lifetime ? parseInt(opts.lifetime) : undefined,
      });
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Templates Commands
// ============================================
const templatesCmd = program
  .command('templates')
  .alias('tpl')
  .description('Manage templates');

templatesCmd
  .command('list')
  .description('List templates')
  .option('-q, --query <query>', 'Search query')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .option('--tag <tag>', 'Filter by tag')
  .option('--folder <uuid>', 'Filter by folder UUID')
  .option('--deleted', 'Include deleted templates')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.templates.list({
        q: opts.query,
        count: parseInt(opts.count),
        page: parseInt(opts.page),
        tag: opts.tag,
        folder_uuid: opts.folder,
        deleted: opts.deleted,
      });
      print(result.results || result, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templatesCmd
  .command('get <id>')
  .description('Get template details')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.templates.getDetails(id);
      print(result, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templatesCmd
  .command('delete <id>')
  .description('Delete a template')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.templates.delete(id);
      success('Template deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Contacts Commands
// ============================================
const contactsCmd = program
  .command('contacts')
  .description('Manage contacts');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('-e, --email <email>', 'Filter by email')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.list({
        email: opts.email,
        count: parseInt(opts.count),
        page: parseInt(opts.page),
      });
      print(result.results || result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('get <id>')
  .description('Get contact by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(id);
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .requiredOption('-e, --email <email>', 'Email address')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--company <company>', 'Company name')
  .option('--job-title <title>', 'Job title')
  .option('--phone <phone>', 'Phone number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        email: opts.email,
        first_name: opts.firstName,
        last_name: opts.lastName,
        company: opts.company,
        job_title: opts.jobTitle,
        phone: opts.phone,
      });
      success('Contact created!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('update <id>')
  .description('Update a contact')
  .option('-e, --email <email>', 'Email address')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--company <company>', 'Company name')
  .option('--job-title <title>', 'Job title')
  .option('--phone <phone>', 'Phone number')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.email) params.email = opts.email;
      if (opts.firstName) params.first_name = opts.firstName;
      if (opts.lastName) params.last_name = opts.lastName;
      if (opts.company) params.company = opts.company;
      if (opts.jobTitle) params.job_title = opts.jobTitle;
      if (opts.phone) params.phone = opts.phone;

      const result = await client.contacts.update(id, params as any);
      success('Contact updated!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete <id>')
  .description('Delete a contact')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.contacts.delete(id);
      success('Contact deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Folders Commands
// ============================================
const foldersCmd = program
  .command('folders')
  .description('Manage document folders');

foldersCmd
  .command('list')
  .description('List folders')
  .option('--parent <uuid>', 'Parent folder UUID')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.folders.list({
        parent_uuid: opts.parent,
        count: parseInt(opts.count),
        page: parseInt(opts.page),
      });
      print(result.results || result, getFormat(foldersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('get <uuid>')
  .description('Get folder by UUID')
  .action(async (uuid: string) => {
    try {
      const client = getClient();
      const result = await client.folders.get(uuid);
      print(result, getFormat(foldersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('create')
  .description('Create a new folder')
  .requiredOption('-n, --name <name>', 'Folder name')
  .option('--parent <uuid>', 'Parent folder UUID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.folders.create({
        name: opts.name,
        parent_uuid: opts.parent,
      });
      success('Folder created!');
      print(result, getFormat(foldersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('rename <uuid>')
  .description('Rename a folder')
  .requiredOption('-n, --name <name>', 'New folder name')
  .action(async (uuid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.folders.rename(uuid, opts.name);
      success('Folder renamed!');
      print(result, getFormat(foldersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('delete <uuid>')
  .description('Delete a folder')
  .action(async (uuid: string) => {
    try {
      const client = getClient();
      await client.folders.delete(uuid);
      success('Folder deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Members Commands
// ============================================
const membersCmd = program
  .command('members')
  .description('Manage workspace members');

membersCmd
  .command('list')
  .description('List workspace members')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.members.list({
        count: parseInt(opts.count),
        page: parseInt(opts.page),
      });
      print(result.results || result, getFormat(membersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

membersCmd
  .command('get <membershipId>')
  .description('Get member by membership ID')
  .action(async (membershipId: string) => {
    try {
      const client = getClient();
      const result = await client.members.get(membershipId);
      print(result, getFormat(membersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

membersCmd
  .command('me')
  .description('Get current user details')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.members.getCurrentUser();
      print(result, getFormat(membersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Webhooks Commands
// ============================================
const webhooksCmd = program
  .command('webhooks')
  .description('Manage webhooks');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.list({
        count: parseInt(opts.count),
        page: parseInt(opts.page),
      });
      print(result.results || result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <uuid>')
  .description('Get webhook by UUID')
  .action(async (uuid: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.get(uuid);
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a new webhook')
  .requiredOption('-n, --name <name>', 'Webhook name')
  .requiredOption('-u, --url <url>', 'Webhook URL')
  .requiredOption('-e, --events <events>', 'Events (comma-separated: document_state_changed,recipient_completed,document_updated,document_deleted,document_creation_failed)')
  .option('--active', 'Set webhook as active')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.create({
        name: opts.name,
        url: opts.url,
        events: opts.events.split(','),
        active: opts.active || false,
      });
      success('Webhook created!');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('update <uuid>')
  .description('Update a webhook')
  .option('-n, --name <name>', 'Webhook name')
  .option('-u, --url <url>', 'Webhook URL')
  .option('-e, --events <events>', 'Events (comma-separated)')
  .option('--active', 'Set webhook as active')
  .option('--inactive', 'Set webhook as inactive')
  .action(async (uuid: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.name) params.name = opts.name;
      if (opts.url) params.url = opts.url;
      if (opts.events) params.events = opts.events.split(',');
      if (opts.active) params.active = true;
      if (opts.inactive) params.active = false;

      const result = await client.webhooks.update(uuid, params as any);
      success('Webhook updated!');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <uuid>')
  .description('Delete a webhook')
  .action(async (uuid: string) => {
    try {
      const client = getClient();
      await client.webhooks.delete(uuid);
      success('Webhook deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('shared-key')
  .description('Get webhook shared key for signature verification')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.webhooks.getSharedKey();
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('regenerate-key')
  .description('Regenerate webhook shared key')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.webhooks.regenerateSharedKey();
      success('Shared key regenerated!');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Forms Commands
// ============================================
const formsCmd = program
  .command('forms')
  .description('Manage forms');

formsCmd
  .command('list')
  .description('List forms')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.forms.list({
        count: parseInt(opts.count),
        page: parseInt(opts.page),
        status: opts.status,
      });
      print(result.results || result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('get <id>')
  .description('Get form by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.forms.get(id);
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Catalogs Commands
// ============================================
const catalogsCmd = program
  .command('catalogs')
  .alias('catalog')
  .description('Manage product catalog items');

catalogsCmd
  .command('list')
  .description('List catalog items')
  .option('-q, --query <query>', 'Search query')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.catalogs.list({
        q: opts.query,
        count: parseInt(opts.count),
        page: parseInt(opts.page),
      });
      print(result.results || result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('get <id>')
  .description('Get catalog item by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.catalogs.get(id);
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('create')
  .description('Create a new catalog item')
  .requiredOption('-n, --name <name>', 'Item name')
  .option('-d, --description <description>', 'Item description')
  .option('--sku <sku>', 'SKU')
  .option('--price <value>', 'Price value')
  .option('--currency <currency>', 'Currency code (USD, EUR, etc.)', 'USD')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = { name: opts.name };
      if (opts.description) params.description = opts.description;
      if (opts.sku) params.sku = opts.sku;
      if (opts.price) {
        params.price = {
          value: opts.price,
          currency: opts.currency,
        };
      }

      const result = await client.catalogs.create(params as any);
      success('Catalog item created!');
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('update <id>')
  .description('Update a catalog item')
  .option('-n, --name <name>', 'Item name')
  .option('-d, --description <description>', 'Item description')
  .option('--sku <sku>', 'SKU')
  .option('--price <value>', 'Price value')
  .option('--currency <currency>', 'Currency code')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.name) params.name = opts.name;
      if (opts.description) params.description = opts.description;
      if (opts.sku) params.sku = opts.sku;
      if (opts.price) {
        params.price = {
          value: opts.price,
          currency: opts.currency || 'USD',
        };
      }

      const result = await client.catalogs.update(id, params as any);
      success('Catalog item updated!');
      print(result, getFormat(catalogsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogsCmd
  .command('delete <id>')
  .description('Delete a catalog item')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.catalogs.delete(id);
      success('Catalog item deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Content Library Commands
// ============================================
const contentLibraryCmd = program
  .command('content-library')
  .alias('cl')
  .description('Manage content library items');

contentLibraryCmd
  .command('list')
  .description('List content library items')
  .option('-q, --query <query>', 'Search query')
  .option('-n, --count <number>', 'Results per page', '25')
  .option('--page <number>', 'Page number', '1')
  .option('--tag <tag>', 'Filter by tag')
  .option('--folder <uuid>', 'Filter by folder UUID')
  .option('--deleted', 'Include deleted items')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contentLibrary.list({
        q: opts.query,
        count: parseInt(opts.count),
        page: parseInt(opts.page),
        tag: opts.tag,
        folder_uuid: opts.folder,
        deleted: opts.deleted,
      });
      print(result.results || result, getFormat(contentLibraryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contentLibraryCmd
  .command('get <id>')
  .description('Get content library item by ID')
  .option('--details', 'Include pricing tables and tags')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = opts.details
        ? await client.contentLibrary.getDetails(id)
        : await client.contentLibrary.get(id);
      print(result, getFormat(contentLibraryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contentLibraryCmd
  .command('delete <id>')
  .description('Delete a content library item')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.contentLibrary.delete(id);
      success('Content library item deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
