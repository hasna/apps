#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Brandsight } from '../api';
import {
  getApiKey,
  getApiSecret,
  getCustomerId,
  setApiKey,
  setApiSecret,
  setCustomerId,
  setDefaultAccount,
  getDefaultAccount,
  clearConfig,
  getActiveProfileName,
  setActiveProfile,
  setProfileOverride,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  profileExists,
  type ProfileConfig,
} from '../utils/config';
import {
  saveContact,
  loadContact,
  listContacts,
  deleteContact,
  setDefaultContact,
  getDefaultContactName,
  getDefaultContact,
  toGoDaddyContact,
  validatePhone,
  validateCountry,
  validateEmail,
  type ContactInfo,
} from '../utils/contacts';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

// Read version from package.json
const pkg = await import('../../package.json');
const VERSION = pkg.version || '0.0.0';

const program = new Command();

program
  .name('connect-brandsight')
  .description('Brandsight/GoDaddy Domain API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Brandsight API key')
  .option('-s, --api-secret <secret>', 'Brandsight API secret')
  .option('-c, --customer-id <id>', 'Brandsight customer ID')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-brandsight profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.BRANDSIGHT_API_KEY = opts.apiKey;
    }
    if (opts.apiSecret) {
      process.env.BRANDSIGHT_API_SECRET = opts.apiSecret;
    }
    if (opts.customerId) {
      process.env.BRANDSIGHT_CUSTOMER_ID = opts.customerId;
    }
  });

