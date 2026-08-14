#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getUsername,
  setUsername,
  getClientIp,
  setClientIp,
  getSandbox,
  setSandbox,
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
import { success, error, info, print, warn } from '../utils/output';
import { splitDomain } from '../utils/xml';

// Connector name and version
const CONNECTOR_NAME = 'connect-namecheap';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Namecheap API connector CLI — manage domains and DNS')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --username <username>', 'Username (overrides config)')
  .option('--client-ip <ip>', 'Client IP (overrides config)')
  .option('--sandbox', 'Use sandbox API')
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
      process.env.NAMECHEAP_API_KEY = opts.apiKey;
    }
    if (opts.username) {
      process.env.NAMECHEAP_USERNAME = opts.username;
    }
    if (opts.clientIp) {
      process.env.NAMECHEAP_CLIENT_IP = opts.clientIp;
    }
    if (opts.sandbox) {
      process.env.NAMECHEAP_SANDBOX = 'true';
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  const username = getUsername();
  const clientIp = getClientIp();
  const sandbox = getSandbox();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set NAMECHEAP_API_KEY environment variable.`);
    process.exit(1);
  }
  if (!username) {
    error(`No username configured. Run "${CONNECTOR_NAME} config set-username <username>" or set NAMECHEAP_USERNAME environment variable.`);
    process.exit(1);
  }
  if (!clientIp) {
    error(`No client IP configured. Run "${CONNECTOR_NAME} config set-client-ip <ip>" or set NAMECHEAP_CLIENT_IP environment variable.`);
    process.exit(1);
  }

  return new Connector({ apiKey, username, clientIp, sandbox });
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
  .option('--username <username>', 'Username')
  .option('--client-ip <ip>', 'Client IP')
  .option('--sandbox', 'Use sandbox API')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      username: opts.username,
      clientIp: opts.clientIp,
      sandbox: opts.sandbox,
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
    info(`Username: ${config.username || chalk.gray('not set')}`);
    info(`Client IP: ${config.clientIp || chalk.gray('not set')}`);
    info(`Sandbox: ${config.sandbox ? 'yes' : 'no'}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-username <username>')
  .description('Set username')
  .action((username: string) => {
    setUsername(username);
    success(`Username saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-client-ip <ip>')
  .description('Set whitelisted client IP')
  .action((ip: string) => {
    setClientIp(ip);
    success(`Client IP saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-sandbox <enabled>')
  .description('Enable or disable sandbox mode (true/false)')
  .action((enabled: string) => {
    setSandbox(enabled === 'true');
    success(`Sandbox ${enabled === 'true' ? 'enabled' : 'disabled'} for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const username = getUsername();
    const clientIp = getClientIp();
    const sandbox = getSandbox();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Username: ${username || chalk.gray('not set')}`);
    info(`Client IP: ${clientIp || chalk.gray('not set')}`);
    info(`Sandbox: ${sandbox ? 'yes' : 'no'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Domain Commands
// ============================================
const domainCmd = program
  .command('domain')
  .description('Manage domains');

domainCmd
  .command('list')
  .description('List all domains')
  .option('-l, --limit <number>', 'Page size', '100')
  .option('--page <number>', 'Page number', '1')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.domains.list({
        pageSize: parseInt(opts.limit),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('info <domain>')
  .description('Get detailed info for a domain')
  .action(async function(this: Command, domain: string) {
    try {
      const client = getClient();
      const result = await client.domains.getInfo(domain);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('renew <domain>')
  .description('Renew a domain')
  .option('-y, --years <number>', 'Number of years to renew', '1')
  .action(async function(this: Command, domain: string, opts) {
    try {
      const client = getClient();
      const result = await client.domains.renew(domain, parseInt(opts.years));
      success(`Domain ${domain} renewed for ${opts.years} year(s)`);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('check <domain>')
  .description('Check domain availability')
  .action(async function(this: Command, domain: string) {
    try {
      const client = getClient();
      const result = await client.domains.check(domain);
      if (result.available) {
        success(`${domain} is available!`);
      } else {
        warn(`${domain} is not available`);
      }
      print(result, getFormat(this));
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
  .description('Manage DNS records');

dnsCmd
  .command('get <domain>')
  .description('Get DNS records for a domain')
  .action(async function(this: Command, domain: string) {
    try {
      const client = getClient();
      const { sld, tld } = splitDomain(domain);
      const result = await client.dns.getHosts(sld, tld);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('set <domain>')
  .description('Set DNS records for a domain (replaces ALL records)')
  .requiredOption('--records <json>', 'JSON array of DNS records [{type, name, address, ttl, mxPref?}]')
  .action(async function(this: Command, domain: string, opts) {
    try {
      const client = getClient();
      const { sld, tld } = splitDomain(domain);
      const records = JSON.parse(opts.records);

      if (!Array.isArray(records)) {
        error('Records must be a JSON array');
        process.exit(1);
      }

      // Validate records
      for (const r of records) {
        if (!r.type || !r.name || !r.address) {
          error('Each record must have type, name, and address fields');
          process.exit(1);
        }
        if (!r.ttl) r.ttl = 1800;
      }

      await client.dns.setHosts(sld, tld, records);
      success(`DNS records set for ${domain} (${records.length} records)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
