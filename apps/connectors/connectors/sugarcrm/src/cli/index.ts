#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getOAuthToken,
  setOAuthToken,
  getBaseUrl,
  setBaseUrl,
  getClientId,
  getClientSecret,
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
  setClientId,
  setClientSecret,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-sugarcrm';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SugarCRM REST API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth token (overrides config)')
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
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.token) {
      process.env.SUGARCRM_OAUTH_TOKEN = opts.token;
      debug('OAuth token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(requireToken = true): Connector {
  const oauthToken = getOAuthToken();
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    error(`No base URL configured. Run "${CONNECTOR_NAME} config set-base-url <url>" or set SUGARCRM_BASE_URL.`);
    process.exit(1);
  }
  if (requireToken && !oauthToken) {
    error(`No OAuth token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set SUGARCRM_OAUTH_TOKEN.`);
    process.exit(1);
  }

  return new Connector({
    oauthToken,
    baseUrl,
    clientId: getClientId(),
    clientSecret: getClientSecret(),
  });
}

function parseJsonOption(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'OAuth token')
  .option('--base-url <url>', 'SugarCRM instance URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      oauthToken: opts.token,
      baseUrl: opts.baseUrl,
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
    info(`OAuth Token: ${config.oauthToken || config.token || config.apiKey ? '***set***' : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
    info(`Client ID: ${config.clientId || chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set OAuth token')
  .action((token: string) => {
    setOAuthToken(token);
    success(`OAuth token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set SugarCRM instance base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-client-id <clientId>')
  .description('Set OAuth2 client ID for password grant')
  .action((clientId: string) => {
    setClientId(clientId);
    success(`Client ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-client-secret <secret>')
  .description('Set OAuth2 client secret for password grant')
  .action((secret: string) => {
    setClientSecret(secret);
    success(`Client secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getOAuthToken();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`OAuth Token: ${token ? `${token.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('not set')}`);
    info(`Client ID: ${getClientId() || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const authCmd = program.command('auth').description('Authentication commands');

authCmd
  .command('authenticate')
  .description('Exchange username + password for an OAuth token')
  .requiredOption('--username <username>', 'SugarCRM username')
  .requiredOption('--password <password>', 'SugarCRM password')
  .option('--client-id <id>', 'OAuth2 client ID', 'sugar')
  .option('--client-secret <secret>', 'OAuth2 client secret', '')
  .option('--save', 'Save access token to active profile')
  .action(async (opts) => {
    try {
      const client = getClient(false);
      const result = await client.auth.authenticate({
        username: opts.username,
        password: opts.password,
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
      });

      if (opts.save && result.access_token) {
        setOAuthToken(result.access_token);
        success('Access token saved to profile');
      }

      print(result, getFormat(authCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const recordCmd = program.command('record').description('Generic module record operations');

recordCmd
  .command('list <module>')
  .description('List records in a module')
  .option('--fields <fields>', 'Comma-separated field list')
  .option('--order-by <order>', 'Sort order')
  .option('--max-num <n>', 'Maximum records', '20')
  .option('--offset <n>', 'Pagination offset', '0')
  .option('--filter <json>', 'Filter object as JSON')
  .action(async (module: string, opts) => {
    try {
      const client = getClient();
      const result = await client.modules.list(module, {
        fields: opts.fields?.split(','),
        orderBy: opts.orderBy,
        maxNum: parseInt(opts.maxNum, 10),
        offset: parseInt(opts.offset, 10),
        filter: opts.filter ? (parseJsonOption(opts.filter, 'filter') as Record<string, unknown>) : undefined,
      });
      print(result, getFormat(recordCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordCmd
  .command('get <module> <id>')
  .description('Get a record by ID')
  .option('--fields <fields>', 'Comma-separated field list')
  .action(async (module: string, id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.modules.get(module, id, {
        fields: opts.fields?.split(','),
      });
      print(result, getFormat(recordCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordCmd
  .command('create <module>')
  .description('Create a record')
  .requiredOption('--data <json>', 'Record data as JSON')
  .action(async (module: string, opts) => {
    try {
      const client = getClient();
      const result = await client.modules.create(
        module,
        parseJsonOption(opts.data, 'data') as Record<string, unknown>
      );
      success('Record created');
      print(result, getFormat(recordCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordCmd
  .command('update <module> <id>')
  .description('Update a record')
  .requiredOption('--data <json>', 'Record data as JSON')
  .action(async (module: string, id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.modules.update(
        module,
        id,
        parseJsonOption(opts.data, 'data') as Record<string, unknown>
      );
      success('Record updated');
      print(result, getFormat(recordCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordCmd
  .command('delete <module> <id>')
  .description('Delete a record')
  .action(async (module: string, id: string) => {
    try {
      const client = getClient();
      await client.modules.delete(module, id);
      success(`Record ${id} deleted from ${module}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordCmd
  .command('search <module> <query>')
  .description('Search records in a module')
  .option('--fields <fields>', 'Comma-separated field list')
  .option('--max-num <n>', 'Maximum records', '20')
  .option('--offset <n>', 'Pagination offset', '0')
  .action(async (module: string, query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.modules.search(module, {
        q: query,
        fields: opts.fields?.split(','),
        maxNum: parseInt(opts.maxNum, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(recordCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordCmd
  .command('filter <module>')
  .description('Filter records via POST /{module}/filter')
  .requiredOption('--filter <json>', 'Filter array as JSON')
  .option('--fields <fields>', 'Comma-separated field list')
  .option('--order-by <order>', 'Sort order')
  .option('--max-num <n>', 'Maximum records', '20')
  .option('--offset <n>', 'Pagination offset', '0')
  .action(async (module: string, opts) => {
    try {
      const client = getClient();
      const result = await client.modules.filter(module, {
        filter: parseJsonOption(opts.filter, 'filter') as Array<Record<string, unknown>>,
        fields: opts.fields?.split(','),
        orderBy: opts.orderBy,
        maxNum: parseInt(opts.maxNum, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(recordCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const relatedCmd = program.command('related').description('Related record link operations');

relatedCmd
  .command('list <module> <id> <link>')
  .description('List related records')
  .option('--fields <fields>', 'Comma-separated field list')
  .option('--max-num <n>', 'Maximum records', '20')
  .option('--offset <n>', 'Pagination offset', '0')
  .action(async (module: string, id: string, link: string, opts) => {
    try {
      const client = getClient();
      const result = await client.related.list(module, id, link, {
        fields: opts.fields?.split(','),
        maxNum: parseInt(opts.maxNum, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(relatedCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

relatedCmd
  .command('create <module> <id> <link>')
  .description('Create a related record link')
  .requiredOption('--data <json>', 'Related record data as JSON')
  .action(async (module: string, id: string, link: string, opts) => {
    try {
      const client = getClient();
      const result = await client.related.create(
        module,
        id,
        link,
        parseJsonOption(opts.data, 'data') as Record<string, unknown>
      );
      success('Related record created');
      print(result, getFormat(relatedCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

relatedCmd
  .command('unlink <module> <id> <link> <relatedId>')
  .description('Remove a related record link')
  .action(async (module: string, id: string, link: string, relatedId: string) => {
    try {
      const client = getClient();
      await client.related.unlink(module, id, link, relatedId);
      success('Related record unlinked');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const metadataCmd = program.command('metadata').description('Metadata operations');

metadataCmd
  .command('list')
  .description('Get global metadata')
  .option('--modules <modules>', 'Comma-separated module filter')
  .option('--type-filter <type>', 'Type filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.metadata.getMetadata({
        modules: opts.modules?.split(','),
        type_filter: opts.typeFilter,
      });
      print(result, getFormat(metadataCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metadataCmd
  .command('module <module>')
  .description('Get module metadata')
  .action(async (module: string) => {
    try {
      const client = getClient();
      const result = await client.metadata.getModuleMetadata(module);
      print(result, getFormat(metadataCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metadataCmd
  .command('enum <module> <field>')
  .description('Get enum options for a module field')
  .action(async (module: string, field: string) => {
    try {
      const client = getClient();
      const result = await client.metadata.getEnumOptions(module, field);
      print(result, getFormat(metadataCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const userCmd = program.command('user').description('User operations');

userCmd
  .command('me')
  .description('Get current authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.user.getCurrentUser();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('ping')
  .description('Ping the SugarCRM instance')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.user.ping();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Logout and invalidate OAuth token')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.auth.logout();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
