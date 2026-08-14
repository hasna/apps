#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import { UniswapApi } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-uniswap-api';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Uniswap Trade API connector - swaps, quotes, approvals, and bridgeable tokens')
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
      process.env.UNISWAP_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): UniswapApi {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UNISWAP_API_KEY.`);
    process.exit(1);
  }
  return new UniswapApi({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// Profile commands
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
      error(`Profile "${name}" does not exist.`);
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
    createProfile(name, { apiKey: opts.apiKey });
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

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Trade commands
const tradeCmd = program.command('trade').description('Uniswap Trade API operations');

tradeCmd
  .command('check-approval')
  .description('Check token approval for Permit2')
  .requiredOption('--wallet <address>', 'Wallet address')
  .requiredOption('--token <address>', 'Token contract address')
  .requiredOption('--amount <amount>', 'Amount in base units')
  .option('--chain-id <id>', 'Chain ID', '1')
  .option('--token-out <address>', 'Output token address')
  .option('--token-out-chain-id <id>', 'Output token chain ID')
  .option('--body <json>', 'Raw JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonOption(opts.body, '--body')
        : {
            walletAddress: opts.wallet,
            token: opts.token,
            amount: opts.amount,
            chainId: Number(opts.chainId),
            ...(opts.tokenOut ? { tokenOut: opts.tokenOut } : {}),
            ...(opts.tokenOutChainId ? { tokenOutChainId: Number(opts.tokenOutChainId) } : {}),
          };
      const result = await client.checkApproval(body as Parameters<UniswapApi['checkApproval']>[0]);
      print(result, getFormat(tradeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tradeCmd
  .command('quote')
  .description('Get a swap quote')
  .requiredOption('--swapper <address>', 'Swapper wallet address')
  .requiredOption('--token-in <address>', 'Input token address')
  .requiredOption('--token-out <address>', 'Output token address')
  .requiredOption('--amount <amount>', 'Amount in base units')
  .option('--token-in-chain-id <id>', 'Input chain ID', '1')
  .option('--token-out-chain-id <id>', 'Output chain ID', '1')
  .option('--type <type>', 'Quote type (EXACT_INPUT or EXACT_OUTPUT)', 'EXACT_INPUT')
  .option('--routing-preference <pref>', 'Routing preference')
  .option('--body <json>', 'Raw JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonOption(opts.body, '--body')
        : {
            swapper: opts.swapper,
            tokenIn: opts.tokenIn,
            tokenOut: opts.tokenOut,
            amount: opts.amount,
            tokenInChainId: Number(opts.tokenInChainId),
            tokenOutChainId: Number(opts.tokenOutChainId),
            type: opts.type,
            ...(opts.routingPreference ? { routingPreference: opts.routingPreference } : {}),
          };
      const result = await client.quote(body as Parameters<UniswapApi['quote']>[0]);
      print(result, getFormat(tradeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tradeCmd
  .command('swap')
  .description('Create a swap transaction from a quote')
  .option('--quote-file <path>', 'Path to quote JSON file')
  .option('--body <json>', 'Raw JSON request body (must include quote)')
  .action(async (opts) => {
    try {
      const client = getClient();
      let body: Record<string, unknown>;

      if (opts.body) {
        body = parseJsonOption(opts.body, '--body');
      } else if (opts.quoteFile) {
        body = { quote: JSON.parse(readFileSync(opts.quoteFile, 'utf-8')) };
      } else {
        error('Provide --body or --quote-file');
        process.exit(1);
      }

      const result = await client.createSwap(body as unknown as Parameters<UniswapApi['createSwap']>[0]);
      print(result, getFormat(tradeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tradeCmd
  .command('swap-status')
  .description('Get swap status by transaction or user operation hashes')
  .option('--tx-hashes <hashes>', 'Comma-separated transaction hashes')
  .option('--user-op-hashes <hashes>', 'Comma-separated user operation hashes')
  .action(async (opts) => {
    try {
      if (!opts.txHashes && !opts.userOpHashes) {
        error('Provide --tx-hashes and/or --user-op-hashes');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.getSwapStatus({
        txHashes: opts.txHashes?.split(',').map((h: string) => h.trim()).filter(Boolean),
        userOpHashes: opts.userOpHashes?.split(',').map((h: string) => h.trim()).filter(Boolean),
      });
      print(result, getFormat(tradeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tradeCmd
  .command('swappable-tokens')
  .description('List bridgeable destination tokens for a token')
  .requiredOption('--token-in <address>', 'Input token address')
  .option('--token-in-chain-id <id>', 'Input chain ID', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSwappableTokens({
        tokenIn: opts.tokenIn,
        tokenInChainId: Number(opts.tokenInChainId),
      });
      print(result, getFormat(tradeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
