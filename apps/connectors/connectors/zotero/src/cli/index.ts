#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { Zotero } from '../api';
import type { OutputFormat } from '../types';
import {
  getApiKey,
  setApiKey,
  getLibraryId,
  setLibraryId,
  getLibraryType,
  setLibraryType,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  clearConfig,
  isAuthenticated,
  setProfileOverride,
} from '../utils/config';
import { print, success, error, info, heading } from '../utils/output';

const program = new Command();

function getClient(): Zotero {
  const apiKey = getApiKey();
  const libraryId = getLibraryId();

  if (!apiKey) {
    console.error(chalk.red('Error: No Zotero API key configured.'));
    console.error(chalk.yellow('Set API key with: connect-zotero config set-api-key <key>'));
    console.error(chalk.yellow('Or set ZOTERO_API_KEY environment variable'));
    process.exit(1);
  }

  if (!libraryId) {
    console.error(chalk.red('Error: No Zotero library ID configured.'));
    console.error(chalk.yellow('Set library ID with: connect-zotero config set-library-id <id>'));
    console.error(chalk.yellow('Or set ZOTERO_LIBRARY_ID environment variable'));
    process.exit(1);
  }

  return new Zotero({
    apiKey,
    libraryId,
    libraryType: getLibraryType(),
    baseUrl: getBaseUrl(),
  });
}

function getFormat(opts: { format?: string }): OutputFormat {
  const format = opts.format ?? 'pretty';
  if (format === 'json' || format === 'table' || format === 'pretty') {
    return format;
  }
  return 'pretty';
}

async function runAction(action: () => Promise<unknown>, format: OutputFormat): Promise<void> {
  try {
    const result = await action();
    print(result, format);
  } catch (e) {
    error((e as Error).message);
    process.exit(1);
  }
}

