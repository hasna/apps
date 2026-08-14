#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getConnectorConfig,
  getProductId,
  setProductId,
  setIdentityToken,
  setBaseUrl,
  setModel,
  setSubdomain,
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

const CONNECTOR_NAME = 'connect-usecrow';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Crow Platform API connector CLI')
  .version(VERSION)
  .option('-p, --product-id <id>', 'Product ID (overrides config)')
  .option('-t, --identity-token <token>', 'Identity JWT (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('--profile <profile>', 'Use a specific profile')
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

    if (opts.productId) {
      process.env.USECROW_PRODUCT_ID = opts.productId;
    }

    if (opts.identityToken) {
      process.env.USECROW_IDENTITY_TOKEN = opts.identityToken;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const config = getConnectorConfig();
  if (!config.productId) {
    error(`No product ID configured. Run "${CONNECTOR_NAME} config set-product-id <id>" or set USECROW_PRODUCT_ID.`);
    process.exit(1);
  }
  return new Connector(config);
}

function parseJsonOption(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error('Invalid JSON body');
    process.exit(1);
  }
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--product-id <id>', 'Product ID')
  .option('--identity-token <token>', 'Identity JWT')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      productId: opts.productId,
      identityToken: opts.identityToken,
    });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Product ID: ${config.productId ? `${config.productId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Identity Token: ${config.identityToken ? chalk.green('set') : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.usecrow.org)')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-product-id <productId>').description('Set product ID').action((productId: string) => {
  setProductId(productId);
  success(`Product ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-identity-token <token>').description('Set identity JWT').action((token: string) => {
  setIdentityToken(token);
  success(`Identity token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-model <model>').description('Set default model').action((model: string) => {
  setModel(model);
  success(`Model saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-subdomain <subdomain>').description('Set default subdomain').action((subdomain: string) => {
  setSubdomain(subdomain);
  success(`Subdomain saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const productId = getProductId();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Product ID: ${productId ? `${productId.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Chat commands
const chatCmd = program.command('chat').description('Chat and conversation operations');

chatCmd
  .command('send')
  .description('Send a chat message')
  .option('--message <text>', 'Message text')
  .option('--conversation-id <id>', 'Conversation ID')
  .option('--body <json>', 'Full request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body) || {
        ...(opts.message ? { message: opts.message } : {}),
        ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
      };
      const result = await client.chat.sendMessage(body);
      print(result, getFormat(chatCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd.command('conversations').description('List conversations').action(async () => {
  try {
    const client = getClient();
    const result = await client.chat.listConversations();
    print(result, getFormat(chatCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

chatCmd
  .command('history <conversationId>')
  .description('Get conversation history')
  .action(async (conversationId: string) => {
    try {
      const client = getClient();
      const result = await client.chat.getConversationHistory({ conversationId });
      print(result, getFormat(chatCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatCmd
  .command('history-anonymous <conversationId>')
  .description('Get anonymous conversation history')
  .action(async (conversationId: string) => {
    try {
      const client = getClient();
      const result = await client.chat.getAnonymousConversationHistory({ conversationId });
      print(result, getFormat(chatCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Workflow commands
const workflowCmd = program.command('workflow').description('Workflow operations');

workflowCmd.command('list').description('List recorded workflows').action(async () => {
  try {
    const client = getClient();
    const result = await client.workflows.listRecordedWorkflows();
    print(result, getFormat(workflowCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Browser-use commands (remote HTTP API — no local browser automation)
const browserCmd = program.command('browser-use').description('Remote browser-use session operations');

browserCmd
  .command('start')
  .description('Start a browser-use session')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.browserUse.start(parseJsonOption(opts.body) || {});
      print(result, getFormat(browserCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

browserCmd
  .command('step')
  .description('Execute a browser-use step')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.browserUse.step(parseJsonOption(opts.body) || {});
      print(result, getFormat(browserCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

browserCmd
  .command('end')
  .description('End a browser-use session')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.browserUse.end(parseJsonOption(opts.body) || {});
      print(result, getFormat(browserCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program
  .command('raw')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /api/chat/message)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        query: parseJsonOption(opts.query) as Record<string, string | number | boolean | undefined> | undefined,
        body: parseJsonOption(opts.body),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
