#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoInventory } from '../api';
import {
  getToken,
  setToken,
  getOrganizationId,
  setOrganizationId,
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

const CONNECTOR_NAME = 'connect-zoho-inventory';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Inventory connector CLI — contacts, items, orders, and invoices')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides profile)')
  .option('-o, --org-id <id>', 'Organization ID (overrides profile)')
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
    if (opts.token) process.env.ZOHOINVENTORY_TOKEN = opts.token;
    if (opts.orgId) process.env.ZOHOINVENTORY_ORG_ID = opts.orgId;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoInventory {
  const token = getToken();
  const organizationId = getOrganizationId();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOINVENTORY_TOKEN.`);
    process.exit(1);
  }
  if (!organizationId) {
    error(`No organization ID configured. Run "${CONNECTOR_NAME} config set-org-id <id>" or set ZOHOINVENTORY_ORG_ID.`);
    process.exit(1);
  }
  return new ZohoInventory({ token, organizationId, baseUrl: getBaseUrl() });
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
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'OAuth access token')
  .option('--org-id <id>', 'Organization ID')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { token: opts.token, organizationId: opts.orgId, baseUrl: opts.baseUrl });
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
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Organization ID: ${config.organizationId || chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set OAuth access token').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-org-id <id>').description('Set organization ID').action((id: string) => {
  setOrganizationId(id);
  success(`Organization ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const token = getToken();
  const organizationId = getOrganizationId();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Organization ID: ${organizationId || chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const contactsCmd = program.command('contacts').description('Contact operations');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('--page <page>', 'Page number', parseInt)
  .option('--per-page <count>', 'Results per page', parseInt)
  .option('--contact-type <type>', 'Contact type filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        page: opts.page,
        per_page: opts.perPage,
        contact_type: opts.contactType,
      });
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const itemsCmd = program.command('items').description('Item operations');

itemsCmd
  .command('list')
  .description('List items')
  .option('--page <page>', 'Page number', parseInt)
  .option('--per-page <count>', 'Results per page', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listItems({ page: opts.page, per_page: opts.perPage });
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd.command('get <itemId>').description('Get item by ID').action(async (itemId: string) => {
  try {
    const client = getClient();
    const result = await client.getItem(itemId);
    print(result, getFormat(itemsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const salesOrdersCmd = program.command('salesorders').description('Sales order operations');

salesOrdersCmd
  .command('list')
  .description('List sales orders')
  .option('--page <page>', 'Page number', parseInt)
  .option('--per-page <count>', 'Results per page', parseInt)
  .option('--status <status>', 'Status filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSalesOrders({
        page: opts.page,
        per_page: opts.perPage,
        status: opts.status,
      });
      print(result, getFormat(salesOrdersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const purchaseOrdersCmd = program.command('purchaseorders').description('Purchase order operations');

purchaseOrdersCmd
  .command('list')
  .description('List purchase orders')
  .option('--page <page>', 'Page number', parseInt)
  .option('--per-page <count>', 'Results per page', parseInt)
  .option('--status <status>', 'Status filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPurchaseOrders({
        page: opts.page,
        per_page: opts.perPage,
        status: opts.status,
      });
      print(result, getFormat(purchaseOrdersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const invoicesCmd = program.command('invoices').description('Invoice operations');

invoicesCmd
  .command('list')
  .description('List invoices')
  .option('--page <page>', 'Page number', parseInt)
  .option('--per-page <count>', 'Results per page', parseInt)
  .option('--status <status>', 'Status filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listInvoices({
        page: opts.page,
        per_page: opts.perPage,
        status: opts.status,
      });
      print(result, getFormat(invoicesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw <path>')
  .description('Make a raw API request')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('--page <page>', 'Query param: page', parseInt)
  .option('--per-page <count>', 'Query param: per_page', parseInt)
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, number | undefined> = {};
      if (opts.page !== undefined) params.page = opts.page;
      if (opts.perPage !== undefined) params.per_page = opts.perPage;
      const result = await client.getClient().rawRequest(path, {
        method: opts.method,
        params,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
