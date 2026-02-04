#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Shopify } from '../api';
import {
  getStore,
  getAccessToken,
  setStore,
  setAccessToken,
  setApiVersion,
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
  normalizeStoreName,
  getApiVersion,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-shopify';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Shopify Admin API connector CLI - Products, Orders, Customers, Inventory with multi-profile support')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
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
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Shopify {
  const store = getStore();
  const accessToken = getAccessToken();

  if (!store) {
    error(`No Shopify store configured. Run "${CONNECTOR_NAME} config set --store <store.myshopify.com> --token <token>" or set SHOPIFY_STORE environment variable.`);
    process.exit(1);
  }
  if (!accessToken) {
    error(`No Shopify access token configured. Run "${CONNECTOR_NAME} config set --store <store.myshopify.com> --token <token>" or set SHOPIFY_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Shopify({ store, accessToken, apiVersion: getApiVersion() });
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
  .option('--store <store>', 'Shopify store URL (e.g., mystore.myshopify.com)')
  .option('--token <token>', 'Shopify access token')
  .option('--api-version <version>', 'API version (default: 2024-01)')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      store: opts.store ? normalizeStoreName(opts.store) : undefined,
      accessToken: opts.token,
      apiVersion: opts.apiVersion,
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
    info(`Store: ${config.store || chalk.gray('not set')}`);
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`API Version: ${config.apiVersion || chalk.gray('not set (defaults to 2024-01)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set')
  .description('Set Shopify credentials')
  .requiredOption('--store <store>', 'Shopify store URL (e.g., mystore.myshopify.com)')
  .requiredOption('--token <token>', 'Shopify access token')
  .option('--api-version <version>', 'API version (default: 2024-01)')
  .action((opts) => {
    setStore(normalizeStoreName(opts.store));
    setAccessToken(opts.token);
    if (opts.apiVersion) {
      setApiVersion(opts.apiVersion);
    }
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const store = getStore();
    const apiVersion = getApiVersion();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Store: ${store || chalk.gray('not set')}`);
    info(`API Version: ${apiVersion}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Shop Commands
// ============================================
program
  .command('shop')
  .description('Get shop information')
  .action(async () => {
    try {
      const client = getClient();
      const shop = await client.shop.get();
      print(shop, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Products Commands
// ============================================
const productsCmd = program
  .command('products')
  .description('Product operations');

productsCmd
  .command('list')
  .description('List products')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--status <status>', 'Filter by status (active, archived, draft)')
  .option('--vendor <vendor>', 'Filter by vendor')
  .option('--product-type <type>', 'Filter by product type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const products = await client.products.list({
        limit: parseInt(opts.limit),
        status: opts.status,
        vendor: opts.vendor,
        productType: opts.productType,
      });

      const simplified = products.map(p => ({
        id: p.id,
        title: p.title,
        vendor: p.vendor,
        status: p.status,
        variantCount: p.variants.length,
        createdAt: p.createdAt,
      }));

      print(simplified, getFormat(productsCmd));
      info(`Total: ${products.length} products`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('get <id>')
  .description('Get a product by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const product = await client.products.get(parseInt(id));
      print(product, getFormat(productsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('create')
  .description('Create a new product')
  .requiredOption('--title <title>', 'Product title')
  .option('--body <html>', 'Product description HTML')
  .option('--vendor <vendor>', 'Product vendor')
  .option('--product-type <type>', 'Product type')
  .option('--tags <tags>', 'Product tags (comma-separated)')
  .option('--status <status>', 'Product status (active, draft, archived)', 'draft')
  .option('--price <price>', 'Initial variant price')
  .option('--sku <sku>', 'Initial variant SKU')
  .action(async (opts) => {
    try {
      const client = getClient();
      const product = await client.products.create({
        title: opts.title,
        bodyHtml: opts.body,
        vendor: opts.vendor,
        productType: opts.productType,
        tags: opts.tags,
        status: opts.status,
        variants: opts.price ? [{
          price: opts.price,
          sku: opts.sku,
        }] : undefined,
      });
      success(`Product created: ${product.id}`);
      print(product, getFormat(productsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('update <id>')
  .description('Update a product')
  .option('--title <title>', 'Product title')
  .option('--body <html>', 'Product description HTML')
  .option('--vendor <vendor>', 'Product vendor')
  .option('--product-type <type>', 'Product type')
  .option('--tags <tags>', 'Product tags')
  .option('--status <status>', 'Product status (active, draft, archived)')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const product = await client.products.update(parseInt(id), {
        title: opts.title,
        bodyHtml: opts.body,
        vendor: opts.vendor,
        productType: opts.productType,
        tags: opts.tags,
        status: opts.status,
      });
      success(`Product updated: ${product.id}`);
      print(product, getFormat(productsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('delete <id>')
  .description('Delete a product')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.products.delete(parseInt(id));
      success(`Product deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('count')
  .description('Get product count')
  .option('--status <status>', 'Filter by status')
  .option('--vendor <vendor>', 'Filter by vendor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const count = await client.products.count({
        status: opts.status,
        vendor: opts.vendor,
      });
      success(`Product count: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Orders Commands
// ============================================
const ordersCmd = program
  .command('orders')
  .description('Order operations');

ordersCmd
  .command('list')
  .description('List orders')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--status <status>', 'Filter by status (open, closed, cancelled, any)', 'any')
  .option('--financial-status <status>', 'Filter by financial status')
  .option('--fulfillment-status <status>', 'Filter by fulfillment status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const orders = await client.orders.list({
        limit: parseInt(opts.limit),
        status: opts.status,
        financialStatus: opts.financialStatus,
        fulfillmentStatus: opts.fulfillmentStatus,
      });

      const simplified = orders.map(o => ({
        id: o.id,
        name: o.name,
        email: o.email,
        totalPrice: o.totalPrice,
        currency: o.currency,
        financialStatus: o.financialStatus,
        fulfillmentStatus: o.fulfillmentStatus || 'unfulfilled',
        itemCount: o.lineItems.length,
        createdAt: o.createdAt,
      }));

      print(simplified, getFormat(ordersCmd));
      info(`Total: ${orders.length} orders`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('get <id>')
  .description('Get an order by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const order = await client.orders.get(parseInt(id));
      print(order, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('fulfill <id>')
  .description('Fulfill an order')
  .requiredOption('--location-id <id>', 'Location ID for fulfillment')
  .option('--tracking-number <number>', 'Tracking number')
  .option('--tracking-company <company>', 'Tracking company')
  .option('--no-notify', 'Do not notify customer')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const fulfillment = await client.orders.fulfill(parseInt(id), {
        locationId: parseInt(opts.locationId),
        trackingNumber: opts.trackingNumber,
        trackingCompany: opts.trackingCompany,
        notifyCustomer: opts.notify !== false,
      });
      success(`Order fulfilled: ${id}`);
      print(fulfillment, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('close <id>')
  .description('Close an order')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const order = await client.orders.close(parseInt(id));
      success(`Order closed: ${order.name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('cancel <id>')
  .description('Cancel an order')
  .option('--reason <reason>', 'Cancel reason')
  .option('--email', 'Send email to customer')
  .option('--restock', 'Restock inventory')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const order = await client.orders.cancel(parseInt(id), {
        reason: opts.reason,
        email: opts.email,
        restock: opts.restock,
      });
      success(`Order cancelled: ${order.name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('count')
  .description('Get order count')
  .option('--status <status>', 'Filter by status')
  .option('--financial-status <status>', 'Filter by financial status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const count = await client.orders.count({
        status: opts.status,
        financialStatus: opts.financialStatus,
      });
      success(`Order count: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Customers Commands
// ============================================
const customersCmd = program
  .command('customers')
  .description('Customer operations');

customersCmd
  .command('list')
  .description('List customers')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const customers = await client.customers.list({
        limit: parseInt(opts.limit),
      });

      const simplified = customers.map(c => ({
        id: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        ordersCount: c.ordersCount,
        totalSpent: c.totalSpent,
        createdAt: c.createdAt,
      }));

      print(simplified, getFormat(customersCmd));
      info(`Total: ${customers.length} customers`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('get <id>')
  .description('Get a customer by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const customer = await client.customers.get(parseInt(id));
      print(customer, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('search <query>')
  .description('Search customers')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const customers = await client.customers.search({
        query,
        limit: parseInt(opts.limit),
      });

      const simplified = customers.map(c => ({
        id: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        ordersCount: c.ordersCount,
        totalSpent: c.totalSpent,
      }));

      print(simplified, getFormat(customersCmd));
      info(`Found: ${customers.length} customers`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('create')
  .description('Create a new customer')
  .option('--email <email>', 'Customer email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .option('--note <note>', 'Customer note')
  .option('--tags <tags>', 'Customer tags')
  .action(async (opts) => {
    try {
      const client = getClient();
      const customer = await client.customers.create({
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        phone: opts.phone,
        note: opts.note,
        tags: opts.tags,
      });
      success(`Customer created: ${customer.id}`);
      print(customer, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('update <id>')
  .description('Update a customer')
  .option('--email <email>', 'Customer email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .option('--note <note>', 'Customer note')
  .option('--tags <tags>', 'Customer tags')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const customer = await client.customers.update(parseInt(id), {
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        phone: opts.phone,
        note: opts.note,
        tags: opts.tags,
      });
      success(`Customer updated: ${customer.id}`);
      print(customer, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('count')
  .description('Get customer count')
  .action(async () => {
    try {
      const client = getClient();
      const count = await client.customers.count();
      success(`Customer count: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Inventory Commands
// ============================================
const inventoryCmd = program
  .command('inventory')
  .description('Inventory operations');

inventoryCmd
  .command('list')
  .description('List inventory levels')
  .option('--location-id <id>', 'Filter by location ID')
  .option('--item-ids <ids>', 'Filter by inventory item IDs (comma-separated)')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const levels = await client.inventory.listLevels({
        locationIds: opts.locationId ? [parseInt(opts.locationId)] : undefined,
        inventoryItemIds: opts.itemIds ? opts.itemIds.split(',').map((id: string) => parseInt(id)) : undefined,
        limit: parseInt(opts.limit),
      });

      print(levels, getFormat(inventoryCmd));
      info(`Total: ${levels.length} inventory levels`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('set')
  .description('Set inventory level')
  .requiredOption('--item-id <id>', 'Inventory item ID')
  .requiredOption('--location-id <id>', 'Location ID')
  .requiredOption('--available <number>', 'Available quantity')
  .action(async (opts) => {
    try {
      const client = getClient();
      const level = await client.inventory.setLevel({
        inventoryItemId: parseInt(opts.itemId),
        locationId: parseInt(opts.locationId),
        available: parseInt(opts.available),
      });
      success(`Inventory level set: ${level.available} available`);
      print(level, getFormat(inventoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('adjust')
  .description('Adjust inventory level')
  .requiredOption('--item-id <id>', 'Inventory item ID')
  .requiredOption('--location-id <id>', 'Location ID')
  .requiredOption('--adjustment <number>', 'Quantity adjustment (positive or negative)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const level = await client.inventory.adjustLevel({
        inventoryItemId: parseInt(opts.itemId),
        locationId: parseInt(opts.locationId),
        availableAdjustment: parseInt(opts.adjustment),
      });
      success(`Inventory level adjusted: ${level.available} available`);
      print(level, getFormat(inventoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('locations')
  .description('List inventory locations')
  .action(async () => {
    try {
      const client = getClient();
      const locations = await client.inventory.listLocations();

      const simplified = locations.map(l => ({
        id: l.id,
        name: l.name,
        city: l.city,
        country: l.country,
        active: l.active,
      }));

      print(simplified, getFormat(inventoryCmd));
      info(`Total: ${locations.length} locations`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Collections Commands
// ============================================
const collectionsCmd = program
  .command('collections')
  .description('Collection operations');

collectionsCmd
  .command('list')
  .description('List collections')
  .option('--type <type>', 'Collection type (custom, smart)', 'custom')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const collections = opts.type === 'smart'
        ? await client.collections.listSmart({ limit: parseInt(opts.limit) })
        : await client.collections.listCustom({ limit: parseInt(opts.limit) });

      const simplified = collections.map(c => ({
        id: c.id,
        title: c.title,
        handle: c.handle,
        productsCount: c.productsCount,
        updatedAt: c.updatedAt,
      }));

      print(simplified, getFormat(collectionsCmd));
      info(`Total: ${collections.length} collections`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

collectionsCmd
  .command('get <id>')
  .description('Get a collection by ID')
  .option('--type <type>', 'Collection type (custom, smart)', 'custom')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const collection = opts.type === 'smart'
        ? await client.collections.getSmart(parseInt(id))
        : await client.collections.getCustom(parseInt(id));
      print(collection, getFormat(collectionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

collectionsCmd
  .command('create')
  .description('Create a custom collection')
  .requiredOption('--title <title>', 'Collection title')
  .option('--body <html>', 'Collection description HTML')
  .option('--handle <handle>', 'URL handle')
  .action(async (opts) => {
    try {
      const client = getClient();
      const collection = await client.collections.createCustom({
        title: opts.title,
        bodyHtml: opts.body,
        handle: opts.handle,
      });
      success(`Collection created: ${collection.id}`);
      print(collection, getFormat(collectionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

collectionsCmd
  .command('delete <id>')
  .description('Delete a collection')
  .option('--type <type>', 'Collection type (custom, smart)', 'custom')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      if (opts.type === 'smart') {
        await client.collections.deleteSmart(parseInt(id));
      } else {
        await client.collections.deleteCustom(parseInt(id));
      }
      success(`Collection deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

collectionsCmd
  .command('add-product <collection-id> <product-id>')
  .description('Add a product to a custom collection')
  .action(async (collectionId: string, productId: string) => {
    try {
      const client = getClient();
      const result = await client.collections.addProduct(parseInt(collectionId), parseInt(productId));
      success(`Product ${productId} added to collection ${collectionId}`);
      print(result, getFormat(collectionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
