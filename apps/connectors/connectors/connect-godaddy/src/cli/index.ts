#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { GoDaddy } from '../api';
import {
  getApiKey,
  getApiSecret,
  setCredentials,
  clearConfig,
  getConfigDir,
  isAuthenticated,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const program = new Command();

program
  .name('connect-godaddy')
  .description('GoDaddy API connector CLI - Manage domains, DNS records, and availability')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-godaddy profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function requireAuth(): GoDaddy {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-godaddy config set-credentials <key> <secret>" or set GODADDY_API_KEY and GODADDY_API_SECRET.');
    process.exit(1);
  }
  return GoDaddy.create();
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
  .option('--api-key <key>', 'API key')
  .option('--api-secret <secret>', 'API secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${config.apiSecret ? `${config.apiSecret.substring(0, 4)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-credentials <apiKey> <apiSecret>')
  .description('Set GoDaddy API key and secret')
  .action((apiKey: string, apiSecret: string) => {
    setCredentials(apiKey, apiSecret);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${apiSecret ? `${apiSecret.substring(0, 4)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Domains Commands
// ============================================
const domainsCmd = program
  .command('domains')
  .description('Domain management commands');

domainsCmd
  .command('list')
  .description('List all domains in your account')
  .option('-l, --limit <limit>', 'Maximum domains to return')
  .option('-s, --statuses <statuses>', 'Filter by status (comma-separated: ACTIVE,EXPIRED)')
  .action(async (opts) => {
    try {
      const gd = requireAuth();
      const params: { limit?: number; statuses?: string[] } = {};
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.statuses) params.statuses = opts.statuses.split(',');

      const domains = await gd.domains.list(params);

      if (!domains || domains.length === 0) {
        info('No domains found');
        return;
      }

      const formatted = domains.map(d => ({
        domain: d.domain,
        status: d.status,
        expires: d.expires ? new Date(d.expires).toLocaleDateString() : 'N/A',
        autoRenew: d.renewAuto ? 'Yes' : 'No',
        nameservers: d.nameServers?.join(', ') || '',
      }));

      success(`Found ${domains.length} domain(s):`);
      print(formatted, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('get <domain>')
  .description('Get detailed information for a domain')
  .action(async (domain: string) => {
    try {
      const gd = requireAuth();
      const detail = await gd.domains.getInfo(domain);
      print(detail, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('renew <domain>')
  .description('Renew a domain')
  .option('-y, --years <years>', 'Number of years to renew', '1')
  .action(async (domain: string, opts) => {
    try {
      const gd = requireAuth();
      const result = await gd.domains.renew(domain, parseInt(opts.years));
      success(`Domain "${domain}" renewed!`);
      info(`Order ID: ${result.orderId}`);
      info(`Total: ${result.total}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('available <domain>')
  .description('Check if a domain is available for purchase')
  .action(async (domain: string) => {
    try {
      const gd = requireAuth();
      const result = await gd.domains.checkAvailability(domain);

      if (result.available) {
        success(`${domain} is available!`);
        info(`Price: ${result.price} ${result.currency}`);
        info(`Period: ${result.period} year(s)`);
      } else {
        warn(`${domain} is not available`);
      }

      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// DNS Commands
// ============================================
const dnsCmd = program
  .command('dns')
  .description('DNS record management commands');

dnsCmd
  .command('list <domain>')
  .description('List DNS records for a domain')
  .option('-t, --type <type>', 'Filter by record type (A, AAAA, CNAME, TXT, MX, etc.)')
  .action(async (domain: string, opts) => {
    try {
      const gd = requireAuth();
      const records = await gd.dns.getRecords(domain, opts.type);

      if (!records || records.length === 0) {
        info('No DNS records found');
        return;
      }

      const formatted = records.map(r => ({
        type: r.type,
        name: r.name,
        data: r.data.length > 50 ? r.data.substring(0, 50) + '...' : r.data,
        ttl: r.ttl,
        priority: r.priority ?? '-',
      }));

      success(`Found ${records.length} record(s):`);
      print(formatted, getFormat(dnsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('get <domain> <type> <name>')
  .description('Get DNS records by type and name')
  .action(async (domain: string, type: string, name: string) => {
    try {
      const gd = requireAuth();
      const records = await gd.dns.getRecordsByName(domain, type.toUpperCase(), name);
      print(records, getFormat(dnsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('set <domain> <type>')
  .description('Set DNS records for a domain by type (replaces existing records of that type)')
  .requiredOption('-r, --records <json>', 'JSON array of records [{name, data, ttl, priority?}]')
  .action(async (domain: string, type: string, opts) => {
    try {
      const gd = requireAuth();
      const records = JSON.parse(opts.records);

      if (!Array.isArray(records)) {
        error('Records must be a JSON array');
        process.exit(1);
      }

      await gd.dns.setRecords(domain, type.toUpperCase(), records);
      success(`DNS records of type ${type.toUpperCase()} set for ${domain}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('add <domain>')
  .description('Add a DNS record to a domain')
  .requiredOption('-t, --type <type>', 'Record type (A, AAAA, CNAME, TXT, MX, etc.)')
  .requiredOption('-n, --name <name>', 'Record name (@ for root)')
  .requiredOption('-d, --data <data>', 'Record data (IP address, hostname, text, etc.)')
  .option('--ttl <ttl>', 'TTL in seconds', '3600')
  .option('--priority <priority>', 'Priority (for MX records)')
  .action(async (domain: string, opts) => {
    try {
      const gd = requireAuth();
      const record: Record<string, unknown> = {
        type: opts.type.toUpperCase(),
        name: opts.name,
        data: opts.data,
        ttl: parseInt(opts.ttl),
      };

      if (opts.priority !== undefined) {
        record.priority = parseInt(opts.priority);
      }

      await gd.dns.addRecords(domain, [record as any]);
      success(`DNS record added to ${domain}`);
      info(`Type: ${opts.type.toUpperCase()}, Name: ${opts.name}, Data: ${opts.data}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
