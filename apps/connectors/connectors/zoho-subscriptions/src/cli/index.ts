#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoSubscriptions } from '../api';
import {
  getToken,
  setToken,
  getOrganizationId,
  setOrganizationId,
  getDataCenter,
  setDataCenter,
  clearConfig,
  getConfigDir,
  setOAuthConfig,
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

const CONNECTOR_NAME = 'zoho-subscriptions';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Subscriptions (Billing) API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
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
    }
    if (opts.token) {
      process.env.ZOHO_SUBSCRIPTIONS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoSubscriptions {
  const token = getToken();
  const organizationId = getOrganizationId();
  if (!token || !organizationId) {
    error(
      `Missing credentials. Set ZOHO_SUBSCRIPTIONS_TOKEN and ZOHO_SUBSCRIPTIONS_ORG_ID, or run "${CONNECTOR_NAME} config set-token" and "config set-org-id".`,
    );
    process.exit(1);
  }
  return new ZohoSubscriptions({
    token,
    organizationId,
    dataCenter: getDataCenter(),
    baseUrl: process.env.ZOHO_SUBSCRIPTIONS_BASE_URL,
  });
}

async function runAction(cmd: Command, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--use', 'Switch to this profile').action((name: string, opts) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name);
  success(`Profile "${name}" created`);
  if (opts.use) setCurrentProfile(name);
});

