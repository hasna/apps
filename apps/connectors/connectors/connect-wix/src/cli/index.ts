#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wix } from '../api';
import {
  getApiKey,
  getSiteId,
  setApiKey,
  setSiteId,
  setAccountId,
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
  getAccountId,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-wix';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wix API connector CLI - Sites, Contacts, Members, Products, Orders, Inventory, Bookings with multi-profile support')
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
function getClient(): Wix {
  const apiKey = getApiKey();
  const siteId = getSiteId();
  const accountId = getAccountId();

  if (!apiKey) {
    error(`No Wix API key configured. Run "${CONNECTOR_NAME} config set --api-key <key>" or set WIX_API_KEY environment variable.`);
    process.exit(1);
  }

  return new Wix({ apiKey, siteId, accountId });
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
  .option('--api-key <key>', 'Wix API key')
  .option('--site-id <id>', 'Wix site ID')
  .option('--account-id <id>', 'Wix account ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      siteId: opts.siteId,
      accountId: opts.accountId,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Site ID: ${config.siteId || chalk.gray('not set')}`);
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set')
  .description('Set Wix credentials')
  .requiredOption('--api-key <key>', 'Wix API key')
  .option('--site-id <id>', 'Wix site ID')
  .option('--account-id <id>', 'Wix account ID')
  .action((opts) => {
    setApiKey(opts.apiKey);
    if (opts.siteId) {
      setSiteId(opts.siteId);
    }
    if (opts.accountId) {
      setAccountId(opts.accountId);
    }
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const siteId = getSiteId();
    const accountId = getAccountId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Site ID: ${siteId || chalk.gray('not set')}`);
    info(`Account ID: ${accountId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Sites Commands
// ============================================
const sitesCmd = program
  .command('sites')
  .description('Site operations');

sitesCmd
  .command('list')
  .description('List all sites')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const sites = await client.sites.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = sites.map(s => ({
        id: s.id,
        name: s.name,
        url: s.url,
        published: s.published,
        createdDate: s.createdDate,
      }));

      print(simplified, getFormat(sitesCmd));
      info(`Total: ${sites.length} sites`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sitesCmd
  .command('get <id>')
  .description('Get a site by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const site = await client.sites.get(id);
      print(site, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Contacts Commands
// ============================================
const contactsCmd = program
  .command('contacts')
  .description('Contact operations');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const contacts = await client.contacts.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = contacts.map(c => ({
        id: c.id,
        email: c.primaryInfo?.email,
        phone: c.primaryInfo?.phone,
        firstName: c.info?.name?.first,
        lastName: c.info?.name?.last,
        createdDate: c.createdDate,
      }));

      print(simplified, getFormat(contactsCmd));
      info(`Total: ${contacts.length} contacts`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('get <id>')
  .description('Get a contact by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const contact = await client.contacts.get(id);
      print(contact, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('search <query>')
  .description('Search contacts')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const contacts = await client.contacts.search({
        search: query,
        limit: parseInt(opts.limit),
      });

      const simplified = contacts.map(c => ({
        id: c.id,
        email: c.primaryInfo?.email,
        phone: c.primaryInfo?.phone,
        firstName: c.info?.name?.first,
        lastName: c.info?.name?.last,
      }));

      print(simplified, getFormat(contactsCmd));
      info(`Found: ${contacts.length} contacts`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .option('--email <email>', 'Contact email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .option('--company <company>', 'Company name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const contact = await client.contacts.create({
        info: {
          name: (opts.firstName || opts.lastName) ? {
            first: opts.firstName,
            last: opts.lastName,
          } : undefined,
          emails: opts.email ? [{ email: opts.email, primary: true }] : undefined,
          phones: opts.phone ? [{ phone: opts.phone, primary: true }] : undefined,
          company: opts.company,
        },
      });
      success(`Contact created: ${contact.id}`);
      print(contact, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('update <id>')
  .description('Update a contact')
  .requiredOption('--revision <number>', 'Contact revision (required for updates)')
  .option('--email <email>', 'Contact email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .option('--company <company>', 'Company name')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const contact = await client.contacts.update(id, {
        revision: parseInt(opts.revision),
        info: {
          name: (opts.firstName || opts.lastName) ? {
            first: opts.firstName,
            last: opts.lastName,
          } : undefined,
          emails: opts.email ? [{ email: opts.email, primary: true }] : undefined,
          phones: opts.phone ? [{ phone: opts.phone, primary: true }] : undefined,
          company: opts.company,
        },
      });
      success(`Contact updated: ${contact.id}`);
      print(contact, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete <id>')
  .description('Delete a contact')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.contacts.delete(id);
      success(`Contact deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('count')
  .description('Get contact count')
  .action(async () => {
    try {
      const client = getClient();
      const count = await client.contacts.count();
      success(`Contact count: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Members Commands
// ============================================
const membersCmd = program
  .command('members')
  .description('Member operations');

membersCmd
  .command('list')
  .description('List members')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const members = await client.members.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = members.map(m => ({
        id: m.id,
        loginEmail: m.loginEmail,
        status: m.status,
        firstName: m.contact?.firstName,
        lastName: m.contact?.lastName,
        createdDate: m.createdDate,
      }));

      print(simplified, getFormat(membersCmd));
      info(`Total: ${members.length} members`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

membersCmd
  .command('get <id>')
  .description('Get a member by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const member = await client.members.get(id);
      print(member, getFormat(membersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

membersCmd
  .command('count')
  .description('Get member count')
  .action(async () => {
    try {
      const client = getClient();
      const count = await client.members.count();
      success(`Member count: ${count}`);
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
  .description('Product operations (Wix Stores)');

productsCmd
  .command('list')
  .description('List products')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .option('--include-hidden', 'Include hidden products')
  .option('--include-variants', 'Include product variants')
  .action(async (opts) => {
    try {
      const client = getClient();
      const products = await client.products.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
        includeHiddenProducts: opts.includeHidden,
        includeVariants: opts.includeVariants,
      });

      const simplified = products.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        visible: p.visible,
        price: p.priceData?.price,
        inStock: p.stock?.inStock,
        createdDate: p.createdDate,
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
  .option('--include-variants', 'Include product variants')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const product = await client.products.get(id, opts.includeVariants);
      print(product, getFormat(productsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('create')
  .description('Create a new product')
  .requiredOption('--name <name>', 'Product name')
  .option('--description <desc>', 'Product description')
  .option('--price <price>', 'Product price')
  .option('--sku <sku>', 'Product SKU')
  .option('--visible', 'Make product visible')
  .option('--track-inventory', 'Enable inventory tracking')
  .option('--quantity <number>', 'Initial quantity')
  .action(async (opts) => {
    try {
      const client = getClient();
      const product = await client.products.create({
        name: opts.name,
        description: opts.description,
        price: opts.price ? parseFloat(opts.price) : undefined,
        sku: opts.sku,
        visible: opts.visible ?? true,
        trackInventory: opts.trackInventory,
        quantity: opts.quantity ? parseInt(opts.quantity) : undefined,
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
  .option('--name <name>', 'Product name')
  .option('--description <desc>', 'Product description')
  .option('--price <price>', 'Product price')
  .option('--sku <sku>', 'Product SKU')
  .option('--visible <bool>', 'Product visibility')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const product = await client.products.update(id, {
        name: opts.name,
        description: opts.description,
        price: opts.price ? parseFloat(opts.price) : undefined,
        sku: opts.sku,
        visible: opts.visible !== undefined ? opts.visible === 'true' : undefined,
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
      await client.products.delete(id);
      success(`Product deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('count')
  .description('Get product count')
  .action(async () => {
    try {
      const client = getClient();
      const count = await client.products.count();
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
  .description('Order operations (Wix Stores)');

ordersCmd
  .command('list')
  .description('List orders')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const orders = await client.orders.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = orders.map(o => ({
        id: o.id,
        number: o.number,
        buyerEmail: o.buyerInfo?.email,
        total: o.totals?.total,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        createdDate: o.createdDate,
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
      const order = await client.orders.get(id);
      print(order, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('update <id>')
  .description('Update an order')
  .option('--buyer-note <note>', 'Buyer note')
  .option('--archived <bool>', 'Archive status')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const order = await client.orders.update(id, {
        buyerNote: opts.buyerNote,
        archived: opts.archived !== undefined ? opts.archived === 'true' : undefined,
      });
      success(`Order updated: ${order.id}`);
      print(order, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('archive <id>')
  .description('Archive an order')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.orders.archive(id);
      success(`Order archived: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('unarchive <id>')
  .description('Unarchive an order')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.orders.unarchive(id);
      success(`Order unarchived: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('count')
  .description('Get order count')
  .action(async () => {
    try {
      const client = getClient();
      const count = await client.orders.count();
      success(`Order count: ${count}`);
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
  .description('Inventory operations (Wix Stores)');

inventoryCmd
  .command('list')
  .description('List inventory items')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const items = await client.inventory.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = items.map(i => ({
        id: i.id,
        productId: i.productId,
        trackQuantity: i.trackQuantity,
        variants: i.variants?.length || 0,
        lastUpdated: i.lastUpdated,
      }));

      print(simplified, getFormat(inventoryCmd));
      info(`Total: ${items.length} inventory items`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('get <id>')
  .description('Get inventory item by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const item = await client.inventory.get(id);
      print(item, getFormat(inventoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('get-by-product <productId>')
  .description('Get inventory by product ID')
  .action(async (productId: string) => {
    try {
      const client = getClient();
      const item = await client.inventory.getByProduct(productId);
      if (item) {
        print(item, getFormat(inventoryCmd));
      } else {
        info('No inventory found for this product');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('update <id>')
  .description('Update inventory')
  .option('--track-quantity <bool>', 'Enable/disable quantity tracking')
  .option('--variant-id <id>', 'Variant ID to update')
  .option('--quantity <number>', 'Set quantity')
  .option('--in-stock <bool>', 'Set in-stock status')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const variants = opts.variantId ? [{
        variantId: opts.variantId,
        quantity: opts.quantity ? parseInt(opts.quantity) : undefined,
        inStock: opts.inStock !== undefined ? opts.inStock === 'true' : undefined,
      }] : undefined;

      const item = await client.inventory.update(id, {
        trackQuantity: opts.trackQuantity !== undefined ? opts.trackQuantity === 'true' : undefined,
        variants,
      });
      success(`Inventory updated: ${item.id}`);
      print(item, getFormat(inventoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('increment <id>')
  .description('Increment inventory quantity')
  .requiredOption('--variant-id <id>', 'Variant ID')
  .requiredOption('--quantity <number>', 'Quantity to add')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      await client.inventory.increment(id, [{
        variantId: opts.variantId,
        quantity: parseInt(opts.quantity),
      }]);
      success(`Inventory incremented for ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inventoryCmd
  .command('decrement <id>')
  .description('Decrement inventory quantity')
  .requiredOption('--variant-id <id>', 'Variant ID')
  .requiredOption('--quantity <number>', 'Quantity to subtract')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      await client.inventory.decrement(id, [{
        variantId: opts.variantId,
        quantity: parseInt(opts.quantity),
      }]);
      success(`Inventory decremented for ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Bookings Commands
// ============================================
const bookingsCmd = program
  .command('bookings')
  .description('Bookings operations');

bookingsCmd
  .command('services')
  .description('List booking services')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const services = await client.bookings.listServices({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = services.map(s => ({
        id: s.id,
        name: s.name,
        tagLine: s.tagLine,
        hidden: s.hidden,
        defaultCapacity: s.defaultCapacity,
        createdDate: s.createdDate,
      }));

      print(simplified, getFormat(bookingsCmd));
      info(`Total: ${services.length} services`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bookingsCmd
  .command('service <id>')
  .description('Get a booking service by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const service = await client.bookings.getService(id);
      print(service, getFormat(bookingsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bookingsCmd
  .command('list')
  .description('List bookings')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const bookings = await client.bookings.listBookings({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = bookings.map(b => ({
        id: b.id,
        title: b.bookedEntity?.title,
        status: b.status,
        paymentStatus: b.paymentStatus,
        contactEmail: b.contactDetails?.email,
        startDate: b.startDate,
        createdDate: b.createdDate,
      }));

      print(simplified, getFormat(bookingsCmd));
      info(`Total: ${bookings.length} bookings`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bookingsCmd
  .command('get <id>')
  .description('Get a booking by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const booking = await client.bookings.getBooking(id);
      print(booking, getFormat(bookingsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bookingsCmd
  .command('count')
  .description('Get booking count')
  .action(async () => {
    try {
      const client = getClient();
      const count = await client.bookings.countBookings();
      success(`Booking count: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bookingsCmd
  .command('services-count')
  .description('Get service count')
  .action(async () => {
    try {
      const client = getClient();
      const count = await client.bookings.countServices();
      success(`Service count: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
