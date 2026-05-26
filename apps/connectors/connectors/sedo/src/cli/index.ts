#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Sedo } from '../api';
import {
  getPartnerId,
  getSignKey,
  getUsername,
  getPassword,
  setPartnerId,
  setSignKey,
  setUsername,
  setPassword,
  clearConfig,
  getActiveProfileName,
  setActiveProfile,
  setProfileOverride,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  profileExists,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, formatPrice } from '../utils/output';
import { SedoApiError } from '../types';

// Helper to format error messages
function formatError(err: unknown): string {
  if (err instanceof SedoApiError) {
    return `${err.message} (code: ${err.code})`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null) {
    return JSON.stringify(err);
  }
  return String(err);
}

// Read version from package.json
const pkg = await import('../../package.json');
const VERSION = pkg.version || '0.0.0';

const program = new Command();

program
  .name('connect-sedo')
  .description('Sedo Domain Marketplace API connector CLI')
  .version(VERSION)
  .option('-p, --partner-id <id>', 'Sedo partner ID')
  .option('-k, --api-key <key>', 'Sedo API key (sign key)')
  .option('-u, --username <username>', 'Sedo account username')
  .option('--password <password>', 'Sedo account password')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('--profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-sedo profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.partnerId) {
      process.env.SEDO_PARTNER_ID = opts.partnerId;
    }
    if (opts.apiKey) {
      process.env.SEDO_API_KEY = opts.apiKey;
    }
    if (opts.username) {
      process.env.SEDO_USERNAME = opts.username;
    }
    if (opts.password) {
      process.env.SEDO_PASSWORD = opts.password;
    }
  });