program
  .name('connect-zotero')
  .description('Zotero Web API v3 CLI')
  .version('0.0.1')
  .option('-p, --profile <name>', 'Use specific profile')
  .option('-f, --format <format>', 'Output format: json, table, pretty', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

const configCmd = program.command('config').description('Configuration commands');

configCmd
  .command('set-api-key <key>')
  .description('Set API key for current profile')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-library-id <id>')
  .description('Set user or group library ID')
  .action((id: string) => {
    setLibraryId(id);
    success(`Library ID saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-library-type <type>')
  .description('Set library type: users or groups')
  .action((type: string) => {
    if (type !== 'users' && type !== 'groups' && type !== 'group') {
      error('Library type must be "users" or "groups"');
      process.exit(1);
    }
    setLibraryType(type as 'users' | 'groups' | 'group');
    success(`Library type set to "${type === 'group' ? 'groups' : type}"`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set custom API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL set to "${url}"`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    heading('Current Configuration');
    print({
      profile: getCurrentProfile(),
      authenticated: isAuthenticated(),
      apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'Not set',
      libraryId: getLibraryId() || 'Not set',
      libraryType: getLibraryType(),
      baseUrl: getBaseUrl() || 'https://api.zotero.org (default)',
    });
  });

configCmd
  .command('clear')
  .description('Clear configuration for current profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

const profileCmd = program.command('profile').description('Profile management');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Using default.');
      return;
    }

    heading('Profiles');
    profiles.forEach(p => {
      const marker = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
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
    success(`Switched to profile "${name}"`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Test API authentication')
  .action(async function (this: Command) {
    const format = getFormat(this.opts());
    await runAction(() => getClient().test(), format);
  });

const itemsCmd = program.command('items').description('Library item operations');

itemsCmd
  .command('list')
  .description('List items in the library')
  .option('--collection <key>', 'Filter by collection key')
  .option('--limit <n>', 'Maximum items to return', parseInt)
  .option('--start <n>', 'Start index for pagination', parseInt)
  .option('--tag <tag>', 'Filter by tag')
  .action(async function (this: Command, options) {
    const format = getFormat(this.opts());
    await runAction(
      () => getClient().items.list({
        collectionKey: options.collection,
        limit: options.limit,
        start: options.start,
        tag: options.tag,
      }),
      format
    );
  });

itemsCmd
  .command('search <query>')
  .description('Search items by query')
  .option('--collection <key>', 'Filter by collection key')
  .option('--limit <n>', 'Maximum items to return', parseInt)
  .action(async function (this: Command, query: string, options) {
    const format = getFormat(this.opts());
    await runAction(
      () => getClient().items.search(query, {
        collectionKey: options.collection,
        limit: options.limit,
      }),
      format
    );
  });

itemsCmd
  .command('get <itemKey>')
  .description('Get a single item by key')
  .action(async function (this: Command, itemKey: string) {
    const format = getFormat(this.opts());
    await runAction(() => getClient().items.get(itemKey), format);
  });

itemsCmd
  .command('create')
  .description('Create one or more items from JSON')
  .requiredOption('--json <path>', 'Path to JSON file with item(s)')
  .action(async function (this: Command, options) {
    const format = getFormat(this.opts());
    const content = readFileSync(options.json, 'utf-8');
    const payload = JSON.parse(content);
    await runAction(() => getClient().items.create(payload), format);
  });

itemsCmd
  .command('update <itemKey>')
  .description('Update an item')
  .requiredOption('--json <path>', 'Path to JSON file with item fields')
  .option('--version <n>', 'Item version for optimistic concurrency', parseInt)
  .option('--method <method>', 'HTTP method: PATCH or PUT', 'PATCH')
  .action(async function (this: Command, itemKey: string, options) {
    const format = getFormat(this.opts());
    const content = readFileSync(options.json, 'utf-8');
    const payload = JSON.parse(content);
    const method = options.method === 'PUT' ? 'PUT' : 'PATCH';
    await runAction(
      () => getClient().items.update(itemKey, payload, options.version, method),
      format
    );
  });

itemsCmd
  .command('delete <itemKey>')
  .description('Delete an item')
  .requiredOption('--version <n>', 'Item version for optimistic concurrency', parseInt)
  .action(async function (this: Command, itemKey: string, options) {
    const format = getFormat(this.opts());
    await runAction(() => getClient().items.delete(itemKey, options.version), format);
  });

const collectionsCmd = program.command('collections').description('Collection operations');

collectionsCmd
  .command('list')
  .description('List collections')
  .action(async function (this: Command) {
    const format = getFormat(this.opts());
    await runAction(() => getClient().collections.list(), format);
  });

collectionsCmd
  .command('get <collectionKey>')
  .description('Get a collection by key')
  .action(async function (this: Command, collectionKey: string) {
    const format = getFormat(this.opts());
    await runAction(() => getClient().collections.get(collectionKey), format);
  });

collectionsCmd
  .command('create')
  .description('Create a collection from JSON')
  .requiredOption('--json <path>', 'Path to JSON file with collection data')
  .action(async function (this: Command, options) {
    const format = getFormat(this.opts());
    const content = readFileSync(options.json, 'utf-8');
    const payload = JSON.parse(content);
    await runAction(() => getClient().collections.create(payload), format);
  });

const attachmentsCmd = program.command('attachments').description('Attachment operations');

attachmentsCmd
  .command('create')
  .description('Create an attachment from JSON')
  .requiredOption('--json <path>', 'Path to JSON file with attachment data')
  .action(async function (this: Command, options) {
    const format = getFormat(this.opts());
    const content = readFileSync(options.json, 'utf-8');
    const payload = JSON.parse(content);
    await runAction(() => getClient().attachments.create(payload), format);
  });

attachmentsCmd
  .command('upload')
  .description('Upload a file attachment')
  .requiredOption('--file <path>', 'Path to file to upload')
  .option('--parent <itemKey>', 'Parent item key (required if no --attachment-key)')
  .option('--attachment-key <key>', 'Existing attachment item key')
  .option('--content-type <type>', 'MIME type')
  .action(async function (this: Command, options) {
    const format = getFormat(this.opts());
    const content = readFileSync(options.file);
    await runAction(
      () => getClient().attachments.uploadFile({
        filename: options.file.split('/').pop() || 'upload.bin',
        content,
        contentType: options.contentType,
        parentItem: options.parent,
        attachmentKey: options.attachmentKey,
      }),
      format
    );
  });

program
  .command('raw <path>')
  .description('Make a raw API request')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--json <path>', 'Path to JSON request body')
  .option('--version <n>', 'If-Unmodified-Since-Version header', parseInt)
  .action(async function (this: Command, path: string, options) {
    const format = getFormat(this.opts());
    let body: unknown;
    if (options.json) {
      body = JSON.parse(readFileSync(options.json, 'utf-8'));
    }

    await runAction(
      () => getClient().rawRequest(path, {
        method: options.method,
        body,
        version: options.version,
      }),
      format
    );
  });

program.parse();
