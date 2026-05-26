#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { config } from 'dotenv';
import { ClickBank } from '../api';
import {
  getApiKey,
  setApiKey,
  setDefaultAccount,
  getDefaultAccount,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  setProfileOverride,
  isAuthenticated,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, heading } from '../utils/output';

// Load environment variables
config();

const program = new Command();

program
  .name('connect-clickbank')
  .description('ClickBank API connector CLI')
  .version('1.0.1')
  .option('-k, --api-key <key>', 'ClickBank API key')
  .option('-p, --profile <name>', 'Use specific profile')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.CLICKBANK_API_KEY = opts.apiKey;
    }
  });

// Helper to get ClickBank client
function getClient(): ClickBank {
  const apiKey = getApiKey();
  if (!apiKey) {
    error('No API key configured. Run "connect-clickbank config set-key <key>" or set CLICKBANK_API_KEY environment variable.');
    process.exit(1);
  }
  return new ClickBank({ apiKey });
}

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set ClickBank API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success('API key saved successfully');
  });

configCmd
  .command('set-account <account>')
  .description('Set default account nickname')
  .action((account: string) => {
    setDefaultAccount(account);
    success(`Default account set to: ${account}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const apiKey = getApiKey();
    const account = getDefaultAccount();

    heading('Current Configuration');
    print({
      profile,
      authenticated: isAuthenticated(),
      apiKey: apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : 'Not set',
      defaultAccount: account || 'Not set',
    });
  });

configCmd
  .command('clear')
  .description('Clear all configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Profile management');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Using default.');
      return;
    }

    heading('Profiles');
    profiles.forEach(p => {
      const marker = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile "${name}"`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('show')
  .description('Show current profile name')
  .action(() => {
    const profile = getCurrentProfile();
    const apiKey = getApiKey();
    const account = getDefaultAccount();

    heading('Current Profile');
    print({
      profile,
      authenticated: isAuthenticated(),
      apiKey: apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : 'Not set',
      defaultAccount: account || 'Not set',
    });
  });

// ============================================
// Orders Commands
// ============================================
const ordersCmd = program
  .command('orders')
  .description('Manage orders');

ordersCmd
  .command('get <receipt>')
  .description('Get order by receipt number')
  .option('-s, --sku <sku>', 'SKU for multi-item orders')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      const order = await client.orders.getOrder(receipt, opts.sku);
      print(order, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('list')
  .description('List orders')
  .option('-a, --affiliate <affiliate>', 'Filter by affiliate')
  .option('-v, --vendor <vendor>', 'Filter by vendor')
  .option('-e, --email <email>', 'Filter by customer email')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .option('-t, --type <type>', 'Transaction type')
  .option('-r, --role <role>', 'Role (VENDOR or AFFILIATE)')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.orders.list({
        affiliate: opts.affiliate,
        vendor: opts.vendor,
        email: opts.email,
        startDate: opts.startDate,
        endDate: opts.endDate,
        type: opts.type,
        role: opts.role,
        page: parseInt(opts.page),
      });
      print(result.orders, getFormat(ordersCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('count')
  .description('Count orders')
  .option('-a, --affiliate <affiliate>', 'Filter by affiliate')
  .option('-v, --vendor <vendor>', 'Filter by vendor')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .option('-t, --type <type>', 'Transaction type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const count = await client.orders.count({
        affiliate: opts.affiliate,
        vendor: opts.vendor,
        startDate: opts.startDate,
        endDate: opts.endDate,
        type: opts.type,
      });
      info(`Total orders: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('upsells <receipt>')
  .description('Get upsell transactions for a receipt')
  .action(async (receipt: string) => {
    try {
      const client = getClient();
      const upsells = await client.orders.getUpsells(receipt);
      if (upsells.length === 0) {
        info('No upsells found for this receipt');
      } else {
        print(upsells, getFormat(ordersCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('is-active <receipt>')
  .description('Check if a subscription is active')
  .option('-s, --sku <sku>', 'SKU for multi-item orders')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      const active = await client.orders.isActive(receipt, opts.sku);
      if (active) {
        success('Subscription is active');
      } else {
        info('Subscription is not active');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('pause <receipt>')
  .description('Pause a subscription')
  .requiredOption('--restart-date <date>', 'Restart date (yyyy-mm-dd)')
  .option('-s, --sku <sku>', 'SKU for multi-item orders')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      await client.orders.pause(receipt, {
        restartDate: opts.restartDate,
        sku: opts.sku,
      });
      success('Subscription paused');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('reinstate <receipt>')
  .description('Reinstate a cancelled subscription')
  .option('-s, --sku <sku>', 'SKU for multi-item orders')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      await client.orders.reinstate(receipt, { sku: opts.sku });
      success('Subscription reinstated');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('extend <receipt>')
  .description('Extend a subscription')
  .requiredOption('-n, --num-periods <number>', 'Number of periods to extend')
  .option('-s, --sku <sku>', 'SKU for multi-item orders')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      await client.orders.extend(receipt, {
        numPeriods: parseInt(opts.numPeriods),
        sku: opts.sku,
      });
      success('Subscription extended');
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
  .description('Manage products');

productsCmd
  .command('get <sku>')
  .description('Get product by SKU')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .action(async (sku: string, opts) => {
    try {
      const client = getClient();
      const product = await client.products.get(sku, opts.account);
      print(product, getFormat(productsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('list')
  .description('List all products')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('-t, --type <type>', 'Product type (STANDARD or RECURRING)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const products = await client.products.list({
        site: opts.account,
        type: opts.type,
      });
      print(products, getFormat(productsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('delete <sku>')
  .description('Delete a product')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .action(async (sku: string, opts) => {
    try {
      const client = getClient();
      await client.products.delete(sku, opts.account);
      success(`Product ${sku} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('create')
  .description('Create a new product')
  .requiredOption('-s, --sku <sku>', 'Product SKU')
  .requiredOption('-a, --account <account>', 'Account nickname (site)')
  .requiredOption('-t, --title <title>', 'Product title')
  .requiredOption('--price <price>', 'Product price')
  .requiredOption('--currency <currency>', 'Currency code (e.g., USD)')
  .requiredOption('--language <language>', 'Language code (e.g., EN)')
  .requiredOption('--pitch-page <url>', 'Pitch page URL')
  .requiredOption('--thank-you-page <url>', 'Thank you page URL')
  .option('-d, --description <description>', 'Product description')
  .option('--digital', 'Product is digital', true)
  .option('--physical', 'Product is physical')
  .option('--recurring', 'Product is recurring')
  .option('--rebill-price <price>', 'Rebill price (for recurring)')
  .option('--rebill-commission <percentage>', 'Rebill commission percentage')
  .option('--duration <number>', 'Subscription duration')
  .option('--frequency <frequency>', 'Rebill frequency (e.g., WEEKLY, MONTHLY)')
  .option('--trial-period <days>', 'Trial period in days')
  .option('--purchase-commission <percentage>', 'Initial purchase commission')
  .option('--categories <categories>', 'Comma-separated categories')
  .option('--skip-confirmation', 'Skip confirmation page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const sku = await client.products.create({
        sku: opts.sku,
        site: opts.account,
        title: opts.title,
        price: parseFloat(opts.price),
        currency: opts.currency,
        language: opts.language,
        pitchPage: opts.pitchPage,
        thankYouPage: opts.thankYouPage,
        description: opts.description,
        digital: opts.digital && !opts.physical,
        physical: opts.physical,
        recurring: opts.recurring,
        rebillPrice: opts.rebillPrice ? parseFloat(opts.rebillPrice) : undefined,
        rebillCommission: opts.rebillCommission ? parseFloat(opts.rebillCommission) : undefined,
        duration: opts.duration ? parseInt(opts.duration) : undefined,
        frequency: opts.frequency,
        trialPeriod: opts.trialPeriod ? parseInt(opts.trialPeriod) : undefined,
        purchaseCommission: opts.purchaseCommission ? parseFloat(opts.purchaseCommission) : undefined,
        categories: opts.categories ? opts.categories.split(',') : undefined,
        skipConfirmationPage: opts.skipConfirmation,
      });
      success(`Product created with SKU: ${sku}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Tickets Commands
// ============================================
const ticketsCmd = program
  .command('tickets')
  .description('Manage support and refund tickets');

ticketsCmd
  .command('get <ticketId>')
  .description('Get ticket by ID')
  .action(async (ticketId: string) => {
    try {
      const client = getClient();
      const ticket = await client.tickets.get(ticketId);
      print(ticket, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('list')
  .description('List tickets')
  .option('-r, --receipt <receipt>', 'Filter by receipt')
  .option('-s, --status <status>', 'Filter by status (open, reopened, closed)')
  .option('-t, --type <type>', 'Filter by type (rfnd, cncl, tech)')
  .option('--create-from <date>', 'Created from date (yyyy-mm-dd)')
  .option('--create-to <date>', 'Created to date (yyyy-mm-dd)')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tickets.list({
        receipt: opts.receipt,
        status: opts.status,
        type: opts.type,
        createDateFrom: opts.createFrom,
        createDateTo: opts.createTo,
        page: parseInt(opts.page),
      });
      print(result.tickets, getFormat(ticketsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('count')
  .description('Count tickets')
  .option('-r, --receipt <receipt>', 'Filter by receipt')
  .option('-s, --status <status>', 'Filter by status')
  .option('-t, --type <type>', 'Filter by type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const count = await client.tickets.count({
        receipt: opts.receipt,
        status: opts.status,
        type: opts.type,
      });
      info(`Total tickets: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('refund <receipt>')
  .description('Create a refund ticket')
  .requiredOption('--reason <reason>', 'Refund reason')
  .option('--type <type>', 'Refund type (FULL, PARTIAL_PERCENT, PARTIAL_AMOUNT)', 'FULL')
  .option('--amount <amount>', 'Refund amount (for partial refunds)')
  .option('-s, --sku <sku>', 'SKU for multi-item orders')
  .option('-c, --comment <comment>', 'Additional comment')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      const ticket = await client.tickets.createRefund(receipt, opts.type, opts.reason, {
        refundAmount: opts.amount ? parseFloat(opts.amount) : undefined,
        sku: opts.sku,
        comment: opts.comment,
      });
      success('Refund ticket created');
      print(ticket, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('cancel <receipt>')
  .description('Create a cancellation ticket')
  .requiredOption('--reason <reason>', 'Cancellation reason')
  .option('-s, --sku <sku>', 'SKU for multi-item orders')
  .option('-c, --comment <comment>', 'Additional comment')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      const ticket = await client.tickets.createCancellation(receipt, opts.reason, {
        sku: opts.sku,
        comment: opts.comment,
      });
      success('Cancellation ticket created');
      print(ticket, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('close <ticketId>')
  .description('Close a ticket')
  .option('-c, --comment <comment>', 'Closing comment')
  .action(async (ticketId: string, opts) => {
    try {
      const client = getClient();
      await client.tickets.close(ticketId, opts.comment);
      success('Ticket closed');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('reopen <ticketId>')
  .description('Reopen a ticket')
  .requiredOption('-c, --comment <comment>', 'Reason for reopening')
  .action(async (ticketId: string, opts) => {
    try {
      const client = getClient();
      await client.tickets.reopen(ticketId, opts.comment);
      success('Ticket reopened');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Shipping Commands
// ============================================
const shippingCmd = program
  .command('shipping')
  .description('Manage shipping');

shippingCmd
  .command('list')
  .description('List physical goods orders')
  .option('-s, --status <status>', 'Filter by status (shipped, notshipped, all)')
  .option('-r, --receipt <receipt>', 'Filter by receipt')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .option('-d, --days <days>', 'Number of days (default 30)')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.shipping.list({
        status: opts.status,
        receipt: opts.receipt,
        startDate: opts.startDate,
        endDate: opts.endDate,
        days: opts.days ? parseInt(opts.days) : undefined,
        page: parseInt(opts.page),
      });
      print(result.orders, getFormat(shippingCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shippingCmd
  .command('count')
  .description('Count physical goods orders')
  .option('-s, --status <status>', 'Filter by status')
  .option('-r, --receipt <receipt>', 'Filter by receipt')
  .option('--start-date <date>', 'Start date')
  .option('--end-date <date>', 'End date')
  .action(async (opts) => {
    try {
      const client = getClient();
      const count = await client.shipping.count({
        status: opts.status,
        receipt: opts.receipt,
        startDate: opts.startDate,
        endDate: opts.endDate,
      });
      info(`Total orders: ${count}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shippingCmd
  .command('unshipped')
  .description('List unshipped orders')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.shipping.getUnshipped({ page: parseInt(opts.page) });
      print(result.orders, getFormat(shippingCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shippingCmd
  .command('mark-shipped <receipt>')
  .description('Mark an order as shipped')
  .requiredOption('-i, --item <itemNo>', 'Item number')
  .option('-t, --tracking <trackingId>', 'Tracking number')
  .option('-c, --carrier <carrier>', 'Shipping carrier')
  .action(async (receipt: string, opts) => {
    try {
      const client = getClient();
      await client.shipping.markShipped(receipt, opts.item, opts.tracking, opts.carrier);
      success('Order marked as shipped');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Quickstats Commands
// ============================================
const quickstatsCmd = program
  .command('quickstats')
  .alias('stats')
  .description('View quick statistics');

quickstatsCmd
  .command('accounts')
  .description('List accounts with read access')
  .action(async () => {
    try {
      const client = getClient();
      const accounts = await client.quickstats.getAccounts();
      print(accounts, getFormat(quickstatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

quickstatsCmd
  .command('summary')
  .description('Get summary statistics')
  .option('-a, --account <account>', 'Account nickname')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const stats = await client.quickstats.count({
        account: opts.account || getDefaultAccount(),
        startDate: opts.startDate,
        endDate: opts.endDate,
      });
      print(stats, getFormat(quickstatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

quickstatsCmd
  .command('today')
  .description('Get today\'s statistics')
  .option('-a, --account <account>', 'Account nickname')
  .action(async (opts) => {
    try {
      const client = getClient();
      const stats = await client.quickstats.getToday(opts.account || getDefaultAccount());
      print(stats, getFormat(quickstatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

quickstatsCmd
  .command('daily')
  .description('Get daily statistics')
  .option('-a, --account <account>', 'Account nickname')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.quickstats.list({
        account: opts.account || getDefaultAccount(),
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: parseInt(opts.page),
      });
      print(result.data, getFormat(quickstatsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Analytics Commands
// ============================================
const analyticsCmd = program
  .command('analytics')
  .description('View analytics data');

analyticsCmd
  .command('status')
  .description('Get API status')
  .action(async () => {
    try {
      const client = getClient();
      const status = await client.analytics.getStatus();
      print(status, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('subscriptions')
  .description('Get subscription trends (vendor only)')
  .option('-a, --account <account>', 'Account nickname')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const trends = await client.analytics.getSubscriptionTrends({
        role: 'VENDOR',
        account: opts.account || getDefaultAccount(),
        startDate: opts.startDate,
        endDate: opts.endDate,
      });
      print(trends, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('products')
  .description('Get product statistics (vendor only)')
  .option('-a, --account <account>', 'Account nickname')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const stats = await client.analytics.getVendorProductStats(
        opts.account || getDefaultAccount(),
        opts.startDate,
        opts.endDate
      );
      print(stats, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('countries')
  .description('Get statistics by country')
  .option('-r, --role <role>', 'Role (VENDOR or AFFILIATE)', 'VENDOR')
  .option('-a, --account <account>', 'Account nickname')
  .option('--start-date <date>', 'Start date (yyyy-mm-dd)')
  .option('--end-date <date>', 'End date (yyyy-mm-dd)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const stats = await client.analytics.getCountryStats(
        opts.role,
        opts.account || getDefaultAccount(),
        opts.startDate,
        opts.endDate
      );
      print(stats, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('subscription-details')
  .description('Get subscription details with optional filter')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('--filter <filter>', 'Filter type (canceldate, cancelsixty, cancelthirty, compsixty, compthirty, nextpmtdate, startdate, status)')
  .option('--status <status>', 'Subscription status (ACTIVE, COMPLETED, CANCELED, RETRY_PAYMENT, REQUEST_NEW_CARD)')
  .option('--start-date <date>', 'Start date (for canceldate, nextpmtdate, startdate filters)')
  .option('--end-date <date>', 'End date (for canceldate, nextpmtdate, startdate filters)')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const account = opts.account || getDefaultAccount();

      if (!account) {
        error('Account is required. Use -a or set default with config set-account.');
        process.exit(1);
      }

      let result;

      if (opts.filter) {
        switch (opts.filter) {
          case 'canceldate':
            if (!opts.startDate || !opts.endDate) {
              error('canceldate filter requires --start-date and --end-date');
              process.exit(1);
            }
            result = await client.analytics.getCanceledByDateRange(
              account, opts.startDate, opts.endDate, parseInt(opts.page)
            );
            break;
          case 'cancelsixty':
            result = await client.analytics.getCanceledLast60Days(account, parseInt(opts.page));
            break;
          case 'cancelthirty':
            result = await client.analytics.getCanceledLast30Days(account, parseInt(opts.page));
            break;
          case 'compsixty':
            result = await client.analytics.getCompletingIn60Days(account, parseInt(opts.page));
            break;
          case 'compthirty':
            result = await client.analytics.getCompletingIn30Days(account, parseInt(opts.page));
            break;
          case 'nextpmtdate':
            if (!opts.startDate || !opts.endDate) {
              error('nextpmtdate filter requires --start-date and --end-date');
              process.exit(1);
            }
            result = await client.analytics.getByNextPaymentDate(
              account, opts.startDate, opts.endDate, parseInt(opts.page)
            );
            break;
          case 'startdate':
            if (!opts.startDate || !opts.endDate) {
              error('startdate filter requires --start-date and --end-date');
              process.exit(1);
            }
            result = await client.analytics.getByStartDate(
              account, opts.startDate, opts.endDate, parseInt(opts.page)
            );
            break;
          case 'status':
            if (!opts.status) {
              error('status filter requires --status parameter');
              process.exit(1);
            }
            result = await client.analytics.getBySubscriptionStatus(
              account, opts.status, parseInt(opts.page)
            );
            break;
          default:
            error(`Unknown filter: ${opts.filter}`);
            process.exit(1);
        }
      } else {
        result = await client.analytics.getSubscriptionDetails({
          role: 'VENDOR',
          account,
          status: opts.status,
          page: parseInt(opts.page),
        });
      }

      print(result.details, getFormat(analyticsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('canceled-30d')
  .description('Get subscriptions canceled in the last 30 days')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.getCanceledLast30Days(
        opts.account || getDefaultAccount()!,
        parseInt(opts.page)
      );
      print(result.details, getFormat(analyticsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('canceled-60d')
  .description('Get subscriptions canceled in the last 60 days')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.getCanceledLast60Days(
        opts.account || getDefaultAccount()!,
        parseInt(opts.page)
      );
      print(result.details, getFormat(analyticsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('completing-30d')
  .description('Get subscriptions completing within 30 days')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.getCompletingIn30Days(
        opts.account || getDefaultAccount()!,
        parseInt(opts.page)
      );
      print(result.details, getFormat(analyticsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('completing-60d')
  .description('Get subscriptions completing within 60 days')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.getCompletingIn60Days(
        opts.account || getDefaultAccount()!,
        parseInt(opts.page)
      );
      print(result.details, getFormat(analyticsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('active-subs')
  .description('Get active subscriptions')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.getBySubscriptionStatus(
        opts.account || getDefaultAccount()!,
        'ACTIVE',
        parseInt(opts.page)
      );
      print(result.details, getFormat(analyticsCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Images Commands
// ============================================
const imagesCmd = program
  .command('images')
  .description('Manage account images');

imagesCmd
  .command('list')
  .description('List images')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('-t, --type <type>', 'Image type (PRODUCT, BANNER, BANNER_CLASSIC, BANNER_NEW, BANNER_BG, CUSTOM_BANNER, CUSTOM_BANNER_BG, CUSTOM_ORDERFORM)')
  .option('--approved', 'Only show approved images')
  .option('--include-unapproved', 'Include unapproved images')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const approvedOnly = opts.includeUnapproved ? false : (opts.approved ? true : undefined);
      const result = await client.images.list({
        site: opts.account,
        type: opts.type,
        approvedOnly,
        page: parseInt(opts.page),
      });
      print(result.images, getFormat(imagesCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imagesCmd
  .command('products')
  .description('List product images')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('--include-unapproved', 'Include unapproved images')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.images.getProductImages(
        opts.account,
        opts.includeUnapproved ? false : undefined
      );
      print(result.images, getFormat(imagesCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

imagesCmd
  .command('banners')
  .description('List banner images')
  .requiredOption('-a, --account <account>', 'Account nickname')
  .option('--include-unapproved', 'Include unapproved images')
  .option('-p, --page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.images.getBannerImages(
        opts.account,
        opts.includeUnapproved ? false : undefined
      );
      print(result.images, getFormat(imagesCmd));
      if (result.hasMore) {
        info('More results available. Use --page to get next page.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