// Helper to get Brandsight client
function getClient(): Brandsight {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  const customerId = getCustomerId();

  if (!apiKey) {
    error('No API key configured. Run "connect-brandsight config set-key <key>" or set BRANDSIGHT_API_KEY environment variable.');
    process.exit(1);
  }
  if (!apiSecret) {
    error('No API secret configured. Run "connect-brandsight config set-secret <secret>" or set BRANDSIGHT_API_SECRET environment variable.');
    process.exit(1);
  }

  return new Brandsight({ apiKey, apiSecret, customerId });
}

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
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
    const active = getActiveProfileName();

    if (profiles.length === 0) {
      info('No profiles found. Use "connect-brandsight profile create <name>" to create one.');
      return;
    }

    success(`Profiles:`);
    profiles.forEach(p => {
      const isActive = p === active ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist. Create it with "connect-brandsight profile create ${name}"`);
      process.exit(1);
    }
    setActiveProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--set-api-key <key>', 'API key')
  .option('--set-api-secret <secret>', 'API secret')
  .option('--set-customer-id <id>', 'Customer ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    const config: ProfileConfig = {};
    if (opts.setApiKey) config.apiKey = opts.setApiKey;
    if (opts.setApiSecret) config.apiSecret = opts.setApiSecret;
    if (opts.setCustomerId) config.customerId = opts.setCustomerId;

    createProfile(name, config);
    success(`Profile "${name}" created`);

    if (opts.use) {
      setActiveProfile(name);
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
    const profileName = name || getActiveProfileName();
    const config = loadProfile(profileName);
    const active = getActiveProfileName();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...${config.apiKey.substring(config.apiKey.length - 4)}` : chalk.gray('not set')}`);
    info(`API Secret: ${config.apiSecret ? `${config.apiSecret.substring(0, 4)}...${config.apiSecret.substring(config.apiSecret.length - 2)}` : chalk.gray('not set')}`);
    info(`Customer ID: ${config.customerId || chalk.gray('not set')}`);
    info(`Shopper ID: ${config.shopperId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set Brandsight API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getActiveProfileName()}`);
  });

configCmd
  .command('set-secret <apiSecret>')
  .description('Set Brandsight API secret')
  .action((apiSecret: string) => {
    setApiSecret(apiSecret);
    success(`API secret saved to profile: ${getActiveProfileName()}`);
  });

configCmd
  .command('set-customer-id <customerId>')
  .description('Set Brandsight customer ID (required for purchases)')
  .action((customerId: string) => {
    setCustomerId(customerId);
    success(`Customer ID set to: ${customerId}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getActiveProfileName();
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();
    const customerId = getCustomerId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : chalk.gray('not set')}`);
    info(`API Secret: ${apiSecret ? `${apiSecret.substring(0, 4)}...${apiSecret.substring(apiSecret.length - 2)}` : chalk.gray('not set')}`);
    info(`Customer ID: ${customerId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getActiveProfileName()}`);
  });

// ============================================
// Domain Commands
// ============================================
const domainsCmd = program
  .command('domains')
  .description('Domain management commands');

domainsCmd
  .command('check <domain>')
  .description('Check if a domain is available for registration')
  .option('-p, --period <years>', 'Registration period in years (1-10)', '1')
  .option('-t, --type <type>', 'Check type: REGISTRATION, RENEWAL, TRANSFER', 'REGISTRATION')
  .option('-o, --optimize <mode>', 'Optimize for: SPEED or ACCURACY', 'ACCURACY')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();
      const result = await client.domains.checkAvailability({
        domain,
        period: parseInt(opts.period),
        checkType: opts.type,
        optimizeFor: opts.optimize,
      });

      if (result.available) {
        success(`${domain} is AVAILABLE!`);
        if (result.price) {
          info(`Price: ${result.currency || 'USD'} ${(result.price / 100000).toFixed(2)} for ${result.period || 1} year(s)`);
        }
      } else {
        warn(`${domain} is NOT available`);
      }
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('check-bulk <domains...>')
  .description('Check availability for multiple domains (max 500)')
  .option('-t, --type <type>', 'Check type: REGISTRATION, RENEWAL, TRANSFER', 'REGISTRATION')
  .action(async (domains: string[], opts) => {
    try {
      const client = getClient();
      const result = await client.domains.checkBulkAvailability(domains, opts.type);

      const available = result.domains.filter(d => d.available);
      const unavailable = result.domains.filter(d => !d.available);

      if (available.length > 0) {
        success(`Available domains (${available.length}):`);
        available.forEach(d => console.log(`  ${chalk.green('✓')} ${d.domain}`));
      }
      if (unavailable.length > 0) {
        info(`Unavailable domains (${unavailable.length}):`);
        unavailable.forEach(d => console.log(`  ${chalk.red('✗')} ${d.domain}`));
      }
      if (result.errors && result.errors.length > 0) {
        warn(`Errors (${result.errors.length}):`);
        result.errors.forEach(e => console.log(`  ${chalk.yellow('!')} ${e.domain}: ${e.message}`));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('suggest <keyword>')
  .description('Get domain suggestions based on a keyword')
  .option('-l, --limit <number>', 'Maximum suggestions to return', '10')
  .option('--country <code>', 'Country code for localized suggestions')
  .option('--city <name>', 'City name for localized suggestions')
  .action(async (keyword: string, opts) => {
    try {
      const client = getClient();
      const suggestions = await client.domains.getSuggestions(keyword, {
        limit: parseInt(opts.limit),
        country: opts.country,
        city: opts.city,
      });

      if (suggestions.length === 0) {
        info('No suggestions found');
        return;
      }

      success(`Found ${suggestions.length} suggestions:`);
      suggestions.forEach(s => {
        const status = s.available ? chalk.green('available') : chalk.red('taken');
        const price = s.price ? ` - ${s.currency || 'USD'} ${(s.price / 100000).toFixed(2)}` : '';
        console.log(`  ${s.domain} [${status}]${price}`);
      });
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('list')
  .description('List all domains in your account')
  .option('-l, --limit <number>', 'Maximum domains to return', '100')
  .option('-s, --status <statuses>', 'Filter by status (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const domains = await client.domains.list({
        limit: parseInt(opts.limit),
        statuses: opts.status?.split(','),
      });

      if (domains.length === 0) {
        info('No domains found');
        return;
      }

      success(`Found ${domains.length} domains:`);
      print(domains, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('info <domain>')
  .description('Get detailed information about a domain')
  .action(async (domain: string) => {
    try {
      const client = getClient();
      const domainInfo = await client.domains.getInfo(domain);
      print(domainInfo, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('tlds')
  .description('List all supported TLDs')
  .action(async () => {
    try {
      const client = getClient();
      const tlds = await client.domains.getTlds();
      success(`Supported TLDs (${tlds.length}):`);
      console.log(tlds.join(', '));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('agreements <tlds...>')
  .description('Get legal agreements required for domain registration')
  .option('--privacy', 'Include privacy agreement')
  .option('--transfer', 'Get agreements for transfer')
  .action(async (tlds: string[], opts) => {
    try {
      const client = getClient();
      const agreements = await client.domains.getAgreements({
        tlds,
        privacy: opts.privacy,
        forTransfer: opts.transfer,
      });

      success(`Found ${agreements.length} agreements:`);
      agreements.forEach(a => {
        console.log(`\n${chalk.bold(a.title)}`);
        console.log(`Key: ${a.agreementKey}`);
        if (a.url) console.log(`URL: ${a.url}`);
      });
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('purchase <domain>')
  .description('Purchase/register a domain (requires customer-id)')
  .option('-p, --period <years>', 'Registration period in years', '1')
  .option('--privacy', 'Enable privacy protection')
  .option('--auto-renew', 'Enable auto-renewal')
  .option('--contact <name>', 'Use saved contact by name (or "default" for default contact)')
  .option('--contact-json <file>', 'Path to JSON file with contact details')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();
      const customerId = getCustomerId();

      if (!customerId) {
        error('Customer ID is required for purchases. Run "connect-brandsight config set-customer-id <id>"');
        process.exit(1);
      }

      let contactData: any;

      // Get contact data from saved contact or JSON file
      if (opts.contact) {
        const contactName = opts.contact === 'default' ? getDefaultContactName() : opts.contact;
        if (!contactName) {
          error('No default contact set. Use "connect-brandsight contacts set-default <name>" or specify a contact name.');
          process.exit(1);
        }

        const savedContact = loadContact(contactName);
        if (!savedContact) {
          error(`Contact "${contactName}" not found. Use "connect-brandsight contacts list" to see available contacts.`);
          process.exit(1);
        }

        contactData = toGoDaddyContact(savedContact);
        info(`Using contact: ${savedContact.nameFirst} ${savedContact.nameLast} <${savedContact.email}>`);
      } else if (opts.contactJson) {
        contactData = JSON.parse(await Bun.file(opts.contactJson).text());
      } else {
        // Try default contact
        const defaultContact = getDefaultContact();
        if (defaultContact) {
          contactData = toGoDaddyContact(defaultContact);
          info(`Using default contact: ${defaultContact.nameFirst} ${defaultContact.nameLast} <${defaultContact.email}>`);
        } else {
          error('Contact details required. Use --contact <name> or --contact-json <file>');
          info('Or add a default contact: connect-brandsight contacts add <name> --default ...');
          info('See "connect-brandsight contacts add --help" for required fields.');
          process.exit(1);
        }
      }

      // Check availability to get price and currency
      info('Checking domain availability and price...');
      const availability = await client.domains.checkAvailability({
        domain,
        period: parseInt(opts.period),
        checkType: 'REGISTRATION',
      });

      if (!availability.available) {
        error(`Domain ${domain} is not available for registration`);
        process.exit(1);
      }

      if (!availability.price) {
        error('Could not retrieve price for domain. Please try again.');
        process.exit(1);
      }

      const price = availability.price;
      const currency = availability.currency || 'USD';
      info(`Price: ${currency} ${(price / 100000).toFixed(2)}`);

      // Get agreements
      const tld = domain.split('.').pop() || 'com';
      const agreements = await client.domains.getAgreements({
        tlds: [tld],
        privacy: opts.privacy,
      });

      // Add encoding to contact
      const registrantContact = {
        ...contactData,
        encoding: 'ASCII',
      };

      // Get public IP for consent
      let clientIp = '0.0.0.0';
      try {
        const ipResponse = await fetch('https://api.ipify.org');
        clientIp = await ipResponse.text();
      } catch {
        // Fallback if can't get IP
      }

      const purchaseRequest = {
        domain,
        consent: {
          agreedAt: new Date().toISOString(),
          agreedBy: clientIp,
          agreementKeys: agreements.map((a: any) => a.agreementKey),
          price,
          currency,
        },
        contacts: {
          registrant: registrantContact,
          admin: registrantContact,
          tech: registrantContact,
          billing: registrantContact,
        },
        period: parseInt(opts.period),
        privacy: opts.privacy || false,
        renewAuto: opts.autoRenew || false,
      };

      // Validate first
      info('Validating purchase request...');
      await client.domains.validatePurchase(purchaseRequest);
      success('Validation passed');

      // Then purchase
      info('Submitting purchase request...');
      const result = await client.domains.purchase(purchaseRequest);
      success(`Domain ${domain} purchase initiated!`);
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('renew <domain>')
  .description('Renew a domain')
  .option('-p, --period <years>', 'Renewal period in years', '1')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();
      const result = await client.domains.renew(domain, {
        period: parseInt(opts.period),
      });
      success(`Domain ${domain} renewed successfully!`);
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Contact Commands
// ============================================
const contactsCmd = program
  .command('contacts')
  .description('Manage contacts for domain registration');

contactsCmd
  .command('add <name>')
  .description('Add a new contact')
  .requiredOption('--first-name <name>', 'First name')
  .requiredOption('--last-name <name>', 'Last name')
  .requiredOption('--email <email>', 'Email address')
  .requiredOption('--phone <phone>', 'Phone with country code (e.g., +1.5551234567)')
  .requiredOption('--address <address>', 'Street address')
  .requiredOption('--city <city>', 'City')
  .requiredOption('--state <state>', 'State/Province')
  .requiredOption('--postal-code <code>', 'Postal/ZIP code')
  .requiredOption('--country <code>', 'Country code (2-letter, e.g., US, UK, CA)')
  .option('--middle-name <name>', 'Middle name')
  .option('--organization <org>', 'Organization/Company')
  .option('--job-title <title>', 'Job title')
  .option('--address2 <address>', 'Address line 2')
  .option('--fax <fax>', 'Fax number')
  .option('--default', 'Set as default contact')
  .action(async (name: string, opts) => {
    // Validate inputs
    if (!validateEmail(opts.email)) {
      error('Invalid email format');
      process.exit(1);
    }
    if (!validatePhone(opts.phone)) {
      error('Invalid phone format. Use format: +1.5551234567');
      process.exit(1);
    }
    if (!validateCountry(opts.country)) {
      error('Invalid country code. Use 2-letter code (e.g., US, UK, CA)');
      process.exit(1);
    }

    const contact: ContactInfo = {
      nameFirst: opts.firstName,
      nameLast: opts.lastName,
      nameMiddle: opts.middleName,
      email: opts.email,
      phone: opts.phone,
      address1: opts.address,
      address2: opts.address2,
      city: opts.city,
      state: opts.state,
      postalCode: opts.postalCode,
      country: opts.country.toUpperCase(),
      organization: opts.organization,
      jobTitle: opts.jobTitle,
      fax: opts.fax,
    };

    saveContact(name, contact);
    success(`Contact "${name}" saved successfully`);

    if (opts.default) {
      setDefaultContact(name);
      info(`Set as default contact`);
    }
  });

contactsCmd
  .command('list')
  .description('List all saved contacts')
  .action(() => {
    const contacts = listContacts();
    const defaultName = getDefaultContactName();

    if (contacts.length === 0) {
      info('No contacts saved. Use "connect-brandsight contacts add <name>" to add one.');
      return;
    }

    success(`Found ${contacts.length} contact(s):`);
    contacts.forEach(c => {
      const isDefault = c.name === defaultName ? chalk.green(' (default)') : '';
      console.log(`  ${chalk.bold(c.name)}${isDefault}`);
      console.log(`    ${c.nameFirst} ${c.nameLast} <${c.email}>`);
      console.log(`    ${c.address1}, ${c.city}, ${c.state} ${c.postalCode}, ${c.country}`);
    });
  });

contactsCmd
  .command('show <name>')
  .description('Show details of a contact')
  .action((name: string) => {
    const contact = loadContact(name);

    if (!contact) {
      error(`Contact "${name}" not found`);
      process.exit(1);
    }

    const defaultName = getDefaultContactName();
    const isDefault = contact.name === defaultName ? chalk.green(' (default)') : '';

    console.log(`${chalk.bold(contact.name)}${isDefault}`);
    console.log(`  Name: ${contact.nameFirst}${contact.nameMiddle ? ' ' + contact.nameMiddle : ''} ${contact.nameLast}`);
    console.log(`  Email: ${contact.email}`);
    console.log(`  Phone: ${contact.phone}`);
    if (contact.fax) console.log(`  Fax: ${contact.fax}`);
    if (contact.organization) console.log(`  Organization: ${contact.organization}`);
    if (contact.jobTitle) console.log(`  Job Title: ${contact.jobTitle}`);
    console.log(`  Address: ${contact.address1}`);
    if (contact.address2) console.log(`           ${contact.address2}`);
    console.log(`           ${contact.city}, ${contact.state} ${contact.postalCode}`);
    console.log(`           ${contact.country}`);
    console.log(`  Created: ${contact.createdAt}`);
    console.log(`  Updated: ${contact.updatedAt}`);
  });

contactsCmd
  .command('remove <name>')
  .description('Remove a contact')
  .action((name: string) => {
    if (deleteContact(name)) {
      success(`Contact "${name}" removed`);
    } else {
      error(`Contact "${name}" not found`);
      process.exit(1);
    }
  });

contactsCmd
  .command('set-default <name>')
  .description('Set a contact as the default')
  .action((name: string) => {
    if (setDefaultContact(name)) {
      success(`"${name}" is now the default contact`);
    } else {
      error(`Contact "${name}" not found`);
      process.exit(1);
    }
  });

// ============================================
// DNS Commands
// ============================================
const dnsCmd = program
  .command('dns')
  .description('DNS record management');

dnsCmd
  .command('list <domain>')
  .description('List DNS records for a domain')
  .option('-t, --type <type>', 'Filter by record type (A, AAAA, CNAME, MX, TXT, etc.)')
  .option('-n, --name <name>', 'Filter by record name')
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();
      const records = await client.domains.getDnsRecords(domain, opts.type, opts.name);

      if (records.length === 0) {
        info('No DNS records found');
        return;
      }

      success(`Found ${records.length} DNS records:`);
      print(records, getFormat(dnsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('add <domain> <type> <name> <data>')
  .description('Add a DNS record')
  .option('--ttl <seconds>', 'Time to live in seconds', '3600')
  .action(async (domain: string, type: string, name: string, data: string, opts) => {
    try {
      const client = getClient();
      await client.domains.addDnsRecords(domain, [{
        type: type.toUpperCase(),
        name,
        data,
        ttl: parseInt(opts.ttl),
      }]);
      success(`DNS record added: ${type} ${name} -> ${data}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
