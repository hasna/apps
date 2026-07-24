#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccessToken,
  setAccessToken,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-trustpilot';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Trustpilot Business API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-t, --access-token <token>', 'OAuth access token (overrides config)')
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

    if (opts.apiKey) {
      process.env.TRUSTPILOT_API_KEY = opts.apiKey;
    }

    if (opts.accessToken) {
      process.env.TRUSTPILOT_ACCESS_TOKEN = opts.accessToken;
    }
  });

function getFormatFromProgram(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function runAction<T>(fn: () => Promise<T>): void {
  fn()
    .then(result => print(result, getFormatFromProgram()))
    .catch(err => {
      error(String(err));
      process.exit(1);
    });
}

function getClient(): Connector {
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  const baseUrl = getBaseUrl();

  if (!apiKey && !accessToken) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRUSTPILOT_API_KEY / TRUSTPILOT_ACCESS_TOKEN.`);
    process.exit(1);
  }

  return new Connector({ apiKey, accessToken, baseUrl });
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
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
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

profileCmd.command('create <name>').description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--access-token <token>', 'OAuth access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, accessToken: opts.accessToken });
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
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-token <accessToken>').description('Set OAuth access token').action((accessToken: string) => {
  setAccessToken(accessToken);
  success(`Access token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Categories
const categoriesCmd = program.command('categories').description('Category operations');

categoriesCmd.command('list').description('List categories')
  .option('--country <country>')
  .option('--locale <locale>')
  .option('--parent-id <parentId>')
  .option('--depth <depth>')
  .action(function (opts) {
    runAction(() => getClient().categories.list({
      country: opts.country,
      locale: opts.locale,
      parentId: opts.parentId,
      depth: opts.depth ? Number(opts.depth) : undefined,
    }));
  });

categoriesCmd.command('get <categoryId>').description('Get a category')
  .option('--country <country>')
  .option('--locale <locale>')
  .action(function (categoryId: string, opts) {
    runAction(() => getClient().categories.get({ categoryId, country: opts.country, locale: opts.locale }));
  });

categoriesCmd.command('business-units <categoryId>').description('List business units in a category')
  .option('--country <country>')
  .option('--locale <locale>')
  .option('--per-page <perPage>')
  .option('--page <page>')
  .action(function (categoryId: string, opts) {
    runAction(() => getClient().categories.getBusinessUnits({
      categoryId,
      country: opts.country,
      locale: opts.locale,
      perPage: opts.perPage ? Number(opts.perPage) : undefined,
      page: opts.page ? Number(opts.page) : undefined,
    }));
  });

// Business units
const buCmd = program.command('business-units').description('Business unit operations');

buCmd.command('find').description('Find a business unit by name')
  .requiredOption('--name <name>')
  .action(function (opts) {
    runAction(() => getClient().businessUnits.find({ name: opts.name }));
  });

buCmd.command('search').description('Search business units')
  .requiredOption('--query <query>')
  .option('--country <country>')
  .option('--per-page <perPage>')
  .option('--page <page>')
  .action(function (opts) {
    runAction(() => getClient().businessUnits.search({
      query: opts.query,
      country: opts.country,
      perPage: opts.perPage ? Number(opts.perPage) : undefined,
      page: opts.page ? Number(opts.page) : undefined,
    }));
  });

buCmd.command('get <businessUnitId>').description('Get a business unit').action(function (businessUnitId: string) {
  runAction(() => getClient().businessUnits.get(businessUnitId));
});

buCmd.command('profile <businessUnitId>').description('Get business unit profile info').action(function (businessUnitId: string) {
  runAction(() => getClient().businessUnits.getProfile(businessUnitId));
});

buCmd.command('web-links <businessUnitId>').description('Get business unit web links')
  .option('--locale <locale>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().businessUnits.getWebLinks({ businessUnitId, locale: opts.locale }));
  });

buCmd.command('reviews <businessUnitId>').description('Get public business unit reviews')
  .option('--per-page <perPage>')
  .option('--page <page>')
  .option('--stars <stars>')
  .option('--order-by <orderBy>')
  .option('--language <language>')
  .option('--tag-group <tagGroup>')
  .option('--tag <tag>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().businessUnits.getReviews({
      businessUnitId,
      perPage: opts.perPage ? Number(opts.perPage) : undefined,
      page: opts.page ? Number(opts.page) : undefined,
      stars: opts.stars ? Number(opts.stars) : undefined,
      orderBy: opts.orderBy,
      language: opts.language,
      tagGroup: opts.tagGroup,
      tag: opts.tag,
    }));
  });

