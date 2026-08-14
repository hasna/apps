#!/usr/bin/env bun
import { Command } from 'commander';
import { Stampedio } from '../api';
import {
  getPublicKey,
  getPrivateKey,
  getStoreHash,
  getStoreUrl,
  setPublicKey,
  setPrivateKey,
  setStoreHash,
  setStoreUrl,
  hasCredentials,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-stampedio';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stamped.io connector CLI - reviews, customers, and loyalty for e-commerce')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile) && opts.profile !== 'default') {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let c: Command | null = cmd;
  while (c) {
    const fmt = c.opts().format;
    if (fmt) return fmt as OutputFormat;
    c = c.parent;
  }
  return 'pretty';
}

function getClient(): Stampedio {
  if (!hasCredentials()) {
    error(`No Stamped.io credentials configured. Run "${CONNECTOR_NAME} config set" or set STAMPEDIO_PRIVATE_KEY / STAMPEDIO_STORE_HASH.`);
    process.exit(1);
  }
  return new Stampedio({
    publicKey: getPublicKey(),
    privateKey: getPrivateKey()!,
    storeHash: getStoreHash()!,
    storeUrl: getStoreUrl(),
  });
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage stored credentials');

configCmd
  .command('set')
  .description('Store Stamped.io credentials in the active profile')
  .option('--public-key <key>', 'Public API key for public widget endpoints')
  .option('--private-key <key>', 'Private API key for private API requests')
  .option('--store-hash <hash>', 'ShopId/storeHash identifier')
  .option('--store-url <url>', 'Storefront domain (for public widget endpoints)')
  .action((opts) => {
    if (opts.publicKey) setPublicKey(opts.publicKey);
    if (opts.privateKey) setPrivateKey(opts.privateKey);
    if (opts.storeHash) setStoreHash(opts.storeHash);
    if (opts.storeUrl) setStoreUrl(opts.storeUrl);
    if (!opts.publicKey && !opts.privateKey && !opts.storeHash && !opts.storeUrl) {
      error('Provide at least one of --public-key, --private-key, --store-hash, --store-url');
      process.exit(1);
    }
    success(`Credentials saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('show')
  .description('Show the configured credentials (secrets masked)')
  .action(() => {
    const mask = (v?: string) => (v ? `${v.slice(0, 4)}${'*'.repeat(Math.max(0, v.length - 4))}` : '(not set)');
    print({
      profile: getCurrentProfile(),
      configDir: getConfigDir(),
      publicKey: mask(getPublicKey()),
      privateKey: mask(getPrivateKey()),
      storeHash: getStoreHash() || '(not set)',
      storeUrl: getStoreUrl() || '(not set)',
    });
  });

configCmd
  .command('clear')
  .description('Clear stored credentials for the active profile')
  .action(() => {
    clearConfig();
    success(`Cleared credentials for profile "${getCurrentProfile()}"`);
  });

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Manage credential profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action((_opts, cmd) => {
    const current = getCurrentProfile();
    const profiles = listProfiles();
    if (!profiles.includes('default')) profiles.unshift('default');
    print(profiles.map((p) => ({ name: p, active: p === current })), getFormat(cmd));
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name) => {
    if (createProfile(name)) success(`Created profile "${name}"`);
    else error(`Profile "${name}" already exists`);
  });

profileCmd
  .command('use <name>')
  .description('Switch the active profile')
  .action((name) => {
    try {
      setCurrentProfile(name);
      success(`Switched to profile "${name}"`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name) => {
    if (deleteProfile(name)) success(`Deleted profile "${name}"`);
    else error(`Cannot delete profile "${name}"`);
  });

// ============================================
// Reviews Commands
// ============================================
const reviewsCmd = program.command('reviews').description('Product reviews');

reviewsCmd
  .command('list')
  .description('List reviews from the merchant dashboard')
  .option('--product-id <id>', 'Filter by product id')
  .option('--min-rating <n>', 'Minimum star rating (1-5)', (v) => parseInt(v, 10))
  .option('--type <type>', 'Review type (e.g. review, question)')
  .option('--sort <sort>', 'Sort order (e.g. most-recent, highest-rating)')
  .option('--email <email>', 'Filter by reviewer email')
  .option('--page <n>', 'Page number', (v) => parseInt(v, 10))
  .option('--take <n>', 'Results per page', (v) => parseInt(v, 10))
  .action((opts, cmd) =>
    run(async () => {
      const result = await getClient().reviews.list({
        productId: opts.productId,
        minRating: opts.minRating,
        type: opts.type,
        sortReviews: opts.sort,
        email: opts.email,
        page: opts.page,
        take: opts.take,
      });
      print(result, getFormat(cmd));
    })
  );

reviewsCmd
  .command('public')
  .description('List published reviews from the public storefront widget')
  .option('--product-id <id>', 'Filter by product id')
  .option('--min-rating <n>', 'Minimum star rating (1-5)', (v) => parseInt(v, 10))
  .option('--sort <sort>', 'Sort order')
  .option('--page <n>', 'Page number', (v) => parseInt(v, 10))
  .option('--take <n>', 'Results per page', (v) => parseInt(v, 10))
  .action((opts, cmd) =>
    run(async () => {
      const result = await getClient().reviews.listPublic({
        productId: opts.productId,
        minRating: opts.minRating,
        sortReviews: opts.sort,
        page: opts.page,
        take: opts.take,
      });
      print(result, getFormat(cmd));
    })
  );

// ============================================
// Customers Commands
// ============================================
const customersCmd = program.command('customers').description('Customer management');

customersCmd
  .command('add')
  .description('Add or upsert a customer')
  .requiredOption('--email <email>', 'Customer email')
  .option('--custom-customer-id <id>', 'External customer id from your platform')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--tags <tags>', 'Comma-separated tags')
  .action((opts, cmd) =>
    run(async () => {
      const result = await getClient().customers.add({
        email: opts.email,
        customCustomerId: opts.customCustomerId,
        firstName: opts.firstName,
        lastName: opts.lastName,
        tags: opts.tags ? String(opts.tags).split(',').map((tag) => tag.trim()).filter(Boolean) : undefined,
      });
      success('Customer added');
      print(result, getFormat(cmd));
    })
  );

// ============================================
// Loyalty Commands
// ============================================
const loyaltyCmd = program.command('loyalty').description('Loyalty & rewards');

loyaltyCmd
  .command('award')
  .description('Award loyalty points to a customer')
  .requiredOption('--customer-id <id>', 'Stamped customer id')
  .requiredOption('--points <n>', 'Points to award', (v) => parseInt(v, 10))
  .option('--reason <reason>', 'Reason recorded against the transaction')
  .action((opts, cmd) =>
    run(async () => {
      const result = await getClient().loyalty.awardPoints(opts.customerId, opts.points, opts.reason);
      success(`Awarded ${opts.points} points to customer ${opts.customerId}`);
      print(result, getFormat(cmd));
    })
  );

loyaltyCmd
  .command('deduct')
  .description('Deduct loyalty points from a customer')
  .requiredOption('--customer-id <id>', 'Stamped customer id')
  .requiredOption('--points <n>', 'Points to deduct', (v) => parseInt(v, 10))
  .option('--reason <reason>', 'Reason recorded against the transaction')
  .action((opts, cmd) =>
    run(async () => {
      const result = await getClient().loyalty.deductPoints(opts.customerId, opts.points, opts.reason);
      success(`Deducted ${opts.points} points from customer ${opts.customerId}`);
      print(result, getFormat(cmd));
    })
  );

// ============================================
// Whoami
// ============================================
program
  .command('whoami')
  .description('Show which profile and store hash are active')
  .action(() => {
    info(`Profile: ${getCurrentProfile()}`);
    info(`Store hash: ${getStoreHash() || '(not set)'}`);
    info(`Credentials configured: ${hasCredentials() ? 'yes' : 'no'}`);
  });

program.parseAsync(process.argv);
