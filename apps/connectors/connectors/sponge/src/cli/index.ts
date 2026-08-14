#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Sponge } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-sponge';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Sponge (PaySponge Agent Wallet) API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
      process.env.SPONGE_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.SPONGE_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format;
    if (fmt) return fmt as OutputFormat;
    node = node.parent;
  }
  return 'pretty';
}

function getClient(): Sponge {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPONGE_API_KEY.`);
    process.exit(1);
  }
  return new Sponge({
    apiKey,
    baseUrl: getBaseUrl(),
    apiVersion: getApiVersion(),
  });
}

/** Run an API call and print the result, with uniform error handling. */
async function run(cmd: Command, fn: (client: Sponge) => Promise<unknown>): Promise<void> {
  try {
    const client = getClient();
    const result = await fn(client);
    print(result, getFormat(cmd));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function parseJson(label: string, value?: string): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}: ${value}`);
    process.exit(1);
  }
}

function toBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return value === true || value === 'true';
}

function toNum(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Manage configuration profiles');

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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
    info(`API Version: ${config.apiVersion || chalk.gray('default')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

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
  .command('set-version <version>')
  .description('Set Sponge-Version header value')
  .action((version: string) => {
    setApiVersion(version);
    success(`API version saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.wallet.paysponge.com)')}`);
    info(`API Version: ${getApiVersion() || chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Agents
// ============================================
const agentCmd = program.command('agent').description('Manage agents');

agentCmd
  .command('me')
  .description('Get the agent for the current API key')
  .action(function (this: Command) { return run(this, c => c.agents.me()); });

agentCmd
  .command('list')
  .description('List agents')
  .option('--include-balances', 'Include wallet balances')
  .action(function (this: Command, opts) {
    return run(this, c => c.agents.list({ includeBalances: toBool(opts.includeBalances) }));
  });

agentCmd
  .command('get <id>')
  .description('Get an agent by id')
  .option('--include-balances', 'Include wallet balances')
  .action(function (this: Command, id: string, opts) {
    return run(this, c => c.agents.get(id, { includeBalances: toBool(opts.includeBalances) }));
  });

agentCmd
  .command('create')
  .description('Create an agent')
  .requiredOption('--name <name>', 'Agent name')
  .option('--description <text>', 'Description')
  .option('--type <type>', 'Agent type')
  .option('--daily-limit <amount>', 'Daily spending limit')
  .option('--weekly-limit <amount>', 'Weekly spending limit')
  .option('--monthly-limit <amount>', 'Monthly spending limit')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(function (this: Command, opts) {
    return run(this, c => c.agents.create({
      name: opts.name,
      description: opts.description,
      agentType: opts.type,
      dailySpendingLimit: opts.dailyLimit,
      weeklySpendingLimit: opts.weeklyLimit,
      monthlySpendingLimit: opts.monthlyLimit,
      metadata: parseJson('--metadata', opts.metadata) as Record<string, unknown> | undefined,
    }));
  });

agentCmd
  .command('update <id>')
  .description('Update an agent')
  .option('--name <name>', 'Agent name')
  .option('--description <text>', 'Description')
  .option('--type <type>', 'Agent type')
  .option('--status <status>', 'Status')
  .option('--daily-limit <amount>', 'Daily spending limit')
  .option('--weekly-limit <amount>', 'Weekly spending limit')
  .option('--monthly-limit <amount>', 'Monthly spending limit')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(function (this: Command, id: string, opts) {
    return run(this, c => c.agents.update(id, {
      name: opts.name,
      description: opts.description,
      agentType: opts.type,
      status: opts.status,
      dailySpendingLimit: opts.dailyLimit,
      weeklySpendingLimit: opts.weeklyLimit,
      monthlySpendingLimit: opts.monthlyLimit,
      metadata: parseJson('--metadata', opts.metadata) as Record<string, unknown> | undefined,
    }));
  });

agentCmd
  .command('delete <id>')
  .description('Delete an agent')
  .action(function (this: Command, id: string) { return run(this, c => c.agents.delete(id)); });

agentCmd
  .command('api-key <id>')
  .description("Get an agent's API key")
  .action(function (this: Command, id: string) { return run(this, c => c.agents.getApiKey(id)); });

agentCmd
  .command('regenerate-key <id>')
  .description("Regenerate an agent's API key")
  .action(function (this: Command, id: string) { return run(this, c => c.agents.regenerateKey(id)); });

// ============================================
// Wallets
// ============================================
const walletCmd = program.command('wallet').description('Wallets and balances');

walletCmd
  .command('balances')
  .description('Get aggregated balances')
  .option('--chain <chain>', 'Filter by chain')
  .option('--allowed-chains <chains>', 'Comma-separated allowed chains')
  .option('--only-usdc', 'Only USDC balances')
  .action(function (this: Command, opts) {
    return run(this, c => c.wallets.balances({
      chain: opts.chain,
      allowedChains: opts.allowedChains,
      onlyUsdc: toBool(opts.onlyUsdc),
    }));
  });

walletCmd
  .command('list')
  .description('List wallets')
  .option('--include-balances', 'Include balances')
  .action(function (this: Command, opts) {
    return run(this, c => c.wallets.list({ includeBalances: toBool(opts.includeBalances) }));
  });

walletCmd
  .command('get <id>')
  .description('Get a wallet by id')
  .action(function (this: Command, id: string) { return run(this, c => c.wallets.get(id)); });

walletCmd
  .command('balance <id>')
  .description("Get a wallet's balance")
  .option('--chain-id <chainId>', 'Chain id')
  .action(function (this: Command, id: string, opts) {
    return run(this, c => c.wallets.balance(id, { chainId: opts.chainId }));
  });

// ============================================
// Transfers / Tokens / Transactions
// ============================================
const transferCmd = program.command('transfer').description('Transfers, tokens, swaps, and transactions');

transferCmd
  .command('evm')
  .description('Transfer funds on an EVM chain')
  .requiredOption('--chain <chain>', 'Chain')
  .requiredOption('--to <address>', 'Recipient address')
  .requiredOption('--amount <amount>', 'Amount')
  .requiredOption('--currency <currency>', 'ETH or USDC')
  .action(function (this: Command, opts) {
    return run(this, c => c.transfers.evm({
      chain: opts.chain, to: opts.to, amount: opts.amount, currency: opts.currency,
    }));
  });

transferCmd
  .command('solana')
  .description('Transfer funds on Solana')
  .requiredOption('--chain <chain>', 'Chain')
  .requiredOption('--to <address>', 'Recipient address')
  .requiredOption('--amount <amount>', 'Amount')
  .requiredOption('--currency <currency>', 'SOL or USDC')
  .action(function (this: Command, opts) {
    return run(this, c => c.transfers.solana({
      chain: opts.chain, to: opts.to, amount: opts.amount, currency: opts.currency,
    }));
  });

transferCmd
  .command('tokens <chain>')
  .description('List Solana tokens for a chain')
  .action(function (this: Command, chain: string) { return run(this, c => c.transfers.solanaTokens(chain)); });

transferCmd
  .command('search-tokens <query>')
  .description('Search Solana tokens')
  .option('--limit <n>', 'Result limit')
  .action(function (this: Command, query: string, opts) {
    return run(this, c => c.transfers.searchSolanaTokens(query, { limit: toNum(opts.limit) }));
  });

transferCmd
  .command('history')
  .description('List recent transactions')
  .option('--limit <n>', 'Result limit')
  .option('--chain <chain>', 'Filter by chain')
  .action(function (this: Command, opts) {
    return run(this, c => c.transfers.history({ limit: toNum(opts.limit), chain: opts.chain }));
  });

transferCmd
  .command('status <txHash>')
  .description('Get a transaction status')
  .requiredOption('--chain <chain>', 'Chain')
  .action(function (this: Command, txHash: string, opts) {
    return run(this, c => c.transfers.status(txHash, opts.chain));
  });

transferCmd
  .command('swap')
  .description('Swap tokens on a chain')
  .requiredOption('--chain <chain>', 'Chain')
  .requiredOption('--input <token>', 'Input token')
  .requiredOption('--output <token>', 'Output token')
  .requiredOption('--amount <amount>', 'Amount')
  .option('--slippage-bps <bps>', 'Slippage in basis points')
  .action(function (this: Command, opts) {
    return run(this, c => c.transfers.swap({
      chain: opts.chain, inputToken: opts.input, outputToken: opts.output,
      amount: opts.amount, slippageBps: toNum(opts.slippageBps),
    }));
  });

transferCmd
  .command('base-swap')
  .description('Swap tokens on Base')
  .requiredOption('--chain <chain>', 'Chain')
  .requiredOption('--input <token>', 'Input token')
  .requiredOption('--output <token>', 'Output token')
  .requiredOption('--amount <amount>', 'Amount')
  .option('--slippage-bps <bps>', 'Slippage in basis points')
  .action(function (this: Command, opts) {
    return run(this, c => c.transfers.baseSwap({
      chain: opts.chain, inputToken: opts.input, outputToken: opts.output,
      amount: opts.amount, slippageBps: toNum(opts.slippageBps),
    }));
  });

transferCmd
  .command('bridge')
  .description('Bridge tokens between chains')
  .requiredOption('--source-chain <chain>', 'Source chain')
  .requiredOption('--destination-chain <chain>', 'Destination chain')
  .requiredOption('--token <token>', 'Token')
  .requiredOption('--amount <amount>', 'Amount')
  .option('--destination-token <token>', 'Destination token')
  .option('--recipient <address>', 'Recipient address')
  .action(function (this: Command, opts) {
    return run(this, c => c.transfers.bridge({
      sourceChain: opts.sourceChain, destinationChain: opts.destinationChain,
      token: opts.token, amount: opts.amount,
      destinationToken: opts.destinationToken, recipientAddress: opts.recipient,
    }));
  });

// ============================================
// Payments (x402 / MPP)
// ============================================
const paymentCmd = program.command('payment').description('x402 and MPP paid requests');

paymentCmd
  .command('x402-fetch <url>')
  .description('Perform an x402 paid HTTP fetch')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--headers <json>', 'Headers JSON object')
  .option('--body <json>', 'Request body JSON')
  .action(function (this: Command, url: string, opts) {
    return run(this, c => c.payments.x402Fetch({
      url, method: opts.method,
      headers: parseJson('--headers', opts.headers) as Record<string, string> | undefined,
      body: parseJson('--body', opts.body),
    }));
  });

paymentCmd
  .command('mpp-fetch <url>')
  .description('Perform an MPP paid fetch')
  .option('--chain <chain>', 'Chain (tempo)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--headers <json>', 'Headers JSON object')
  .option('--body <json>', 'Request body JSON')
  .action(function (this: Command, url: string, opts) {
    return run(this, c => c.payments.mppFetch({
      url, chain: opts.chain, method: opts.method,
      headers: parseJson('--headers', opts.headers) as Record<string, string> | undefined,
      body: parseJson('--body', opts.body),
    }));
  });

paymentCmd
  .command('mpp-start')
  .description('Start an MPP session')
  .option('--chain <chain>', 'Chain (tempo)')
  .option('--max-deposit <amount>', 'Maximum deposit')
  .option('--deposit <amount>', 'Deposit')
  .action(function (this: Command, opts) {
    return run(this, c => c.payments.mppSessionStart({
      chain: opts.chain, max_deposit: opts.maxDeposit, deposit: opts.deposit,
    }));
  });

paymentCmd
  .command('mpp-request <sessionId> <url>')
  .description('Issue a request within an MPP session')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--headers <json>', 'Headers JSON object')
  .option('--body <json>', 'Request body JSON')
  .option('--stream', 'Stream the response')
  .action(function (this: Command, sessionId: string, url: string, opts) {
    return run(this, c => c.payments.mppSessionRequest({
      session_id: sessionId, url, method: opts.method,
      headers: parseJson('--headers', opts.headers) as Record<string, string> | undefined,
      body: parseJson('--body', opts.body),
      stream: toBool(opts.stream),
    }));
  });

paymentCmd
  .command('mpp-close <sessionId>')
  .description('Close an MPP session')
  .option('--reason <reason>', 'Reason')
  .action(function (this: Command, sessionId: string, opts) {
    return run(this, c => c.payments.mppSessionClose({ session_id: sessionId, reason: opts.reason }));
  });

paymentCmd
  .command('mpp-sessions')
  .description('List MPP sessions')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Result limit')
  .action(function (this: Command, opts) {
    return run(this, c => c.payments.mppSessions({ status: opts.status, limit: toNum(opts.limit) }));
  });

// ============================================
// Trading (Hyperliquid)
// ============================================
program
  .command('hyperliquid <action>')
  .description('Execute a Hyperliquid action (status, order, cancel, positions, markets, ...)')
  .option('--symbol <symbol>', 'Market symbol')
  .option('--side <side>', 'buy or sell')
  .option('--type <type>', 'limit or market')
  .option('--amount <amount>', 'Amount')
  .option('--price <price>', 'Price')
  .option('--reduce-only', 'Reduce-only order')
  .option('--trigger-price <price>', 'Trigger price')
  .option('--tp-sl <tpSl>', 'tp or sl')
  .option('--tif <tif>', 'GTC, IOC, or PO')
  .option('--order-id <id>', 'Order id')
  .option('--leverage <n>', 'Leverage')
  .option('--since <ms>', 'Since timestamp (ms)')
  .option('--limit <n>', 'Result limit')
  .option('--offset <n>', 'Offset')
  .option('--query <query>', 'Query')
  .option('--market-type <type>', 'spot or swap')
  .option('--full', 'Full response')
  .option('--destination <address>', 'Destination address')
  .option('--to-perp', 'Transfer to perp')
  .option('--abstraction <mode>', 'disabled, unifiedAccount, or portfolioMargin')
  .action(function (this: Command, action: string, opts) {
    return run(this, c => c.trading.hyperliquid({
      action: action as never,
      symbol: opts.symbol,
      side: opts.side,
      type: opts.type,
      amount: opts.amount,
      price: opts.price,
      reduce_only: toBool(opts.reduceOnly),
      trigger_price: opts.triggerPrice,
      tp_sl: opts.tpSl,
      tif: opts.tif,
      order_id: opts.orderId,
      leverage: toNum(opts.leverage),
      since: toNum(opts.since),
      limit: toNum(opts.limit),
      offset: toNum(opts.offset),
      query: opts.query,
      market_type: opts.marketType,
      full: toBool(opts.full),
      destination: opts.destination,
      to_perp: toBool(opts.toPerp),
      abstraction: opts.abstraction,
    }));
  });

// ============================================
// Onramp
// ============================================
const onrampCmd = program.command('onramp').description('Fiat onramps (Coinbase, Stripe, crypto)');

onrampCmd
  .command('crypto <walletAddress>')
  .description('Create a crypto onramp')
  .option('--provider <provider>', 'auto, stripe, or coinbase')
  .option('--chain <chain>', 'base, solana, or polygon')
  .option('--fiat-amount <amount>', 'Fiat amount')
  .option('--fiat-currency <currency>', 'Fiat currency')
  .option('--lock-wallet-address', 'Lock the wallet address')
  .option('--redirect-url <url>', 'Redirect URL')
  .action(function (this: Command, walletAddress: string, opts) {
    return run(this, c => c.onramp.crypto({
      wallet_address: walletAddress,
      provider: opts.provider,
      chain: opts.chain,
      fiat_amount: opts.fiatAmount,
      fiat_currency: opts.fiatCurrency,
      lock_wallet_address: toBool(opts.lockWalletAddress),
      redirect_url: opts.redirectUrl,
    }));
  });

onrampCmd
  .command('coinbase-status')
  .description('Coinbase onramp status')
  .action(function (this: Command) { return run(this, c => c.onramp.coinbaseStatus()); });

onrampCmd
  .command('coinbase-supported')
  .description('Coinbase onramp supported assets/chains')
  .action(function (this: Command) { return run(this, c => c.onramp.coinbaseSupported()); });

onrampCmd
  .command('coinbase-url')
  .description('Generate a Coinbase onramp URL')
  .requiredOption('--addresses <json>', 'Addresses JSON array [{chainId,address}]')
  .option('--default-chain-id <id>', 'Default chain id')
  .option('--default-asset <asset>', 'Default asset')
  .option('--preset-fiat-amount <amount>', 'Preset fiat amount')
  .option('--fiat-currency <currency>', 'Fiat currency')
  .option('--redirect-url <url>', 'Redirect URL')
  .action(function (this: Command, opts) {
    return run(this, c => c.onramp.coinbaseUrl({
      addresses: parseJson('--addresses', opts.addresses) as never,
      defaultChainId: toNum(opts.defaultChainId),
      defaultAsset: opts.defaultAsset,
      presetFiatAmount: toNum(opts.presetFiatAmount),
      fiatCurrency: opts.fiatCurrency,
      redirectUrl: opts.redirectUrl,
    }));
  });

onrampCmd
  .command('coinbase-session-status <sessionToken>')
  .description('Coinbase onramp session status')
  .action(function (this: Command, sessionToken: string) {
    return run(this, c => c.onramp.coinbaseSessionStatus(sessionToken));
  });

onrampCmd
  .command('coinbase-session-abandon <sessionToken>')
  .description('Abandon a Coinbase onramp session')
  .action(function (this: Command, sessionToken: string) {
    return run(this, c => c.onramp.coinbaseSessionAbandon(sessionToken));
  });

onrampCmd
  .command('stripe-status')
  .description('Stripe onramp status')
  .action(function (this: Command) { return run(this, c => c.onramp.stripeStatus()); });

onrampCmd
  .command('stripe-supported')
  .description('Stripe onramp supported assets/chains')
  .action(function (this: Command) { return run(this, c => c.onramp.stripeSupported()); });

onrampCmd
  .command('stripe-session')
  .description('Create a Stripe onramp session')
  .requiredOption('--addresses <json>', 'Addresses JSON array [{chainId,address}]')
  .option('--lock-wallet-address', 'Lock the wallet address')
  .action(function (this: Command, opts) {
    return run(this, c => c.onramp.stripeSession({
      addresses: parseJson('--addresses', opts.addresses) as never,
      lockWalletAddress: toBool(opts.lockWalletAddress),
    }));
  });

onrampCmd
  .command('stripe-session-status <sessionId>')
  .description('Stripe onramp session status')
  .action(function (this: Command, sessionId: string) {
    return run(this, c => c.onramp.stripeSessionStatus(sessionId));
  });

onrampCmd
  .command('stripe-session-abandon <sessionId>')
  .description('Abandon a Stripe onramp session')
  .action(function (this: Command, sessionId: string) {
    return run(this, c => c.onramp.stripeSessionAbandon(sessionId));
  });

// ============================================
// Cards
// ============================================
const cardCmd = program.command('card').description('Cards and Sponge Card lifecycle');

cardCmd
  .command('store-credit-card')
  .description('Store a credit card (provide full card JSON)')
  .requiredOption('--data <json>', 'Card JSON matching the store-credit-card schema')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.storeCreditCard(parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('list-credit-cards')
  .description('List stored credit cards')
  .option('--agent-id <id>', 'Agent id')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.listCreditCards({ agentId: opts.agentId }));
  });

cardCmd
  .command('link-payment-method <agentId>')
  .description('Link a Link payment method to an agent')
  .requiredOption('--data <json>', 'Link payment method JSON')
  .action(function (this: Command, agentId: string, opts) {
    return run(this, c => c.cards.linkPaymentMethod(agentId, parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('link-payment-credential <agentId>')
  .description('Create a Link payment credential for an agent')
  .requiredOption('--data <json>', 'Link payment credential JSON')
  .action(function (this: Command, agentId: string, opts) {
    return run(this, c => c.cards.linkPaymentCredential(agentId, parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('get-card')
  .description('Get a card for a payment')
  .requiredOption('--data <json>', 'Get-card request JSON')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.getCard(parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('issue-virtual-card')
  .description('Issue a virtual card')
  .requiredOption('--data <json>', 'Issue-virtual-card request JSON')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.issueVirtualCard(parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('report-usage')
  .description('Report card usage')
  .requiredOption('--data <json>', 'Report-card-usage request JSON')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.reportCardUsage(parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('sponge-status')
  .description('Get Sponge Card status')
  .option('--agent-id <id>', 'Agent id')
  .option('--refresh', 'Force refresh')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.spongeCardStatus({ agentId: opts.agentId, refresh: toBool(opts.refresh) }));
  });

cardCmd
  .command('sponge-onboard')
  .description('Begin Sponge Card onboarding')
  .requiredOption('--data <json>', 'Sponge Card onboard JSON')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.spongeCardOnboard(parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('sponge-terms')
  .description('Accept Sponge Card terms')
  .requiredOption('--data <json>', 'Sponge Card terms JSON')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.spongeCardTerms(parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('sponge-create')
  .description('Create a Sponge Card')
  .requiredOption('--data <json>', 'Create Sponge Card JSON')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.spongeCardCreate(parseJson('--data', opts.data) as never));
  });

cardCmd
  .command('sponge-details')
  .description('Get Sponge Card details')
  .option('--agent-id <id>', 'Agent id')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.spongeCardDetails({ agentId: opts.agentId }));
  });

cardCmd
  .command('sponge-fund')
  .description('Fund the Sponge Card')
  .requiredOption('--amount <amount>', 'Amount')
  .option('--chain <chain>', 'Chain')
  .option('--agent-id <id>', 'Agent id')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.spongeCardFund({ amount: opts.amount, chain: opts.chain, agentId: opts.agentId }));
  });

cardCmd
  .command('sponge-withdraw')
  .description('Withdraw from the Sponge Card')
  .requiredOption('--amount <amount>', 'Amount')
  .option('--chain <chain>', 'Chain')
  .option('--agent-id <id>', 'Agent id')
  .action(function (this: Command, opts) {
    return run(this, c => c.cards.spongeCardWithdraw({ amount: opts.amount, chain: opts.chain, agentId: opts.agentId }));
  });

// ============================================
// Agent Service Keys (Secrets)
// ============================================
const keyCmd = program.command('key').description('Agent service keys (secrets)');

keyCmd
  .command('store')
  .description('Store a service key for an agent')
  .requiredOption('--service <service>', 'Service name')
  .requiredOption('--key <value>', 'Key value')
  .option('--label <label>', 'Label')
  .option('--metadata <json>', 'Metadata JSON object')
  .option('--agent-id <id>', 'Agent id')
  .action(function (this: Command, opts) {
    return run(this, c => c.keys.store({
      service: opts.service, key: opts.key, label: opts.label,
      metadata: parseJson('--metadata', opts.metadata) as Record<string, unknown> | undefined,
      agentId: opts.agentId,
    }));
  });

keyCmd
  .command('list')
  .description('List stored service keys')
  .option('--agent-id <id>', 'Agent id')
  .option('--service <service>', 'Filter by service')
  .action(function (this: Command, opts) {
    return run(this, c => c.keys.list({ agentId: opts.agentId, service: opts.service }));
  });

keyCmd
  .command('delete <service>')
  .description('Delete a stored service key')
  .option('--agent-id <id>', 'Agent id')
  .action(function (this: Command, service: string, opts) {
    return run(this, c => c.keys.delete(service, { agentId: opts.agentId }));
  });

keyCmd
  .command('value <service>')
  .description('Retrieve the raw value of a stored service key')
  .option('--agent-id <id>', 'Agent id')
  .action(function (this: Command, service: string, opts) {
    return run(this, c => c.keys.value(service, { agentId: opts.agentId }));
  });

// ============================================
// Raw request escape hatch
// ============================================
program
  .command('raw <path>')
  .description('Call any Sponge API path directly')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query params JSON object')
  .option('--body <json>', 'Request body JSON')
  .action(function (this: Command, path: string, opts) {
    return run(this, c => c.raw.request(path, {
      method: opts.method,
      params: parseJson('--query', opts.query) as Record<string, string> | undefined,
      body: parseJson('--body', opts.body),
    }));
  });

program.parse();
