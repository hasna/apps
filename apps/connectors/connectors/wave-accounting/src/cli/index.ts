#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WaveAccounting } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getBusinessId,
  setBusinessId,
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
  setOAuthConfig,
  saveOAuthTokens,
  clearOAuthTokens,
} from '../utils/config';
import {
  getAuthUrl,
  startCallbackServer,
  getValidAccessToken,
  isAuthenticated,
  getRedirectUri,
  getDefaultScopes,
} from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import type { InvoiceCreateInput } from '../types';

const CONNECTOR_NAME = 'connect-wave-accounting';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wave Accounting connector CLI - businesses, invoices, customers, and accounts')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-b, --business-id <id>', 'Business ID (overrides profile default)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
    if (opts.token) {
      process.env.WAVE_ACCESS_TOKEN = opts.token;
    }
    if (opts.businessId) {
      process.env.WAVE_BUSINESS_ID = opts.businessId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

async function resolveAccessToken(): Promise<string> {
  const envToken = getAccessToken();
  if (envToken) {
    return envToken;
  }

  if (isAuthenticated()) {
    return getValidAccessToken();
  }

  throw new Error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or "${CONNECTOR_NAME} auth login".`);
}

async function getClient(): Promise<WaveAccounting> {
  const accessToken = await resolveAccessToken();
  return new WaveAccounting({ accessToken });
}

function requireBusinessId(cmd: Command): string {
  const businessId = getBusinessId();
  if (!businessId) {
    error(`Business ID required. Use --business-id or run "${CONNECTOR_NAME} config set-business-id <id>".`);
    process.exit(1);
  }
  return businessId;
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
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

profileCmd.command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'Access token')
  .option('--business-id <id>', 'Default business ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      accessToken: opts.token,
      businessId: opts.businessId,
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
  info(`Access token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Business ID: ${config.businessId || chalk.gray('not set')}`);
  info(`OAuth client: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage connector configuration');

configCmd.command('show').description('Show current configuration').action(() => {
  const profile = getCurrentProfile();
  const config = loadProfile();
  console.log(chalk.bold(`Active profile: ${profile}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Access token: ${config.accessToken ? 'configured' : chalk.gray('not set')}`);
  info(`Business ID: ${config.businessId || chalk.gray('not set')}`);
  info(`OAuth client: ${config.clientId ? 'configured' : chalk.gray('not set')}`);
});

configCmd.command('set-token <token>').description('Set access token for current profile').action((token: string) => {
  setAccessToken(token);
  success('Access token saved');
});

configCmd.command('set-business-id <id>').description('Set default business ID').action((id: string) => {
  setBusinessId(id);
  success('Business ID saved');
});

configCmd.command('set-credentials')
  .description('Set OAuth client credentials')
  .requiredOption('--client-id <id>', 'OAuth client ID')
  .requiredOption('--client-secret <secret>', 'OAuth client secret')
  .action((opts) => {
    setOAuthConfig({ clientId: opts.clientId, clientSecret: opts.clientSecret });
    success('OAuth credentials saved');
  });

configCmd.command('clear').description('Clear profile configuration').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// Auth commands
const authCmd = program.command('auth').description('OAuth2 authentication');

authCmd.command('login')
  .description('Start OAuth login flow')
  .option('--scopes <scopes>', 'OAuth scopes (space-delimited)')
  .option('--business-id <id>', 'Recommended business ID for authorization')
  .action(async (opts) => {
    try {
      const authUrl = getAuthUrl({
        scopes: opts.scopes || getDefaultScopes(),
        businessId: opts.businessId,
      });
      info(`Open this URL in your browser:\n${authUrl}`);
      info(`Redirect URI: ${getRedirectUri()}`);
      info('Waiting for callback...');
      const result = await startCallbackServer();
      if (result.success && result.tokens) {
        saveOAuthTokens(result.tokens);
        success('Authentication successful');
        if (result.tokens.businessId) {
          setBusinessId(result.tokens.businessId);
          info(`Business ID saved: ${result.tokens.businessId}`);
        }
      } else {
        error(result.error || 'Authentication failed');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd.command('logout').description('Clear OAuth tokens').action(() => {
  clearOAuthTokens();
  success('Logged out');
});

authCmd.command('status').description('Show authentication status').action(() => {
  info(`Authenticated: ${isAuthenticated() ? chalk.green('yes') : chalk.red('no')}`);
});

// Business commands
const businessCmd = program.command('businesses').description('Business operations');

businessCmd.command('list')
  .description('List businesses')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '25')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const result = await client.listBusinesses({
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(businessCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

businessCmd.command('get [id]').description('Get a business by ID').action(async (id?: string) => {
  try {
    const client = await getClient();
    const result = await client.getBusiness(id);
    print(result, getFormat(businessCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Customer commands
const customerCmd = program.command('customers').description('Customer operations');

customerCmd.command('list')
  .description('List customers')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '25')
  .option('--email <email>', 'Filter by email')
  .action(async (opts) => {
    try {
      const businessId = requireBusinessId(customerCmd);
      const client = await getClient();
      const result = await client.listCustomers(businessId, {
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
        email: opts.email,
      });
      print(result, getFormat(customerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customerCmd.command('get <id>').description('Get a customer by ID').action(async (id: string) => {
  try {
    const businessId = requireBusinessId(customerCmd);
    const client = await getClient();
    const result = await client.getCustomer(businessId, id);
    print(result, getFormat(customerCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Invoice commands
const invoiceCmd = program.command('invoices').description('Invoice operations');

invoiceCmd.command('list')
  .description('List invoices')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '25')
  .option('--status <status>', 'Filter by status')
  .option('--customer-id <id>', 'Filter by customer ID')
  .action(async (opts) => {
    try {
      const businessId = requireBusinessId(invoiceCmd);
      const client = await getClient();
      const result = await client.listInvoices(businessId, {
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
        status: opts.status,
        customerId: opts.customerId,
      });
      print(result, getFormat(invoiceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceCmd.command('get <id>').description('Get an invoice by ID').action(async (id: string) => {
  try {
    const businessId = requireBusinessId(invoiceCmd);
    const client = await getClient();
    const result = await client.getInvoice(businessId, id);
    print(result, getFormat(invoiceCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

invoiceCmd.command('create')
  .description('Create an invoice')
  .requiredOption('--customer-id <id>', 'Customer ID')
  .option('--status <status>', 'Invoice status (DRAFT or SAVED)', 'DRAFT')
  .option('--title <title>', 'Invoice title')
  .option('--product-id <id>', 'Line item product ID')
  .option('--quantity <qty>', 'Line item quantity', '1')
  .option('--unit-price <price>', 'Line item unit price')
  .action(async (opts) => {
    try {
      const businessId = requireBusinessId(invoiceCmd);
      const client = await getClient();
      const input: InvoiceCreateInput = {
        businessId,
        customerId: opts.customerId,
        status: opts.status,
        title: opts.title,
      };
      if (opts.productId) {
        input.items = [{
          productId: opts.productId,
          quantity: opts.quantity,
          unitPrice: opts.unitPrice,
        }];
      }
      const result = await client.createInvoice(input);
      success('Invoice created');
      print(result, getFormat(invoiceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Account commands
const accountCmd = program.command('accounts').description('Chart of accounts operations');

accountCmd.command('list')
  .description('List accounts')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '25')
  .action(async (opts) => {
    try {
      const businessId = requireBusinessId(accountCmd);
      const client = await getClient();
      const result = await client.listAccounts(businessId, {
        page: parseInt(opts.page, 10),
        pageSize: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw GraphQL escape hatch
program.command('graphql')
  .description('Execute a raw GraphQL query or mutation')
  .requiredOption('-q, --query <query>', 'GraphQL query or mutation')
  .option('-v, --variables <json>', 'JSON variables object')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const variables = opts.variables ? JSON.parse(opts.variables) as Record<string, unknown> : undefined;
      const result = await client.graphql(opts.query, variables);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
