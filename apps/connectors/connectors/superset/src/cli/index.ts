#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Superset } from '../api';
import { SupersetApiError } from '../types';
import type { ListFilter, ListOptions, OrderDirection } from '../types';
import {
  getBaseUrl,
  setBaseUrl,
  getUsername,
  setUsername,
  getPassword,
  setPassword,
  getProvider,
  setProvider,
  getAccessToken,
  getRefreshToken,
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

const CONNECTOR_NAME = 'connect-superset';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Apache Superset connector CLI - Dashboards, Charts, Datasets, Databases, Saved Queries')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
  let c: Command | null = cmd;
  while (c) {
    const fmt = c.opts().format;
    if (fmt) return fmt as OutputFormat;
    c = c.parent;
  }
  return 'pretty';
}

function getClient(): Superset {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    error(`No Superset base URL configured. Run "${CONNECTOR_NAME} config set-url <url>" or set SUPERSET_BASE_URL.`);
    process.exit(1);
  }

  const username = getUsername();
  const password = getPassword();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  if (!accessToken && !refreshToken && (!username || !password)) {
    error(`Not authenticated. Run "${CONNECTOR_NAME} auth login" or set credentials.`);
    process.exit(1);
  }

  return new Superset({
    baseUrl,
    username,
    password,
    provider: getProvider(),
    accessToken,
    refreshToken,
  });
}

function handleError(err: unknown): never {
  if (err instanceof SupersetApiError) {
    error(`${err.message} (HTTP ${err.statusCode})`);
  } else if (err instanceof Error) {
    error(err.message);
  } else {
    error(String(err));
  }
  process.exit(1);
}

/** Parse --filter "col:opr:value" strings into ListFilter clauses. */
function parseFilters(values: string[] | undefined): ListFilter[] {
  if (!values || values.length === 0) return [];
  return values.map((raw) => {
    const firstColon = raw.indexOf(':');
    const secondColon = raw.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) {
      throw new Error(`Invalid filter "${raw}". Expected format: col:opr:value`);
    }
    const col = raw.slice(0, firstColon);
    const opr = raw.slice(firstColon + 1, secondColon);
    const value = raw.slice(secondColon + 1);
    return { col, opr, value };
  });
}

