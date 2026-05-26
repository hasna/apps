#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Revolut } from '../api';
import {
  getApiToken,
  setApiToken,
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

const CONNECTOR_NAME = 'connect-revolut';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Revolut Business API connector CLI - Accounts, Payments, Counterparties, Transactions, Exchange, Cards with multi-profile support')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--sandbox', 'Use sandbox environment')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set sandbox from flag if provided
    if (opts.sandbox) {
      process.env.REVOLUT_SANDBOX = 'true';
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Revolut {
  const apiToken = getApiToken();
  const sandbox = getSandbox();

  if (!apiToken) {
    error(`No Revolut API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set REVOLUT_API_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Revolut({ apiToken, sandbox });
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
  .option('--token <token>', 'Revolut API token')
  .option('--sandbox', 'Use sandbox environment')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiToken: opts.token,
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
    info(`API Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Environment: ${config.sandbox ? 'Sandbox' : 'Production'}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set Revolut API token')
  .action((token: string) => {
    setApiToken(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-sandbox <enabled>')
  .description('Enable/disable sandbox mode (true/false)')
  .action((enabled: string) => {
    const isSandbox = enabled === 'true' || enabled === '1';
    setSandbox(isSandbox);
    success(`Sandbox mode ${isSandbox ? 'enabled' : 'disabled'}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiToken = getApiToken();
    const sandbox = getSandbox();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${apiToken ? `${apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Environment: ${sandbox ? 'Sandbox' : 'Production'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Accounts Commands
// ============================================
const accountsCmd = program
  .command('accounts')
  .description('Manage Revolut accounts');

accountsCmd
  .command('list')
  .description('List all accounts')
  .action(async () => {
    try {
      const client = getClient();
      const accounts = await client.accounts.listAccounts();
      print(accounts.map(a => ({
        id: a.id,
        name: a.name,
        balance: `${a.balance} ${a.currency}`,
        state: a.state,
      })), getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('get <accountId>')
  .description('Get account details')
  .action(async (accountId: string) => {
    try {
      const client = getClient();
      const account = await client.accounts.getAccount(accountId);
      print(account, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Balance Command (Top-level)
// ============================================
program
  .command('balance')
  .description('Show all account balances')
  .action(async () => {
    try {
      const client = getClient();
      const accounts = await client.accounts.listAccounts();
      const balances = accounts.map(a => ({
        account: a.name,
        balance: a.balance,
        currency: a.currency,
      }));
      print(balances, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Counterparties Commands
// ============================================
const counterpartiesCmd = program
  .command('counterparties')
  .description('Manage counterparties');

counterpartiesCmd
  .command('list')
  .description('List all counterparties')
  .action(async () => {
    try {
      const client = getClient();
      const counterparties = await client.counterparties.listCounterparties();
      print(counterparties.map(c => ({
        id: c.id,
        name: c.name,
        type: c.profile_type,
        country: c.country,
        state: c.state,
      })), getFormat(counterpartiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

counterpartiesCmd
  .command('get <counterpartyId>')
  .description('Get counterparty details')
  .action(async (counterpartyId: string) => {
    try {
      const client = getClient();
      const counterparty = await client.counterparties.getCounterparty(counterpartyId);
      print(counterparty, getFormat(counterpartiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

counterpartiesCmd
  .command('create')
  .description('Create a new counterparty')
  .requiredOption('--name <name>', 'Counterparty name')
  .requiredOption('--type <type>', 'Profile type (personal/business)')
  .option('--phone <phone>', 'Phone number')
  .option('--email <email>', 'Email address')
  .option('--revtag <revtag>', 'Revolut tag (for Revolut users)')
  .option('--iban <iban>', 'IBAN (for external bank accounts)')
  .option('--bic <bic>', 'BIC/SWIFT code')
  .option('--currency <currency>', 'Currency')
  .option('--country <country>', 'Bank country code')
  .action(async (opts) => {
    try {
      const client = getClient();
      const counterparty = await client.counterparties.createCounterparty({
        name: opts.name,
        profile_type: opts.type as 'personal' | 'business',
        phone: opts.phone,
        email: opts.email,
        revtag: opts.revtag,
        iban: opts.iban,
        bic: opts.bic,
        currency: opts.currency,
        bank_country: opts.country,
      });
      success(`Counterparty created: ${counterparty.id}`);
      print(counterparty, getFormat(counterpartiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

counterpartiesCmd
  .command('delete <counterpartyId>')
  .description('Delete a counterparty')
  .action(async (counterpartyId: string) => {
    try {
      const client = getClient();
      await client.counterparties.deleteCounterparty(counterpartyId);
      success(`Counterparty ${counterpartyId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payments Commands
// ============================================
const paymentsCmd = program
  .command('payments')
  .description('Manage payments and transfers');

paymentsCmd
  .command('create <accountId> <counterpartyId> <amount> <currency>')
  .description('Create a payment to a counterparty')
  .option('--reference <reference>', 'Payment reference')
  .option('--schedule <date>', 'Schedule for future date (YYYY-MM-DD)')
  .option('--counterparty-account <accountId>', 'Counterparty account ID')
  .action(async (accountId: string, counterpartyId: string, amount: string, currency: string, opts) => {
    try {
      const client = getClient();
      const requestId = `pay_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const payment = await client.payments.createPayment({
        request_id: requestId,
        account_id: accountId,
        receiver: {
          counterparty_id: counterpartyId,
          account_id: opts.counterpartyAccount,
        },
        amount: parseFloat(amount),
        currency: currency.toUpperCase(),
        reference: opts.reference,
        schedule_for: opts.schedule,
      });

      success(`Payment created: ${payment.id}`);
      print(payment, getFormat(paymentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentsCmd
  .command('get <paymentId>')
  .description('Get payment details')
  .action(async (paymentId: string) => {
    try {
      const client = getClient();
      const payment = await client.payments.getPayment(paymentId);
      print(payment, getFormat(paymentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentsCmd
  .command('cancel <paymentId>')
  .description('Cancel a scheduled payment')
  .action(async (paymentId: string) => {
    try {
      const client = getClient();
      await client.payments.cancelPayment(paymentId);
      success(`Payment ${paymentId} cancelled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentsCmd
  .command('transfer <sourceAccountId> <targetAccountId> <amount> <currency>')
  .description('Transfer between own accounts')
  .option('--reference <reference>', 'Transfer reference')
  .action(async (sourceAccountId: string, targetAccountId: string, amount: string, currency: string, opts) => {
    try {
      const client = getClient();
      const requestId = `xfer_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const transfer = await client.payments.createTransfer({
        request_id: requestId,
        source_account_id: sourceAccountId,
        target_account_id: targetAccountId,
        amount: parseFloat(amount),
        currency: currency.toUpperCase(),
        reference: opts.reference,
      });

      success(`Transfer created: ${transfer.id}`);
      print(transfer, getFormat(paymentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transactions Commands
// ============================================
const transactionsCmd = program
  .command('transactions')
  .description('View transactions');

transactionsCmd
  .command('list')
  .description('List transactions')
  .option('--from <date>', 'Start date (ISO format)')
  .option('--to <date>', 'End date (ISO format)')
  .option('--count <number>', 'Maximum number of transactions')
  .option('--type <type>', 'Transaction type filter')
  .action(async (opts) => {
    try {
      const client = getClient();
      const transactions = await client.transactions.listTransactions({
        from: opts.from,
        to: opts.to,
        count: opts.count ? parseInt(opts.count) : undefined,
        type: opts.type,
      });

      print(transactions.map(tx => ({
        id: tx.id,
        type: tx.type,
        state: tx.state,
        created_at: tx.created_at,
        reference: tx.reference,
        legs: tx.legs.map(leg => `${leg.amount} ${leg.currency}`).join(', '),
      })), getFormat(transactionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionsCmd
  .command('get <transactionId>')
  .description('Get transaction details')
  .action(async (transactionId: string) => {
    try {
      const client = getClient();
      const transaction = await client.transactions.getTransaction(transactionId);
      print(transaction, getFormat(transactionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Exchange Commands
// ============================================
const exchangeCmd = program
  .command('exchange')
  .description('Currency exchange operations');

exchangeCmd
  .command('rate <from> <to>')
  .description('Get exchange rate between currencies')
  .option('--amount <amount>', 'Amount to convert (for reference)')
  .action(async (from: string, to: string, opts) => {
    try {
      const client = getClient();
      const rate = await client.exchange.getRate(
        from.toUpperCase(),
        to.toUpperCase(),
        opts.amount ? parseFloat(opts.amount) : undefined
      );

      print({
        from: rate.from,
        to: rate.to,
        rate: rate.rate,
        ...(opts.amount && {
          amount: parseFloat(opts.amount),
          result: parseFloat(opts.amount) * rate.rate,
        }),
        ...(rate.fee && { fee: rate.fee }),
      }, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exchangeCmd
  .command('convert <fromAccountId> <toAccountId> <amount>')
  .description('Exchange currency between accounts')
  .requiredOption('--from-currency <currency>', 'Source currency')
  .requiredOption('--to-currency <currency>', 'Target currency')
  .option('--reference <reference>', 'Exchange reference')
  .action(async (fromAccountId: string, toAccountId: string, amount: string, opts) => {
    try {
      const client = getClient();
      const result = await client.exchange.quickExchange(
        fromAccountId,
        toAccountId,
        opts.fromCurrency.toUpperCase(),
        opts.toCurrency.toUpperCase(),
        parseFloat(amount),
        opts.reference
      );

      success(`Exchange completed: ${result.id}`);
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Cards Commands
// ============================================
const cardsCmd = program
  .command('cards')
  .description('Manage virtual cards');

cardsCmd
  .command('list')
  .description('List all cards')
  .action(async () => {
    try {
      const client = getClient();
      const cards = await client.cards.listCards();
      print(cards.map(c => ({
        id: c.id,
        label: c.label,
        last_four: c.last_four_digits,
        expiry: c.expiry,
        state: c.state,
        virtual: c.virtual ? 'Yes' : 'No',
      })), getFormat(cardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd
  .command('get <cardId>')
  .description('Get card details')
  .action(async (cardId: string) => {
    try {
      const client = getClient();
      const card = await client.cards.getCard(cardId);
      print(card, getFormat(cardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd
  .command('create')
  .description('Create a virtual card')
  .option('--label <label>', 'Card label')
  .option('--holder <holderId>', 'Card holder ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const card = await client.cards.createVirtualCard({
        label: opts.label,
        holder_id: opts.holder,
      });

      success(`Virtual card created: ${card.id}`);
      print(card, getFormat(cardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd
  .command('freeze <cardId>')
  .description('Freeze a card')
  .action(async (cardId: string) => {
    try {
      const client = getClient();
      const card = await client.cards.freezeCard(cardId);
      success(`Card ${cardId} frozen`);
      print(card, getFormat(cardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd
  .command('unfreeze <cardId>')
  .description('Unfreeze a card')
  .action(async (cardId: string) => {
    try {
      const client = getClient();
      const card = await client.cards.unfreezeCard(cardId);
      success(`Card ${cardId} unfrozen`);
      print(card, getFormat(cardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd
  .command('terminate <cardId>')
  .description('Terminate a card')
  .action(async (cardId: string) => {
    try {
      const client = getClient();
      await client.cards.terminateCard(cardId);
      success(`Card ${cardId} terminated`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
