#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { PayPal } from '../api';
import {
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getBaseUrl,
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-paypal';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('PayPal connector CLI - Payments, orders, and invoicing')
  .version(VERSION)
  .option('--client-id <id>', 'Client ID (overrides config)')
  .option('--client-secret <secret>', 'Client Secret (overrides config)')
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
    if (opts.clientId) {
      process.env.PAYPAL_CLIENT_ID = opts.clientId;
    }
    if (opts.clientSecret) {
      process.env.PAYPAL_CLIENT_SECRET = opts.clientSecret;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): PayPal {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const baseUrl = getBaseUrl();

  if (!clientId) {
    error(`No client ID configured. Run "${CONNECTOR_NAME} config set-client-id <id>" or set PAYPAL_CLIENT_ID.`);
    process.exit(1);
  }
  if (!clientSecret) {
    error(`No client secret configured. Run "${CONNECTOR_NAME} config set-client-secret <secret>" or set PAYPAL_CLIENT_SECRET.`);
    process.exit(1);
  }
  return new PayPal({ clientId, clientSecret, baseUrl });
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
  .option('--client-id <id>', 'Client ID')
  .option('--client-secret <secret>', 'Client Secret')
  .option('--sandbox', 'Use sandbox environment (default)')
  .option('--production', 'Use production environment')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    const baseUrl = opts.production ? 'https://api-m.paypal.com' : undefined;
    createProfile(name, {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      baseUrl,
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
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${config.clientSecret ? '********' : chalk.gray('not set')}`);
    info(`Environment: ${config.baseUrl?.includes('sandbox') || !config.baseUrl ? 'Sandbox' : 'Production'}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-client-id <clientId>')
  .description('Set client ID')
  .action((clientId: string) => {
    setClientId(clientId);
    success(`Client ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-client-secret <clientSecret>')
  .description('Set client secret')
  .action((clientSecret: string) => {
    setClientSecret(clientSecret);
    success(`Client secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-environment <env>')
  .description('Set environment (sandbox or production)')
  .action((env: string) => {
    if (env !== 'sandbox' && env !== 'production') {
      error('Environment must be "sandbox" or "production"');
      process.exit(1);
    }
    const baseUrl = env === 'production' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    setBaseUrl(baseUrl);
    success(`Environment set to ${env} for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const clientId = getClientId();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${getClientSecret() ? '********' : chalk.gray('not set')}`);
    info(`Environment: ${baseUrl?.includes('sandbox') || !baseUrl ? 'Sandbox' : 'Production'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Order Commands
// ============================================
const orderCmd = program
  .command('order')
  .description('Order management commands');

orderCmd
  .command('get <orderId>')
  .description('Get order details')
  .action(async (orderId: string) => {
    try {
      const client = getClient();
      const result = await client.getOrder(orderId);
      const format = getFormat(orderCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Order: ${result.id}`));
        info(`Status: ${result.status}`);
        info(`Intent: ${result.intent}`);
        if (result.purchase_units.length > 0) {
          const unit = result.purchase_units[0];
          info(`Amount: ${unit.amount.value} ${unit.amount.currency_code}`);
        }
        if (result.create_time) info(`Created: ${result.create_time}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orderCmd
  .command('capture <orderId>')
  .description('Capture payment for an order')
  .action(async (orderId: string) => {
    try {
      const client = getClient();
      const result = await client.captureOrder(orderId);
      success(`Order captured: ${result.id}`);
      info(`Status: ${result.status}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orderCmd
  .command('authorize <orderId>')
  .description('Authorize payment for an order')
  .action(async (orderId: string) => {
    try {
      const client = getClient();
      const result = await client.authorizeOrder(orderId);
      success(`Order authorized: ${result.id}`);
      info(`Status: ${result.status}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Invoice Commands
// ============================================
const invoiceCmd = program
  .command('invoice')
  .description('Invoice management commands');

invoiceCmd
  .command('list')
  .description('List invoices')
  .option('-n, --page-size <size>', 'Number of results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listInvoices({
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
        total_required: true,
      });
      const format = getFormat(invoiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Invoices (${result.total_items || 0} total):`);
        if (result.items && result.items.length > 0) {
          result.items.forEach(inv => {
            const status = inv.status === 'PAID' ? chalk.green(`[${inv.status}]`)
              : inv.status === 'SENT' ? chalk.yellow(`[${inv.status}]`)
              : chalk.gray(`[${inv.status}]`);
            console.log(`  ${inv.detail.invoice_number || inv.id} ${status}`);
            console.log(`    ID: ${inv.id}`);
            if (inv.amount) console.log(`    Amount: ${inv.amount.value} ${inv.amount.currency_code}`);
          });
        } else {
          info('No invoices found');
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceCmd
  .command('get <invoiceId>')
  .description('Get invoice details')
  .action(async (invoiceId: string) => {
    try {
      const client = getClient();
      const result = await client.getInvoice(invoiceId);
      const format = getFormat(invoiceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Invoice: ${result.detail.invoice_number || result.id}`));
        info(`ID: ${result.id}`);
        info(`Status: ${result.status}`);
        if (result.amount) info(`Amount: ${result.amount.value} ${result.amount.currency_code}`);
        if (result.due_amount) info(`Due: ${result.due_amount.value} ${result.due_amount.currency_code}`);
        if (result.detail.invoice_date) info(`Date: ${result.detail.invoice_date}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceCmd
  .command('send <invoiceId>')
  .description('Send an invoice')
  .option('--subject <subject>', 'Email subject')
  .option('--note <note>', 'Note to recipient')
  .action(async (invoiceId: string, opts) => {
    try {
      const client = getClient();
      await client.sendInvoice(invoiceId, {
        subject: opts.subject,
        note: opts.note,
        send_to_recipient: true,
      });
      success(`Invoice sent: ${invoiceId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceCmd
  .command('cancel <invoiceId>')
  .description('Cancel an invoice')
  .option('--note <note>', 'Note to recipient')
  .action(async (invoiceId: string, opts) => {
    try {
      const client = getClient();
      await client.cancelInvoice(invoiceId, {
        note: opts.note,
        send_to_recipient: true,
      });
      success(`Invoice cancelled: ${invoiceId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceCmd
  .command('delete <invoiceId>')
  .description('Delete a draft invoice')
  .action(async (invoiceId: string) => {
    try {
      const client = getClient();
      await client.deleteInvoice(invoiceId);
      success(`Invoice deleted: ${invoiceId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payment Commands
// ============================================
const paymentCmd = program
  .command('payment')
  .description('Payment management commands');

paymentCmd
  .command('get-capture <captureId>')
  .description('Get capture details')
  .action(async (captureId: string) => {
    try {
      const client = getClient();
      const result = await client.getCapture(captureId);
      const format = getFormat(paymentCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Capture: ${result.id}`));
        info(`Status: ${result.status}`);
        info(`Amount: ${result.amount.value} ${result.amount.currency_code}`);
        if (result.create_time) info(`Created: ${result.create_time}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentCmd
  .command('refund <captureId>')
  .description('Refund a captured payment')
  .option('--amount <amount>', 'Refund amount')
  .option('--currency <code>', 'Currency code', 'USD')
  .option('--note <note>', 'Note to payer')
  .action(async (captureId: string, opts) => {
    try {
      const client = getClient();
      const options: { amount?: { currency_code: string; value: string }; note_to_payer?: string } = {};
      if (opts.amount) {
        options.amount = { currency_code: opts.currency, value: opts.amount };
      }
      if (opts.note) {
        options.note_to_payer = opts.note;
      }
      const result = await client.refundCapture(captureId, options);
      success(`Refund created: ${result.id}`);
      info(`Status: ${result.status}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentCmd
  .command('get-refund <refundId>')
  .description('Get refund details')
  .action(async (refundId: string) => {
    try {
      const client = getClient();
      const result = await client.getRefund(refundId);
      const format = getFormat(paymentCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Refund: ${result.id}`));
        info(`Status: ${result.status}`);
        if (result.amount) info(`Amount: ${result.amount.value} ${result.amount.currency_code}`);
        if (result.create_time) info(`Created: ${result.create_time}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payout Commands
// ============================================
const payoutCmd = program
  .command('payout')
  .description('Payout management commands');

payoutCmd
  .command('get <payoutBatchId>')
  .description('Get payout batch details')
  .action(async (payoutBatchId: string) => {
    try {
      const client = getClient();
      const result = await client.getPayoutBatch(payoutBatchId);
      const format = getFormat(payoutCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const header = result.batch_header;
        console.log(chalk.bold(`Payout Batch: ${header.payout_batch_id}`));
        info(`Status: ${header.batch_status}`);
        if (header.amount) info(`Total Amount: ${header.amount.value} ${header.amount.currency_code}`);
        if (header.fees) info(`Fees: ${header.fees.value} ${header.fees.currency_code}`);
        if (result.items && result.items.length > 0) {
          console.log(chalk.bold('\nItems:'));
          result.items.forEach(item => {
            console.log(`  ${item.payout_item.receiver} - ${item.payout_item.amount.value} ${item.payout_item.amount.currency_code} [${item.transaction_status}]`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

payoutCmd
  .command('get-item <payoutItemId>')
  .description('Get payout item details')
  .action(async (payoutItemId: string) => {
    try {
      const client = getClient();
      const result = await client.getPayoutItem(payoutItemId);
      const format = getFormat(payoutCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        console.log(chalk.bold(`Payout Item: ${result.payout_item_id}`));
        info(`Status: ${result.transaction_status}`);
        info(`Receiver: ${result.payout_item.receiver}`);
        info(`Amount: ${result.payout_item.amount.value} ${result.payout_item.amount.currency_code}`);
        if (result.payout_item_fee) info(`Fee: ${result.payout_item_fee.value} ${result.payout_item_fee.currency_code}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

payoutCmd
  .command('cancel-item <payoutItemId>')
  .description('Cancel an unclaimed payout item')
  .action(async (payoutItemId: string) => {
    try {
      const client = getClient();
      const result = await client.cancelPayoutItem(payoutItemId);
      success(`Payout item cancelled: ${result.payout_item_id}`);
      info(`Status: ${result.transaction_status}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