// Helper to get Sedo client
function getClient(): Sedo {
  const partnerId = getPartnerId();
  const signKey = getSignKey();
  const username = getUsername();
  const password = getPassword();

  if (!partnerId) {
    error('No partner ID configured. Run "connect-sedo config set-partner-id <id>" or set SEDO_PARTNER_ID environment variable.');
    process.exit(1);
  }
  if (!signKey) {
    error('No API key configured. Run "connect-sedo config set-api-key <key>" or set SEDO_API_KEY environment variable.');
    process.exit(1);
  }

  return new Sedo({ partnerId, signKey, username, password });
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
  .command('set-partner-id <partnerId>')
  .description('Set Sedo partner ID')
  .action((partnerId: string) => {
    setPartnerId(partnerId);
    success('Partner ID saved successfully');
  });

configCmd
  .command('set-api-key <apiKey>')
  .description('Set Sedo API key (sign key)')
  .action((apiKey: string) => {
    setSignKey(apiKey);
    success('API key saved successfully');
  });

configCmd
  .command('set-username <username>')
  .description('Set Sedo account username (for domain management)')
  .action((username: string) => {
    setUsername(username);
    success('Username saved successfully');
  });

configCmd
  .command('set-password <password>')
  .description('Set Sedo account password (for domain management)')
  .action((password: string) => {
    setPassword(password);
    success('Password saved successfully');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const activeProfile = getActiveProfileName();
    const partnerId = getPartnerId();
    const signKey = getSignKey();
    const username = getUsername();
    const password = getPassword();
    info(`Active Profile: ${chalk.cyan(activeProfile)}`);
    info(`Partner ID: ${partnerId || chalk.gray('not set')}`);
    info(`API Key: ${signKey ? `${signKey.substring(0, 8)}...${signKey.substring(signKey.length - 4)}` : chalk.gray('not set')}`);
    info(`Username: ${username || chalk.gray('not set')}`);
    info(`Password: ${password ? '********' : chalk.gray('not set')}`);
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
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const activeProfile = getActiveProfileName();

    if (profiles.length === 0) {
      info('No profiles found. Use "connect-sedo profile create <name>" to create one.');
      return;
    }

    success('Available profiles:');
    profiles.forEach(p => {
      const isActive = p === activeProfile;
      console.log(`  ${isActive ? chalk.green('*') : ' '} ${isActive ? chalk.green(p) : p}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (setActiveProfile(name)) {
      success(`Switched to profile: ${name}`);
    } else {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--set-partner-id <id>', 'Partner ID')
  .option('--set-api-key <key>', 'API key (sign key)')
  .option('--set-username <username>', 'Account username')
  .option('--set-password <password>', 'Account password')
  .option('--use', 'Switch to this profile after creating')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    const config: { partnerId?: string; signKey?: string; username?: string; password?: string } = {};
    if (opts.setPartnerId) config.partnerId = opts.setPartnerId;
    if (opts.setApiKey) config.signKey = opts.setApiKey;
    if (opts.setUsername) config.username = opts.setUsername;
    if (opts.setPassword) config.password = opts.setPassword;

    if (createProfile(name, config)) {
      success(`Profile "${name}" created`);
      if (opts.use) {
        setActiveProfile(name);
        success(`Switched to profile: ${name}`);
      }
    } else {
      error(`Failed to create profile "${name}"`);
      process.exit(1);
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
      error(`Profile "${name}" does not exist or cannot be deleted`);
      process.exit(1);
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getActiveProfileName();
    const config = loadProfile(profileName);

    info(`Profile: ${chalk.cyan(profileName)}${!name ? ' (active)' : ''}`);
    info(`Partner ID: ${config.partnerId || chalk.gray('not set')}`);
    info(`API Key: ${config.signKey ? `${config.signKey.substring(0, 8)}...${config.signKey.substring(config.signKey.length - 4)}` : chalk.gray('not set')}`);
    info(`Username: ${config.username || chalk.gray('not set')}`);
    info(`Password: ${config.password ? '********' : chalk.gray('not set')}`);
  });

// ============================================
// Domain Commands
// ============================================
const domainsCmd = program
  .command('domains')
  .description('Domain marketplace commands');

domainsCmd
  .command('search <keyword>')
  .description('Search for domains in the Sedo marketplace')
  .option('-t, --tld <tld>', 'Filter by TLD (e.g., com, net, org)')
  .option('-m, --match <type>', 'Match type: B (begins), C (contains), E (ends)', 'C')
  .option('--no-hyphen', 'Exclude hyphenated domains')
  .option('--no-numeral', 'Exclude domains with numbers')
  .option('--no-idn', 'Exclude internationalized domains')
  .option('-l, --limit <number>', 'Maximum results (max 1000)', '50')
  .option('--lang <code>', 'Language code (ISO 639-1)')
  .action(async (keyword: string, opts) => {
    try {
      const client = getClient();
      const results = await client.domains.search({
        keyword,
        tld: opts.tld,
        kwtype: opts.match as 'B' | 'C' | 'E',
        noHyphen: opts.hyphen === false,
        noNumeral: opts.numeral === false,
        noIdn: opts.idn === false,
        resultSize: parseInt(opts.limit),
        language: opts.lang,
      });

      if (results.length === 0) {
        info('No domains found matching your search');
        return;
      }

      success(`Found ${results.length} domains:`);
      results.forEach(d => {
        const priceStr = d.price > 0 ? formatPrice(d.price, d.currencyCode) : 'Make Offer';
        const rankStr = d.rank === 1 ? chalk.green('exact') :
                       d.rank === 2 ? chalk.blue('begins') :
                       d.rank === 3 ? chalk.yellow('ends') :
                       chalk.gray('contains');
        console.log(`  ${chalk.bold(d.domain)} - ${priceStr} [${rankStr}]`);
      });

      if (getFormat(domainsCmd) === 'json') {
        print(results, 'json');
      }
    } catch (err) {
      error(formatError(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('status <domains...>')
  .description('Check status of domains on Sedo')
  .action(async (domains: string[]) => {
    try {
      const client = getClient();
      const results = await client.domains.status({ domains });

      if (results.length === 0) {
        info('No status information available');
        return;
      }

      results.forEach(d => {
        const status = d.domainStatus === 1 ? chalk.green('Listed') : chalk.gray('Not Listed');
        const forSale = d.forSale ? chalk.green('For Sale') : chalk.gray('Not for sale');
        const priceStr = d.price > 0 ? formatPrice(d.price, d.currencyCode) : 'No price';
        console.log(`${chalk.bold(d.domain)}: ${status} | ${forSale} | ${priceStr}`);
      });

      if (getFormat(domainsCmd) === 'json') {
        print(results, 'json');
      }
    } catch (err) {
      error(formatError(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('list')
  .description('List domains in your Sedo account (requires username/password)')
  .option('-l, --limit <number>', 'Maximum results (max 100)', '100')
  .option('-s, --start <number>', 'Starting position', '0')
  .option('-o, --order <order>', 'Order by: 0 (domain name), 1 (insert date)', '0')
  .action(async (opts) => {
    try {
      const client = getClient();

      if (!client.hasCredentials()) {
        error('Username and password required. Run:');
        info('  connect-sedo config set-username <username>');
        info('  connect-sedo config set-password <password>');
        process.exit(1);
      }

      const results = await client.domains.list({
        results: parseInt(opts.limit),
        startFrom: parseInt(opts.start),
        orderBy: parseInt(opts.order) as 0 | 1,
      });

      if (results.length === 0) {
        info('No domains found in your account');
        return;
      }

      success(`Found ${results.length} domains in your account:`);
      results.forEach(d => {
        const status = d.forSale ? chalk.green('For Sale') : chalk.gray('Not listed');
        const priceStr = d.price > 0 ? formatPrice(d.price, d.currencyCode) : 'No price';
        console.log(`  ${chalk.bold(d.domain)} - ${priceStr} [${status}]`);
      });

      if (getFormat(domainsCmd) === 'json') {
        print(results, 'json');
      }
    } catch (err) {
      error(formatError(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('add <domain>')
  .description('Add a domain to your Sedo account (requires username/password)')
  .option('--for-sale', 'List domain for sale')
  .option('--price <price>', 'Sale price')
  .option('--min-price <price>', 'Minimum acceptable price')
  .option('--fixed-price', 'Fixed price (no negotiation)')
  .option('--currency <code>', 'Currency: 0 (EUR), 1 (USD), 2 (GBP)', '1')
  .option('--lang <code>', 'Language code (ISO 639-1)')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();

      if (!client.hasCredentials()) {
        error('Username and password required for adding domains.');
        process.exit(1);
      }

      await client.domains.insert({
        domain,
        forSale: opts.forSale,
        price: opts.price ? parseFloat(opts.price) : undefined,
        minPrice: opts.minPrice ? parseFloat(opts.minPrice) : undefined,
        fixedPrice: opts.fixedPrice,
        currency: parseInt(opts.currency) as 0 | 1 | 2,
        language: opts.lang,
      });

      success(`Domain ${domain} added to your Sedo account`);
    } catch (err) {
      error(formatError(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('remove <domain>')
  .description('Remove a domain from your Sedo account (requires username/password)')
  .action(async (domain: string) => {
    try {
      const client = getClient();

      if (!client.hasCredentials()) {
        error('Username and password required for removing domains.');
        process.exit(1);
      }

      await client.domains.delete(domain);
      success(`Domain ${domain} removed from your Sedo account`);
    } catch (err) {
      error(formatError(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('edit <domain>')
  .description('Edit domain settings (requires username/password)')
  .option('--for-sale', 'List domain for sale')
  .option('--not-for-sale', 'Remove from sale')
  .option('--price <price>', 'Sale price')
  .option('--min-price <price>', 'Minimum acceptable price')
  .option('--fixed-price', 'Fixed price (no negotiation)')
  .option('--negotiable', 'Price is negotiable')
  .option('--currency <code>', 'Currency: 0 (EUR), 1 (USD), 2 (GBP)')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();

      if (!client.hasCredentials()) {
        error('Username and password required for editing domains.');
        process.exit(1);
      }

      await client.domains.edit({
        domain,
        forSale: opts.forSale ? true : opts.notForSale ? false : undefined,
        price: opts.price ? parseFloat(opts.price) : undefined,
        minPrice: opts.minPrice ? parseFloat(opts.minPrice) : undefined,
        fixedPrice: opts.fixedPrice ? true : opts.negotiable ? false : undefined,
        currency: opts.currency ? parseInt(opts.currency) as 0 | 1 | 2 : undefined,
      });

      success(`Domain ${domain} updated successfully`);
    } catch (err) {
      error(formatError(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
