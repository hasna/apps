#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tepali } from '../api';
import type { RequestOptions } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-tepali';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tepali connector CLI - medspa operating system (patients, appointments, treatments, charting, inventory, leads)')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-b, --base-url <url>', 'API base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
      process.env.TEPALI_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.TEPALI_BASE_URL = opts.baseUrl;
      debug(`Base URL set from command line flag: ${opts.baseUrl}`);
    }
  });

function getFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tepali {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TEPALI_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Tepali({ apiKey, baseUrl: getBaseUrl() });
}

function fail(err: unknown): never {
  error(String(err));
  process.exit(1);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
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
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.tepali.com/v1)')}`);
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
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
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
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.tepali.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Patients
// ============================================
program
  .command('list-patients')
  .description('List patients')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--status <status>', 'Filter by status')
  .option('--email <email>', 'Filter by email')
  .option('-q, --query <text>', 'Search query')
  .action(async (opts) => {
    try {
      const result = await getClient().patients.list({
        page: parsePositiveInt(opts.page),
        per_page: parsePositiveInt(opts.perPage),
        status: opts.status,
        email: opts.email,
        q: opts.query,
      });
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

program
  .command('get-patient <id>')
  .description('Get a patient by ID')
  .action(async (id: string) => {
    try {
      const result = await getClient().patients.get(id);
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Appointments
// ============================================
program
  .command('list-appointments')
  .description('List appointments')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--patient-id <id>', 'Filter by patient ID')
  .option('--provider-id <id>', 'Filter by provider ID')
  .option('--status <status>', 'Filter by status')
  .option('--starts-after <datetime>', 'Filter appointments starting after (ISO 8601)')
  .option('--starts-before <datetime>', 'Filter appointments starting before (ISO 8601)')
  .action(async (opts) => {
    try {
      const result = await getClient().appointments.list({
        page: parsePositiveInt(opts.page),
        per_page: parsePositiveInt(opts.perPage),
        patient_id: opts.patientId,
        provider_id: opts.providerId,
        status: opts.status,
        starts_after: opts.startsAfter,
        starts_before: opts.startsBefore,
      });
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

program
  .command('create-appointment')
  .description('Create an appointment')
  .requiredOption('--patient-id <id>', 'Patient ID')
  .requiredOption('--starts-at <datetime>', 'Start time (ISO 8601)')
  .option('--ends-at <datetime>', 'End time (ISO 8601)')
  .option('--provider-id <id>', 'Provider ID')
  .option('--treatment-id <id>', 'Treatment ID')
  .option('--location <location>', 'Location')
  .option('--notes <notes>', 'Notes')
  .action(async (opts) => {
    try {
      const result = await getClient().appointments.create({
        patient_id: opts.patientId,
        starts_at: opts.startsAt,
        ends_at: opts.endsAt,
        provider_id: opts.providerId,
        treatment_id: opts.treatmentId,
        location: opts.location,
        notes: opts.notes,
      });
      success('Appointment created!');
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Treatments
// ============================================
program
  .command('list-treatments')
  .description('List treatments')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--category <category>', 'Filter by category')
  .option('--active', 'Only active treatments')
  .option('-q, --query <text>', 'Search query')
  .action(async (opts) => {
    try {
      const result = await getClient().treatments.list({
        page: parsePositiveInt(opts.page),
        per_page: parsePositiveInt(opts.perPage),
        category: opts.category,
        active: opts.active,
        q: opts.query,
      });
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Charts
// ============================================
program
  .command('create-chart')
  .description('Create a clinical chart note')
  .requiredOption('--patient-id <id>', 'Patient ID')
  .requiredOption('--content <content>', 'Chart content / note body')
  .option('--appointment-id <id>', 'Appointment ID')
  .option('--provider-id <id>', 'Provider ID')
  .option('--type <type>', 'Chart type (e.g. soap, summary)')
  .action(async (opts) => {
    try {
      const result = await getClient().charts.create({
        patient_id: opts.patientId,
        content: opts.content,
        appointment_id: opts.appointmentId,
        provider_id: opts.providerId,
        type: opts.type,
      });
      success('Chart created!');
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Inventory
// ============================================
program
  .command('list-inventory')
  .description('List inventory items')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--category <category>', 'Filter by category')
  .option('--low-stock', 'Only items at or below reorder point')
  .option('-q, --query <text>', 'Search query')
  .action(async (opts) => {
    try {
      const result = await getClient().inventory.list({
        page: parsePositiveInt(opts.page),
        per_page: parsePositiveInt(opts.perPage),
        category: opts.category,
        low_stock: opts.lowStock,
        q: opts.query,
      });
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Leads
// ============================================
program
  .command('list-leads')
  .description('List leads')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .option('--status <status>', 'Filter by status')
  .option('--source <source>', 'Filter by source')
  .option('-q, --query <text>', 'Search query')
  .action(async (opts) => {
    try {
      const result = await getClient().leads.list({
        page: parsePositiveInt(opts.page),
        per_page: parsePositiveInt(opts.perPage),
        status: opts.status,
        source: opts.source,
        q: opts.query,
      });
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Raw request passthrough
// ============================================
program
  .command('raw-request <path>')
  .description('Perform an arbitrary authenticated request against the Tepali API')
  .option('-X, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)', 'GET')
  .option('-d, --data <json>', 'Request body as a JSON string')
  .option('--param <key=value...>', 'Query parameter (repeatable)')
  .action(async (path: string, opts) => {
    try {
      const method = String(opts.method).toUpperCase() as RequestOptions['method'];

      let body: Record<string, unknown> | undefined;
      if (opts.data) {
        try {
          body = JSON.parse(opts.data);
        } catch {
          fail(`Invalid JSON in --data: ${opts.data}`);
        }
      }

      const params: Record<string, string> = {};
      if (Array.isArray(opts.param)) {
        for (const pair of opts.param) {
          const idx = String(pair).indexOf('=');
          if (idx === -1) continue;
          params[String(pair).slice(0, idx)] = String(pair).slice(idx + 1);
        }
      }

      const result = await getClient().raw(path, {
        method,
        body,
        params: Object.keys(params).length ? params : undefined,
      });
      print(result, getFormat());
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv);
