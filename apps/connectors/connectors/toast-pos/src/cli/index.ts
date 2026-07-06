#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ToastPos } from '../api';
import {
  getClientId,
  getClientSecret,
  getRestaurantExternalId,
  getBaseUrl,
  setCredentials,
  setRestaurantExternalId,
  setBaseUrl,
  clearAuthToken,
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

const CONNECTOR_NAME = 'connect-toast-pos';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Toast POS connector - Restaurant, menu, and order APIs')
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

function getClient(): ToastPos {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const restaurantExternalId = getRestaurantExternalId();
  const baseUrl = getBaseUrl();

  if (!clientId || !clientSecret) {
    error(`No API credentials configured. Run "${CONNECTOR_NAME} config set-credentials <clientId> <clientSecret>"`);
    process.exit(1);
  }

  if (!restaurantExternalId) {
    error(`No restaurant external ID configured. Run "${CONNECTOR_NAME} config set-restaurant <guid>"`);
    process.exit(1);
  }

  return new ToastPos({ clientId, clientSecret, restaurantExternalId, baseUrl });
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
  profiles.forEach((p) => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--client-id <id>', 'Toast client ID')
  .option('--client-secret <secret>', 'Toast client secret')
  .option('--restaurant <guid>', 'Restaurant external ID')
  .option('--base-url <url>', 'Toast API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      restaurantExternalId: opts.restaurant,
      baseUrl: opts.baseUrl,
    });
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
  info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Client Secret: ${config.clientSecret ? '********' : chalk.gray('not set')}`);
  info(`Restaurant ID: ${config.restaurantExternalId || chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default (ws-api.toasttab.com)')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-credentials <clientId> <clientSecret>')
  .description('Set Toast API client credentials')
  .option('--restaurant <guid>', 'Restaurant external ID')
  .action((clientId: string, clientSecret: string, opts) => {
    setCredentials(clientId, clientSecret, opts.restaurant);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-restaurant <guid>')
  .description('Set restaurant external ID (Toast-Restaurant-External-ID)')
  .action((guid: string) => {
    setRestaurantExternalId(guid);
    success(`Restaurant external ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('set-url <baseUrl>').description('Set Toast API base URL').action((baseUrl: string) => {
  setBaseUrl(baseUrl);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const restaurantExternalId = getRestaurantExternalId();
  const baseUrl = getBaseUrl();

  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Client Secret: ${clientSecret ? '********' : chalk.gray('not set')}`);
  info(`Restaurant ID: ${restaurantExternalId || chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || 'default (ws-api.toasttab.com)'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const authCmd = program.command('auth').description('Authentication commands');

authCmd.command('login').description('Authenticate with Toast machine client credentials').action(async () => {
  try {
    const client = getClient();
    await client.authenticate();
    success('Authenticated successfully');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

authCmd.command('clear-token').description('Clear cached access token').action(() => {
  clearAuthToken();
  success('Cached token cleared');
});

const restaurantCmd = program.command('restaurant').description('Restaurant configuration API');

restaurantCmd
  .command('get <guid>')
  .description('Get restaurant configuration')
  .option('--include-archived', 'Include archived restaurants')
  .action(async (guid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getRestaurant(guid, { includeArchived: opts.includeArchived });
      print(result, getFormat(restaurantCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

restaurantCmd
  .command('list <managementGroupGuid>')
  .description('List restaurants in a management group')
  .action(async (managementGroupGuid: string) => {
    try {
      const client = getClient();
      const result = await client.listRestaurantsInGroup(managementGroupGuid);
      print(result, getFormat(restaurantCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const menuCmd = program.command('menu').description('Menu API');

menuCmd.command('list').description('Get menus for the configured restaurant').action(async () => {
  try {
    const client = getClient();
    const result = await client.getMenus();
    print(result, getFormat(menuCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const orderCmd = program.command('order').description('Orders API');

orderCmd.command('get <guid>').description('Get an order by GUID').action(async (guid: string) => {
  try {
    const client = getClient();
    const result = await client.getOrder(guid);
    print(result, getFormat(orderCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orderCmd
  .command('list')
  .description('List orders in bulk')
  .option('--start <date>', 'Start date (ISO 8601)')
  .option('--end <date>', 'End date (ISO 8601)')
  .option('--business-date <date>', 'Business date filter')
  .option('--page-size <size>', 'Page size', '100')
  .option('--page-token <token>', 'Pagination token')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listOrdersBulk({
        startDate: opts.start,
        endDate: opts.end,
        businessDate: opts.businessDate,
        pageSize: parseInt(opts.pageSize, 10),
        pageToken: opts.pageToken,
      });
      print(result, getFormat(orderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Raw API request escape hatch');

rawCmd
  .command('request <method> <path>')
  .description('Make a raw authenticated request')
  .option('--restaurant <guid>', 'Override restaurant external ID header')
  .option('--body <json>', 'JSON request body')
  .action(async (method: string, path: string, opts) => {
    const upperMethod = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(upperMethod)) {
      error('Method must be GET, POST, PUT, DELETE, or PATCH');
      process.exit(1);
    }

    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest(upperMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', path, {
        body,
        restaurantExternalId: opts.restaurant,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