buCmd.command('reviews-summary <businessUnitId>').description('Get business unit reviews summary')
  .option('--locale <locale>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().businessUnits.getReviewsSummary({ businessUnitId, locale: opts.locale }));
  });

// Reviews
const reviewsCmd = program.command('reviews').description('Review operations');

reviewsCmd.command('get <reviewId>').description('Get a review').action(function (reviewId: string) {
  runAction(() => getClient().reviews.get(reviewId));
});

reviewsCmd.command('reply <reviewId>').description('Reply to a review')
  .requiredOption('-m, --message <message>')
  .action(function (reviewId: string, opts) {
    runAction(() => getClient().reviews.reply({ reviewId, message: opts.message }));
  });

reviewsCmd.command('delete-reply <reviewId>').description('Delete a review reply').action(function (reviewId: string) {
  runAction(() => getClient().reviews.deleteReply(reviewId));
});

reviewsCmd.command('report <reviewId>').description('Report a review')
  .requiredOption('--reason <reason>')
  .option('--explanation <explanation>')
  .action(function (reviewId: string, opts) {
    runAction(() => getClient().reviews.report({ reviewId, reason: opts.reason, explanation: opts.explanation }));
  });

reviewsCmd.command('list-private <businessUnitId>').description('List private business unit reviews')
  .option('--per-page <perPage>')
  .option('--page <page>')
  .option('--stars <stars>')
  .option('--start <startDateTime>')
  .option('--end <endDateTime>')
  .option('--order-by <orderBy>')
  .option('--responded <responded>')
  .option('--language <language>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().reviews.listPrivate({
      businessUnitId,
      perPage: opts.perPage ? Number(opts.perPage) : undefined,
      page: opts.page ? Number(opts.page) : undefined,
      stars: opts.stars ? Number(opts.stars) : undefined,
      startDateTime: opts.start,
      endDateTime: opts.end,
      orderBy: opts.orderBy,
      responded: opts.responded === undefined ? undefined : opts.responded === 'true',
      language: opts.language,
    }));
  });

// Invitations
const invitationsCmd = program.command('invitations').description('Invitation operations');

invitationsCmd.command('create-link <businessUnitId>').description('Create an invitation link')
  .requiredOption('--email <email>')
  .option('--name <name>')
  .option('--locale <locale>')
  .option('--reference-id <referenceId>')
  .option('--product-skus <skus>', 'Comma-separated SKUs')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().invitations.createLink({
      businessUnitId,
      consumer: { email: opts.email, name: opts.name },
      locale: opts.locale,
      referenceId: opts.referenceId,
      productSkus: opts.productSkus?.split(',').map((s: string) => s.trim()).filter(Boolean),
      tags: opts.tags?.split(',').map((s: string) => s.trim()).filter(Boolean),
    }));
  });

invitationsCmd.command('send-email <businessUnitId>').description('Send an invitation email')
  .requiredOption('--email <email>')
  .option('--name <name>')
  .option('--locale <locale>')
  .option('--reference-id <referenceId>')
  .option('--reply-to <replyTo>')
  .option('--sender-email <senderEmail>')
  .option('--sender-name <senderName>')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--template-id <templateId>')
  .option('--preferred-send-time <preferredSendTime>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().invitations.sendEmail({
      businessUnitId,
      consumerEmail: opts.email,
      consumerName: opts.name,
      locale: opts.locale,
      referenceId: opts.referenceId,
      replyTo: opts.replyTo,
      senderEmail: opts.senderEmail,
      senderName: opts.senderName,
      tags: opts.tags?.split(',').map((s: string) => s.trim()).filter(Boolean),
      templateId: opts.templateId,
      preferredSendTime: opts.preferredSendTime,
    }));
  });