profileCmd.command('delete <name>').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Token: ${config.accessToken || config.token ? 'set' : chalk.gray('not set')}`);
  info(`Organization ID: ${config.organizationId || chalk.gray('not set')}`);
  info(`Data center: ${config.dataCenter || chalk.gray('com (default)')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-org-id <id>').action((id: string) => {
  setOrganizationId(id);
  success(`Organization ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-data-center <dc>').action((dc: string) => {
  setDataCenter(dc);
  success(`Data center saved to profile: ${getCurrentProfile()}`);
});

configCmd
  .command('set-credentials')
  .requiredOption('--client-id <id>', 'Zoho OAuth client ID')
  .requiredOption('--client-secret <secret>', 'Zoho OAuth client secret')
  .action((opts) => {
    setOAuthConfig({ clientId: opts.clientId, clientSecret: opts.clientSecret });
    success(`OAuth credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${getToken() ? 'set' : chalk.gray('not set')}`);
  info(`Organization ID: ${getOrganizationId() || chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter() || chalk.gray('com (default)')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const customersCmd = program.command('customers').description('Customer operations');

customersCmd
  .command('list')
  .option('--page <n>')
  .option('--per-page <n>')
  .option('--status <status>')
  .action(async (opts) => {
    await runAction(customersCmd, () =>
      getClient().listCustomers({
        page: opts.page ? Number(opts.page) : undefined,
        per_page: opts.perPage ? Number(opts.perPage) : undefined,
        status: opts.status,
      }),
    );
  });

customersCmd.command('get <id>').action(async (id: string) => {
  await runAction(customersCmd, () => getClient().getCustomer(id));
});

customersCmd
  .command('create')
  .requiredOption('--display-name <name>')
  .option('--email <email>')
  .action(async (opts) => {
    await runAction(customersCmd, () =>
      getClient().createCustomer({ display_name: opts.displayName, email: opts.email }),
    );
  });

customersCmd
  .command('update <id>')
  .option('--display-name <name>')
  .option('--email <email>')
  .action(async (id: string, opts) => {
    await runAction(customersCmd, () =>
      getClient().updateCustomer(id, { display_name: opts.displayName, email: opts.email }),
    );
  });

customersCmd.command('delete <id>').action(async (id: string) => {
  await runAction(customersCmd, () => getClient().deleteCustomer(id));
});

const subscriptionsCmd = program.command('subscriptions').description('Subscription operations');

subscriptionsCmd
  .command('list')
  .option('--page <n>')
  .option('--status <status>')
  .option('--customer-id <id>')
  .action(async (opts) => {
    await runAction(subscriptionsCmd, () =>
      getClient().listSubscriptions({
        page: opts.page ? Number(opts.page) : undefined,
        status: opts.status,
        customer_id: opts.customerId,
      }),
    );
  });

subscriptionsCmd.command('get <id>').action(async (id: string) => {
  await runAction(subscriptionsCmd, () => getClient().getSubscription(id));
});

subscriptionsCmd
  .command('create')
  .requiredOption('--customer-id <id>')
  .requiredOption('--plan-code <code>')
  .action(async (opts) => {
    await runAction(subscriptionsCmd, () =>
      getClient().createSubscription({ customer_id: opts.customerId, plan: { plan_code: opts.planCode } }),
    );
  });

subscriptionsCmd
  .command('cancel <id>')
  .option('--at-end', 'Cancel at end of term')
  .action(async (id: string, opts) => {
    await runAction(subscriptionsCmd, () => getClient().cancelSubscription(id, opts.atEnd));
  });

subscriptionsCmd.command('reactivate <id>').action(async (id: string) => {
  await runAction(subscriptionsCmd, () => getClient().reactivateSubscription(id));
});

const plansCmd = program.command('plans').description('Plan operations');

plansCmd
  .command('list')
  .option('--page <n>')
  .option('--status <status>')
  .action(async (opts) => {
    await runAction(plansCmd, () =>
      getClient().listPlans({ page: opts.page ? Number(opts.page) : undefined, status: opts.status }),
    );
  });

plansCmd.command('get <code>').action(async (code: string) => {
  await runAction(plansCmd, () => getClient().getPlan(code));
});

plansCmd
  .command('create')
  .requiredOption('--plan-code <code>')
  .requiredOption('--name <name>')
  .requiredOption('--price <n>', 'Recurring price', parseFloat)
  .action(async (opts) => {
    await runAction(plansCmd, () =>
      getClient().createPlan({ plan_code: opts.planCode, name: opts.name, recurring_price: opts.price }),
    );
  });

const invoicesCmd = program.command('invoices').description('Invoice operations');

invoicesCmd
  .command('list')
  .option('--page <n>')
  .option('--customer-id <id>')
  .option('--status <status>')
  .action(async (opts) => {
    await runAction(invoicesCmd, () =>
      getClient().listInvoices({
        page: opts.page ? Number(opts.page) : undefined,
        customer_id: opts.customerId,
        status: opts.status,
      }),
    );
  });

invoicesCmd.command('get <id>').action(async (id: string) => {
  await runAction(invoicesCmd, () => getClient().getInvoice(id));
});

invoicesCmd
  .command('record-payment <id>')
  .requiredOption('--amount <n>', 'Payment amount', parseFloat)
  .option('--payment-mode <mode>')
  .action(async (id: string, opts) => {
    await runAction(invoicesCmd, () =>
      getClient().recordInvoicePayment(id, { amount: opts.amount, payment_mode: opts.paymentMode }),
    );
  });

const webhooksCmd = program.command('webhooks').description('Webhook operations');

webhooksCmd.command('list').action(async () => {
  await runAction(webhooksCmd, () => getClient().listWebhooks());
});

webhooksCmd
  .command('create')
  .requiredOption('--name <name>')
  .requiredOption('--url <url>')
  .option('--events <events>', 'Comma-separated event names')
  .action(async (opts) => {
    const events = opts.events ? String(opts.events).split(',').map((e: string) => e.trim()) : undefined;
    await runAction(webhooksCmd, () => getClient().createWebhook({ name: opts.name, url: opts.url, events }));
  });

webhooksCmd.command('delete <id>').action(async (id: string) => {
  await runAction(webhooksCmd, () => getClient().deleteWebhook(id));
});

const orgCmd = program.command('organization').description('Get organization details');
orgCmd.action(async () => {
  await runAction(orgCmd, () => getClient().getOrganization());
});

program.parse();
