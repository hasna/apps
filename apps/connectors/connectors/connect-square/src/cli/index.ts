#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Square, SquareClient } from '../api';
import {
  getAccessToken,
  setAccessToken,
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

const CONNECTOR_NAME = 'connect-square';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Square connector - Payments, orders, customers, and catalog API')
  .version(VERSION)
  .option('-k, --access-token <token>', 'Access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--sandbox', 'Use Square sandbox environment')
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
    // Set access token from flag if provided
    if (opts.accessToken) {
      process.env.SQUARE_ACCESS_TOKEN = opts.accessToken;
    }
    // Set sandbox URL if flag provided
    if (opts.sandbox) {
      process.env.SQUARE_BASE_URL = SquareClient.getSandboxUrl();
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Square {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set SQUARE_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Square({ accessToken, baseUrl });
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
  .option('--access-token <token>', 'Access token')
  .option('--sandbox', 'Use sandbox environment')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.accessToken,
      baseUrl: opts.sandbox ? SquareClient.getSandboxUrl() : undefined,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('production (default)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <accessToken>')
  .description('Set access token')
  .action((accessToken: string) => {
    setAccessToken(accessToken);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
  .description('Set base URL (use "sandbox" for sandbox environment)')
  .action((baseUrl: string) => {
    const url = baseUrl === 'sandbox' ? SquareClient.getSandboxUrl() : baseUrl;
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || 'production (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Location Commands
// ============================================
const locationCmd = program
  .command('location')
  .description('Manage Square locations');

locationCmd
  .command('list')
  .description('List all locations')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listLocations();
      print(result, getFormat(locationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

locationCmd
  .command('get <id>')
  .description('Get a location by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getLocation(id);
      print(result, getFormat(locationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Customer Commands
// ============================================
const customerCmd = program
  .command('customer')
  .description('Manage customers');

customerCmd
  .command('list')
  .description('List customers')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCustomers({
        limit: parseInt(opts.limit),
        cursor: opts.cursor,
      });
      print(result, getFormat(customerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customerCmd
  .command('get <id>')
  .description('Get a customer by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getCustomer(id);
      print(result, getFormat(customerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customerCmd
  .command('create')
  .description('Create a new customer')
  .option('--given-name <name>', 'First name')
  .option('--family-name <name>', 'Last name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--company <company>', 'Company name')
  .option('--note <note>', 'Note')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createCustomer({
        given_name: opts.givenName,
        family_name: opts.familyName,
        email_address: opts.email,
        phone_number: opts.phone,
        company_name: opts.company,
        note: opts.note,
      });
      success('Customer created!');
      print(result, getFormat(customerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customerCmd
  .command('delete <id>')
  .description('Delete a customer')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteCustomer(id);
      success(`Customer ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customerCmd
  .command('search')
  .description('Search customers')
  .option('--email <email>', 'Search by email')
  .option('--phone <phone>', 'Search by phone')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const filter: Record<string, { exact?: string }> = {};
      if (opts.email) filter.email_address = { exact: opts.email };
      if (opts.phone) filter.phone_number = { exact: opts.phone };

      const result = await client.searchCustomers({
        limit: parseInt(opts.limit),
        query: Object.keys(filter).length > 0 ? { filter } : undefined,
      });
      print(result, getFormat(customerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payment Commands
// ============================================
const paymentCmd = program
  .command('payment')
  .description('Manage payments');

paymentCmd
  .command('list')
  .description('List payments')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--location <id>', 'Filter by location ID')
  .option('--begin <date>', 'Start date (ISO 8601)')
  .option('--end <date>', 'End date (ISO 8601)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPayments({
        limit: parseInt(opts.limit),
        location_id: opts.location,
        begin_time: opts.begin,
        end_time: opts.end,
        cursor: opts.cursor,
      });
      print(result, getFormat(paymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentCmd
  .command('get <id>')
  .description('Get a payment by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getPayment(id);
      print(result, getFormat(paymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentCmd
  .command('cancel <id>')
  .description('Cancel a payment')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.cancelPayment(id);
      success('Payment cancelled!');
      print(result, getFormat(paymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentCmd
  .command('complete <id>')
  .description('Complete a payment')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.completePayment(id);
      success('Payment completed!');
      print(result, getFormat(paymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Order Commands
// ============================================
const orderCmd = program
  .command('order')
  .description('Manage orders');

orderCmd
  .command('get <id>')
  .description('Get an order by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getOrder(id);
      print(result, getFormat(orderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orderCmd
  .command('search')
  .description('Search orders')
  .requiredOption('--location <ids>', 'Location IDs (comma-separated)')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--state <states>', 'Filter by states (comma-separated: OPEN,COMPLETED,CANCELED,DRAFT)')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const locationIds = opts.location.split(',').map((s: string) => s.trim());

      const query: {
        filter?: {
          state_filter?: { states: string[] };
          customer_filter?: { customer_ids: string[] };
        };
      } = {};

      if (opts.state) {
        query.filter = query.filter || {};
        query.filter.state_filter = { states: opts.state.split(',').map((s: string) => s.trim()) };
      }
      if (opts.customer) {
        query.filter = query.filter || {};
        query.filter.customer_filter = { customer_ids: [opts.customer] };
      }

      const result = await client.searchOrders({
        location_ids: locationIds,
        limit: parseInt(opts.limit),
        query: Object.keys(query).length > 0 ? query : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(orderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Catalog Commands
// ============================================
const catalogCmd = program
  .command('catalog')
  .description('Manage catalog');

catalogCmd
  .command('list')
  .description('List catalog objects')
  .option('--types <types>', 'Object types (comma-separated: ITEM,CATEGORY,TAX,DISCOUNT,MODIFIER_LIST)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCatalog({
        types: opts.types,
        cursor: opts.cursor,
      });
      print(result, getFormat(catalogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogCmd
  .command('get <id>')
  .description('Get a catalog object by ID')
  .option('--include-related', 'Include related objects')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getCatalogObject(id, {
        include_related_objects: opts.includeRelated,
      });
      print(result, getFormat(catalogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogCmd
  .command('search')
  .description('Search catalog')
  .option('--text <keywords>', 'Search by keywords')
  .option('--types <types>', 'Object types (comma-separated)')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query: { text_query?: { keywords: string[] } } = {};

      if (opts.text) {
        query.text_query = { keywords: opts.text.split(' ') };
      }

      const result = await client.searchCatalog({
        object_types: opts.types ? opts.types.split(',').map((s: string) => s.trim()) : undefined,
        limit: parseInt(opts.limit),
        query: Object.keys(query).length > 0 ? query : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(catalogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

catalogCmd
  .command('delete <id>')
  .description('Delete a catalog object')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.deleteCatalogObject(id);
      success('Catalog object deleted!');
      print(result, getFormat(catalogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
