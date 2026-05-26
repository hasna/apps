#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Webflow } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getSiteId,
  setSiteId,
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

const CONNECTOR_NAME = 'connect-webflow';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Webflow API v2 connector CLI - Sites, Collections, Items, Pages, Assets, Forms, Users, Products, Orders')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-s, --site <siteId>', 'Use a specific site ID')
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

// Helper to get site ID from options, env, or config
function resolveSiteId(opts: { site?: string }): string | undefined {
  return opts.site || getSiteId();
}

// Helper to require site ID
function requireSiteId(opts: { site?: string }): string {
  const siteId = resolveSiteId(opts);
  if (!siteId) {
    error(`No site ID specified. Use --site <id>, set WEBFLOW_SITE_ID, or run "${CONNECTOR_NAME} config set --site-id <id>"`);
    process.exit(1);
  }
  return siteId;
}

// Helper to get authenticated client
function getClient(): Webflow {
  const accessToken = getAccessToken();
  const siteId = getSiteId();

  if (!accessToken) {
    error(`No Webflow access token configured. Run "${CONNECTOR_NAME} config set --token <token>" or set WEBFLOW_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Webflow({ accessToken, siteId });
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
  .option('--token <token>', 'Webflow access token')
  .option('--site-id <id>', 'Default site ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
      siteId: opts.siteId,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Site ID: ${config.siteId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set')
  .description('Set Webflow credentials')
  .option('--token <token>', 'Webflow access token')
  .option('--site-id <id>', 'Default site ID')
  .action((opts) => {
    if (opts.token) {
      setAccessToken(opts.token);
    }
    if (opts.siteId) {
      setSiteId(opts.siteId);
    }
    if (!opts.token && !opts.siteId) {
      error('Please specify --token or --site-id');
      process.exit(1);
    }
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const siteId = getSiteId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Site ID: ${siteId || chalk.gray('not set')}`);
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
  .action(async () => {
    try {
      const client = getClient();
      const sites = await client.sites.list();

      const simplified = sites.map(s => ({
        id: s.id,
        displayName: s.displayName,
        shortName: s.shortName,
        previewUrl: s.previewUrl,
        lastPublished: s.lastPublished || 'never',
      }));

      print(simplified, getFormat(sitesCmd));
      info(`Total: ${sites.length} sites`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sitesCmd
  .command('get [id]')
  .description('Get a site by ID')
  .action(async (id?: string) => {
    try {
      const client = getClient();
      const siteId = id || requireSiteId(program.opts());
      const site = await client.sites.get(siteId);
      print(site, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sitesCmd
  .command('publish [id]')
  .description('Publish a site')
  .option('--domains <ids>', 'Comma-separated domain IDs to publish to')
  .action(async (id: string | undefined, opts) => {
    try {
      const client = getClient();
      const siteId = id || requireSiteId(program.opts());
      const domains = opts.domains ? opts.domains.split(',') : undefined;
      const result = await client.sites.publish(siteId, domains);
      success(`Site publish queued: ${result.queued}`);
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
  .description('List all collections')
  .action(async () => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const collections = await client.collections.list(siteId);

      const simplified = collections.map(c => ({
        id: c.id,
        displayName: c.displayName,
        singularName: c.singularName,
        slug: c.slug,
        fieldCount: c.fields.length,
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
  .action(async (id: string) => {
    try {
      const client = getClient();
      const collection = await client.collections.get(id);
      print(collection, getFormat(collectionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

collectionsCmd
  .command('create')
  .description('Create a new collection')
  .requiredOption('--name <name>', 'Collection display name')
  .requiredOption('--singular <name>', 'Singular name')
  .option('--slug <slug>', 'URL slug')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const collection = await client.collections.create(siteId, {
        displayName: opts.name,
        singularName: opts.singular,
        slug: opts.slug,
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
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.collections.delete(id);
      success(`Collection deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Items Commands
// ============================================
const itemsCmd = program
  .command('items')
  .description('CMS Item operations');

itemsCmd
  .command('list <collectionId>')
  .description('List items in a collection')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .option('--offset <number>', 'Offset for pagination', '0')
  .action(async (collectionId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.items.list(collectionId, {
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });

      const simplified = result.items.map(i => ({
        id: i.id,
        isDraft: i.isDraft,
        isArchived: i.isArchived,
        lastUpdated: i.lastUpdated,
        name: (i.fieldData as Record<string, unknown>).name || (i.fieldData as Record<string, unknown>).title || 'N/A',
      }));

      print(simplified, getFormat(itemsCmd));
      info(`Showing ${result.items.length} of ${result.pagination.total} items`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('get <collectionId> <itemId>')
  .description('Get an item by ID')
  .action(async (collectionId: string, itemId: string) => {
    try {
      const client = getClient();
      const item = await client.items.get(collectionId, itemId);
      print(item, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('create <collectionId>')
  .description('Create a new item')
  .requiredOption('--data <json>', 'Field data as JSON')
  .option('--draft', 'Create as draft')
  .option('--live', 'Publish immediately')
  .action(async (collectionId: string, opts) => {
    try {
      const client = getClient();
      const fieldData = JSON.parse(opts.data);
      const item = await client.items.create(collectionId, {
        isDraft: opts.draft || false,
        fieldData,
      }, opts.live);
      success(`Item created: ${item.id}`);
      print(item, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('update <collectionId> <itemId>')
  .description('Update an item')
  .requiredOption('--data <json>', 'Field data as JSON')
  .option('--live', 'Update live item')
  .action(async (collectionId: string, itemId: string, opts) => {
    try {
      const client = getClient();
      const fieldData = JSON.parse(opts.data);
      const item = await client.items.update(collectionId, itemId, {
        fieldData,
      }, opts.live);
      success(`Item updated: ${item.id}`);
      print(item, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('delete <collectionId> <itemId>')
  .description('Delete an item')
  .option('--live', 'Delete from live site')
  .action(async (collectionId: string, itemId: string, opts) => {
    try {
      const client = getClient();
      await client.items.delete(collectionId, itemId, opts.live);
      success(`Item deleted: ${itemId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('publish <collectionId>')
  .description('Publish items')
  .requiredOption('--ids <ids>', 'Comma-separated item IDs')
  .action(async (collectionId: string, opts) => {
    try {
      const client = getClient();
      const itemIds = opts.ids.split(',');
      const result = await client.items.publish(collectionId, itemIds);
      success(`Published ${result.publishedItemIds.length} items`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pages Commands
// ============================================
const pagesCmd = program
  .command('pages')
  .description('Page operations');

pagesCmd
  .command('list')
  .description('List all pages')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.pages.list(siteId, {
        limit: parseInt(opts.limit),
      });

      const simplified = result.pages.map(p => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        archived: p.archived,
        draft: p.draft,
      }));

      print(simplified, getFormat(pagesCmd));
      info(`Showing ${result.pages.length} of ${result.pagination.total} pages`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('get <id>')
  .description('Get a page by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const page = await client.pages.get(id);
      print(page, getFormat(pagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Assets Commands
// ============================================
const assetsCmd = program
  .command('assets')
  .description('Asset operations');

assetsCmd
  .command('list')
  .description('List all assets')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.assets.list(siteId, {
        limit: parseInt(opts.limit),
      });

      const simplified = result.assets.map(a => ({
        id: a.id,
        displayName: a.displayName,
        originalFileName: a.originalFileName,
        contentType: a.contentType,
        size: a.size,
        hostedUrl: a.hostedUrl,
      }));

      print(simplified, getFormat(assetsCmd));
      info(`Showing ${result.assets.length} of ${result.pagination.total} assets`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

assetsCmd
  .command('get <id>')
  .description('Get an asset by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const asset = await client.assets.get(id);
      print(asset, getFormat(assetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

assetsCmd
  .command('folders')
  .description('List asset folders')
  .action(async () => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.assets.listFolders(siteId);
      print(result.assetFolders, getFormat(assetsCmd));
      info(`Total: ${result.assetFolders.length} folders`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

assetsCmd
  .command('delete <id>')
  .description('Delete an asset')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.assets.delete(id);
      success(`Asset deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Forms Commands
// ============================================
const formsCmd = program
  .command('forms')
  .description('Form operations');

formsCmd
  .command('list')
  .description('List all forms')
  .action(async () => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.forms.list(siteId);

      const simplified = result.forms.map(f => ({
        id: f.id,
        displayName: f.displayName,
        pageName: f.pageName,
        responsesCount: f.responsesCount,
        lastSubmitted: f.lastSubmitted,
      }));

      print(simplified, getFormat(formsCmd));
      info(`Total: ${result.forms.length} forms`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('get <id>')
  .description('Get a form by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const form = await client.forms.get(id);
      print(form, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('submissions <formId>')
  .description('List form submissions')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.forms.listSubmissions(formId, {
        limit: parseInt(opts.limit),
      });

      print(result.formSubmissions, getFormat(formsCmd));
      info(`Showing ${result.formSubmissions.length} of ${result.pagination.total} submissions`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================
const usersCmd = program
  .command('users')
  .description('User operations');

usersCmd
  .command('list')
  .description('List all users')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.users.list(siteId, {
        limit: parseInt(opts.limit),
      });

      const simplified = result.users.map(u => ({
        id: u.id,
        email: u.data.email,
        name: u.data.name,
        status: u.status,
        lastLogin: u.lastLogin || 'never',
      }));

      print(simplified, getFormat(usersCmd));
      info(`Showing ${result.users.length} of ${result.total} users`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <id>')
  .description('Get a user by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const user = await client.users.get(siteId, id);
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('invite')
  .description('Invite a user')
  .requiredOption('--email <email>', 'User email')
  .option('--groups <slugs>', 'Comma-separated access group slugs')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const accessGroups = opts.groups ? opts.groups.split(',') : undefined;
      const user = await client.users.invite(siteId, {
        email: opts.email,
        accessGroups,
      });
      success(`User invited: ${user.id}`);
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('delete <id>')
  .description('Delete a user')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      await client.users.delete(siteId, id);
      success(`User deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('access-groups')
  .description('List access groups')
  .action(async () => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.users.listAccessGroups(siteId);
      print(result.accessGroups, getFormat(usersCmd));
      info(`Total: ${result.accessGroups.length} access groups`);
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
  .description('Ecommerce product operations');

productsCmd
  .command('list')
  .description('List all products')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.products.list(siteId, {
        limit: parseInt(opts.limit),
      });

      const simplified = result.items.map(p => ({
        id: p.id,
        name: p.fieldData.name,
        slug: p.fieldData.slug,
        isDraft: p.isDraft,
        isArchived: p.isArchived,
      }));

      print(simplified, getFormat(productsCmd));
      info(`Showing ${result.items.length} of ${result.pagination.total} products`);
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
      const siteId = requireSiteId(program.opts());
      const product = await client.products.get(siteId, id);
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
  .requiredOption('--slug <slug>', 'Product slug')
  .option('--description <text>', 'Product description')
  .option('--draft', 'Create as draft')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const product = await client.products.create(siteId, {
        isDraft: opts.draft || false,
        fieldData: {
          name: opts.name,
          slug: opts.slug,
          description: opts.description,
        },
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
  .option('--description <text>', 'Product description')
  .option('--archived', 'Archive the product')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());

      const updates: Record<string, unknown> = {};
      if (opts.name) updates.name = opts.name;
      if (opts.description) updates.description = opts.description;

      const product = await client.products.update(siteId, id, {
        isArchived: opts.archived,
        fieldData: Object.keys(updates).length > 0 ? updates : undefined,
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
  .description('Delete (archive) a product')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      await client.products.delete(siteId, id);
      success(`Product deleted: ${id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('skus <productId>')
  .description('List SKUs for a product')
  .action(async (productId: string) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.products.listSkus(siteId, productId);
      print(result.skus, getFormat(productsCmd));
      info(`Total: ${result.skus.length} SKUs`);
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
  .description('Ecommerce order operations');

ordersCmd
  .command('list')
  .description('List all orders')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .option('--status <status>', 'Filter by status (pending, unfulfilled, fulfilled, disputed, dispute-lost, refunded)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const result = await client.orders.list(siteId, {
        limit: parseInt(opts.limit),
        status: opts.status,
      });

      const simplified = result.orders.map(o => ({
        orderId: o.orderId,
        status: o.status,
        customerEmail: o.customerInfo.email,
        total: `${o.totals.total.value / 100} ${o.totals.total.unit}`,
        itemCount: o.purchasedItemsCount,
        acceptedOn: o.acceptedOn,
      }));

      print(simplified, getFormat(ordersCmd));
      info(`Showing ${result.orders.length} of ${result.pagination.total} orders`);
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
      const siteId = requireSiteId(program.opts());
      const order = await client.orders.get(siteId, id);
      print(order, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('update <id>')
  .description('Update an order')
  .option('--comment <text>', 'Order comment')
  .option('--shipping-provider <provider>', 'Shipping provider')
  .option('--tracking <number>', 'Tracking number')
  .option('--tracking-url <url>', 'Tracking URL')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const order = await client.orders.update(siteId, id, {
        comment: opts.comment,
        shippingProvider: opts.shippingProvider,
        shippingTracking: opts.tracking,
        shippingTrackingUrl: opts.trackingUrl,
      });
      success(`Order updated: ${order.orderId}`);
      print(order, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('fulfill <id>')
  .description('Mark an order as fulfilled')
  .option('--no-email', 'Do not send fulfillment email')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const order = await client.orders.fulfill(siteId, id, {
        sendOrderFulfilledEmail: opts.email !== false,
      });
      success(`Order fulfilled: ${order.orderId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('unfulfill <id>')
  .description('Mark an order as unfulfilled')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const order = await client.orders.unfulfill(siteId, id);
      success(`Order unfulfilled: ${order.orderId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('refund <id>')
  .description('Refund an order')
  .option('--reason <text>', 'Refund reason')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const siteId = requireSiteId(program.opts());
      const order = await client.orders.refund(siteId, id, opts.reason);
      success(`Order refunded: ${order.orderId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
