#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StripeBillingAdvanced } from '../api';
import {
  getApiKey,
  setApiKey,
  getApiVersion,
  setApiVersion,
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
  getBaseUrl,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, parseJsonBody } from '../utils/output';

const CONNECTOR_NAME = 'connect-stripe-billing-advanced';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Billing Advanced connector - Usage-based billing with pricing plans and billing intents')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
      process.env.STRIPE_BILLING_ADVANCED_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): StripeBillingAdvanced {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_BILLING_ADVANCED_API_KEY.`);
    process.exit(1);
  }
  return new StripeBillingAdvanced({
    apiKey,
    apiVersion: getApiVersion(),
    baseUrl: getBaseUrl(),
  });
}

function addListOptions(cmd: Command): void {
  cmd
    .option('--limit <number>', 'Page size')
    .option('--starting-after <id>', 'Cursor for pagination')
    .option('--ending-before <id>', 'Cursor for pagination');
}

function listParamsFromOpts(opts: Record<string, string | undefined>) {
  return {
    limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    starting_after: opts.startingAfter,
    ending_before: opts.endingBefore,
  };
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

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--api-version <version>', 'Stripe API version')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, apiVersion: opts.apiVersion });
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
    info(`API Version: ${config.apiVersion || chalk.gray('default (2026-05-27.preview)')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set Stripe secret API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-version <apiVersion>')
  .description('Set Stripe-Version header for v2 billing')
  .action((apiVersion: string) => {
    setApiVersion(apiVersion);
    success(`API version saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`API Version: ${getApiVersion() || '2026-05-27.preview (default)'}`);
  info(`Base URL: ${getBaseUrl() || 'https://api.stripe.com (default)'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Pricing plans
const pricingPlansCmd = program.command('pricing-plans').description('Pricing plan management');
addListOptions(pricingPlansCmd.command('list').description('List pricing plans').action(async (opts) => {
  try {
    const client = getClient();
    print(await client.listPricingPlans(listParamsFromOpts(opts)), getFormat(pricingPlansCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}));

pricingPlansCmd.command('get <id>').description('Get a pricing plan').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.getPricingPlan(id), getFormat(pricingPlansCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

pricingPlansCmd
  .command('create')
  .description('Create a pricing plan')
  .option('--data <json>', 'Full request body as JSON')
  .option('--display-name <name>', 'Display name')
  .option('--currency <currency>', 'Three-letter currency code')
  .option('--tax-behavior <behavior>', 'Tax behavior (exclusive, inclusive, unspecified)')
  .action(async (opts) => {
    try {
      const body = opts.data
        ? parseJsonBody(opts.data)
        : {
            display_name: opts.displayName,
            currency: opts.currency,
            tax_behavior: opts.taxBehavior,
          };
      if (!opts.data && (!body.display_name || !body.currency)) {
        error('Provide --data JSON or --display-name and --currency');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.createPricingPlan(body);
      success('Pricing plan created');
      print(result, getFormat(pricingPlansCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Rate cards
const rateCardsCmd = program.command('rate-cards').description('Rate card management');
addListOptions(rateCardsCmd.command('list').description('List rate cards').action(async (opts) => {
  try {
    const client = getClient();
    print(await client.listRateCards(listParamsFromOpts(opts)), getFormat(rateCardsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}));

rateCardsCmd.command('get <id>').description('Get a rate card').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.getRateCard(id), getFormat(rateCardsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

rateCardsCmd
  .command('create')
  .description('Create a rate card')
  .option('--data <json>', 'Full request body as JSON')
  .option('--display-name <name>', 'Display name')
  .option('--currency <currency>', 'Three-letter currency code')
  .option('--tax-behavior <behavior>', 'Tax behavior')
  .action(async (opts) => {
    try {
      const body = opts.data
        ? parseJsonBody(opts.data)
        : {
            display_name: opts.displayName,
            currency: opts.currency,
            tax_behavior: opts.taxBehavior,
          };
      if (!opts.data && (!body.display_name || !body.currency)) {
        error('Provide --data JSON or --display-name and --currency');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.createRateCard(body);
      success('Rate card created');
      print(result, getFormat(rateCardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Billing profiles
const profilesCmd = program.command('billing-profiles').description('Billing profile management');

profilesCmd.command('get <id>').description('Get a billing profile').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.getBillingProfile(id), getFormat(profilesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

profilesCmd
  .command('create')
  .description('Create a billing profile')
  .requiredOption('--data <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createBillingProfile(parseJsonBody(opts.data));
      success('Billing profile created');
      print(result, getFormat(profilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Cadences
const cadencesCmd = program.command('cadences').description('Billing cadence management');

cadencesCmd.command('get <id>').description('Get a cadence').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.getCadence(id), getFormat(cadencesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

cadencesCmd
  .command('create')
  .description('Create a billing cadence')
  .requiredOption('--data <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createCadence(parseJsonBody(opts.data));
      success('Cadence created');
      print(result, getFormat(cadencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Billing intents
const intentsCmd = program.command('intents').description('Billing intent management');

intentsCmd.command('get <id>').description('Get a billing intent').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.getIntent(id), getFormat(intentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

intentsCmd
  .command('create')
  .description('Create a billing intent')
  .requiredOption('--data <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createIntent(parseJsonBody(opts.data));
      success('Billing intent created');
      print(result, getFormat(intentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program
  .command('raw-request')
  .description('Send a raw request to /v2/billing/*')
  .requiredOption('--path <path>', 'Path under /v2/billing (e.g. /pricing_plans)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--data <json>', 'Request body as JSON')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest(opts.path, {
        method: opts.method.toUpperCase(),
        body: opts.data ? parseJsonBody(opts.data) : undefined,
        params: opts.query ? parseJsonBody(opts.query) as Record<string, string | number | boolean | undefined> : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
