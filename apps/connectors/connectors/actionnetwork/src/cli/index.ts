#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-actionnetwork';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Action Network API connector - progressive organizing platform')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.ACTION_NETWORK_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ACTION_NETWORK_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key (OSDI-API-Token)')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// People Commands
// ============================================
const peopleCmd = program
  .command('people')
  .description('Manage people/activists');

peopleCmd
  .command('list')
  .description('List people')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--filter <odata>', 'OData filter expression')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.people.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        filter: opts.filter,
      });
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('get <personId>')
  .description('Get a person by ID')
  .action(async (personId: string) => {
    try {
      const client = getClient();
      const result = await client.people.get(personId);
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('signup')
  .description('Sign up a new person (or update if exists)')
  .requiredOption('--email <email>', 'Email address')
  .option('--given-name <name>', 'First name')
  .option('--family-name <name>', 'Last name')
  .option('--phone <number>', 'Phone number')
  .option('--postal-code <code>', 'Postal/ZIP code')
  .option('--country <code>', 'Country code')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {
        person: {
          email_addresses: [{ address: opts.email }],
          ...(opts.givenName && { given_name: opts.givenName }),
          ...(opts.familyName && { family_name: opts.familyName }),
          ...(opts.phone && { phone_numbers: [{ number: opts.phone }] }),
          ...(opts.postalCode && {
            postal_addresses: [{
              postal_code: opts.postalCode,
              ...(opts.country && { country: opts.country }),
            }],
          }),
        },
      };
      const result = await client.people.signup(params as never);
      success('Person signed up!');
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('update <personId>')
  .description('Update a person')
  .option('--given-name <name>', 'First name')
  .option('--family-name <name>', 'Last name')
  .option('--email <email>', 'Email address')
  .option('--phone <number>', 'Phone number')
  .action(async (personId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.givenName) params.given_name = opts.givenName;
      if (opts.familyName) params.family_name = opts.familyName;
      if (opts.email) params.email_addresses = [{ address: opts.email }];
      if (opts.phone) params.phone_numbers = [{ number: opts.phone }];
      const result = await client.people.update(personId, params as never);
      success('Person updated!');
      print(result, getFormat(peopleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Petitions Commands
// ============================================
const petitionsCmd = program
  .command('petitions')
  .description('Manage petitions');

petitionsCmd
  .command('list')
  .description('List petitions')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--filter <odata>', 'OData filter expression')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.petitions.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        filter: opts.filter,
      });
      print(result, getFormat(petitionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

petitionsCmd
  .command('get <petitionId>')
  .description('Get a petition by ID')
  .action(async (petitionId: string) => {
    try {
      const client = getClient();
      const result = await client.petitions.get(petitionId);
      print(result, getFormat(petitionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

petitionsCmd
  .command('create')
  .description('Create a new petition')
  .requiredOption('--title <title>', 'Petition title')
  .option('--description <text>', 'Petition description')
  .option('--target <target>', 'Petition target')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.petitions.create({
        title: opts.title,
        description: opts.description,
        target: opts.target,
      } as never);
      success('Petition created!');
      print(result, getFormat(petitionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

petitionsCmd
  .command('update <petitionId>')
  .description('Update a petition')
  .option('--title <title>', 'Petition title')
  .option('--description <text>', 'Petition description')
  .action(async (petitionId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.title) params.title = opts.title;
      if (opts.description) params.description = opts.description;
      const result = await client.petitions.update(petitionId, params as never);
      success('Petition updated!');
      print(result, getFormat(petitionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

petitionsCmd
  .command('signatures <petitionId>')
  .description('List signatures for a petition')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (petitionId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.petitions.listSignatures(petitionId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(petitionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

petitionsCmd
  .command('sign <petitionId>')
  .description('Record a signature on a petition')
  .requiredOption('--email <email>', 'Signer email')
  .option('--given-name <name>', 'First name')
  .option('--family-name <name>', 'Last name')
  .action(async (petitionId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.petitions.createSignature(petitionId, {
        person: {
          email_addresses: [{ address: opts.email }],
          ...(opts.givenName && { given_name: opts.givenName }),
          ...(opts.familyName && { family_name: opts.familyName }),
        },
      } as never);
      success('Signature recorded!');
      print(result, getFormat(petitionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Events Commands
// ============================================
const eventsCmd = program
  .command('events')
  .description('Manage events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--filter <odata>', 'OData filter expression')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        filter: opts.filter,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <eventId>')
  .description('Get an event by ID')
  .action(async (eventId: string) => {
    try {
      const client = getClient();
      const result = await client.events.get(eventId);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('create')
  .description('Create a new event')
  .requiredOption('--title <title>', 'Event title')
  .option('--description <text>', 'Event description')
  .option('--start-date <date>', 'Start date (ISO 8601)')
  .option('--venue <venue>', 'Venue name')
  .option('--location <address>', 'Location address')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.create({
        title: opts.title,
        description: opts.description,
        start_date: opts.startDate,
        ...(opts.venue && { location: { venue: opts.venue, address_lines: opts.location ? [opts.location] : undefined } }),
      } as never);
      success('Event created!');
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('update <eventId>')
  .description('Update an event')
  .option('--title <title>', 'Event title')
  .option('--description <text>', 'Event description')
  .option('--start-date <date>', 'Start date (ISO 8601)')
  .action(async (eventId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.title) params.title = opts.title;
      if (opts.description) params.description = opts.description;
      if (opts.startDate) params.start_date = opts.startDate;
      const result = await client.events.update(eventId, params as never);
      success('Event updated!');
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('attendances <eventId>')
  .description('List attendances for an event')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (eventId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.events.listAttendances(eventId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('attend <eventId>')
  .description('Record an attendance for an event')
  .requiredOption('--email <email>', 'Attendee email')
  .option('--given-name <name>', 'First name')
  .option('--family-name <name>', 'Last name')
  .action(async (eventId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.events.createAttendance(eventId, {
        person: {
          email_addresses: [{ address: opts.email }],
          ...(opts.givenName && { given_name: opts.givenName }),
          ...(opts.familyName && { family_name: opts.familyName }),
        },
      } as never);
      success('Attendance recorded!');
      print(result, getFormat(eventsCmd));
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
  .description('Manage forms');

formsCmd
  .command('list')
  .description('List forms')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--filter <odata>', 'OData filter expression')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.forms.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        filter: opts.filter,
      });
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('get <formId>')
  .description('Get a form by ID')
  .action(async (formId: string) => {
    try {
      const client = getClient();
      const result = await client.forms.get(formId);
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('create')
  .description('Create a new form')
  .requiredOption('--title <title>', 'Form title')
  .option('--description <text>', 'Form description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.forms.create({
        title: opts.title,
        description: opts.description,
      } as never);
      success('Form created!');
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('update <formId>')
  .description('Update a form')
  .option('--title <title>', 'Form title')
  .option('--description <text>', 'Form description')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.title) params.title = opts.title;
      if (opts.description) params.description = opts.description;
      const result = await client.forms.update(formId, params as never);
      success('Form updated!');
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('submissions <formId>')
  .description('List submissions for a form')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.forms.listSubmissions(formId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('submit <formId>')
  .description('Create a submission for a form')
  .requiredOption('--email <email>', 'Submitter email')
  .option('--given-name <name>', 'First name')
  .option('--family-name <name>', 'Last name')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.forms.createSubmission(formId, {
        person: {
          email_addresses: [{ address: opts.email }],
          ...(opts.givenName && { given_name: opts.givenName }),
          ...(opts.familyName && { family_name: opts.familyName }),
        },
      } as never);
      success('Submission recorded!');
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Fundraising Commands
// ============================================
const fundraisingCmd = program
  .command('fundraising')
  .description('Manage fundraising pages and donations');

fundraisingCmd
  .command('list')
  .description('List fundraising pages')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--filter <odata>', 'OData filter expression')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.fundraising.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        filter: opts.filter,
      });
      print(result, getFormat(fundraisingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fundraisingCmd
  .command('get <pageId>')
  .description('Get a fundraising page by ID')
  .action(async (pageId: string) => {
    try {
      const client = getClient();
      const result = await client.fundraising.get(pageId);
      print(result, getFormat(fundraisingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fundraisingCmd
  .command('create')
  .description('Create a new fundraising page')
  .requiredOption('--title <title>', 'Fundraising page title')
  .option('--description <text>', 'Page description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.fundraising.create({
        title: opts.title,
        description: opts.description,
      } as never);
      success('Fundraising page created!');
      print(result, getFormat(fundraisingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fundraisingCmd
  .command('update <pageId>')
  .description('Update a fundraising page')
  .option('--title <title>', 'Page title')
  .option('--description <text>', 'Page description')
  .action(async (pageId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.title) params.title = opts.title;
      if (opts.description) params.description = opts.description;
      const result = await client.fundraising.update(pageId, params as never);
      success('Fundraising page updated!');
      print(result, getFormat(fundraisingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fundraisingCmd
  .command('donations <pageId>')
  .description('List donations for a fundraising page')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (pageId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.fundraising.listDonations(pageId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(fundraisingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fundraisingCmd
  .command('donate <pageId>')
  .description('Record a donation')
  .requiredOption('--email <email>', 'Donor email')
  .requiredOption('--amount <amount>', 'Donation amount (e.g., "20.00")')
  .option('--currency <code>', 'Currency code (default: USD)', 'USD')
  .option('--given-name <name>', 'First name')
  .option('--family-name <name>', 'Last name')
  .action(async (pageId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.fundraising.createDonation(pageId, {
        recipients: [{
          amount: opts.amount,
          display_name: 'Donation',
        }],
        currency: opts.currency,
        person: {
          email_addresses: [{ address: opts.email }],
          ...(opts.givenName && { given_name: opts.givenName }),
          ...(opts.familyName && { family_name: opts.familyName }),
        },
      } as never);
      success('Donation recorded!');
      print(result, getFormat(fundraisingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Tags Commands
// ============================================
const tagsCmd = program
  .command('tags')
  .description('Manage tags and taggings');

tagsCmd
  .command('list')
  .description('List tags')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tags.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('get <tagId>')
  .description('Get a tag by ID')
  .action(async (tagId: string) => {
    try {
      const client = getClient();
      const result = await client.tags.get(tagId);
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('create')
  .description('Create a new tag')
  .requiredOption('--name <name>', 'Tag name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tags.create({
        name: opts.name,
      });
      success('Tag created!');
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('taggings <tagId>')
  .description('List taggings (people tagged) for a tag')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (tagId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tags.listTaggings(tagId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('tag-person <tagId>')
  .description('Tag a person')
  .requiredOption('--person-url <url>', 'Person API URL (from _links.self.href)')
  .action(async (tagId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tags.createTagging(tagId, {
        _links: {
          'osdi:person': { href: opts.personUrl },
        },
      } as never);
      success('Person tagged!');
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('untag <tagId> <taggingId>')
  .description('Remove a tagging')
  .action(async (tagId: string, taggingId: string) => {
    try {
      const client = getClient();
      await client.tags.deleteTagging(tagId, taggingId);
      success('Tagging removed!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Messages Commands
// ============================================
const messagesCmd = program
  .command('messages')
  .description('Manage email messages');

messagesCmd
  .command('list')
  .description('List messages')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.messages.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('get <messageId>')
  .description('Get a message by ID')
  .action(async (messageId: string) => {
    try {
      const client = getClient();
      const result = await client.messages.get(messageId);
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('create')
  .description('Create a new message')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--body <html>', 'Email body (HTML)')
  .option('--from <name>', 'From name')
  .option('--reply-to <email>', 'Reply-to email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.messages.create({
        subject: opts.subject,
        body: opts.body,
        from: opts.from,
        reply_to: opts.replyTo,
      } as never);
      success('Message created!');
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('update <messageId>')
  .description('Update a message')
  .option('--subject <subject>', 'Email subject')
  .option('--body <html>', 'Email body (HTML)')
  .action(async (messageId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.subject) params.subject = opts.subject;
      if (opts.body) params.body = opts.body;
      const result = await client.messages.update(messageId, params as never);
      success('Message updated!');
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Advocacy Commands
// ============================================
const advocacyCmd = program
  .command('advocacy')
  .description('Manage advocacy campaigns');

advocacyCmd
  .command('list')
  .description('List advocacy campaigns')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--filter <odata>', 'OData filter expression')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.advocacy.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        filter: opts.filter,
      });
      print(result, getFormat(advocacyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

advocacyCmd
  .command('get <campaignId>')
  .description('Get an advocacy campaign by ID')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.advocacy.get(campaignId);
      print(result, getFormat(advocacyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

advocacyCmd
  .command('create')
  .description('Create a new advocacy campaign')
  .requiredOption('--title <title>', 'Campaign title')
  .option('--description <text>', 'Campaign description')
  .option('--target <target>', 'Campaign target')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.advocacy.create({
        title: opts.title,
        description: opts.description,
        target: opts.target,
      } as never);
      success('Advocacy campaign created!');
      print(result, getFormat(advocacyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

advocacyCmd
  .command('update <campaignId>')
  .description('Update an advocacy campaign')
  .option('--title <title>', 'Campaign title')
  .option('--description <text>', 'Campaign description')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.title) params.title = opts.title;
      if (opts.description) params.description = opts.description;
      const result = await client.advocacy.update(campaignId, params as never);
      success('Advocacy campaign updated!');
      print(result, getFormat(advocacyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

advocacyCmd
  .command('outreaches <campaignId>')
  .description('List outreaches for an advocacy campaign')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.advocacy.listOutreaches(campaignId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(advocacyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
