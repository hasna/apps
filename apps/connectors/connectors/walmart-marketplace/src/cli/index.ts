#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WalmartMarketplace } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getServiceName,
  setServiceName,
  getBaseUrl,
  setBaseUrl,
  getCorrelationId,
  setCorrelationId,
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

const CONNECTOR_NAME = 'connect-walmart-marketplace';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Walmart Marketplace connector - Items, inventory, and orders API')
  .version(VERSION)
  .option('-t, --access-token <token>', 'Access token (overrides config)')
  .option('-s, --service-name <name>', 'WM_SVC.NAME header value (overrides config)')
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
    if (opts.accessToken) {
      process.env.WALMART_ACCESS_TOKEN = opts.accessToken;
    }
    if (opts.serviceName) {
      process.env.WALMART_SERVICE_NAME = opts.serviceName;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WalmartMarketplace {
  const accessToken = getAccessToken();
  const serviceName = getServiceName();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set WALMART_ACCESS_TOKEN.`);
    process.exit(1);
  }
  if (!serviceName) {
    error(`No service name configured. Run "${CONNECTOR_NAME} config set-service-name <name>" or set WALMART_SERVICE_NAME.`);
    process.exit(1);
  }
  return new WalmartMarketplace({
    accessToken,
    serviceName,
    baseUrl: getBaseUrl(),
    correlationId: getCorrelationId(),
  });
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
  .option('--access-token <token>', 'Access token')
  .option('--service-name <name>', 'WM_SVC.NAME value')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      accessToken: opts.accessToken,
      serviceName: opts.serviceName,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Service Name: ${config.serviceName || chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <accessToken>')
  .description('Set access token')
  .action((accessToken: string) => {
    setAccessToken(accessToken);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-service-name <serviceName>')
  .description('Set WM_SVC.NAME header value')
  .action((serviceName: string) => {
    setServiceName(serviceName);
    success(`Service name saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
  .description('Set API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-correlation-id <correlationId>')
  .description('Set default WM_QOS.CORRELATION_ID (optional; auto-generated per request if unset)')
  .action((correlationId: string) => {
    setCorrelationId(correlationId);
    success(`Correlation ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const serviceName = getServiceName();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Service Name: ${serviceName || chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || 'https://marketplace.walmartapis.com/v3 (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const itemsCmd = program.command('items').description('Manage marketplace items');

itemsCmd
  .command('list')
  .description('List items')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--offset <number>', 'Pagination offset')
  .option('--sku <sku>', 'Filter by SKU')
  .option('--lifecycle-status <status>', 'Filter by lifecycle status')
  .option('--published-status <status>', 'Filter by published status')
  .option('--next-cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.items.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
        sku: opts.sku,
        lifecycleStatus: opts.lifecycleStatus,
        publishedStatus: opts.publishedStatus,
        nextCursor: opts.nextCursor,
      });
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('get <sku>')
  .description('Get item by SKU')
  .action(async (sku: string) => {
    try {
      const client = getClient();
      const result = await client.items.get(sku);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const inventoryCmd = program.command('inventory').description('Manage inventory');

inventoryCmd
  .command('list')
  .description('List inventory')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--offset <number>', 'Pagination offset')
  .option('--sku <sku>', 'Filter by SKU')
  .option('--ship-node <node>', 'Filter by ship node')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.inventory.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
        sku: opts.sku,
        shipNode: opts.shipNode,
      });
      print(result, getFormat(inventoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('get <sku>')
  .description('Get inventory for a SKU')
  .option('--ship-node <node>', 'Ship node filter')
  .action(async (sku: string, opts) => {
    try {
      const client = getClient();
      const result = await client.inventory.get(sku, opts.shipNode);
      print(result, getFormat(inventoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const ordersCmd = program.command('orders').description('Manage orders');

ordersCmd
  .command('list')
  .description('List orders')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--offset <number>', 'Pagination offset')
  .option('--created-start <date>', 'Created start date (ISO 8601)')
  .option('--created-end <date>', 'Created end date (ISO 8601)')
  .option('--ship-node-type <type>', 'SellerFulfilled, WFSFulfilled, or 3PLFulfilled')
  .option('--next-cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.orders.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
        createdStartDate: opts.createdStart,
        createdEndDate: opts.createdEnd,
        shipNodeType: opts.shipNodeType,
        nextCursor: opts.nextCursor,
      });
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('get <purchaseOrderId>')
  .description('Get order by purchase order ID')
  .action(async (purchaseOrderId: string) => {
    try {
      const client = getClient();
      const result = await client.orders.get(purchaseOrderId);
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