function buildListOptions(opts: Record<string, unknown>): ListOptions {
  const options: ListOptions = {};
  if (opts.page !== undefined) options.page = Number(opts.page);
  if (opts.pageSize !== undefined) options.pageSize = Number(opts.pageSize);
  if (opts.orderColumn) options.orderColumn = String(opts.orderColumn);
  if (opts.orderDirection) options.orderDirection = String(opts.orderDirection) as OrderDirection;
  if (opts.columns) options.columns = String(opts.columns).split(',').map((c) => c.trim());
  const filters = parseFilters(opts.filter as string[] | undefined);
  if (filters.length > 0) options.filters = filters;
  return options;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('login')
  .description('Authenticate with Superset (username/password) and store tokens')
  .option('--base-url <url>', 'Superset base URL')
  .option('--username <username>', 'Superset username')
  .option('--password <password>', 'Superset password')
  .option('--provider <provider>', 'Auth provider (db or ldap)')
  .action(async (opts) => {
    try {
      if (opts.baseUrl) setBaseUrl(opts.baseUrl);
      if (opts.username) setUsername(opts.username);
      if (opts.password) setPassword(opts.password);
      if (opts.provider) setProvider(opts.provider);

      const baseUrl = getBaseUrl();
      if (!baseUrl) {
        error(`Base URL required. Provide --base-url or run "${CONNECTOR_NAME} config set-url <url>".`);
        process.exit(1);
      }
      const username = getUsername();
      const password = getPassword();
      if (!username || !password) {
        error('Username and password required. Provide --username and --password.');
        process.exit(1);
      }

      const superset = new Superset({ baseUrl, username, password, provider: getProvider() });
      await superset.login();
      const me = await superset.me();
      success(`Authenticated to ${baseUrl}${me.username ? ` as ${me.username}` : ''}`);
    } catch (err) {
      handleError(err);
    }
  });

authCmd
  .command('status')
  .description('Show authentication status')
  .action(() => {
    const baseUrl = getBaseUrl();
    const profile = getCurrentProfile();
    const hasToken = Boolean(getAccessToken() || getRefreshToken());
    const hasCreds = Boolean(getUsername() && getPassword());
    info(`Profile:  ${profile}`);
    info(`Base URL: ${baseUrl || chalk.gray('(not set)')}`);
    info(`Tokens:   ${hasToken ? chalk.green('present') : chalk.gray('none')}`);
    info(`Login:    ${hasCreds ? chalk.green('credentials set') : chalk.gray('none')}`);
  });

authCmd
  .command('whoami')
  .description('Show the currently authenticated Superset user')
  .action(async (_opts, cmd: Command) => {
    try {
      const me = await getClient().me();
      print(me, getFormat(cmd));
    } catch (err) {
      handleError(err);
    }
  });

authCmd
  .command('logout')
  .description('Clear stored credentials for the current profile')
  .action(() => {
    clearConfig();
    success('Cleared credentials for the current profile');
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Configuration management');

configCmd
  .command('set-url <url>')
  .description('Set the Superset base URL for the current profile')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL set to ${getBaseUrl()}`);
  });

configCmd
  .command('show')
  .description('Show non-sensitive configuration for the current profile')
  .action((_opts, cmd: Command) => {
    const cfg = loadProfile();
    print(
      {
        profile: getCurrentProfile(),
        baseUrl: cfg.baseUrl,
        username: cfg.username,
        provider: cfg.provider || 'db',
        hasAccessToken: Boolean(cfg.accessToken),
        hasRefreshToken: Boolean(cfg.refreshToken),
        configDir: getConfigDir(),
      },
      getFormat(cmd)
    );
  });

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Profile management');

profileCmd
  .command('list')
  .description('List available profiles')
  .action(() => {
    const current = getCurrentProfile();
    const profiles = listProfiles();
    if (profiles.length === 0) {
      info('No profiles found (using "default")');
      return;
    }
    for (const p of profiles) {
      console.log(p === current ? chalk.green(`* ${p}`) : `  ${p}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch the active profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      success(`Switched to profile "${name}"`);
    } catch (err) {
      handleError(err);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      if (createProfile(name)) {
        success(`Created profile "${name}"`);
      } else {
        error(`Profile "${name}" already exists`);
        process.exit(1);
      }
    } catch (err) {
      handleError(err);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (deleteProfile(name)) {
      success(`Deleted profile "${name}"`);
    } else {
      error(`Could not delete profile "${name}" (does not exist or is "default")`);
      process.exit(1);
    }
  });

profileCmd
  .command('show')
  .description('Show the current profile name')
  .action(() => {
    info(`Current profile: ${getCurrentProfile()}`);
  });

// ============================================
// Resource Commands (list/get)
// ============================================
interface ResourceSpec {
  command: string;
  description: string;
  key: 'dashboards' | 'charts' | 'datasets' | 'databases' | 'savedQueries' | 'queries';
}

const RESOURCES: ResourceSpec[] = [
  { command: 'dashboard', description: 'Superset dashboards', key: 'dashboards' },
  { command: 'chart', description: 'Superset charts', key: 'charts' },
  { command: 'dataset', description: 'Superset datasets', key: 'datasets' },
  { command: 'database', description: 'Superset database connections', key: 'databases' },
  { command: 'saved-query', description: 'SQL Lab saved queries', key: 'savedQueries' },
  { command: 'query', description: 'SQL Lab query records', key: 'queries' },
];

for (const resource of RESOURCES) {
  const cmd = program.command(resource.command).description(`Manage ${resource.description}`);

  cmd
    .command('list')
    .description(`List ${resource.description}`)
    .option('--page <n>', 'Zero-based page index')
    .option('--page-size <n>', 'Rows per page')
    .option('--order-column <col>', 'Column to order by')
    .option('--order-direction <dir>', 'Order direction (asc or desc)')
    .option('--columns <cols>', 'Comma-separated list of columns to return')
    .option('--filter <col:opr:value>', 'Filter clause (repeatable)', collect, [])
    .action(async (opts, actionCmd: Command) => {
      try {
        const superset = getClient();
        const options = buildListOptions(opts);
        const result = await superset[resource.key].list(options);
        print({ count: result.count, result: result.result }, getFormat(actionCmd));
      } catch (err) {
        handleError(err);
      }
    });

  cmd
    .command('get <id>')
    .description(`Get a single ${resource.command} by id`)
    .action(async (id: string, _opts, actionCmd: Command) => {
      try {
        const superset = getClient();
        const item = await superset[resource.key].get(id);
        print(item, getFormat(actionCmd));
      } catch (err) {
        handleError(err);
      }
    });
}

program.parseAsync(process.argv).catch(handleError);
