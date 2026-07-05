#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Whop } from '../api';
import {
  getApiKey,
  setApiKey,
  getCompanyId,
  setCompanyId,
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
  getApiVersionDate,
  resolveCompanyId,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-whop';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Whop connector - memberships, payments, and creator commerce')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-c, --company-id <id>', 'Company ID biz_xxx (overrides config)')
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
      process.env.WHOP_API_KEY = opts.apiKey;
    }
    if (opts.companyId) {
      process.env.WHOP_COMPANY_ID = opts.companyId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Whop {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WHOP_API_KEY.`);
    process.exit(1);
  }
  return new Whop({
    apiKey,
    companyId: getCompanyId(),
    baseUrl: getBaseUrl(),
    apiVersionDate: getApiVersionDate(),
  });
}

function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function paginationOpts(opts: Record<string, string | undefined>) {
  return {
    first: opts.first ? parseInt(opts.first, 10) : undefined,
    after: opts.after,
    before: opts.before,
    company_id: resolveCompanyId(opts.companyId),
  };
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`));
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .option('--api-key <key>', 'API key')
  .option('--company-id <id>', 'Company ID')
  .option('--use', 'Activate after create')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, companyId: opts.companyId });
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Company ID: ${config.companyId || chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-company <companyId>').action((companyId: string) => {
  setCompanyId(companyId);
  success(`Company ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${getApiKey() ? `${getApiKey()!.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Company ID: ${getCompanyId() || chalk.gray('not set')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// User commands
const userCmd = program.command('user').description('User endpoints');

userCmd.command('me').action(async function () {
  try {
    const client = getClient();
    print(await client.users.me(), getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

userCmd.command('get <id>').action(async function (id: string) {
  try {
    const client = getClient();
    print(await client.users.get(id), getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Membership commands
const membershipCmd = program.command('membership').description('Membership management');

membershipCmd
  .command('list')
  .option('--company-id <id>', 'Company ID')
  .option('--first <n>', 'Page size')
  .option('--after <cursor>', 'Cursor')
  .option('--before <cursor>', 'Cursor')
  .option('--statuses <csv>', 'Comma-separated statuses')
  .option('--product-ids <csv>', 'Comma-separated product IDs')
  .action(async function (opts) {
    try {
      const client = getClient();
      print(await client.memberships.list({
        ...paginationOpts(opts),
        statuses: parseCsv(opts.statuses),
        product_ids: parseCsv(opts.productIds),
      }), getFormat(membershipCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

membershipCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().memberships.get(id), getFormat(membershipCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

membershipCmd.command('cancel <id>').option('--immediate', 'Cancel immediately').action(async function (id: string, opts) {
  try {
    print(await getClient().memberships.cancel(id, { cancel_immediately: opts.immediate }), getFormat(membershipCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

membershipCmd.command('pause <id>').action(async function (id: string) {
  try {
    print(await getClient().memberships.pause(id), getFormat(membershipCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

membershipCmd.command('resume <id>').action(async function (id: string) {
  try {
    print(await getClient().memberships.resume(id), getFormat(membershipCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

membershipCmd.command('uncancel <id>').action(async function (id: string) {
  try {
    print(await getClient().memberships.uncancel(id), getFormat(membershipCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

membershipCmd.command('add-free-days <id>').requiredOption('--days <n>', 'Days to add').action(async function (id: string, opts) {
  try {
    print(await getClient().memberships.addFreeDays(id, { days: parseInt(opts.days, 10) }), getFormat(membershipCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Plan commands
const planCmd = program.command('plan').description('Plan management');

planCmd
  .command('list')
  .option('--account-id <id>', 'Account / company ID')
  .option('--company-id <id>', 'Alias for account-id')
  .option('--first <n>', 'Page size')
  .option('--after <cursor>', 'Cursor')
  .option('--product-ids <csv>', 'Filter by product IDs')
  .action(async function (opts) {
    try {
      const client = getClient();
      print(await client.plans.list({
        account_id: opts.accountId || resolveCompanyId(opts.companyId),
        first: opts.first ? parseInt(opts.first, 10) : undefined,
        after: opts.after,
        product_ids: parseCsv(opts.productIds),
      }), getFormat(planCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

planCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().plans.get(id), getFormat(planCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Product commands
const productCmd = program.command('product').description('Product management');

productCmd
  .command('list')
  .option('--company-id <id>', 'Company ID')
  .option('--first <n>', 'Page size')
  .option('--after <cursor>', 'Cursor')
  .action(async function (opts) {
    try {
      print(await getClient().products.list(paginationOpts(opts)), getFormat(productCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().products.get(id), getFormat(productCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Payment commands
const paymentCmd = program.command('payment').description('Payment management');

paymentCmd
  .command('list')
  .option('--company-id <id>', 'Company ID')
  .option('--first <n>', 'Page size')
  .option('--after <cursor>', 'Cursor')
  .option('--statuses <csv>', 'Comma-separated statuses')
  .action(async function (opts) {
    try {
      print(await getClient().payments.list({
        ...paginationOpts(opts),
        statuses: parseCsv(opts.statuses),
      }), getFormat(paymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().payments.get(id), getFormat(paymentCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

paymentCmd
  .command('refund <id>')
  .option('--amount <n>', 'Partial refund amount')
  .option('--reason <text>', 'Refund reason')
  .action(async function (id: string, opts) {
    try {
      print(await getClient().payments.refund(id, {
        amount: opts.amount ? parseFloat(opts.amount) : undefined,
        reason: opts.reason,
      }), getFormat(paymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Webhook commands
const webhookCmd = program.command('webhook').description('Webhook management');

webhookCmd
  .command('list')
  .option('--company-id <id>', 'Company ID')
  .option('--first <n>', 'Page size')
  .action(async function (opts) {
    try {
      print(await getClient().webhooks.list(paginationOpts(opts)), getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().webhooks.get(id), getFormat(webhookCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

webhookCmd
  .command('create')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--events <csv>', 'Comma-separated events')
  .option('--company-id <id>', 'Company ID')
  .option('--description <text>', 'Description')
  .action(async function (opts) {
    try {
      print(await getClient().webhooks.create({
        company_id: resolveCompanyId(opts.companyId),
        url: opts.url,
        events: parseCsv(opts.events) || [],
        description: opts.description,
      }), getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd.command('delete <id>').action(async function (id: string) {
  try {
    await getClient().webhooks.delete(id);
    success(`Webhook ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Promo code commands
const promoCmd = program.command('promo').description('Promo code management');

promoCmd
  .command('list')
  .option('--company-id <id>', 'Company ID')
  .option('--first <n>', 'Page size')
  .action(async function (opts) {
    try {
      print(await getClient().promoCodes.list(paginationOpts(opts)), getFormat(promoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

promoCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().promoCodes.get(id), getFormat(promoCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

promoCmd
  .command('create')
  .requiredOption('--code <code>', 'Promo code')
  .requiredOption('--promo-type <type>', 'percentage or flat_amount')
  .requiredOption('--amount-off <n>', 'Discount amount')
  .option('--company-id <id>', 'Company ID')
  .option('--plan-ids <csv>', 'Plan IDs')
  .action(async function (opts) {
    try {
      print(await getClient().promoCodes.create({
        company_id: resolveCompanyId(opts.companyId),
        code: opts.code,
        promo_type: opts.promoType,
        amount_off: parseFloat(opts.amountOff),
        plan_ids: parseCsv(opts.planIds),
      }), getFormat(promoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Review commands
const reviewCmd = program.command('review').description('Review management');

reviewCmd
  .command('list')
  .option('--company-id <id>', 'Company ID')
  .option('--product-id <id>', 'Product ID')
  .option('--first <n>', 'Page size')
  .action(async function (opts) {
    try {
      print(await getClient().reviews.list({
        ...paginationOpts(opts),
        product_id: opts.productId,
      }), getFormat(reviewCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reviewCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().reviews.get(id), getFormat(reviewCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Affiliate commands
const affiliateCmd = program.command('affiliate').description('Affiliate management');

affiliateCmd
  .command('list')
  .option('--company-id <id>', 'Company ID')
  .option('--first <n>', 'Page size')
  .option('--search <query>', 'Search query')
  .action(async function (opts) {
    try {
      print(await getClient().affiliates.list({
        ...paginationOpts(opts),
        search: opts.search,
      }), getFormat(affiliateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

affiliateCmd.command('get <id>').action(async function (id: string) {
  try {
    print(await getClient().affiliates.get(id), getFormat(affiliateCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

affiliateCmd
  .command('create')
  .requiredOption('--user-id <id>', 'User ID')
  .option('--company-id <id>', 'Company ID')
  .option('--commission-percent <n>', 'Commission percent')
  .action(async function (opts) {
    try {
      print(await getClient().affiliates.create({
        company_id: resolveCompanyId(opts.companyId),
        user_id: opts.userId,
        commission_percent: opts.commissionPercent ? parseFloat(opts.commissionPercent) : undefined,
      }), getFormat(affiliateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
