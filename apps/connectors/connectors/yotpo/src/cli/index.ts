#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Yotpo } from '../api';
import {
  getStoreId,
  setStoreId,
  getApiSecret,
  setApiSecret,
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

const CONNECTOR_NAME = 'connect-yotpo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Yotpo connector CLI - Reviews and UGC platform')
  .version(VERSION)
  .option('--store-id <id>', 'Store ID / app key (overrides config)')
  .option('--api-secret <secret>', 'API secret (overrides config)')
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
    if (opts.storeId) {
      process.env.YOTPO_STORE_ID = opts.storeId;
    }
    if (opts.apiSecret) {
      process.env.YOTPO_API_SECRET = opts.apiSecret;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Yotpo {
  const storeId = getStoreId();
  const apiSecret = getApiSecret();
  const baseUrl = getBaseUrl();

  if (!storeId) {
    error(`No store ID configured. Run "${CONNECTOR_NAME} config set-store-id <id>" or set YOTPO_STORE_ID.`);
    process.exit(1);
  }
  if (!apiSecret) {
    error(`No API secret configured. Run "${CONNECTOR_NAME} config set-api-secret <secret>" or set YOTPO_API_SECRET.`);
    process.exit(1);
  }
  return new Yotpo({ storeId, apiSecret, baseUrl });
}

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
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--store-id <id>', 'Store ID / app key')
  .option('--api-secret <secret>', 'API secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      storeId: opts.storeId,
      apiSecret: opts.apiSecret,
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
    info(`Store ID: ${config.storeId ? `${config.storeId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${config.apiSecret ? '********' : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || 'https://api.yotpo.com (default)'}`);
  });

const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-store-id <storeId>')
  .description('Set store ID / app key')
  .action((storeId: string) => {
    setStoreId(storeId);
    success(`Store ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-api-secret <apiSecret>')
  .description('Set API secret')
  .action((apiSecret: string) => {
    setApiSecret(apiSecret);
    success(`API secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <baseUrl>')
  .description('Set API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const storeId = getStoreId();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Store ID: ${storeId ? `${storeId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${getApiSecret() ? '********' : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || 'https://api.yotpo.com (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const reviewsCmd = program
  .command('reviews')
  .description('Review management commands');

reviewsCmd
  .command('list')
  .description('List reviews')
  .option('--count <count>', 'Number of reviews to return', '10')
  .option('--page <page>', 'Page number', '1')
  .option('--since-id <id>', 'Lowest review ID to return')
  .option('--since-date <date>', 'Earliest creation date')
  .option('--since-updated-at <date>', 'Earliest update date')
  .option('--deleted', 'Include unpublished reviews')
  .option('--user-reference <ref>', 'Filter by user reference')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listReviews({
        count: opts.count,
        page: opts.page,
        since_id: opts.sinceId,
        since_date: opts.sinceDate,
        since_updated_at: opts.sinceUpdatedAt,
        deleted: opts.deleted || undefined,
        user_reference: opts.userReference,
      });
      const format = getFormat(reviewsCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const reviews = result.reviews || [];
        success(`Reviews (${reviews.length} returned):`);
        if (reviews.length === 0) {
          info('No reviews found');
        } else {
          reviews.forEach(review => {
            const score = review.score !== undefined ? chalk.yellow(`[${review.score}/5]`) : '';
            console.log(`  ${review.id} ${score} ${review.title || '(no title)'}`);
            if (review.content) console.log(`    ${review.content.substring(0, 80)}${review.content.length > 80 ? '...' : ''}`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reviewsCmd
  .command('get <reviewId>')
  .description('Get a review by ID')
  .action(async (reviewId: string) => {
    try {
      const client = getClient();
      const result = await client.getReview(reviewId);
      const format = getFormat(reviewsCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const review = result.review;
        if (!review) {
          info('Review not found in response');
          return;
        }
        console.log(chalk.bold(`Review: ${review.id}`));
        info(`Score: ${review.score}`);
        if (review.title) info(`Title: ${review.title}`);
        if (review.content) info(`Content: ${review.content}`);
        if (review.created_at) info(`Created: ${review.created_at}`);
        if (review.sku) info(`SKU: ${review.sku}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reviewsCmd
  .command('create')
  .description('Create a review (sends verification emails)')
  .requiredOption('--sku <sku>', 'Product SKU')
  .requiredOption('--product-title <title>', 'Product title')
  .requiredOption('--product-url <url>', 'Product URL')
  .requiredOption('--display-name <name>', 'Reviewer display name')
  .requiredOption('--email <email>', 'Reviewer email')
  .requiredOption('--review-title <title>', 'Review title')
  .requiredOption('--review-content <content>', 'Review content')
  .requiredOption('--review-score <score>', 'Review score (1-5)')
  .option('--domain <domain>', 'Account domain')
  .option('--product-description <desc>', 'Product description')
  .option('--product-image-url <url>', 'Product image URL')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createReview({
        sku: opts.sku,
        product_title: opts.productTitle,
        product_url: opts.productUrl,
        display_name: opts.displayName,
        email: opts.email,
        review_title: opts.reviewTitle,
        review_content: opts.reviewContent,
        review_score: parseInt(opts.reviewScore, 10),
        domain: opts.domain,
        product_description: opts.productDescription,
        product_image_url: opts.productImageUrl,
      });
      success('Review created');
      const format = getFormat(reviewsCmd);
      if (format === 'json' || result.review) {
        print(result, format);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