invitationsCmd.command('templates <businessUnitId>').description('List invitation templates').action(function (businessUnitId: string) {
  runAction(() => getClient().invitations.listTemplates(businessUnitId));
});

// Product reviews
const productCmd = program.command('product-reviews').description('Product review operations');

productCmd.command('list <businessUnitId>').description('List product reviews')
  .option('--per-page <perPage>')
  .option('--page <page>')
  .option('--sku <sku>')
  .option('--stars <stars>')
  .option('--order-by <orderBy>')
  .option('--locale <locale>')
  .option('--product-variant-id <productVariantId>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().products.listReviews({
      businessUnitId,
      perPage: opts.perPage ? Number(opts.perPage) : undefined,
      page: opts.page ? Number(opts.page) : undefined,
      sku: opts.sku,
      stars: opts.stars ? Number(opts.stars) : undefined,
      orderBy: opts.orderBy,
      locale: opts.locale,
      productVariantId: opts.productVariantId,
    }));
  });

productCmd.command('reply <reviewId>').description('Reply to a product review')
  .requiredOption('-m, --message <message>')
  .action(function (reviewId: string, opts) {
    runAction(() => getClient().products.reply(reviewId, opts.message));
  });

productCmd.command('summary <businessUnitId>').description('Get product review summary')
  .requiredOption('--sku <sku>')
  .option('--locale <locale>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().products.getSummary({ businessUnitId, sku: opts.sku, locale: opts.locale }));
  });

// Consumers
const consumersCmd = program.command('consumers').description('Consumer operations');

consumersCmd.command('profile <consumerId>').description('Get consumer profile').action(function (consumerId: string) {
  runAction(() => getClient().consumers.getProfile(consumerId));
});

consumersCmd.command('reviews <consumerId>').description('Get consumer reviews')
  .option('--per-page <perPage>')
  .option('--page <page>')
  .option('--order-by <orderBy>')
  .action(function (consumerId: string, opts) {
    runAction(() => getClient().consumers.getReviews({
      consumerId,
      perPage: opts.perPage ? Number(opts.perPage) : undefined,
      page: opts.page ? Number(opts.page) : undefined,
      orderBy: opts.orderBy,
    }));
  });

// Tags
const tagsCmd = program.command('tags').description('Tag and question operations');

tagsCmd.command('list <businessUnitId>').description('List business unit tags').action(function (businessUnitId: string) {
  runAction(() => getClient().tags.listBusinessUnitTags(businessUnitId));
});

tagsCmd.command('questions <businessUnitId>').description('List service review questions').action(function (businessUnitId: string) {
  runAction(() => getClient().tags.listServiceReviewQuestions(businessUnitId));
});

tagsCmd.command('create <businessUnitId>').description('Create a custom tag')
  .requiredOption('--tag-group <tagGroup>')
  .requiredOption('--tag <tag>')
  .option('--description <description>')
  .action(function (businessUnitId: string, opts) {
    runAction(() => getClient().tags.createCustomTag({
      businessUnitId,
      tagGroup: opts.tagGroup,
      tag: opts.tag,
      description: opts.description,
    }));
  });

// OAuth
const oauthCmd = program.command('oauth').description('OAuth helpers');

oauthCmd.command('auth-link')
  .description('Generate OAuth authorization URL')
  .requiredOption('--redirect-uri <redirectUri>')
  .option('--state <state>')
  .action((opts) => {
    try {
      const client = getClient();
      const result = client.oauth.generateAuthLink({ redirectUri: opts.redirectUri, state: opts.state });
      print(result, getFormatFromProgram());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
