#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Uploadcare } from '../api';
import {
  getPublicKey,
  getSecretKey,
  setCredentials,
  clearConfig,
  getConfigDir,
  isAuthenticated,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const program = new Command();

program
  .name('connect-uploadcare')
  .description('Uploadcare API connector CLI - Manage files, groups, webhooks, and project settings')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-uploadcare profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function requireAuth(): Uploadcare {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-uploadcare config set-credentials <publicKey> <secretKey>" or set UPLOADCARE_PUBLIC_KEY and UPLOADCARE_SECRET_KEY.');
    process.exit(1);
  }
  return Uploadcare.create();
}

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

    success('Profiles:');
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
  .option('--public-key <key>', 'Public API key')
  .option('--secret-key <key>', 'Secret API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      publicKey: opts.publicKey,
      secretKey: opts.secretKey,
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
    info(`Public Key: ${config.publicKey ? `${config.publicKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Secret Key: ${config.secretKey ? `${config.secretKey.substring(0, 4)}...` : chalk.gray('not set')}`);
  });

const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-credentials <publicKey> <secretKey>')
  .description('Set Uploadcare public and secret API keys')
  .action((publicKey: string, secretKey: string) => {
    setCredentials(publicKey, secretKey);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const publicKey = getPublicKey();
    const secretKey = getSecretKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);
    info(`Public Key: ${publicKey ? `${publicKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Secret Key: ${secretKey ? `${secretKey.substring(0, 4)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const filesCmd = program
  .command('files')
  .description('File management commands');

filesCmd
  .command('list')
  .description('List files in the project')
  .option('-l, --limit <limit>', 'Maximum files to return')
  .option('--stored', 'Filter stored files only')
  .option('--removed', 'Filter removed files only')
  .action(async (opts) => {
    try {
      const uc = requireAuth();
      const params: Record<string, string | number | boolean> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.stored) params.stored = true;
      if (opts.removed) params.removed = true;

      const result = await uc.files.list(params);
      success(`Found ${result.total} file(s):`);
      print(result.results, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('get <uuid>')
  .description('Get file details by UUID')
  .action(async (uuid: string) => {
    try {
      const uc = requireAuth();
      const file = await uc.files.get(uuid);
      print(file, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('store <uuid>')
  .description('Store a file permanently')
  .action(async (uuid: string) => {
    try {
      const uc = requireAuth();
      const file = await uc.files.store(uuid);
      success(`File ${uuid} stored`);
      print(file, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('delete <uuid>')
  .description('Delete a file')
  .action(async (uuid: string) => {
    try {
      const uc = requireAuth();
      await uc.files.delete(uuid);
      success(`File ${uuid} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('copy-local <uuid>')
  .description('Create a local copy of a file')
  .requiredOption('-b, --body <json>', 'JSON body for the copy request')
  .action(async (uuid: string, opts) => {
    try {
      const uc = requireAuth();
      const body = JSON.parse(opts.body);
      const file = await uc.files.copyLocal(uuid, body);
      success(`Local copy created for ${uuid}`);
      print(file, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('copy-remote <uuid>')
  .description('Create a remote copy of a file')
  .requiredOption('-b, --body <json>', 'JSON body for the copy request')
  .action(async (uuid: string, opts) => {
    try {
      const uc = requireAuth();
      const body = JSON.parse(opts.body);
      const file = await uc.files.copyRemote(uuid, body);
      success(`Remote copy created for ${uuid}`);
      print(file, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('metadata <uuid>')
  .description('Get file metadata')
  .action(async (uuid: string) => {
    try {
      const uc = requireAuth();
      const metadata = await uc.files.getMetadata(uuid);
      print(metadata, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('metadata-update <uuid>')
  .description('Update file metadata')
  .requiredOption('-b, --body <json>', 'JSON metadata object')
  .action(async (uuid: string, opts) => {
    try {
      const uc = requireAuth();
      const body = JSON.parse(opts.body);
      const metadata = await uc.files.updateMetadata(uuid, body);
      success(`Metadata updated for ${uuid}`);
      print(metadata, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('metadata-delete <uuid> <key>')
  .description('Delete a metadata key from a file')
  .action(async (uuid: string, key: string) => {
    try {
      const uc = requireAuth();
      await uc.files.deleteMetadataKey(uuid, key);
      success(`Metadata key "${key}" deleted from ${uuid}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const groupsCmd = program
  .command('groups')
  .description('File group management commands');

groupsCmd
  .command('list')
  .description('List file groups')
  .option('-l, --limit <limit>', 'Maximum groups to return')
  .action(async (opts) => {
    try {
      const uc = requireAuth();
      const params: Record<string, number> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);

      const result = await uc.groups.list(params);
      success(`Found ${result.total} group(s):`);
      print(result.results, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('get <uuid>')
  .description('Get group details by UUID')
  .action(async (uuid: string) => {
    try {
      const uc = requireAuth();
      const group = await uc.groups.get(uuid);
      print(group, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('delete <uuid>')
  .description('Delete a file group')
  .action(async (uuid: string) => {
    try {
      const uc = requireAuth();
      await uc.groups.delete(uuid);
      success(`Group ${uuid} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const projectCmd = program
  .command('project')
  .description('Project settings commands');

projectCmd
  .command('get')
  .description('Get project information')
  .action(async () => {
    try {
      const uc = requireAuth();
      const project = await uc.project.get();
      print(project, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const webhooksCmd = program
  .command('webhooks')
  .description('Webhook management commands');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .option('-l, --limit <limit>', 'Maximum webhooks to return')
  .action(async (opts) => {
    try {
      const uc = requireAuth();
      const params: Record<string, number> = {};
      if (opts.limit) params.limit = parseInt(opts.limit);

      const result = await uc.webhooks.list(params);
      success(`Found ${result.total} webhook(s):`);
      print(result.results, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a webhook')
  .requiredOption('-b, --body <json>', 'JSON body for webhook creation')
  .action(async (opts) => {
    try {
      const uc = requireAuth();
      const body = JSON.parse(opts.body);
      const webhook = await uc.webhooks.create(body);
      success('Webhook created');
      print(webhook, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('update <id>')
  .description('Update a webhook')
  .requiredOption('-b, --body <json>', 'JSON body for webhook update')
  .action(async (id: string, opts) => {
    try {
      const uc = requireAuth();
      const body = JSON.parse(opts.body);
      const webhook = await uc.webhooks.update(id, body);
      success(`Webhook ${id} updated`);
      print(webhook, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <id>')
  .description('Delete a webhook')
  .action(async (id: string) => {
    try {
      const uc = requireAuth();
      await uc.webhooks.delete(id);
      success(`Webhook ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw')
  .description('Make a raw API request')
  .requiredOption('-p, --path <path>', 'API path (e.g. /files/)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const uc = requireAuth();
      const options: {
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: Record<string, unknown>;
      } = {
        method: opts.method.toUpperCase(),
      };

      if (opts.body) {
        options.body = JSON.parse(opts.body);
      }

      const result = await uc.rawRequest(opts.path, options);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
