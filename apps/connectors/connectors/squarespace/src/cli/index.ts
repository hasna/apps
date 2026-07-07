#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Squarespace } from '../api';
import {
  getApiKey,
  setApiKey,
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

const CONNECTOR_NAME = 'connect-squarespace';
const VERSION = '0.1.0';

const program = new Command();
let apiKeyOverride: string | undefined;

program
  .name(CONNECTOR_NAME)
  .description('Squarespace Commerce API connector - Products, Orders, Inventory, Transactions, Profiles, Store Pages, Webhooks')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      apiKeyOverride = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Squarespace {
  const apiKey = apiKeyOverride || getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SQUARESPACE_API_KEY.`);
    process.exit(1);
  }
  return new Squarespace({ apiKey });
}

function parseJson(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`));
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

// Config commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear active profile config').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Inventory
const inventoryCmd = program.command('inventory').description('Inventory operations');

inventoryCmd
  .command('list')
  .description('List inventory')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async function (this: Command, opts: { cursor?: string }) {
    const result = await getClient().inventory.list({ cursor: opts.cursor });
    print(result.inventory ?? result, getFormat(this));
  });

inventoryCmd
  .command('get <variantIds...>')
  .description('Get inventory by variant IDs')
  .action(async function (this: Command, variantIds: string[]) {
    const result = await getClient().inventory.get(variantIds);
    print(result.inventory ?? result, getFormat(this));
  });

inventoryCmd
  .command('adjust')
  .description('Adjust inventory')
  .requiredOption('--data <json>', 'Adjustment JSON body')
  .requiredOption('--idempotency-key <key>', 'Idempotency key')
  .action(async function (this: Command, opts: { data: string; idempotencyKey: string }) {
    const result = await getClient().inventory.adjust(parseJson(opts.data, '--data'), opts.idempotencyKey);
    print(result, getFormat(this));
  });

// Orders
const ordersCmd = program.command('orders').description('Order operations');

ordersCmd
  .command('list')
  .description('List orders')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--modified-after <date>', 'Filter modified after')
  .option('--modified-before <date>', 'Filter modified before')
  .option('--fulfillment-status <status>', 'Filter by fulfillment status')
  .action(async function (this: Command, opts: { cursor?: string; modifiedAfter?: string; modifiedBefore?: string; fulfillmentStatus?: string }) {
    const result = await getClient().orders.list({
      cursor: opts.cursor,
      modifiedAfter: opts.modifiedAfter,
      modifiedBefore: opts.modifiedBefore,
      fulfillmentStatus: opts.fulfillmentStatus,
    });
    print(result.result ?? result, getFormat(this));
  });

ordersCmd.command('get <id>').description('Get order').action(async function (this: Command, id: string) {
  print(await getClient().orders.get(id), getFormat(this));
});

ordersCmd
  .command('create')
  .description('Create order')
  .requiredOption('--data <json>', 'Order JSON body')
  .requiredOption('--idempotency-key <key>', 'Idempotency key')
  .action(async function (this: Command, opts: { data: string; idempotencyKey: string }) {
    print(await getClient().orders.create(parseJson(opts.data, '--data'), opts.idempotencyKey), getFormat(this));
  });

ordersCmd
  .command('fulfill <id>')
  .description('Fulfill order')
  .option('--data <json>', 'Fulfillment JSON body', '{}')
  .action(async function (this: Command, id: string, opts: { data: string }) {
    print(await getClient().orders.fulfill(id, parseJson(opts.data, '--data')), getFormat(this));
  });

// Products
const productsCmd = program.command('products').description('Product operations');

productsCmd
  .command('list')
  .description('List products')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--query <query>', 'Search query')
  .option('--type <type>', 'Product type filter; repeat as comma-separated values')
  .option('--modified-after <date>', 'Modified after')
  .option('--modified-before <date>', 'Modified before')
  .action(async function (this: Command, opts: { cursor?: string; query?: string; type?: string; modifiedAfter?: string; modifiedBefore?: string }) {
    const result = await getClient().products.list({
      cursor: opts.cursor,
      query: opts.query,
      type: opts.type ? opts.type.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      modifiedAfter: opts.modifiedAfter,
      modifiedBefore: opts.modifiedBefore,
    });
    print(result.products ?? result, getFormat(this));
  });

productsCmd.command('get <productIds...>').description('Get products by IDs').action(async function (this: Command, productIds: string[]) {
  const result = await getClient().products.get(productIds);
  print(result.products ?? result, getFormat(this));
});

productsCmd
  .command('create')
  .description('Create product')
  .requiredOption('--data <json>', 'Product JSON body')
  .action(async function (this: Command, opts: { data: string }) {
    print(await getClient().products.create(parseJson(opts.data, '--data')), getFormat(this));
  });

productsCmd
  .command('update <id>')
  .description('Update product')
  .requiredOption('--data <json>', 'Product patch JSON')
  .action(async function (this: Command, id: string, opts: { data: string }) {
    print(await getClient().products.update(id, parseJson(opts.data, '--data')), getFormat(this));
  });

productsCmd.command('delete <id>').description('Delete product').action(async (id: string) => {
  await getClient().products.delete(id);
  success(`Product ${id} deleted`);
});

productsCmd
  .command('variant-create <productId>')
  .description('Create product variant')
  .requiredOption('--data <json>', 'Variant JSON body')
  .action(async function (this: Command, productId: string, opts: { data: string }) {
    print(await getClient().products.createVariant(productId, parseJson(opts.data, '--data')), getFormat(this));
  });

productsCmd
  .command('variant-update <productId> <variantId>')
  .description('Update product variant')
  .requiredOption('--data <json>', 'Variant patch JSON')
  .action(async function (this: Command, productId: string, variantId: string, opts: { data: string }) {
    print(await getClient().products.updateVariant(productId, variantId, parseJson(opts.data, '--data')), getFormat(this));
  });

productsCmd
  .command('variant-delete <productId> <variantId>')
  .description('Delete product variant')
  .action(async (productId: string, variantId: string) => {
    await getClient().products.deleteVariant(productId, variantId);
    success(`Variant ${variantId} deleted`);
  });

productsCmd
  .command('associate-variant-image <productId> <variantId>')
  .description('Associate image with product variant')
  .requiredOption('--image-id <id>', 'Image ID')
  .action(async function (this: Command, productId: string, variantId: string, opts: { imageId: string }) {
    print(await getClient().products.associateVariantImage(productId, variantId, opts.imageId), getFormat(this));
  });

// Transactions
const transactionsCmd = program.command('transactions').description('Transaction operations');

transactionsCmd
  .command('list')
  .description('List transactions')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--modified-after <date>', 'Modified after')
  .option('--modified-before <date>', 'Modified before')
  .action(async function (this: Command, opts: { cursor?: string; modifiedAfter?: string; modifiedBefore?: string }) {
    const result = await getClient().transactions.list({
      cursor: opts.cursor,
      modifiedAfter: opts.modifiedAfter,
      modifiedBefore: opts.modifiedBefore,
    });
    print(result.documents ?? result, getFormat(this));
  });

transactionsCmd
  .command('get <id...>')
  .description('Get one or more transactions')
  .action(async function (this: Command, ids: string[]) {
    const result = await getClient().transactions.get(ids);
    print(result.documents ?? result, getFormat(this));
  });

// Profiles
const profilesCmd = program.command('profiles').description('Customer profile operations');

profilesCmd
  .command('list')
  .description('List profiles')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--filter <filter>', 'Filter expression')
  .option('--sort-direction <dir>', 'Sort direction (asc|dsc)')
  .option('--sort-field <field>', 'Sort field')
  .action(async function (this: Command, opts: { cursor?: string; filter?: string; sortDirection?: string; sortField?: string }) {
    let sortDirection: 'asc' | 'dsc' | undefined;
    if (opts.sortDirection) {
      if (opts.sortDirection !== 'asc' && opts.sortDirection !== 'dsc') {
        error('Invalid sort direction. Use "asc" or "dsc".');
        process.exit(1);
      }
      sortDirection = opts.sortDirection;
    }
    const result = await getClient().profiles.list({
      cursor: opts.cursor,
      filter: opts.filter,
      sortDirection,
      sortField: opts.sortField,
    });
    print(result.profiles ?? result, getFormat(this));
  });

profilesCmd.command('get <profileIds...>').description('Get profiles by IDs').action(async function (this: Command, profileIds: string[]) {
  const result = await getClient().profiles.get(profileIds);
  print(result.profiles ?? result, getFormat(this));
});

// Store pages
const storePagesCmd = program.command('store-pages').description('Store page operations');

storePagesCmd
  .command('list')
  .description('List store pages')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async function (this: Command, opts: { cursor?: string }) {
    const result = await getClient().storePages.list(opts.cursor);
    print(result.storePages ?? result, getFormat(this));
  });

// Webhooks
const webhooksCmd = program.command('webhooks').description('Webhook subscription operations (OAuth access token required)');

webhooksCmd.command('list').description('List webhook subscriptions').action(async function (this: Command) {
  const result = await getClient().webhooks.list();
  print(result.webhookSubscriptions ?? result, getFormat(this));
});

webhooksCmd
  .command('create')
  .description('Create webhook subscription')
  .requiredOption('--endpoint-url <url>', 'Webhook endpoint URL')
  .requiredOption('--topics <topics>', 'Comma-separated topics')
  .action(async function (this: Command, opts: { endpointUrl: string; topics: string }) {
    const topics = opts.topics.split(',').map(t => t.trim()).filter(Boolean);
    print(await getClient().webhooks.create(opts.endpointUrl, topics), getFormat(this));
  });

webhooksCmd.command('delete <id>').description('Delete webhook subscription').action(async (id: string) => {
  await getClient().webhooks.delete(id);
  success(`Webhook ${id} deleted`);
});

webhooksCmd.command('rotate-secret <id>').description('Rotate webhook secret').action(async function (this: Command, id: string) {
  print(await getClient().webhooks.rotateSecret(id), getFormat(this));
});

program.parse();
